import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type * as Sqlite from 'node:sqlite'
import { createDb } from './db'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof Sqlite

export function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    readFileSync(
      new URL('../../../packages/db/drizzle/0000_b2c_baseline.sql', import.meta.url),
      'utf8',
    ),
  )
  sqlite.exec(
    readFileSync(
      new URL('../../../packages/db/drizzle/0003_job_recovery.sql', import.meta.url),
      'utf8',
    ),
  )
  sqlite.exec(
    "INSERT INTO users(id,name,email,created_at,updated_at) VALUES('user-1','A','a@example.test',1,1)",
  )
  function prepare(sql: string) {
    let values: (string | number | null)[] = []
    const stmt = {
      bind(...args: (string | number | null)[]) {
        values = args
        return stmt
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values), success: true }
      },
      async run() {
        const result = sqlite.prepare(sql).run(...values)
        return { meta: { changes: Number(result.changes) }, success: true }
      },
    }
    return stmt
  }
  const d1 = {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const s of statements) results.push(await s.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { sqlite, db: createDb(d1), d1 }
}
