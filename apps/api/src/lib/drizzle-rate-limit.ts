import type { Db } from '@saas/db'
import { sql } from 'drizzle-orm'
import type { RateLimitStore } from './rate-limit'

/**
 * D1-backed rate limit store.
 *
 * Single-statement conditional upsert: the row is created at count 1, or
 * bumped when it still belongs to the current window, or reset to 1 when a
 * new window has started. One round trip, no read-then-write race.
 */
export class DrizzleRateLimitStore implements RateLimitStore {
  constructor(private readonly db: Db) {}

  async consume(key: string, windowStart: number): Promise<number> {
    const row = (await this.db.get(sql<{ count: number }>`
      insert into rate_limits (key, window_start, count)
      values (${key}, ${windowStart}, 1)
      on conflict(key) do update set
        count = case when rate_limits.window_start = ${windowStart} then rate_limits.count + 1 else 1 end,
        window_start = ${windowStart}
      returning count
    `)) as { count: number } | undefined
    return Number(row?.count ?? 1)
  }
}
