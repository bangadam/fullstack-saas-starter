import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = () =>
  readFileSync(
    new URL('../../../packages/db/drizzle/0006_session_token_uniqueness.sql', import.meta.url),
    'utf8',
  )
function fixture(duplicate: boolean) {
  const db = new DatabaseSync(':memory:')
  db.exec(
    readFileSync(
      new URL('../../../packages/db/drizzle/0000_b2c_baseline.sql', import.meta.url),
      'utf8',
    ),
  )
  db.exec(
    "INSERT INTO users(id,name,email,created_at,updated_at) VALUES('u','U','u@example.test',0,0)",
  )
  const insert = db.prepare(
    'INSERT INTO sessions(id,user_id,token,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)',
  )
  insert.run('a', 'u', 'same', 999, 0, 0)
  if (duplicate) insert.run('b', 'u', 'same', 999, 0, 0)
  return db
}
/** D1 migration execution is atomic; emulate its transaction in actual SQLite. */
function apply(db: DatabaseSync) {
  db.exec('BEGIN')
  try {
    db.exec(migration())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

describe('forward-only session token uniqueness correction', () => {
  it('fails atomically on existing duplicate tokens without deleting rows or the prior index', () => {
    const db = fixture(true)
    const rows = db.prepare('SELECT * FROM sessions ORDER BY id').all()
    expect(() => apply(db)).toThrow(/UNIQUE constraint failed/)
    expect(db.prepare('SELECT * FROM sessions ORDER BY id').all()).toEqual(rows)
    expect(
      db
        .prepare("PRAGMA index_list('sessions')")
        .all()
        .find((row) => row.name === 'sessions_token_unique')?.unique,
    ).toBe(0)
    db.close()
  })
  it('enforces unique tokens on fresh migration without modifying existing sessions', () => {
    const db = fixture(false)
    apply(db)
    expect(
      db
        .prepare("PRAGMA index_list('sessions')")
        .all()
        .find((row) => row.name === 'sessions_token_unique')?.unique,
    ).toBe(1)
    expect(() =>
      db.exec(
        "INSERT INTO sessions(id,user_id,token,expires_at,created_at,updated_at) VALUES('b','u','same',999,0,0)",
      ),
    ).toThrow(/UNIQUE constraint failed/)
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get()?.count).toBe(1)
    db.close()
  })
})
