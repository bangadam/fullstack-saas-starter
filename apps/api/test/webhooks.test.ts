import type { NormalizedWebhookEvent } from '@saas/billing'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createWebhookRouter } from '../src/routes/webhooks'

const event: NormalizedWebhookEvent = {
  provider: 'polar',
  environment: 'sandbox',
  externalEventId: 'evt_1',
  type: 'subscription.created',
  userId: 'user_1',
}
function setup(options: { queueFails?: boolean; dbFails?: boolean; verifyFails?: boolean } = {}) {
  const order: string[] = []
  const run = vi.fn(async () => {
    order.push('persist')
    if (options.dbFails) throw new Error('SECRET db')
    return { success: true }
  })
  const bind = vi.fn(() => ({ run }))
  const prepare = vi.fn((_sql: string) => ({ bind }))
  const send = vi.fn(async () => {
    order.push('queue')
    if (options.queueFails) throw new Error('SECRET queue')
  })
  const verify = vi.fn(
    async (_secret: string, _headers: Record<string, string>, body: ArrayBuffer) => {
      order.push('verify')
      if (options.verifyFails) throw new Error('SECRET signature')
      expect(new TextDecoder().decode(body)).toBe('{ "signed": true }')
      return event
    },
  )
  const app = new Hono()
  app.route('/', createWebhookRouter({ polar: verify, stripe: verify }))
  const env = {
    DB: { prepare },
    BILLING_QUEUE: { send },
    POLAR_WEBHOOK_SECRET: 'secret',
    STRIPE_WEBHOOK_SECRET: 'secret',
    BILLING_PROVIDER: 'polar',
    POLAR_ENVIRONMENT: 'sandbox',
    POLAR_ACCESS_TOKEN: 'test-only',
  }
  const request = () => app.request('/polar', { method: 'POST', body: '{ "signed": true }' }, env)
  return { request, order, run, bind, prepare, send, verify }
}
describe('durable webhook intake', () => {
  it('verifies raw bytes, persists scoped dedup row, then queues reference only', async () => {
    const f = setup()
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(f.order).toEqual(['verify', 'persist', 'queue'])
    expect(f.prepare.mock.calls[0]?.[0]).toContain(
      'ON CONFLICT(provider,environment,external_event_id) DO NOTHING',
    )
    expect(f.send).toHaveBeenCalledWith({
      type: 'webhook-billing',
      provider: 'polar',
      environment: 'sandbox',
      externalEventId: 'evt_1',
      idempotencyKey: 'polar:sandbox:evt_1',
    })
  })
  it('acks durable intake on queue failure because scheduled replay recovers it', async () => {
    const f = setup({ queueFails: true })
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(f.run).toHaveBeenCalledOnce()
    expect(await response.text()).not.toContain('SECRET')
  })
  it('returns safe 503 without queueing when persistence fails', async () => {
    const f = setup({ dbFails: true })
    const response = await f.request()
    expect(response.status).toBe(503)
    expect(f.send).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('SECRET')
  })
  it('derives environment from configured scope and rejects Stripe livemode mismatch', async () => {
    const send = vi.fn()
    const run = vi.fn()
    const app = new Hono().route(
      '/',
      createWebhookRouter({
        polar: async () => event,
        stripe: async () => ({ ...event, provider: 'stripe' }),
      }),
    )
    const env = {
      DB: { prepare: () => ({ bind: () => ({ run }) }) },
      BILLING_QUEUE: { send },
      STRIPE_WEBHOOK_SECRET: 'secret',
      BILLING_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_fixture',
    }
    const res = await app.request(
      '/stripe',
      { method: 'POST', body: JSON.stringify({ livemode: true }) },
      env,
    )
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
  it('maps subscription entitlement only from configured catalog after signature verification', async () => {
    const bind = vi.fn(() => ({ run: vi.fn() }))
    const send = vi.fn()
    const normalized = {
      ...event,
      environment: 'production' as const,
      subscription: {
        externalSubscriptionId: 's',
        externalCustomerId: 'c',
        plan: 'pro' as const,
        interval: 'monthly' as const,
        status: 'active' as const,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    }
    const app = new Hono().route(
      '/',
      createWebhookRouter({ polar: async () => normalized, stripe: async () => event }),
    )
    const env = {
      DB: { prepare: () => ({ bind }) },
      BILLING_QUEUE: { send },
      POLAR_WEBHOOK_SECRET: 'secret',
      BILLING_PROVIDER: 'polar',
      POLAR_ENVIRONMENT: 'sandbox',
      POLAR_ACCESS_TOKEN: 'fixture',
      PRO_MONTHLY: 'allowed-product',
    }
    await app.request(
      '/polar',
      { method: 'POST', body: JSON.stringify({ data: { product_id: 'unrecognized-product' } }) },
      env,
    )
    const persisted = JSON.parse((bind.mock.calls as unknown as unknown[][])[0]?.[5] as string)
    expect(persisted.environment).toBe('sandbox')
    expect(persisted.subscription.plan).toBe('free')
  })
  it('never persists or queues invalid signatures', async () => {
    const f = setup({ verifyFails: true })
    expect((await f.request()).status).toBe(401)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.send).not.toHaveBeenCalled()
  })
})
