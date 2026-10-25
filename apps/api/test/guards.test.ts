import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/errors'
import type { RateLimitStore } from '../src/lib/rate-limit'
import { errorHandler } from '../src/lib/validation'
import { originGuard, rateLimitGuard, turnstileGuard } from '../src/middleware'

/**
 * These guards are exercised over real HTTP through a minimal Hono app so the
 * security behaviour is proven at the request boundary, without booting the
 * whole API (D1, Better Auth, services).
 */

function makeApp(opts: { store?: RateLimitStore } = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  app.use('*', originGuard)
  if (opts.store) app.use('*', rateLimitGuard({ storeFor: () => opts.store as RateLimitStore }))
  app.use('/api/auth/*', turnstileGuard)
  // Mirrors Better Auth: the auth handler returns a raw Response, so header
  // propagation must survive a non-Hono response.
  app.all('/api/auth/*', () => new Response('{"ok":true}', { status: 200 }))
  app.all('*', (c) => c.json({ ok: true }))
  app.onError(errorHandler)
  return app
}

const env = (overrides: Record<string, unknown> = {}) => ({
  APP_URL: 'http://localhost:3000',
  ...overrides,
})

describe('originGuard over HTTP', () => {
  it('blocks a cross-origin write with 403', async () => {
    const app = makeApp()
    const res = await app.request(
      '/api/projects',
      { method: 'POST', headers: { Origin: 'https://evil.example' } },
      env(),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
  })

  it('allows a same-origin write', async () => {
    const app = makeApp()
    const res = await app.request(
      '/api/projects',
      { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
      env(),
    )
    expect(res.status).toBe(200)
  })

  it('allows reads without any Origin header', async () => {
    const app = makeApp()
    const res = await app.request('/api/projects', { method: 'GET' }, env())
    expect(res.status).toBe(200)
  })
})

describe('turnstileGuard over HTTP', () => {
  it('lets requests through while no secret is configured (local dev)', async () => {
    const app = makeApp()
    const res = await app.request(
      '/api/auth/sign-in/email',
      { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
      env(),
    )
    expect(res.status).toBe(200)
  })

  it('rejects a credential request without a token once a secret exists', async () => {
    const app = makeApp()
    const res = await app.request(
      '/api/auth/sign-in/email',
      { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
      env({ TURNSTILE_SECRET_KEY: 'secret' }),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
  })

  it('never applies the token requirement to non-credential auth routes', async () => {
    const app = makeApp()
    const res = await app.request(
      '/api/auth/get-session',
      { method: 'GET', headers: { Origin: 'http://localhost:3000' } },
      env({ TURNSTILE_SECRET_KEY: 'secret' }),
    )
    expect(res.status).toBe(200)
  })
})

describe('rateLimitGuard over HTTP', () => {
  function memoryStore(): RateLimitStore {
    const rows = new Map<string, { windowStart: number; count: number }>()
    return {
      async consume(key, windowStart) {
        const row = rows.get(key)
        if (!row || row.windowStart < windowStart) {
          rows.set(key, { windowStart, count: 1 })
          return 1
        }
        row.count += 1
        return row.count
      },
    }
  }

  it('exposes rate limit headers on the response so clients can back off', async () => {
    const app = makeApp({ store: memoryStore() })
    const res = await app.request(
      '/api/projects',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000', 'cf-connecting-ip': '203.0.113.9' },
      },
      env(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-ratelimit-limit')).toBe('120')
    expect(res.headers.get('x-ratelimit-remaining')).toBe('119')
  })

  it('exposes rate limit headers even when the handler returns a raw Response', async () => {
    const app = makeApp({ store: memoryStore() })
    const res = await app.request(
      '/api/auth/sign-out',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000', 'cf-connecting-ip': '203.0.113.11' },
      },
      env(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-ratelimit-limit')).toBe('120')
    expect(res.headers.get('x-ratelimit-remaining')).toBe('119')
  })

  it('allows attempts up to the strict credential budget then returns 429', async () => {
    const app = makeApp({ store: memoryStore() })
    const call = () =>
      app.request(
        '/api/auth/sign-in/email',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:3000', 'cf-connecting-ip': '203.0.113.5' },
        },
        env(),
      )

    for (let i = 0; i < 10; i++) {
      expect((await call()).status).toBe(200)
    }
    const blocked = await call()
    expect(blocked.status).toBe(429)
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })

  it('keeps buckets per client address', async () => {
    const app = makeApp({ store: memoryStore() })
    const call = (ip: string) =>
      app.request(
        '/api/auth/sign-in/email',
        { method: 'POST', headers: { Origin: 'http://localhost:3000', 'cf-connecting-ip': ip } },
        env(),
      )
    for (let i = 0; i < 10; i++) await call('203.0.113.5')
    expect((await call('203.0.113.5')).status).toBe(429)
    expect((await call('203.0.113.6')).status).toBe(200)
  })

  it('does not limit safe methods', async () => {
    const app = makeApp({ store: memoryStore() })
    for (let i = 0; i < 25; i++) {
      const res = await app.request('/api/auth/get-session', { method: 'GET' }, env())
      expect(res.status).toBe(200)
    }
  })
})

describe('error status mapping', () => {
  it('maps ApiError 429 to the RATE_LIMITED body', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown> }>()
    app.all('*', () => {
      throw ApiError.tooManyRequests('Slow down')
    })
    app.onError(errorHandler)
    const res = await app.request('/', {}, env())
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: unknown }).error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Slow down',
    })
  })
})
