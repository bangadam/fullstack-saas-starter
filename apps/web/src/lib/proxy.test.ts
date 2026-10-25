import { describe, expect, it } from 'vitest'
import { PROXY_PREFIXES, isProxiedPath, upstreamRequest } from './proxy'

describe('isProxiedPath', () => {
  it('routes API and webhook traffic to the API Worker', () => {
    for (const path of ['/api/health', '/api/auth/sign-in/email', '/webhooks/polar', '/api']) {
      expect(isProxiedPath(path)).toBe(true)
    }
  })

  it('leaves application pages to the TanStack Start handler', () => {
    for (const path of ['/', '/login', '/dashboard', '/pricing', '/apiary']) {
      expect(isProxiedPath(path)).toBe(false)
    }
  })

  it('covers the bare prefixes so /api and /webhooks are proxied too', () => {
    expect(PROXY_PREFIXES).toContain('/api/')
    expect(PROXY_PREFIXES).toContain('/webhooks/')
    expect(isProxiedPath('/api')).toBe(true)
  })
})

describe('upstreamRequest', () => {
  it('forwards the request unchanged — no prefix rewriting', () => {
    // Regression guard for the routing contract: stripping /api made Better
    // Auth generate /auth/reset-password/<token> links that 404 on the public
    // app. Public path must stay equal to the internal path.
    const request = new Request(
      'http://localhost:3000/api/auth/reset-password/tok?callbackURL=%2Fx',
      {
        method: 'GET',
      },
    )

    const upstream = upstreamRequest(request)

    expect(new URL(upstream.url).pathname).toBe('/api/auth/reset-password/tok')
    expect(new URL(upstream.url).search).toBe('?callbackURL=%2Fx')
    expect(upstream.method).toBe('GET')
  })

  it('preserves method, headers and body for webhook signature verification', () => {
    const request = new Request('http://localhost:3000/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=abc' },
      body: '{"id":"evt_1"}',
    })

    const upstream = upstreamRequest(request)

    expect(upstream.method).toBe('POST')
    expect(upstream.headers.get('stripe-signature')).toBe('t=1,v1=abc')
  })
})
