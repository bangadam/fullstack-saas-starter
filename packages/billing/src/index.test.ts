import { describe, expect, it } from 'vitest'
import { verifyStripeSignature } from './adapters/stripe'
import { EntitlementError, getEntitlements, requireEntitlement } from './index'
import { normalizePolarStatus, normalizeStripeStatus } from './normalize'

describe('status normalization', () => {
  it('maps stripe statuses', () => {
    expect(normalizeStripeStatus('active')).toBe('active')
    expect(normalizeStripeStatus('past_due')).toBe('past_due')
    expect(normalizeStripeStatus('unpaid')).toBe('past_due')
    expect(normalizeStripeStatus('canceled')).toBe('canceled')
    expect(normalizeStripeStatus('trialing')).toBe('trialing')
    expect(normalizeStripeStatus('incomplete_expired')).toBe('incomplete')
    expect(normalizeStripeStatus('weird')).toBe('incomplete')
  })

  it('maps polar statuses', () => {
    expect(normalizePolarStatus('active')).toBe('active')
    expect(normalizePolarStatus('past_due')).toBe('past_due')
    expect(normalizePolarStatus('trialing')).toBe('trialing')
    expect(normalizePolarStatus('unpaid')).toBe('past_due')
  })
})

describe('entitlements', () => {
  it('enforces free project quota', () => {
    expect(getEntitlements('free').maxProjects).toBe(3)
    expect(() => requireEntitlement('free', 'maxProjects', 3)).toThrow(EntitlementError)
    expect(() => requireEntitlement('free', 'maxProjects', 2)).not.toThrow()
    expect(() => requireEntitlement('pro', 'maxProjects', 9999)).not.toThrow()
  })

  it('enforces storage limits', () => {
    expect(getEntitlements('free').maxStorageBytes).toBe(100 * 1024 * 1024)
    expect(getEntitlements('pro').maxStorageBytes).toBe(10 * 1024 ** 3)
    expect(() => requireEntitlement('free', 'maxStorageBytes', 100 * 1024 * 1024, 1)).toThrow(
      EntitlementError,
    )
  })
})

describe('stripe webhook signature', () => {
  const secret = 'whsec_test_secret'
  const body = JSON.stringify({ id: 'evt_1', type: 'x', data: { object: {} } })

  async function sign(payload: string, timestamp: number) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    )
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  it('accepts a valid signature', async () => {
    const t = Math.floor(Date.now() / 1000)
    const sig = await sign(body, t)
    await expect(
      verifyStripeSignature(
        secret,
        { 'stripe-signature': `t=${t},v1=${sig}` },
        new TextEncoder().encode(body).buffer as ArrayBuffer,
      ),
    ).resolves.toBeUndefined()
  })

  it('rejects a bad signature and stale timestamps', async () => {
    const t = Math.floor(Date.now() / 1000)
    await expect(
      verifyStripeSignature(
        secret,
        { 'stripe-signature': `t=${t},v1=deadbeef` },
        new TextEncoder().encode(body).buffer as ArrayBuffer,
      ),
    ).rejects.toThrow('verification failed')
    const old = t - 4000
    const sig = await sign(body, old)
    await expect(
      verifyStripeSignature(
        secret,
        { 'stripe-signature': `t=${old},v1=${sig}` },
        new TextEncoder().encode(body).buffer as ArrayBuffer,
      ),
    ).rejects.toThrow('tolerance')
  })
})
