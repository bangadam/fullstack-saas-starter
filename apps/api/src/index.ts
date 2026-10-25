import { type Auth, createAuth } from '@saas/auth'
import { verifyAndNormalizePolarWebhook, verifyAndNormalizeStripeWebhook } from '@saas/billing'
import { type Db, createDb } from '@saas/db'
import {
  AuditService,
  DrizzleProjectsRepository,
  EmailOutboxService,
  ProjectsService,
} from '@saas/domain'
import { generatePresignedDownloadUrl, generatePresignedUploadUrl } from '@saas/storage'
import { sql } from 'drizzle-orm'
/**
 * API Worker — private, no public routes.
 *
 * ROUTING CONTRACT (important):
 *   The Web Worker forwards /api/* and /webhooks/* to this worker over a
 *   service binding and does NOT rewrite the path:
 *     web /api/auth/*      -> api /api/auth/*
 *     web /api/health      -> api /api/health
 *     web /webhooks/polar  -> api /webhooks/polar
 *   Better Auth basePath is '/api/auth' so the public URL and the internal
 *   path are identical — that keeps generated email links and OAuth callbacks
 *   valid through the proxy. Do not change one side without the other.
 */
import { Hono } from 'hono'
import type { Env } from '../worker-configuration'
import { createAccountDeletionGuard } from './lib/account'
import {
  billingScope,
  createProviderCheckout,
  createProviderPortal,
  refreshProviderSubscription,
} from './lib/billing'
import { DrizzleEmailOutboxRepository, QueueEmailProducer } from './lib/email-outbox-adapters'
import { maxProjectsForUser } from './lib/plan'
import { errorHandler } from './lib/validation'
import {
  type AppBindings,
  type Services,
  originGuard,
  rateLimitGuard,
  requestContext,
  secureHeaders,
  turnstileGuard,
} from './middleware'
import { accountRoutes } from './routes/account'
import { auditRoutes } from './routes/audit'
import { billingRoutes } from './routes/billing'
import { fileRoutes } from './routes/files'
import { healthRoutes } from './routes/health'
import { projectRoutes } from './routes/projects'
import { createWebhookRouter } from './routes/webhooks'

export function createApp() {
  const app = new Hono<AppBindings>()

  app.use('*', requestContext)
  app.use('*', secureHeaders)
  // Origin check runs first: cross-site writes are rejected before any auth,
  // rate-limit or database work happens.
  app.use('*', originGuard)
  app.onError(errorHandler)

  // Per-request wiring: bindings in Workers are request-scoped, so DB/auth
  // instances are created per request, never at module scope.
  app.use('*', async (c, next) => {
    const db: Db = createDb(c.env.DB)
    // Auth emails (verification, password reset) go through the durable email
    // outbox: row first, then a queue message the Jobs Worker consumes.
    const emailOutbox = new EmailOutboxService({
      outbox: new DrizzleEmailOutboxRepository(db),
      queue: new QueueEmailProducer(c.env.EMAIL_QUEUE as Queue<Record<string, unknown>>),
      onEnqueueError: (error) => {
        console.error(
          JSON.stringify({
            requestId: c.get('requestId'),
            event: 'email.enqueue_failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      },
    })
    const auth: Auth = createAuth({
      db,
      accountDeletion: createAccountDeletionGuard({
        db,
        bucket: c.env.BUCKET,
        billingSafe: async (userId) => {
          const row = await db.get<{ total: number }>(
            sql`select count(*) as total from billing_checkout_intents where user_id = ${userId}`,
          )
          return row?.total === 0
        },
      }),
      env: {
        APP_URL: c.env.APP_URL,
        BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
        GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
        REQUIRE_EMAIL_VERIFICATION: c.env.REQUIRE_EMAIL_VERIFICATION,
      },
      email: {
        sendEmail: (message) =>
          emailOutbox
            .dispatch({
              to: message.to,
              templateId: message.templateId,
              subject: message.subject,
              payload: message.payload,
              idempotencyKey: message.idempotencyKey,
            })
            .then(() => undefined),
      },
      onEmailError: (error) => {
        console.error(
          JSON.stringify({
            requestId: c.get('requestId'),
            event: 'email.dispatch_failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      },
    })
    const audit = new AuditService(db as never)
    const services: Services = {
      audit,
      projects: new ProjectsService({
        repository: new DrizzleProjectsRepository(db),
        audit,
        // Plan-aware quota: resolveEntitlements per request. Plans change
        // through webhooks, and `maxProjectsForUser` reads the newest
        // subscription row each time instead of caching a stale value.
        maxProjectsFor: (userId) => maxProjectsForUser(db, userId, billingScope(c.env)),
      }),
      storage: {
        createUploadUrl: (input) => {
          if (!c.env.R2_BUCKET_NAME)
            throw new Error('R2_BUCKET_NAME is required for presigned uploads')
          const url = generatePresignedUploadUrl(
            {
              accessKeyId: c.env.R2_ACCESS_KEY_ID ?? '',
              secretAccessKey: c.env.R2_SECRET_ACCESS_KEY ?? '',
              accountId: c.env.CLOUDFLARE_ACCOUNT_ID ?? '',
              bucket: c.env.R2_BUCKET_NAME,
            },
            {
              method: 'PUT',
              key: input.r2Key,
              expiresIn: input.expiresIn,
              now: input.now,
              contentType: input.contentType,
            },
          )
          return Promise.resolve({ uploadUrl: url, method: 'PUT' })
        },
        createDownloadUrl: (key, ttlSeconds) => {
          if (!c.env.R2_BUCKET_NAME)
            throw new Error('R2_BUCKET_NAME is required for presigned downloads')
          const url = generatePresignedDownloadUrl(
            {
              accessKeyId: c.env.R2_ACCESS_KEY_ID ?? '',
              secretAccessKey: c.env.R2_SECRET_ACCESS_KEY ?? '',
              accountId: c.env.CLOUDFLARE_ACCOUNT_ID ?? '',
              bucket: c.env.R2_BUCKET_NAME,
            },
            { method: 'GET', key, expiresIn: Math.min(ttlSeconds, 900) },
          )
          return Promise.resolve({ downloadUrl: url })
        },
      },
      billing: {
        // Catalog mapping (plan/interval -> provider product/price id) comes
        // from env; without it checkout is pending, not active (plan section 7).
        createCheckout: (input) => createProviderCheckout(c.env, input),
        createCustomerPortal: (input) => createProviderPortal(c.env, input),
        refreshSubscription: (input) => refreshProviderSubscription(c.env, input),
      },
    }
    c.set('db', db)
    c.set('auth', auth)
    c.set('services', services)
    await next()
  })

  // Rate limiting needs the per-request DB, so it is registered after the
  // wiring middleware; credential endpoints additionally require a Turnstile
  // token whenever TURNSTILE_SECRET_KEY is configured.
  app.use('*', rateLimitGuard())
  app.use('/api/auth/*', turnstileGuard)

  // Public paths equal internal paths (the Web Worker no longer strips /api),
  // so anything the API generates — auth email links, OAuth callbacks — is
  // reachable through the proxy without a rewrite.
  app.route('/api', healthRoutes)
  app.route('/api/projects', projectRoutes)
  app.route('/api/files', fileRoutes)
  app.route('/api/billing', billingRoutes)
  app.route('/api/audit', auditRoutes)
  app.route('/api/account', accountRoutes)
  app.route(
    '/webhooks',
    createWebhookRouter({
      polar: verifyAndNormalizePolarWebhook,
      stripe: verifyAndNormalizeStripeWebhook,
    }),
  )

  // Better Auth handler; basePath '/api/auth' (see header comment).
  app.all('/api/auth/*', (c) => c.get('auth').handler(c.req.raw))
  app.all('/api/auth', (c) => c.get('auth').handler(c.req.raw))

  return app
}

const app = createApp()

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>
