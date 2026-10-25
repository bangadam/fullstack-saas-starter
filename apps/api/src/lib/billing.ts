import {
  createPolarAdapter,
  createStripeCheckout,
  createStripeCustomerPortal,
  createStripeRestClient,
  normalizePolarStatus,
  normalizeStripeStatus,
} from '@saas/billing'
import type { BillingInterval, BillingPlan, SubscriptionStatus } from '@saas/contracts'
import { z } from 'zod'
import type { Env } from '../../worker-configuration'
import { ApiError } from '../errors'

export interface BillingScope {
  provider: 'polar' | 'stripe'
  environment: 'sandbox' | 'production'
}
export interface CheckoutInput {
  userId: string
  plan: 'pro'
  interval: 'monthly' | 'yearly'
  successUrl: string
  cancelUrl: string
  provider: Env['BILLING_PROVIDER']
}
export interface ProviderSubscriptionInput extends BillingScope {
  userId: string
  externalCustomerId: string
  externalSubscriptionId: string
}
export interface PortalInput extends BillingScope {
  userId: string
  externalCustomerId: string
  returnUrl?: string
}
export interface ProviderSubscriptionSnapshot {
  status: SubscriptionStatus
  plan: BillingPlan
  interval: BillingInterval
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

/** Scope comes from the provider credential/mode, never the deployment name. */
export function billingScope(env: Env): BillingScope | null {
  if (
    env.BILLING_PROVIDER === 'polar' &&
    env.POLAR_ACCESS_TOKEN &&
    ['sandbox', 'production'].includes(env.POLAR_ENVIRONMENT)
  ) {
    return { provider: 'polar', environment: env.POLAR_ENVIRONMENT }
  }
  if (env.BILLING_PROVIDER === 'stripe') {
    if (/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? ''))
      return { provider: 'stripe', environment: 'sandbox' }
    if (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? ''))
      return { provider: 'stripe', environment: 'production' }
  }
  return null
}
export function safeBillingReturnUrl(appUrl: string, input?: string): string {
  const app = new URL(appUrl)
  let url: URL
  try {
    url = new URL(input ?? '/dashboard/settings/billing', input === undefined ? app : undefined)
  } catch {
    throw ApiError.badRequest('Return URL must be an absolute same-origin URL')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== app.origin ||
    url.username ||
    url.password
  ) {
    throw ApiError.badRequest('Return URL must use the application origin')
  }
  return url.href
}
function requireScope(
  env: Env,
  input: { provider: Env['BILLING_PROVIDER']; environment?: BillingScope['environment'] },
) {
  const scope = billingScope(env)
  if (!scope) throw new ApiError(503, 'BAD_REQUEST', 'Billing provider is not configured')
  if (
    scope.provider !== input.provider ||
    (input.environment && scope.environment !== input.environment)
  ) {
    throw ApiError.conflict('Billing provider mapping does not match this environment')
  }
  return scope
}
function catalogId(env: Env, plan: string, interval: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[`${plan}_${interval}`.toUpperCase()]
}
function polarClient(env: Env) {
  const base =
    env.POLAR_ENVIRONMENT === 'sandbox'
      ? 'https://sandbox-api.polar.sh/v1'
      : 'https://api.polar.sh/v1'
  return async (path: string, body?: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok)
      throw new ApiError(502, 'BAD_REQUEST', 'Billing provider unavailable; try again later')
    return response.json()
  }
}
const redirectSchema = z.object({ url: z.string().url() })
function polarAdapter(env: Env) {
  const request = polarClient(env)
  return createPolarAdapter({
    accessToken: env.POLAR_ACCESS_TOKEN ?? '',
    environment: env.POLAR_ENVIRONMENT,
    client: {
      checkouts: {
        create: async (body) => redirectSchema.parse(await request('/checkouts', body)),
      },
      customerSessions: {
        create: async (body) => {
          const result = z
            .object({ customer_portal_url: z.string().url() })
            .parse(await request('/customer-sessions', body))
          return { customerPortalUrl: result.customer_portal_url }
        },
      },
    },
  })
}
export async function createProviderCheckout(
  env: Env,
  input: CheckoutInput,
): Promise<{ url: string }> {
  requireScope(env, input)
  const successUrl = safeBillingReturnUrl(env.APP_URL, input.successUrl)
  const cancelUrl = safeBillingReturnUrl(env.APP_URL, input.cancelUrl)
  const productId = catalogId(env, input.plan, input.interval)
  if (!productId) throw new ApiError(503, 'BAD_REQUEST', 'This billing interval is not configured')
  if (input.provider === 'polar')
    return polarAdapter(env).createCheckout({
      organizationId: input.userId,
      productId,
      successUrl,
      metadata: { user_id: input.userId, plan: input.plan, interval: input.interval },
    })
  return createStripeCheckout(createStripeRestClient(env.STRIPE_SECRET_KEY ?? ''), {
    userId: input.userId,
    priceId: productId,
    successUrl,
    cancelUrl,
  })
}
export async function createProviderPortal(env: Env, input: PortalInput): Promise<{ url: string }> {
  requireScope(env, input)
  if (!input.externalCustomerId?.trim())
    throw ApiError.conflict('No billing customer mapping is available')
  const returnUrl = safeBillingReturnUrl(env.APP_URL, input.returnUrl)
  if (input.provider === 'polar')
    return polarAdapter(env).createCustomerPortal({
      customerId: input.externalCustomerId,
      returnUrl,
    })
  return createStripeCustomerPortal(createStripeRestClient(env.STRIPE_SECRET_KEY ?? ''), {
    customerId: input.externalCustomerId,
    returnUrl,
  })
}

/** Explicit, read-only provider reconciliation; never cancels or creates a subscription. */
export async function refreshProviderSubscription(
  env: Env,
  input: ProviderSubscriptionInput,
): Promise<ProviderSubscriptionSnapshot> {
  const scope = requireScope(env, input)
  if (!input.externalCustomerId || !input.externalSubscriptionId)
    throw ApiError.conflict('Missing subscription mapping')
  const path = `/subscriptions/${encodeURIComponent(input.externalSubscriptionId)}`
  const raw =
    scope.provider === 'polar'
      ? await polarClient(env)(path)
      : await createStripeRestClient(env.STRIPE_SECRET_KEY ?? '').get(path)
  const base = z
    .object({ id: z.string(), status: z.string(), cancel_at_period_end: z.boolean() })
    .parse(raw)
  let customerId: string
  let catalog: string
  let interval: BillingInterval
  let end: Date | null
  let status: SubscriptionStatus
  if (scope.provider === 'polar') {
    const sub = z
      .object({
        customer_id: z.string(),
        product_id: z.string(),
        recurring_interval: z.enum(['month', 'year']),
        current_period_end: z.string().datetime({ offset: true }).nullable(),
      })
      .parse(raw)
    customerId = sub.customer_id
    catalog = sub.product_id
    interval = sub.recurring_interval === 'year' ? 'yearly' : 'monthly'
    end = sub.current_period_end ? new Date(sub.current_period_end) : null
    status = normalizePolarStatus(base.status)
  } else {
    const sub = z
      .object({
        customer: z.union([z.string(), z.object({ id: z.string() })]),
        livemode: z.boolean(),
        current_period_end: z.number().int().nonnegative().nullable().optional(),
        items: z.object({
          data: z
            .array(
              z.object({
                current_period_end: z.number().int().nonnegative().optional(),
                price: z.object({
                  id: z.string(),
                  recurring: z.object({ interval: z.enum(['month', 'year']) }),
                }),
              }),
            )
            .length(1),
        }),
      })
      .parse(raw)
    if (sub.livemode !== (scope.environment === 'production'))
      throw ApiError.conflict('Provider environment mapping mismatch')
    customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    const item = sub.items.data[0]
    if (!item) throw ApiError.conflict('Missing subscription item')
    catalog = item.price.id
    interval = item.price.recurring.interval === 'year' ? 'yearly' : 'monthly'
    const timestamp = sub.current_period_end ?? item.current_period_end
    end = timestamp == null ? null : new Date(timestamp * 1000)
    status = normalizeStripeStatus(base.status)
  }
  if (base.id !== input.externalSubscriptionId || customerId !== input.externalCustomerId)
    throw ApiError.conflict('Provider customer/subscription mapping mismatch')
  if (end && !Number.isFinite(end.getTime())) throw ApiError.conflict('Invalid subscription expiry')
  if (catalog !== catalogId(env, 'pro', interval))
    throw ApiError.conflict('Subscription product is not in the configured catalog')
  return {
    status,
    plan: 'pro',
    interval,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: base.cancel_at_period_end,
  }
}
