/** Only durable expired reservations authorize deletion. No bucket-wide orphan scan. */
export async function cleanupStorage(
  db: D1Database,
  bucket: Pick<R2Bucket, 'delete'>,
  now = Math.floor(Date.now() / 1000),
  limit = 50,
) {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)))
  await db
    .prepare(`UPDATE files SET status='expired' WHERE id IN
    (SELECT id FROM files WHERE status IN ('pending','deleting') AND expires_at<=?
    ORDER BY expires_at,id LIMIT ?) AND status IN ('pending','deleting') AND expires_at<=?`)
    .bind(now, bounded, now)
    .run()
  const cursor = await db
    .prepare("SELECT cursor FROM recovery_cursors WHERE name='storage'")
    .first<{ cursor: string }>()
  const query = (after: string) =>
    db
      .prepare(`SELECT id,r2_key AS r2Key FROM files WHERE status='expired'
    AND expires_at<=? AND id>? ORDER BY id LIMIT ?`)
      .bind(now, after, bounded)
      .all<{ id: string; r2Key: string }>()
  let rows = (await query(cursor?.cursor ?? '')).results
  if (!rows.length && cursor?.cursor) rows = (await query('')).results
  let deleted = 0
  let failed = 0
  for (const row of rows) {
    try {
      await bucket.delete(row.r2Key)
      deleted++
    } catch {
      failed++
    }
  }
  // Tombstones stay forever until operator reconciliation; rotate even when a
  // delete fails so one object does not starve all other expired reservations.
  await db
    .prepare(`INSERT INTO recovery_cursors(name,cursor) VALUES('storage',?)
    ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor`)
    .bind(rows.at(-1)?.id ?? '')
    .run()
  return { scanned: rows.length, deleted, failed }
}
