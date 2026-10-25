import { prepareAccountDeletionSchema } from '@saas/contracts'
import { sessions } from '@saas/db'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { ApiError } from '../errors'
import { accountDeletionState, exportAccountData, prepareAccountDeletion } from '../lib/account'
import { requireSession } from '../lib/session'
import type { AppBindings } from '../middleware'

export const accountRoutes = new Hono<AppBindings>()
accountRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})
accountRoutes.get('/security', async (c) => {
  await requireSession(c)
  return c.json({
    turnstileRequired: Boolean(c.env.TURNSTILE_SECRET_KEY),
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null,
  })
})
accountRoutes.get('/export', async (c) => {
  const { userId } = await requireSession(c)
  c.header('Content-Disposition', 'attachment; filename="account-data.json"')
  return c.json(await exportAccountData(c.get('db'), userId))
})
accountRoutes.get('/sessions', async (c) => {
  const { userId, auth } = await requireSession(c)
  const current = await auth.api.getSession({ headers: c.req.raw.headers })
  const rows = await auth.api.listSessions({ headers: c.req.raw.headers })
  return c.json({
    items: rows
      .filter((row) => row.userId === userId)
      .map((row) => ({
        id: row.id,
        current: row.id === current?.session.id,
        userAgent: row.userAgent ?? null,
        ipAddress: row.ipAddress ?? null,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
  })
})
accountRoutes.post('/sessions/:id/revoke', async (c) => {
  const { userId, auth } = await requireSession(c)
  // Session tokens never leave the Worker; Better Auth performs actual revocation.
  const [row] = await c
    .get('db')
    .select({ token: sessions.token })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.id, c.req.param('id'))))
    .limit(1)
  if (!row) throw ApiError.notFound('Session')
  return auth.api.revokeSession({
    headers: c.req.raw.headers,
    body: { token: row.token },
    asResponse: true,
  })
})
accountRoutes.get('/deletion', async (c) => {
  const { userId } = await requireSession(c)
  return c.json(await accountDeletionState(c.get('db'), userId))
})
accountRoutes.post('/deletion/prepare', async (c) => {
  const { userId } = await requireSession(c)
  const input = prepareAccountDeletionSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success)
    throw ApiError.badRequest('Type DELETE to confirm preparing your account for deletion.')
  try {
    return c.json(await prepareAccountDeletion(c.get('db'), userId))
  } catch (error) {
    // Only expose the known, actionable lifecycle conflict; DB errors stay generic.
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 'CONFLICT' &&
      'message' in error &&
      typeof error.message === 'string'
    )
      throw ApiError.conflict(error.message)
    throw error
  }
})
