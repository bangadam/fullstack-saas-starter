import { describe, expect, it, vi } from 'vitest'
import { cleanupStorage } from './cleanup'
import { fixture } from './test-db'

function storageFixture() {
  const f = fixture()
  f.sqlite.exec(
    `ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'; ALTER TABLE files ADD COLUMN expires_at INTEGER;`,
  )
  const insert = f.sqlite.prepare(
    'INSERT INTO files(id,user_id,r2_key,name,size,content_type,created_at,status,expires_at) VALUES(?,?,?,?,1,?,1,?,?)',
  )
  for (const [id, status, expires] of [
    ['ready', 'completed', 1],
    ['fresh', 'pending', 1000],
    ['old', 'pending', 10],
    ['deleted', 'deleting', 10],
    ['tombstone', 'expired', 10],
  ] as const)
    insert.run(id, 'user-1', id, 'n', 'text/plain', status, expires)
  return f
}
describe('bounded storage cleanup', () => {
  it('expires only elapsed pending/deleting reservations, never deletes completed or live uploads', async () => {
    const { d1, sqlite } = storageFixture()
    const bucket = { delete: vi.fn() }
    await cleanupStorage(d1, bucket, 100, 50)
    expect(bucket.delete.mock.calls.flat().sort()).toEqual(['deleted', 'old', 'tombstone'])
    expect(sqlite.prepare("SELECT status FROM files WHERE id='ready'").get()?.status).toBe(
      'completed',
    )
    expect(sqlite.prepare("SELECT status FROM files WHERE id='fresh'").get()?.status).toBe(
      'pending',
    )
    expect(sqlite.prepare('SELECT count(*) AS n FROM files').get()?.n).toBe(5)
  })
  it('rotates bounded tombstones fairly and deletes late objects on later passes', async () => {
    const { d1 } = storageFixture()
    const bucket = { delete: vi.fn() }
    for (let i = 0; i < 8; i++) await cleanupStorage(d1, bucket, 100, 1)
    expect(new Set(bucket.delete.mock.calls.flat())).toEqual(
      new Set(['deleted', 'old', 'tombstone']),
    )
    expect(bucket.delete.mock.calls.flat().filter((v) => v === 'old').length).toBeGreaterThan(1)
  })
  it('continues past failed deletions and retries retained tombstones on future cycles', async () => {
    const { d1 } = storageFixture()
    const bucket = { delete: vi.fn().mockRejectedValueOnce(new Error('private key')) }
    const result = await cleanupStorage(d1, bucket, 100, 50)
    expect(result.failed).toBe(1)
    expect(bucket.delete).toHaveBeenCalledTimes(3)
    await cleanupStorage(d1, bucket, 100, 50)
    expect(bucket.delete).toHaveBeenCalledTimes(6)
  })
})
