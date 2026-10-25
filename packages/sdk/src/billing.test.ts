import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './index'
const subscription = {
  plan: 'free',
  status: 'active',
  subscription: null,
  usage: { projects: 1, storageBytes: 0 },
  limits: { maxProjects: 3, maxStorageBytes: 100 },
  portalAvailable: false,
  checkoutAvailable: false,
  refreshAvailable: false,
}
describe('typed billing client', () => {
  it('validates subscription and refresh responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(subscription))
    const client = createApiClient({ baseUrl: '/api', fetchImpl: fetcher })
    expect(await client.getSubscription()).toEqual(subscription)
    expect(await client.refreshSubscription()).toEqual(subscription)
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/billing/refresh')
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('POST')
    fetcher.mockImplementation(async () => Response.json({ plan: 'nonsense' }))
    await expect(client.getSubscription()).rejects.toThrow()
  })
  it('creates a customer portal without sending customer IDs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ url: 'https://polar.sh/portal' }))
    const client = createApiClient({ baseUrl: '/api', fetchImpl: fetcher })
    await expect(
      client.createCustomerPortal({ returnUrl: 'https://app.example/dashboard/settings/billing' }),
    ).resolves.toEqual({ url: 'https://polar.sh/portal' })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/billing/portal')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      returnUrl: 'https://app.example/dashboard/settings/billing',
    })
  })
})
