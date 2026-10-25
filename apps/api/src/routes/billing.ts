import { getEntitlements } from '@saas/billing'
import {
  createCheckoutSchema,
  createPortalSchema,
  subscriptionResponseSchema,
} from '@saas/contracts'
import { type Db, subscriptions, users } from '@saas/db'
import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Env } from '../../worker-configuration'
import { ApiError } from '../errors'
import { billingScope, safeBillingReturnUrl } from '../lib/billing'
import { currentSubscription, resolvePlan } from '../lib/plan'
import { requireSession } from '../lib/session'
import { parse } from '../lib/validation'
import type { AppBindings } from '../middleware'

export const billingRoutes = new Hono<AppBindings>()

async function subscriptionView(db: Db, userId: string, env: Env) {
  const scope = billingScope(env)
  const row = await currentSubscription(db, userId, scope)
  const usage = await db
    .select({
      projects: sql<number>`(SELECT count(*) FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL)`,
      storageBytes: sql<number>`(SELECT coalesce(sum(size), 0) FROM files WHERE user_id = ${userId} AND status != 'expired')`,
      checkoutBlocked: sql<number>`(${users.deletionRequestedAt} IS NOT NULL OR EXISTS (SELECT 1 FROM billing_checkout_intents WHERE user_id = ${userId}) OR EXISTS (SELECT 1 FROM subscriptions WHERE user_id = ${userId} AND status != 'canceled'))`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  const plan = resolvePlan(row)
  return subscriptionResponseSchema.parse({
    plan,
    status: row?.status ?? 'active',
    subscription: row
      ? {
          id: row.id,
          provider: row.provider,
          environment: row.environment,
          status: row.status,
          plan: row.plan,
          interval: row.interval,
          currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        }
      : null,
    usage: {
      projects: Number(usage?.projects ?? 0),
      storageBytes: Number(usage?.storageBytes ?? 0),
    },
    limits: getEntitlements(plan),
    portalAvailable: Boolean(scope && row?.externalCustomerId),
    refreshAvailable: Boolean(scope && row?.externalCustomerId && row.externalSubscriptionId),
    checkoutAvailable: Boolean(
      scope &&
        !usage?.checkoutBlocked &&
        (env as unknown as Record<string, string | undefined>).PRO_MONTHLY &&
        (!row || row.status === 'canceled'),
    ),
  })
}

billingRoutes.post('/checkout', async (c) => {
  const ctx = await requireSession(c)
  const body = parse(createCheckoutSchema, await c.req.json())
  const scope = billingScope(c.env)
  if (!scope) throw new ApiError(503, 'BAD_REQUEST', 'Billing is not configured')
  const successUrl = safeBillingReturnUrl(c.env.APP_URL, body.successUrl)
  const cancelUrl = safeBillingReturnUrl(c.env.APP_URL, body.cancelUrl)
  const catalog = (c.env as unknown as Record<string, string | undefined>)[
    `PRO_${body.interval.toUpperCase()}`
  ]
  if (!catalog) throw new ApiError(503, 'BAD_REQUEST', 'This billing interval is not configured')
  // One atomic statement arbitrates checkout vs account deletion, duplicate
  // checkouts and existing nonterminal subscriptions, before external I/O.
  // Never clear on an ambiguous outcome: an operator must reconcile it first.
  const result = await c.get('db').run(sql`
    INSERT INTO billing_checkout_intents (id, user_id, created_at)
    SELECT ${crypto.randomUUID()}, id, unixepoch() FROM users
    WHERE id = ${ctx.userId} AND deletion_requested_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM billing_checkout_intents WHERE user_id = ${ctx.userId})
      AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE user_id = ${ctx.userId} AND status != 'canceled')
    ON CONFLICT DO NOTHING
  `)
  if (result.meta.changes !== 1)
    throw ApiError.conflict(
      'Checkout blocked: manage your existing subscription, or contact support to resolve a pending checkout or account deletion',
    )
  const checkout = await c.get('services').billing.createCheckout({
    userId: ctx.userId,
    ...body,
    successUrl,
    cancelUrl,
    provider: scope.provider,
  })
  return c.json(checkout, 201)
})

billingRoutes.post('/portal', async (c) => {
  const ctx = await requireSession(c)
  const text = await c.req.text()
  let json: unknown = {}
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      throw ApiError.badRequest('Invalid JSON')
    }
  }
  const body = parse(createPortalSchema, json)
  const returnUrl = safeBillingReturnUrl(c.env.APP_URL, body.returnUrl)
  const row = await currentSubscription(c.get('db'), ctx.userId, billingScope(c.env))
  if (!row?.externalCustomerId)
    throw ApiError.conflict('No billing customer is linked in this environment')
  const portal = await c.get('services').billing.createCustomerPortal({
    userId: ctx.userId,
    provider: row.provider,
    environment: row.environment,
    externalCustomerId: row.externalCustomerId,
    returnUrl,
  })
  return c.json(portal)
})

billingRoutes.get('/subscription', async (c) => {
  const ctx = await requireSession(c)
  return c.json(await subscriptionView(c.get('db'), ctx.userId, c.env))
})

billingRoutes.post('/refresh', async (c) => {
  const ctx = await requireSession(c)
  const db = c.get('db')
  const row = await currentSubscription(db, ctx.userId, billingScope(c.env))
  if (!row?.externalCustomerId)
    throw ApiError.conflict('No subscription is linked in this environment')
  const refresh = c.get('services').billing.refreshSubscription
  if (!refresh) throw new ApiError(503, 'BAD_REQUEST', 'Subscription refresh is not configured')
  const snapshot = await refresh({
    userId: ctx.userId,
    provider: row.provider,
    environment: row.environment,
    externalCustomerId: row.externalCustomerId,
    externalSubscriptionId: row.externalSubscriptionId,
  })
  // Compare all mutable fields as D1 timestamps have second precision. A
  // concurrent webhook must not be overwritten by an older provider response.
  const updated = await db
    .update(subscriptions)
    .set({ ...snapshot, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.id, row.id),
        eq(subscriptions.userId, ctx.userId),
        eq(subscriptions.provider, row.provider),
        eq(subscriptions.environment, row.environment),
        eq(subscriptions.externalSubscriptionId, row.externalSubscriptionId),
        eq(subscriptions.externalCustomerId, row.externalCustomerId),
        eq(subscriptions.updatedAt, row.updatedAt),
        eq(subscriptions.status, row.status),
        eq(subscriptions.plan, row.plan),
        eq(subscriptions.interval, row.interval),
        eq(subscriptions.cancelAtPeriodEnd, row.cancelAtPeriodEnd),
        sql`${subscriptions.currentPeriodEnd} IS ${row.currentPeriodEnd ? Math.floor(row.currentPeriodEnd.getTime() / 1000) : null}`,
      ),
    )
    .returning({ id: subscriptions.id })
  if (!updated.length)
    throw ApiError.conflict('Subscription changed during refresh; please refresh again')
  return c.json(await subscriptionView(db, ctx.userId, c.env))
})
