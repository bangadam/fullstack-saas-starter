/**
 * Fixed-window rate limiting over a D1 table.
 *
 * Each endpoint owns a `bucket` (e.g. `auth`); the key additionally carries
 * the client IP so one abusive client cannot exhaust the budget for everyone.
 * The counter lives in D1 so the limit holds across Worker isolates — the
 * store's `consume` must be atomic (Drizzle adapter uses a conditional
 * upsert), otherwise racing requests over-admit.
 *
 * Decision math is pure (unit-testable); only the store touches the database.
 */

export interface RateLimitStore {
  /**
   * Atomically increments the counter for the key when the row still belongs
   * to this window, otherwise resets it to 1. Returns the new count — the
   * single round trip that makes the check-and-increment race-safe.
   */
  consume(key: string, windowStart: number, limit: number): Promise<number>
}

export interface RateLimitInput {
  key: string
  limit: number
  windowMs: number
  now?: number
  store: RateLimitStore
}

export type RateLimitDecision =
  | { ok: true; remaining: number; resetMs: number }
  | { ok: false; remaining: 0; resetMs: number }

export function defaultKey(bucket: string, clientId: string): string {
  return `${bucket}:${clientId && clientId.length > 0 ? clientId : 'unknown'}`
}

export function computeWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitDecision> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error('Invalid rate limit configuration: limit must be a positive integer')
  }
  if (!Number.isInteger(input.windowMs) || input.windowMs <= 0) {
    throw new Error('Invalid rate limit configuration: windowMs must be a positive integer')
  }

  const now = input.now ?? Date.now()
  const windowStart = computeWindowStart(now, input.windowMs)
  const resetMs = windowStart + input.windowMs - now

  const count = await input.store.consume(input.key, windowStart, input.limit)
  if (count <= input.limit) {
    return { ok: true, remaining: input.limit - count, resetMs }
  }
  return { ok: false, remaining: 0, resetMs }
}

/** Conventional headers a client needs to back off correctly. */
export function rateLimitHeaders(
  decision: RateLimitDecision,
  limit: number,
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Reset': String(Math.ceil(decision.resetMs / 1000)),
    ...(decision.ok ? {} : { 'Retry-After': String(Math.ceil(decision.resetMs / 1000)) }),
  }
}
