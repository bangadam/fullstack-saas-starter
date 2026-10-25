import { randomUUID } from 'node:crypto'
import { uploadRequestSchema } from '@saas/contracts'
import { files } from '@saas/db'
import {
  RESERVE_FILE_SQL,
  UPLOAD_TTL_SECONDS,
  buildR2Key,
  rejectionReasonFor,
  uploadDeadlines,
} from '@saas/storage'
import { and, eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { ApiError } from '../errors'
import { billingScope } from '../lib/billing'
import { storageLimitForUser } from '../lib/plan'
import { requireSession } from '../lib/session'
import { parse } from '../lib/validation'
import type { AppBindings } from '../middleware'

const DOWNLOAD_URL_TTL_SECONDS = 300
const nowSeconds = () => Math.floor(Date.now() / 1000)

function s3Configured(env: AppBindings['Bindings']): boolean {
  return Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.CLOUDFLARE_ACCOUNT_ID)
}

async function requireActiveUser(c: Context<AppBindings>, userId: string) {
  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE id=? AND deletion_requested_at IS NULL',
  )
    .bind(userId)
    .first()
  if (!user) throw ApiError.forbidden('Account deletion is in progress')
}

async function ownedFile(c: Context<AppBindings>, userId: string) {
  const row = await c
    .get('db')
    .select()
    .from(files)
    .where(and(eq(files.id, c.req.param('id') ?? ''), eq(files.userId, userId)))
    .get()
  if (!row) throw ApiError.notFound('File')
  return row
}

type FileRow = typeof files.$inferSelect
function fileItem(row: FileRow) {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    contentType: row.contentType,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }
}

async function complete(c: Context<AppBindings>, userId: string, row: FileRow) {
  await requireActiveUser(c, userId)
  if (row.status === 'completed') return c.json(fileItem(row))
  if (row.status !== 'pending' || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) {
    throw ApiError.conflict('Upload reservation has expired or was cancelled')
  }
  const object = await c.env.BUCKET.head(row.r2Key)
  if (!object) throw ApiError.conflict('Upload is not present in storage; retry after uploading')
  if (object.size !== row.size || object.httpMetadata?.contentType !== row.contentType) {
    throw ApiError.badRequest('Uploaded object size or content type does not match the reservation')
  }
  // Conditional transition prevents completion winning over deletion/expiry.
  const result = await c.env.DB.prepare(`UPDATE files SET status='completed', completed_at=?
    WHERE id=? AND user_id=? AND status='pending' AND expires_at>?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND deletion_requested_at IS NULL)
    RETURNING id`)
    .bind(nowSeconds(), row.id, userId, nowSeconds(), userId)
    .all()
  if (!result.results.length) {
    const current = await ownedFile(c, userId)
    await requireActiveUser(c, userId)
    if (current.status === 'completed') return c.json(fileItem(current))
    throw ApiError.conflict('Upload reservation has expired or was cancelled')
  }
  return c.json(fileItem({ ...row, status: 'completed' }))
}

export const fileRoutes = new Hono<AppBindings>()

fileRoutes.get('/', async (c) => {
  const { userId } = await requireSession(c)
  const db = c.get('db')
  const rows = await db.select().from(files).where(eq(files.userId, userId)).all()
  const charged = rows.filter((row) => row.status !== 'expired')
  return c.json({
    items: rows
      .filter((row) => row.status === 'pending' || row.status === 'completed')
      .map(fileItem),
    usedBytes: charged.reduce((sum, row) => sum + row.size, 0),
    reservedBytes: charged
      .filter((row) => row.status !== 'completed')
      .reduce((sum, row) => sum + row.size, 0),
    limitBytes: await storageLimitForUser(db, userId, billingScope(c.env)),
  })
})

fileRoutes.post('/upload-url', async (c) => {
  const { userId } = await requireSession(c)
  await requireActiveUser(c, userId)
  const input = parse(uploadRequestSchema, await c.req.json())
  const rejection = rejectionReasonFor(input)
  if (rejection) throw ApiError.badRequest(rejection)
  const limit = await storageLimitForUser(c.get('db'), userId, billingScope(c.env))
  const id = randomUUID()
  const r2Key = buildR2Key(userId, input.name)
  const now = nowSeconds()
  const { uploadExpiresAt, expiresAt } = uploadDeadlines(now)
  const result = await c.env.DB.prepare(RESERVE_FILE_SQL)
    .bind(
      id,
      userId,
      r2Key,
      input.name,
      input.size,
      input.contentType,
      now,
      uploadExpiresAt,
      expiresAt,
      userId,
      userId,
      input.size,
      limit,
    )
    .all()
  if (!result.results.length) {
    await requireActiveUser(c, userId)
    throw ApiError.quotaExceeded(
      'Storage quota reached, including pending uploads and cleanup reservations',
    )
  }
  const headers = { 'Content-Type': input.contentType, 'If-None-Match': '*' }
  const ticket = {
    fileId: id,
    method: 'PUT' as const,
    headers,
    uploadExpiresAt: new Date(uploadExpiresAt * 1000).toISOString(),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  }
  if (!s3Configured(c.env)) {
    return c.json({ ...ticket, uploadUrl: `/api/files/upload/${id}`, mode: 'direct' }, 201)
  }
  try {
    const upload = await c.get('services').storage.createUploadUrl({
      ...input,
      userId,
      r2Key,
      expiresIn: UPLOAD_TTL_SECONDS,
      now: new Date(now * 1000),
    })
    return c.json({ ...ticket, uploadUrl: upload.uploadUrl, mode: 'presigned' }, 201)
  } catch (error) {
    // Keep a tombstone even on signer failure: never assume no URL escaped.
    await c.env.DB.prepare(
      "UPDATE files SET status='deleting' WHERE id=? AND user_id=? AND status='pending'",
    )
      .bind(id, userId)
      .run()
    throw error
  }
})

fileRoutes.put('/upload/:id', async (c) => {
  const { userId } = await requireSession(c)
  if (s3Configured(c.env)) throw ApiError.notFound('Direct upload')
  const row = await ownedFile(c, userId)
  await requireActiveUser(c, userId)
  if (
    row.status !== 'pending' ||
    !row.uploadExpiresAt ||
    row.uploadExpiresAt.getTime() <= Date.now()
  ) {
    throw ApiError.conflict('Upload is no longer pending or its upload URL has expired')
  }
  if (c.req.header('content-type') !== row.contentType)
    throw ApiError.badRequest('Upload content type does not match reservation')
  // Bound memory by declared size, not an untrusted Content-Length header.
  const reader = c.req.raw.body?.getReader()
  if (!reader) throw ApiError.badRequest('Empty upload body')
  const bytes = new Uint8Array(row.size)
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (length + value.byteLength > row.size) {
        await reader.cancel()
        throw ApiError.badRequest('Upload size exceeds reservation')
      }
      bytes.set(value, length)
      length += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (length !== row.size) throw ApiError.badRequest('Upload size does not match reservation')
  // A slow body may have outlived authorization. Recheck immediately before R2.
  await requireActiveUser(c, userId)
  const current = await ownedFile(c, userId)
  if (current.status !== 'pending' || row.uploadExpiresAt.getTime() <= Date.now())
    throw ApiError.conflict('Upload is no longer pending')
  const written = await c.env.BUCKET.put(row.r2Key, bytes.buffer, {
    httpMetadata: { contentType: row.contentType },
    onlyIf: { etagDoesNotMatch: '*' },
  })
  if (!written) throw ApiError.conflict('Object already uploaded; complete the existing upload')
  return complete(c, userId, row)
})

fileRoutes.post('/:id/complete', async (c) => {
  const { userId } = await requireSession(c)
  return complete(c, userId, await ownedFile(c, userId))
})

fileRoutes.get('/:id/download-url', async (c) => {
  const { userId } = await requireSession(c)
  const row = await ownedFile(c, userId)
  if (row.status !== 'completed') throw ApiError.conflict('File upload is not completed')
  if (!s3Configured(c.env)) return c.json({ downloadUrl: `/api/files/${row.id}/download` })
  return c.json(
    await c.get('services').storage.createDownloadUrl(row.r2Key, DOWNLOAD_URL_TTL_SECONDS),
  )
})

fileRoutes.get('/:id/download', async (c) => {
  const { userId } = await requireSession(c)
  if (s3Configured(c.env)) throw ApiError.notFound('Direct download')
  const row = await ownedFile(c, userId)
  if (row.status !== 'completed') throw ApiError.conflict('File upload is not completed')
  const object = await c.env.BUCKET.get(row.r2Key)
  if (!object) throw ApiError.notFound('File object')
  return new Response(object.body, {
    headers: {
      'Content-Type': row.contentType,
      'Content-Disposition': `attachment; filename="${row.name.replace(/["\r\n\\]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  })
})

fileRoutes.delete('/:id', async (c) => {
  const { userId } = await requireSession(c)
  const row = await ownedFile(c, userId)
  const now = nowSeconds()
  // Hide immediately, but do not release quota until signed uploads + grace end.
  // Tombstones are retained for repeated cleanup of late in-flight R2 writes.
  await c.env.DB.prepare(`UPDATE files SET status='deleting', expires_at=COALESCE(expires_at,?)
    WHERE id=? AND user_id=? AND status IN ('pending','completed')`)
    .bind(now, row.id, userId)
    .run()
  await c.env.BUCKET.delete(row.r2Key)
  await c.env.DB.prepare(
    "UPDATE files SET status='expired' WHERE id=? AND user_id=? AND status='deleting' AND expires_at<=?",
  )
    .bind(row.id, userId, now)
    .run()
  return c.json({ ok: true })
})
