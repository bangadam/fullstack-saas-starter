import type { Db } from '@saas/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import {
  type AccountDeletionPort,
  assertAccountMutation,
  createAccountDeletionHook,
} from './account-hooks'
import { type AuthEmailPort, createAuthEmailCallbacks } from './email-hooks'

export interface AuthEnv {
  APP_URL: string
  BETTER_AUTH_SECRET: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** Require a verified email before sign-in is allowed. Off by default. */
  REQUIRE_EMAIL_VERIFICATION?: string
}

export interface CreateAuthOptions {
  db: Db
  env: AuthEnv
  /**
   * Email transport for verification and password reset. Optional so the auth
   * package still works without an outbox (tests, tooling): the flows stay
   * enabled only when a port is supplied.
   */
  email?: AuthEmailPort
  onEmailError?: (error: unknown) => void
  accountDeletion?: AccountDeletionPort
}

export function createAuth({ db, env, email, onEmailError, accountDeletion }: CreateAuthOptions) {
  const callbacks = email ? createAuthEmailCallbacks(email, onEmailError) : null
  const requireEmailVerification = env.REQUIRE_EMAIL_VERIFICATION === 'true'

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      usePlural: true,
    }),
    trustedOrigins: [env.APP_URL],
    secret: env.BETTER_AUTH_SECRET,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        assertAccountMutation(ctx.path, ctx.body, ctx.headers ?? new Headers())
      }),
    },
    user: {
      deleteUser: { enabled: true, beforeDelete: createAccountDeletionHook(accountDeletion) },
    },
    // Public path == internal path: the Web Worker forwards /api/* untouched,
    // and Better Auth builds email links / OAuth callbacks from basePath, so
    // this must match the proxied route exactly (apps/api mounts the handler
    // at /api/auth/*). The origin comes from the incoming request.
    basePath: '/api/auth',
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      // Reset links point at the public app; Better Auth appends ?token= when
      // the user follows the callback URL.
      sendResetPassword: callbacks
        ? async ({ user, url, token }) => {
            await callbacks.sendResetPassword({ user, url, token })
          }
        : undefined,
    },
    emailVerification: callbacks
      ? {
          // Send on sign-up so new accounts can verify without an extra click.
          sendOnSignUp: true,
          sendVerificationEmail: async ({ user, url, token }) => {
            await callbacks.sendVerificationEmail({ user, url, token })
          },
        }
      : undefined,
    socialProviders: env.GOOGLE_CLIENT_ID
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : undefined,
  })
}

export type Auth = ReturnType<typeof createAuth>

/** Resolve the session for an incoming Request; null when unauthenticated. */
export async function getAuthSession(auth: Auth, request: Request) {
  const result = await auth.api.getSession({
    headers: request.headers,
  })
  return result
}

export * from './email-hooks'
