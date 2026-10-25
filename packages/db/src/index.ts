import type { D1Database } from '@cloudflare/workers-types'
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export { schema }
export * from './schema'
export type { DrizzleD1Database }
export type Db = DrizzleD1Database<typeof schema>

export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema })
}
