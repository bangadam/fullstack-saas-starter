import { describe, expect, it } from 'vitest'
import {
  type RateLimitDecision,
  type RateLimitStore,
  checkRateLimit,
  computeWindowStart,
  defaultKey,
} from '../src/lib/rate-limit'

/** In-memory store implementing the atomic consume contract. */
function makeStore() {
  const rows = new Map<string, { windowStart: number; count: number }>()
  const store: RateLimitStore = {
    async consume(key, windowStart, limit) {
      const row = rows.get(key)
      if (!row || row.windowStart < windowStart) {
        rows.set(key, { windowStart, count: 1 })
        return 1
      }
      const count = row.count + 1
      row.count = count
      return count
    },
  }
  return { store, rows }
}

const input = (overrides: Record<string, unknown> = {}) => ({
  key: 'auth:127.0.0.1',
  limit: 10,
  windowMs: 60_000,
  now: 12_000,
  ...overrides,
})

describe('computeWindowStart', () => {
  it('floors the timestamp to the window boundary', () => {
    expect(computeWindowStart(61_000, 60_000)).toBe(60_000)
    expect(computeWindowStart(60_000, 60_000)).toBe(60_000)
    expect(computeWindowStart(119_999, 60_000)).toBe(60_000)
  })
})

describe('defaultKey', () => {
  it('namespaces the endpoint by client identity', () => {
    expect(defaultKey('auth', '203.0.113.7')).toBe('auth:203.0.113.7')
    expect(defaultKey('auth', '')).toBe('auth:unknown')
  })
})

describe('checkRateLimit', () => {
  it('allows the first request inside a window', async () => {
    const { store } = makeStore()
    const decision: RateLimitDecision = await checkRateLimit({ ...input(), store })
    expect(decision).toEqual({ ok: true, remaining: 9, resetMs: 48_000 })
  })

  it('counts every request in the same window and blocks at the limit', async () => {
    const { store } = makeStore()
    for (let i = 0; i < 9; i++) {
      expect((await checkRateLimit({ ...input(), store })).ok).toBe(true)
    }
    const last = await checkRateLimit({ ...input(), store })
    expect(last).toEqual({ ok: true, remaining: 0, resetMs: 48_000 })
    const blocked = await checkRateLimit({ ...input(), store })
    expect(blocked).toEqual({ ok: false, remaining: 0, resetMs: 48_000 })
  })

  it('resets the counter when the window rolls over', async () => {
    const { store } = makeStore()
    for (let i = 0; i < 10; i++) {
      await checkRateLimit({ ...input(), store })
    }
    expect((await checkRateLimit({ ...input(), store })).ok).toBe(false)

    const next = await checkRateLimit({ ...input({ now: 60_000 }), store })
    expect(next).toEqual({ ok: true, remaining: 9, resetMs: 60_000 })
  })

  it('keeps separate buckets per key', async () => {
    const { store } = makeStore()
    for (let i = 0; i < 10; i++) {
      await checkRateLimit({ ...input({ key: 'auth:a' }), store })
    }
    expect((await checkRateLimit({ ...input({ key: 'auth:a' }), store })).ok).toBe(false)
    expect((await checkRateLimit({ ...input({ key: 'auth:b' }), store })).ok).toBe(true)
  })

  it('rejects invalid configuration instead of silently disabling the limit', async () => {
    const { store } = makeStore()
    await expect(checkRateLimit({ ...input({ limit: 0 }), store })).rejects.toThrow(
      'Invalid rate limit configuration',
    )
  })
})
