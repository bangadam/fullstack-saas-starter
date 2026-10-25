import type { Auth } from '@saas/auth'
import type { Db } from '@saas/db'
import type { AuditService, ProjectsService } from '@saas/domain'
import type { Context, Next } from 'hono'
import type { Env } from '../worker-configuration'
import { ApiError } from './errors'
import { DrizzleRateLimitStore } from './lib/drizzle-rate-limit'
import { checkOrigin } from './lib/origin'
import { type RateLimitStore, checkRateLimit, defaultKey, rateLimitHeaders } from './lib/rate-limit'
import {
  clientIdentity,
  isCredentialPath,
  overridesFromEnv,
  selectRateRule,
} from './lib/rate-limit-rules'
import { verifyTurnstileToken } from './lib/turnstile'

/** Origins allowed to perform cookie-authenticated writes. */
export function allowedOrigins(env: Env): string[] {
  const extra = (env.EXTRA_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  return [env.APP_URL, ...extra].filter((value): value is string => Boolean(value))
}

export interface Services {
  audit: AuditService
  projects: ProjectsService
  storage: {
    createUploadUrl(input: {
      userId: string
      name: string
      size: number
      contentType: string
      /** Sign this persisted key; never generate a replacement key. */
      r2Key: string
      expiresIn: number
      now: Date
    }): Promise<{ uploadUrl: string; method: 'PUT' }>
    createDownloadUrl(key: string, ttlSeconds: number): Promise<{ downloadUrl: string }>
  }
  billing: {
    createCheckout(input: {
      userId: string
      plan: 'pro'
      interval: 'monthly' | 'yearly'
      successUrl: string
      cancelUrl: string
      provider: Env['BILLING_PROVIDER']
    }): Promise<{ url: string }>
    createCustomerPortal(input: import('./lib/billing').PortalInput): Promise<{ url: string }>
    refreshSubscription?(
      input: import('./lib/billing').ProviderSubscriptionInput,
    ): Promise<import('./lib/billing').ProviderSubscriptionSnapshot>
  }
}

export type AppBindings = {
  Bindings: Env
  Variables: {
    requestId: string
    logError?: string
    db: Db
    auth: Auth
    services: Services
  }
}

// CSRF guard for cookie-authenticated writes (see lib/origin.ts for the
// exemption rules). Runs before any auth/domain work.
export async function originGuard(c: Context<AppBindings>, next: Next) {
  const decision = checkOrigin({
    method: c.req.method,
    path: c.req.path,
    origin: c.req.header('origin') ?? null,
    allowed: allowedOrigins(c.env),
    hasAuthorizationHeader: c.req.header('authorization') !== undefined,
  })
  if (!decision.ok) throw ApiError.forbidden(decision.reason)
  await next()
}
// Turnstile door for credential endpoints (see lib/turnstile.ts). The token
// rides on a header so Better Auth's body parsing is never disturbed.
export async function turnstileGuard(c: Context<AppBindings>, next: Next) {
  if (!isCredentialPath(c.req.path)) return next()
  const result = await verifyTurnstileToken(c.req.header('cf-turnstile-response'), {
    secret: c.env.TURNSTILE_SECRET_KEY,
    remoteip: c.req.header('cf-connecting-ip'),
  })
  if (!result.ok) {
    throw ApiError.forbidden(`Turnstile verification failed (${result.code})`)
  }
  if (result.mode === 'disabled') {
    console.log(JSON.stringify({ requestId: c.get('requestId'), turnstile: 'disabled' }))
  }
  await next()
}

// Rate limits for unsafe methods (see lib/rate-limit-rules.ts). Must run
// after the per-request DB wiring; a test harness may inject a memory store.
// Env overrides (RATE_LIMIT_AUTH_STRICT etc.) let local dev stay loose while
// production keeps the strict defaults.
export function rateLimitGuard(opts: { storeFor?: (db: Db) => RateLimitStore } = {}) {
  return async (c: Context<AppBindings>, next: Next) => {
    const rules = overridesFromEnv(c.env as unknown as Record<string, string | undefined>)
    const rule = selectRateRule(c.req.method, c.req.path, rules)
    if (!rule) return next()
    const store = opts.storeFor
      ? opts.storeFor(c.get('db'))
      : new DrizzleRateLimitStore(c.get('db'))
    const decision = await checkRateLimit({
      key: defaultKey(
        rule.bucket,
        clientIdentity({
          'cf-connecting-ip': c.req.header('cf-connecting-ip'),
          'x-forwarded-for': c.req.header('x-forwarded-for'),
        }),
      ),
      limit: rule.limit,
      windowMs: rule.windowMs,
      store,
    })
    for (const [header, value] of Object.entries(rateLimitHeaders(decision, rule.limit))) {
      c.header(header, value)
    }
    if (!decision.ok) throw ApiError.tooManyRequests()
    await next()
    // Better Auth returns a raw Response that bypasses Hono's prepared
    // headers, so re-apply them to the final response for client back-off.
    if (c.res) {
      for (const [header, value] of Object.entries(rateLimitHeaders(decision, rule.limit))) {
        c.res.headers.set(header, value)
      }
    }
  }
}
export async function requestContext(c: Context<AppBindings>, next: Next) {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  const start = Date.now()
  await next()
  const logError = c.get('logError')
  const line = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
    ...(logError ? { error: logError } : {}),
  }
  console.log(JSON.stringify(line))
}

export async function secureHeaders(c: Context<AppBindings>, next: Next) {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
}
