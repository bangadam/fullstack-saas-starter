import type { NormalizedWebhookEvent } from '@saas/billing'
import { Hono } from 'hono'
import { billingScope } from '../lib/billing'
import type { AppBindings } from '../middleware'

export type VerifyFn = (
  secret: string,
  headers: Record<string, string>,
  rawBody: ArrayBuffer,
) => Promise<NormalizedWebhookEvent>

/**
 * Webhook handlers. The raw body MUST be read as an ArrayBuffer before any
 * JSON parsing — signature verification operates over the exact bytes, and
 * c.req.json() would consume the stream. Verification runs before the payload
 * is trusted; failures return 401 without echoing provider errors.
 */
export function createWebhookRouter(verify: {
  polar: VerifyFn
  stripe: VerifyFn
}) {
  const routes = new Hono<AppBindings>()

  const handle =
    (provider: 'polar' | 'stripe') => async (c: import('hono').Context<AppBindings>) => {
      const rawBody = await c.req.raw.arrayBuffer()
      const secret = provider === 'polar' ? c.env.POLAR_WEBHOOK_SECRET : c.env.STRIPE_WEBHOOK_SECRET
      if (!secret) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Webhook not configured' } }, 503)
      }
      const headers: Record<string, string> = {}
      c.req.raw.headers.forEach((v, k) => {
        headers[k] = v
      })
      let event: NormalizedWebhookEvent
      try {
        event = await verify[provider](secret, headers, rawBody)
      } catch {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid webhook signature' } }, 401)
      }
      const scope = billingScope(c.env)
      if (!scope || scope.provider !== provider) {
        return c.json(
          { error: { code: 'BAD_REQUEST', message: 'Webhook scope not configured' } },
          503,
        )
      }
      // Parse only AFTER raw-byte verification. Provider mode and catalog are
      // deployment credentials/configuration, never browser/provider metadata.
      try {
        const signed = JSON.parse(new TextDecoder().decode(rawBody))
        if (provider === 'stripe' && signed.livemode !== (scope.environment === 'production')) {
          return c.json({ error: { code: 'BAD_REQUEST', message: 'Webhook mode mismatch' } }, 400)
        }
        event.environment = scope.environment
        const subscriptionEvent =
          provider === 'stripe'
            ? event.type.startsWith('customer.subscription.')
            : event.type.startsWith('subscription.')
        if (!subscriptionEvent) event.subscription = undefined
        if (event.subscription) {
          const catalogId =
            provider === 'polar'
              ? signed.data?.product_id
              : signed.data?.object?.items?.data?.[0]?.price?.id
          const catalog = c.env as unknown as Record<string, string | undefined>
          const interval = catalogId && catalogId === catalog.PRO_YEARLY ? 'yearly' : 'monthly'
          const known =
            typeof catalogId === 'string' &&
            Boolean(catalogId) &&
            [catalog.PRO_MONTHLY, catalog.PRO_YEARLY].includes(catalogId)
          event.subscription.plan = known ? 'pro' : 'free'
          event.subscription.interval = interval
        }
      } catch {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid webhook event' } }, 400)
      }
      if (
        event.provider !== provider ||
        !event.externalEventId ||
        !['sandbox', 'production'].includes(event.environment)
      ) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid webhook event' } }, 400)
      }
      // Never acknowledge until durable intake succeeds. Duplicate intake does
      // not replace the original signed event; idempotency is provider/env scoped.
      try {
        await c.env.DB.prepare(`INSERT INTO billing_events
          (id,provider,environment,external_event_id,type,payload_json,created_at)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider,environment,external_event_id) DO NOTHING`)
          .bind(
            crypto.randomUUID(),
            provider,
            event.environment,
            event.externalEventId,
            event.type,
            JSON.stringify(event),
            Math.floor(Date.now() / 1000),
          )
          .run()
      } catch {
        console.error(JSON.stringify({ event: 'billing_intake_failed', provider }))
        return c.json({ error: { code: 'INTERNAL', message: 'Webhook intake unavailable' } }, 503)
      }
      try {
        await c.env.BILLING_QUEUE.send({
          type: 'webhook-billing',
          provider,
          environment: event.environment,
          externalEventId: event.externalEventId,
          idempotencyKey: `${provider}:${event.environment}:${event.externalEventId}`,
        })
      } catch {
        // Cron replays unprocessed durable rows; provider need not retry publish loss.
        console.error(
          JSON.stringify({
            event: 'billing_enqueue_failed',
            provider,
            environment: event.environment,
          }),
        )
      }
      return c.json({ received: true })
    }

  routes.post('/polar', handle('polar'))
  routes.post('/stripe', handle('stripe'))
  return routes
}
