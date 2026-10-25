import { type Auth, getAuthSession } from '@saas/auth'
import type { Context } from 'hono'
import { ApiError } from '../errors'
import type { AppBindings } from '../middleware'

export interface AuthContext {
  userId: string
  auth: Auth
}

/** Throws 401 unless a valid Better Auth session resolves from request headers. */
export async function requireSession(c: Context<AppBindings>): Promise<AuthContext> {
  const auth = c.get('auth')
  if (!auth) throw ApiError.internal('Auth not initialized')
  const session = await getAuthSession(auth, c.req.raw)
  const userId = session?.user?.id
  if (!userId) throw ApiError.unauthorized()
  return { userId, auth }
}

export function domainToApiError(err: unknown): never {
  throw err
}
