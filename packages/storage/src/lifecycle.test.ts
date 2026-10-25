import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  RESERVE_FILE_SQL,
  UPLOAD_GRACE_SECONDS,
  UPLOAD_TTL_SECONDS,
  uploadDeadlines,
} from './lifecycle'

describe('storage reservations on real SQLite', () => {
  function database() {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, deletion_requested_at INTEGER);
      INSERT INTO users VALUES ('u',NULL),('other',NULL),('deleting',1);
      CREATE TABLE files(id TEXT PRIMARY KEY,user_id TEXT,r2_key TEXT,name TEXT,size INTEGER,
      content_type TEXT,status TEXT,created_at INTEGER,upload_expires_at INTEGER,expires_at INTEGER);`)
    return db
  }
  it('serializes competing reservations and counts pending plus completed, not expired', async () => {
    const db = database()
    const reserve = (id: string, user = 'u') =>
      db
        .prepare(RESERVE_FILE_SQL)
        .all(id, user, id, 'x.txt', 6, 'text/plain', 100, 700, 4300, user, user, 6, 10)
    const results = await Promise.all([
      Promise.resolve().then(() => reserve('a')),
      Promise.resolve().then(() => reserve('b')),
    ])
    expect(results.flat()).toHaveLength(1)
    expect(reserve('c', 'other')).toHaveLength(1)
    db.exec("UPDATE files SET status='completed' WHERE user_id='u'")
    expect(reserve('d')).toHaveLength(0)
    db.exec("UPDATE files SET status='deleting' WHERE user_id='u'")
    expect(reserve('e')).toHaveLength(0)
    db.exec("UPDATE files SET status='expired' WHERE user_id='u'")
    expect(reserve('f')).toHaveLength(1)
    expect(reserve('g', 'deleting')).toHaveLength(0)
    db.close()
  })
  it('does not expire reservations until URL expiry plus the upload grace', () => {
    expect(uploadDeadlines(100)).toEqual({
      uploadExpiresAt: 100 + UPLOAD_TTL_SECONDS,
      expiresAt: 100 + UPLOAD_TTL_SECONDS + UPLOAD_GRACE_SECONDS,
    })
  })
})
