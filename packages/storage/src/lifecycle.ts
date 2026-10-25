/** The signing instant is persisted before reservation, never refreshed after DB work. */
export const UPLOAD_TTL_SECONDS = 600
/** Grace for requests accepted by R2 before URL expiry but still transferring. */
export const UPLOAD_GRACE_SECONDS = 3600

export function uploadDeadlines(nowSeconds: number) {
  return {
    uploadExpiresAt: nowSeconds + UPLOAD_TTL_SECONDS,
    expiresAt: nowSeconds + UPLOAD_TTL_SECONDS + UPLOAD_GRACE_SECONDS,
  }
}

/** Single atomic conditional write; D1 cannot use interactive transactions.
 * Expired timestamps alone do NOT free quota: the cleanup worker must first
 * claim pending/deleting rows as expired, after the signed lifetime + grace.
 * Parameters: id,user,key,name,size,type,now,uploadExpiry,expiry,user,user,size,limit.
 */
export const RESERVE_FILE_SQL = `INSERT INTO files
  (id,user_id,r2_key,name,size,content_type,status,created_at,upload_expires_at,expires_at)
  SELECT ?,?,?,?,?,?,'pending',?,?,?
  WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND deletion_requested_at IS NULL)
    AND (SELECT COALESCE(SUM(size),0) FROM files WHERE user_id=? AND status IN ('pending','completed','deleting')) + ? <= ?
  RETURNING id`
