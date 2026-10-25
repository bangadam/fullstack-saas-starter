import { describe, expect, it } from 'vitest'
import { clientIdentity, selectRateRule } from '../src/lib/rate-limit-rules'

describe('clientIdentity', () => {
  it('prefers the Cloudflare client IP header', () => {
    expect(
      clientIdentity({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' }),
    ).toBe('203.0.113.7')
  })

  it('falls back to the first X-Forwarded-For hop', () => {
    expect(clientIdentity({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })).toBe('203.0.113.9')
  })

  it('returns unknown when no client address header is present', () => {
    expect(clientIdentity({})).toBe('unknown')
  })
})

describe('selectRateRule', () => {
  it('never limits safe methods', () => {
    expect(selectRateRule('GET', '/api/auth/get-session')).toBeNull()
    expect(selectRateRule('HEAD', '/api/projects')).toBeNull()
    expect(selectRateRule('OPTIONS', '/api/projects')).toBeNull()
  })

  it('applies the strict bucket to credential endpoints', () => {
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/sign-up/email',
      '/api/auth/request-password-reset',
      '/api/auth/reset-password',
      '/api/auth/send-verification-email',
      '/api/auth/change-password',
    ]) {
      const rule = selectRateRule('POST', path)
      expect(rule?.bucket).toBe('auth-strict')
      expect(rule?.limit).toBe(10)
    }
  })

  it('uses the strict password-attempt budget for account deletion', () => {
    expect(selectRateRule('POST', '/api/auth/delete-user')?.bucket).toBe('auth-strict')
  })

  it('limits webhook deliveries with a generous bucket', () => {
    const rule = selectRateRule('POST', '/webhooks/polar')
    expect(rule?.bucket).toBe('webhooks')
    expect(rule?.limit).toBe(120)
  })

  it('applies a general write bucket to other mutations', () => {
    const rule = selectRateRule('POST', '/api/projects')
    expect(rule?.bucket).toBe('write')
    expect(selectRateRule('DELETE', '/api/projects/1')?.bucket).toBe('write')
  })

  it('does not apply the strict bucket to other auth routes', () => {
    expect(selectRateRule('POST', '/api/auth/sign-out')?.bucket).toBe('write')
  })
})
