import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingScope,
  createProviderCheckout,
  createProviderPortal,
  refreshProviderSubscription,
  safeBillingReturnUrl,
} from '../src/lib/billing'
import type { Env } from '../worker-configuration'

const env = {
  APP_URL: 'https://app.example',
  BILLING_PROVIDER: 'polar',
  POLAR_ENVIRONMENT: 'sandbox',
  POLAR_ACCESS_TOKEN: 'test-token',
  PRO_MONTHLY: 'product_1',
} as unknown as Env
const mapping = {
  userId: 'user_1',
  provider: 'polar' as const,
  environment: 'sandbox' as const,
  externalCustomerId: 'customer_1',
  externalSubscriptionId: 'sub_1',
}
afterEach(() => vi.unstubAllGlobals())
describe('billing provider safety', () => {
  it('Stripe portal uses the mapped customer and checkout binds subscription metadata', async () => {
    const stripeEnv = {
      ...env,
      BILLING_PROVIDER: 'stripe' as const,
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      PRO_MONTHLY: 'price_1',
    }
    const fetcher = vi
      .fn()
      .mockImplementation(async () => Response.json({ url: 'https://billing.stripe.com/session' }))
    vi.stubGlobal('fetch', fetcher)
    await createProviderPortal(stripeEnv, { ...mapping, provider: 'stripe' })
    expect(new URLSearchParams(fetcher.mock.calls[0]?.[1].body).get('customer')).toBe('customer_1')
    expect(new URLSearchParams(fetcher.mock.calls[0]?.[1].body).get('return_url')).toBe(
      'https://app.example/dashboard/settings/billing',
    )
    await createProviderCheckout(stripeEnv, {
      userId: 'user_1',
      provider: 'stripe',
      plan: 'pro',
      interval: 'monthly',
      successUrl: 'https://app.example/ok',
      cancelUrl: 'https://app.example/cancel',
    })
    expect(
      new URLSearchParams(fetcher.mock.calls[1]?.[1].body).get(
        'subscription_data[metadata][user_id]',
      ),
    ).toBe('user_1')
  })
  it('Stripe refresh validates mode and catalog and reads item period expiry', async () => {
    const stripeEnv = {
      ...env,
      BILLING_PROVIDER: 'stripe' as const,
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      PRO_MONTHLY: 'price_1',
    }
    const data = {
      id: 'sub_1',
      customer: { id: 'customer_1' },
      status: 'active',
      livemode: false,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_end: 1893456000,
            price: { id: 'price_1', recurring: { interval: 'month' } },
          },
        ],
      },
    }
    const fetcher = vi.fn().mockImplementation(async () => Response.json(data))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      refreshProviderSubscription(stripeEnv, { ...mapping, provider: 'stripe' }),
    ).resolves.toMatchObject({ plan: 'pro', currentPeriodEnd: new Date('2030-01-01') })
    fetcher.mockImplementation(async () => Response.json({ ...data, livemode: true }))
    await expect(
      refreshProviderSubscription(stripeEnv, { ...mapping, provider: 'stripe' }),
    ).rejects.toThrow('environment')
    fetcher.mockImplementation(async () => Response.json(data))
    await expect(
      refreshProviderSubscription({ ...stripeEnv, PRO_MONTHLY: 'other' } as Env, {
        ...mapping,
        provider: 'stripe',
      }),
    ).rejects.toThrow('catalog')
  })
  it('resolves Stripe mode from the credential, never deployment environment', () => {
    expect(
      billingScope({ ...env, BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_fixture' }),
    ).toEqual({ provider: 'stripe', environment: 'sandbox' })
    expect(
      billingScope({ ...env, BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_fixture' }),
    ).toEqual({ provider: 'stripe', environment: 'production' })
    expect(billingScope({ ...env, BILLING_PROVIDER: 'none' })).toBeNull()
    expect(
      billingScope({ ...env, BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: undefined }),
    ).toBeNull()
  })
  it.each([
    'https://evil.example/path',
    '//evil.example',
    'javascript:alert(1)',
    'https://user@app.example/path',
    'https://app.example.evil/path',
  ])('rejects unsafe return URL %s', (url) => {
    expect(() => safeBillingReturnUrl(env.APP_URL, url)).toThrow()
  })
  it('accepts same-origin return URLs and defaults to billing settings', () => {
    expect(safeBillingReturnUrl(env.APP_URL)).toBe('https://app.example/dashboard/settings/billing')
    expect(safeBillingReturnUrl(env.APP_URL, 'https://app.example/dashboard?done=1')).toBe(
      'https://app.example/dashboard?done=1',
    )
  })
  it('uses sandbox and persisted provider customer with Polar snake_case response', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ customer_portal_url: 'https://sandbox.polar.sh/portal' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      createProviderPortal(env, {
        ...mapping,
        returnUrl: 'https://app.example/dashboard/settings/billing',
      }),
    ).resolves.toEqual({ url: 'https://sandbox.polar.sh/portal' })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://sandbox-api.polar.sh/v1/customer-sessions')
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      customer_id: 'customer_1',
      return_url: 'https://app.example/dashboard/settings/billing',
    })
  })
  it('rejects wrong environment before any network request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      createProviderPortal(env, { ...mapping, environment: 'production' }),
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('checkout uses Polar products and carries server-side user and plan metadata', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ url: 'https://sandbox.polar.sh/checkout' }))
    vi.stubGlobal('fetch', fetcher)
    await createProviderCheckout(env, {
      userId: 'user_1',
      provider: 'polar',
      plan: 'pro',
      interval: 'monthly',
      successUrl: 'https://app.example/ok',
      cancelUrl: 'https://app.example/cancel',
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://sandbox-api.polar.sh/v1/checkouts')
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toMatchObject({
      products: ['product_1'],
      metadata: { user_id: 'user_1', plan: 'pro', interval: 'monthly' },
    })
  })
  it('refresh reads only the mapped subscription and verifies customer ownership', async () => {
    const data = {
      id: 'sub_1',
      customer_id: 'customer_1',
      status: 'active',
      product_id: 'product_1',
      recurring_interval: 'month',
      current_period_end: '2030-01-01T00:00:00Z',
      cancel_at_period_end: true,
    }
    const fetcher = vi.fn().mockResolvedValue(Response.json(data))
    vi.stubGlobal('fetch', fetcher)
    await expect(refreshProviderSubscription(env, mapping)).resolves.toMatchObject({
      status: 'active',
      plan: 'pro',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(data.current_period_end),
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://sandbox-api.polar.sh/v1/subscriptions/sub_1')
    expect(fetcher.mock.calls[0]?.[1].method).toBe('GET')
    fetcher.mockResolvedValue(Response.json({ ...data, customer_id: 'other' }))
    await expect(refreshProviderSubscription(env, mapping)).rejects.toThrow('mapping')
    fetcher.mockResolvedValue(Response.json({ ...data, current_period_end: 'bad-date' }))
    await expect(refreshProviderSubscription(env, mapping)).rejects.toThrow()
  })
})
