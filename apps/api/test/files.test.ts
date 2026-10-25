import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createDb } from '@saas/db'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../src/lib/validation'
import type { AppBindings } from '../src/middleware'
import { fileRoutes } from '../src/routes/files'

vi.mock('../src/lib/session', () => ({
  requireSession: async (c: { req: { header(name: string): string } }) => ({
    userId: c.req.header('x-user') || 'u',
  }),
}))
vi.mock('../src/lib/plan', () => ({ storageLimitForUser: async () => 10 }))
vi.mock('../src/lib/billing', () => ({ billingScope: () => null }))
afterEach(() => vi.useRealTimers())

function harness(presigned = false) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    readFileSync(
      new URL('../../../packages/db/drizzle/0000_b2c_baseline.sql', import.meta.url),
      'utf8',
    ),
  )
  sqlite.exec(
    readFileSync(
      new URL('../../../packages/db/drizzle/0002_storage_lifecycle.sql', import.meta.url),
      'utf8',
    ),
  )
  sqlite.exec(
    "ALTER TABLE users ADD COLUMN deletion_requested_at INTEGER; INSERT INTO users(id,name,email,created_at,updated_at) VALUES('u','U','u@x.test',0,0),('other','O','o@x.test',0,0)",
  )
  const prepare = (query: string) => {
    let values: (string | number | null)[] = []
    const statement = {
      bind: (...args: typeof values) => {
        values = args
        return statement
      },
      all: async () => ({ results: sqlite.prepare(query).all(...values), success: true, meta: {} }),
      raw: async () => {
        const stmt = sqlite.prepare(query)
        stmt.setReturnArrays(true)
        return stmt.all(...values)
      },
      run: async () => ({
        results: [],
        success: true,
        meta: { changes: Number(sqlite.prepare(query).run(...values).changes) },
      }),
      first: async () => sqlite.prepare(query).get(...values) ?? null,
    }
    return statement
  }
  const d1 = { prepare }
  const objects = new Map<
    string,
    { size: number; httpMetadata: { contentType: string }; body: ArrayBuffer }
  >()
  const bucket = {
    head: vi.fn(async (key: string) => objects.get(key) ?? null),
    get: vi.fn(async (key: string) => objects.get(key) ?? null),
    put: vi.fn(
      async (
        key: string,
        body: ArrayBuffer,
        options: { httpMetadata: { contentType: string } },
      ) => {
        if (objects.has(key)) return null
        const object = { size: body.byteLength, httpMetadata: options.httpMetadata, body }
        objects.set(key, object)
        return object
      },
    ),
    delete: vi.fn(async (key: string) => {
      objects.delete(key)
    }),
  }
  const signer = vi.fn(async () => ({
    uploadUrl: 'https://r2.test/upload',
    method: 'PUT' as const,
  }))
  const app = new Hono<AppBindings>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('db', createDb(d1 as never))
    c.set('services', { storage: { createUploadUrl: signer } } as never)
    await next()
  })
  app.route('/api/files', fileRoutes)
  const env = {
    DB: d1,
    BUCKET: bucket,
    ...(presigned
      ? {
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          CLOUDFLARE_ACCOUNT_ID: 'account',
        }
      : {}),
  } as unknown as AppBindings['Bindings']
  const request = (path: string, method = 'GET', body?: unknown, user = 'u') =>
    app.request(
      `/api/files${path}`,
      {
        method,
        headers: { 'x-user': user, 'Content-Type': 'text/plain' },
        ...(body === undefined
          ? {}
          : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      },
      env,
    )
  const reserve = () =>
    request('/upload-url', 'POST', { name: 'x.txt', size: 6, contentType: 'text/plain' })
  return { sqlite, bucket, objects, signer, request, reserve }
}

describe('storage lifecycle HTTP with real SQLite statements', () => {
  it('atomically reserves quota against concurrent pending uploads and signs the persisted key', async () => {
    const h = harness(true)
    const responses = await Promise.all([h.reserve(), h.reserve()])
    expect(responses.map((r) => r.status).sort()).toEqual([201, 402])
    const row = h.sqlite.prepare('SELECT * FROM files').get()
    expect(h.signer).toHaveBeenCalledWith(expect.objectContaining({ r2Key: row?.r2_key }))
    const page = (await (await h.request('')).json()) as {
      items: { status: string }[]
      usedBytes: number
    }
    expect(page.items[0]?.status).toBe('pending')
    expect(page.usedBytes).toBe(6)
  })
  it('requires a matching HEAD before completion and isolates all tenant operations', async () => {
    const h = harness(true)
    const { fileId } = (await (await h.reserve()).json()) as { fileId: string }
    const key = h.sqlite.prepare('SELECT r2_key FROM files').get()?.r2_key as string
    expect((await h.request(`/${fileId}/download-url`)).status).toBe(409)
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(409)
    h.objects.set(key, {
      size: 5,
      httpMetadata: { contentType: 'text/plain' },
      body: new ArrayBuffer(5),
    })
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(400)
    h.objects.set(key, {
      size: 6,
      httpMetadata: { contentType: 'image/png' },
      body: new ArrayBuffer(6),
    })
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(400)
    for (const [path, method] of [
      [`/${fileId}/complete`, 'POST'],
      [`/${fileId}/download-url`, 'GET'],
      [`/${fileId}`, 'DELETE'],
      [`/upload/${fileId}`, 'PUT'],
    ]) {
      expect((await h.request(path ?? '', method, undefined, 'other')).status).toBe(404)
    }
    h.objects.set(key, {
      size: 6,
      httpMetadata: { contentType: 'text/plain' },
      body: new ArrayBuffer(6),
    })
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(200)
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(200)
  })
  it('direct PUT validates metadata and completes once; completed files cannot be overwritten', async () => {
    const h = harness()
    const { fileId } = (await (await h.reserve()).json()) as { fileId: string }
    expect((await h.request(`/upload/${fileId}`, 'PUT', 'bad')).status).toBe(400)
    expect((await h.request(`/upload/${fileId}`, 'PUT', '123456')).status).toBe(200)
    expect((await h.request(`/upload/${fileId}`, 'PUT', 'abcdef')).status).toBe(409)
    expect((await h.request(`/${fileId}/download`)).status).toBe(200)
    expect((await h.request(`/${fileId}`, 'DELETE')).status).toBe(200)
    expect(h.sqlite.prepare('SELECT status FROM files').get()?.status).toBe('deleting')
    expect((await h.request(`/${fileId}/download`)).status).toBe(409)
  })
  it('cannot finalize over a cancellation or account deletion during HEAD', async () => {
    for (const deletingAccount of [false, true]) {
      const h = harness(true)
      const { fileId } = (await (await h.reserve()).json()) as { fileId: string }
      h.bucket.head.mockImplementationOnce(async () => {
        h.sqlite.exec(
          deletingAccount
            ? "UPDATE users SET deletion_requested_at=1 WHERE id='u'"
            : "UPDATE files SET status='deleting'",
        )
        return { size: 6, httpMetadata: { contentType: 'text/plain' }, body: new ArrayBuffer(6) }
      })
      expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(
        deletingAccount ? 403 : 409,
      )
      expect(h.sqlite.prepare('SELECT status FROM files').get()?.status).not.toBe('completed')
    }
  })
  it('retains a retryable tombstone when physical deletion fails and hides cancelled files', async () => {
    const h = harness()
    const { fileId } = (await (await h.reserve()).json()) as { fileId: string }
    h.bucket.delete.mockRejectedValueOnce(new Error('R2 unavailable'))
    expect((await h.request(`/${fileId}`, 'DELETE')).status).toBe(500)
    expect(h.sqlite.prepare('SELECT status FROM files').get()?.status).toBe('deleting')
    const page = (await (await h.request('')).json()) as { items: unknown[]; reservedBytes: number }
    expect(page.items).toEqual([])
    expect(page.reservedBytes).toBe(6)
    expect((await h.request(`/${fileId}`, 'DELETE')).status).toBe(200)
    expect((await h.reserve()).status).toBe(402)
  })
  it('permits completion during grace but rejects it at the cleanup deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T00:00:00Z'))
    const h = harness(true)
    const { fileId } = (await (await h.reserve()).json()) as { fileId: string }
    const key = h.sqlite.prepare('SELECT r2_key FROM files').get()?.r2_key as string
    h.objects.set(key, {
      size: 6,
      httpMetadata: { contentType: 'text/plain' },
      body: new ArrayBuffer(6),
    })
    vi.advanceTimersByTime(601_000)
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(200)
    h.sqlite.exec("UPDATE files SET status='pending'")
    vi.advanceTimersByTime(3599_000)
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(409)
  })
  it('rejects cross-tenant direct uploads and oversized bodies without R2 writes', async () => {
    const h = harness()
    const { fileId } = (await (await h.reserve()).json()) as { fileId: string }
    expect((await h.request(`/upload/${fileId}`, 'PUT', '123456', 'other')).status).toBe(404)
    expect((await h.request(`/upload/${fileId}`, 'PUT', '1234567')).status).toBe(400)
    expect(h.bucket.put).not.toHaveBeenCalled()
  })
  it('rejects expired uploads and deleting accounts without releasing live reservations early', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T00:00:00Z'))
    const h = harness()
    const { fileId } = (await (await h.reserve()).json()) as { fileId: string }
    vi.advanceTimersByTime(601_000)
    expect((await h.request(`/upload/${fileId}`, 'PUT', '123456')).status).toBe(409)
    expect((await h.reserve()).status).toBe(402)
    h.sqlite.exec("UPDATE users SET deletion_requested_at=1 WHERE id='u'")
    expect((await h.request(`/${fileId}/complete`, 'POST')).status).toBe(403)
    expect((await h.reserve()).status).toBe(403)
  })
})
