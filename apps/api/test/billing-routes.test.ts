import { DatabaseSync } from 'node:sqlite'
import type { Auth } from '@saas/auth'
import type { Db } from '@saas/db'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../src/lib/validation'
import type { AppBindings, Services } from '../src/middleware'
import { billingRoutes } from '../src/routes/billing'

const row = {
  id: 'local_1',
  userId: 'user_1',
  provider: 'polar',
  environment: 'sandbox',
  externalCustomerId: 'customer_1',
  externalSubscriptionId: 'sub_1',
  status: 'active',
  plan: 'pro',
  interval: 'monthly',
  currentPeriodEnd: new Date('2030-01-01'),
  cancelAtPeriodEnd: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
function harness(
  opts: {
    row?: typeof row | null
    authenticated?: boolean
    claim?: boolean
    updated?: boolean
  } = {},
) {
  const get = vi
    .fn()
    .mockResolvedValueOnce(opts.row === undefined ? row : opts.row)
    .mockResolvedValue({ projects: 2, storageBytes: 2048 })
  const where = vi.fn().mockReturnThis()
  const returning = vi.fn().mockResolvedValue(opts.updated === false ? [] : [{ id: row.id }])
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where,
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get,
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning,
    run: vi.fn().mockResolvedValue({ meta: { changes: opts.claim === false ? 0 : 1 } }),
  }
  const billing = {
    createCheckout: vi.fn().mockResolvedValue({ url: 'https://polar.sh/checkout' }),
    createCustomerPortal: vi.fn().mockResolvedValue({ url: 'https://polar.sh/portal' }),
    refreshSubscription: vi.fn().mockResolvedValue({
      status: 'active',
      plan: 'pro',
      interval: 'monthly',
      currentPeriodEnd: new Date('2030-02-01'),
      cancelAtPeriodEnd: true,
    }),
  }
  const app = new Hono<AppBindings>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.env = {
      APP_URL: 'https://app.example',
      BILLING_PROVIDER: 'polar',
      POLAR_ENVIRONMENT: 'sandbox',
      POLAR_ACCESS_TOKEN: 'test',
      PRO_MONTHLY: 'product_1',
    } as unknown as AppBindings['Bindings']
    c.set('db', db as unknown as Db)
    c.set('auth', {
      api: {
        getSession: async () =>
          opts.authenticated === false ? null : { user: { id: 'user_1' }, session: { id: 's1' } },
      },
    } as unknown as Auth)
    c.set('services', { billing } as unknown as Services)
    await next()
  })
  app.route('/billing', billingRoutes)
  return { app, db, billing, where }
}
describe('billing self-service routes', () => {
  it('refresh persists provider status and returns the refreshed typed view', async () => {
    const { app, db } = harness()
    db.get
      .mockReset()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, currentPeriodEnd: new Date('2030-02-01') })
      .mockResolvedValueOnce({ projects: 2, storageBytes: 2048 })
    const response = await app.request('/billing/refresh', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(
      ((await response.json()) as { subscription: { currentPeriodEnd: string } }).subscription
        .currentPeriodEnd,
    ).toBe('2030-02-01T00:00:00.000Z')
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAtPeriodEnd: true, status: 'active' }),
    )
  })
  it('provider refresh failures never mutate local entitlement state', async () => {
    const { app, billing, db } = harness()
    billing.refreshSubscription.mockRejectedValue(new Error('fixture unavailable'))
    expect((await app.request('/billing/refresh', { method: 'POST' })).status).toBe(500)
    expect(db.update).not.toHaveBeenCalled()
  })
  it('ambiguous checkout failure retains its durable intent', async () => {
    const { app, billing, db } = harness()
    billing.createCheckout.mockRejectedValue(new Error('fixture connection failure'))
    expect(
      (
        await app.request('/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: 'pro',
            interval: 'monthly',
            successUrl: 'https://app.example/ok',
            cancelUrl: 'https://app.example/cancel',
          }),
        })
      ).status,
    ).toBe(500)
    expect(db.run).toHaveBeenCalledTimes(1)
    expect(db.run.mock.invocationCallOrder[0]).toBeLessThan(
      billing.createCheckout.mock.invocationCallOrder[0] ?? 0,
    )
  })
  it('usage excludes released storage and disables checkout during a pending intent', async () => {
    const { app, db } = harness({ row: null })
    db.get
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ projects: 0, storageBytes: 0, checkoutBlocked: 1 })
    const response = await app.request('/billing/subscription')
    expect(((await response.json()) as { checkoutAvailable: boolean }).checkoutAvailable).toBe(
      false,
    )
    const selection = db.select.mock.calls[1]?.[0] as { storageBytes: import('drizzle-orm').SQL }
    const query = new SQLiteSyncDialect().sqlToQuery(selection.storageBytes)
    expect(query.sql).toContain("status != 'expired'")
  })
  it('executes the checkout barrier atomically in SQLite for deletion, subscription and duplicate cases', async () => {
    const { app, db } = harness({ claim: false })
    await app.request('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: 'pro',
        interval: 'monthly',
        successUrl: 'https://app.example/ok',
        cancelUrl: 'https://app.example/cancel',
      }),
    })
    const query = new SQLiteSyncDialect().sqlToQuery(db.run.mock.calls[0]?.[0])
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(
        "CREATE TABLE users(id TEXT PRIMARY KEY, deletion_requested_at INTEGER); CREATE TABLE billing_checkout_intents(id TEXT PRIMARY KEY,user_id TEXT UNIQUE,created_at INTEGER); CREATE TABLE subscriptions(user_id TEXT,status TEXT); INSERT INTO users VALUES ('user_1',1),('other',NULL)",
      )
      const claim = () =>
        Number(
          sqlite.prepare(query.sql).run(...(query.params as (string | number | null)[])).changes,
        )
      expect(claim()).toBe(0)
      sqlite.exec(
        "UPDATE users SET deletion_requested_at=NULL WHERE id='user_1'; INSERT INTO subscriptions VALUES ('user_1','past_due')",
      )
      expect(claim()).toBe(0)
      sqlite.exec("UPDATE subscriptions SET status='canceled'")
      expect(claim()).toBe(1)
      expect(claim()).toBe(0)
      expect(sqlite.prepare('SELECT user_id FROM billing_checkout_intents').get()?.user_id).toBe(
        'user_1',
      )
    } finally {
      sqlite.close()
    }
  })
  it('requires authentication for reads, portal and refresh', async () => {
    for (const [path, method] of [
      ['subscription', 'GET'],
      ['portal', 'POST'],
      ['refresh', 'POST'],
    ]) {
      const { app } = harness({ authenticated: false })
      expect((await app.request(`/billing/${path}`, { method })).status).toBe(401)
    }
  })
  it('portal uses server mapping and scopes query to tenant/provider/environment', async () => {
    const { app, billing, where } = harness()
    expect(
      (
        await app.request('/billing/portal', {
          method: 'POST',
          body: JSON.stringify({ userId: 'other', externalCustomerId: 'attacker' }),
          headers: { 'Content-Type': 'application/json' },
        })
      ).status,
    ).toBe(200)
    expect(billing.createCustomerPortal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        externalCustomerId: 'customer_1',
        provider: 'polar',
        environment: 'sandbox',
      }),
    )
    const sql = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0]?.[0])
    expect(sql.params).toEqual(['user_1', 'polar', 'sandbox'])
  })
  it('does not send a missing customer mapping or unsafe return to provider', async () => {
    const missing = harness({ row: null })
    expect((await missing.app.request('/billing/portal', { method: 'POST' })).status).toBe(409)
    expect(missing.billing.createCustomerPortal).not.toHaveBeenCalled()
    const unsafe = harness()
    expect(
      (
        await unsafe.app.request('/billing/portal', {
          method: 'POST',
          body: '{"returnUrl":"https://evil.example"}',
          headers: { 'Content-Type': 'application/json' },
        })
      ).status,
    ).toBe(400)
    expect(unsafe.billing.createCustomerPortal).not.toHaveBeenCalled()
  })
  it('returns typed usage, effective access, cancellation and no provider IDs', async () => {
    const { app } = harness()
    const response = await app.request('/billing/subscription')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      plan: 'pro',
      subscription: { cancelAtPeriodEnd: true, currentPeriodEnd: '2030-01-01T00:00:00.000Z' },
      usage: { projects: 2, storageBytes: 2048 },
      limits: { maxProjects: null },
      portalAvailable: true,
    })
  })
  it('refresh rejects concurrent updates rather than overwriting them', async () => {
    const { app, db } = harness({ updated: false })
    expect((await app.request('/billing/refresh', { method: 'POST' })).status).toBe(409)
    expect(db.update).toHaveBeenCalled()
  })
  it('checkout claims a durable intent before provider call and blocks deletion/duplicate races', async () => {
    const { app, billing, db } = harness({ claim: false })
    const response = await app.request('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: 'pro',
        interval: 'monthly',
        successUrl: 'https://app.example/ok',
        cancelUrl: 'https://app.example/cancel',
      }),
    })
    expect(response.status).toBe(409)
    expect(billing.createCheckout).not.toHaveBeenCalled()
    const sql = new SQLiteSyncDialect().sqlToQuery(db.run.mock.calls[0]?.[0])
    expect(sql.sql).toContain('deletion_requested_at')
    expect(sql.sql).toContain('billing_checkout_intents')
    expect(sql.params).toContain('user_1')
  })
})
