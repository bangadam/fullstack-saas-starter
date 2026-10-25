/**
 * Storage quota rules.
 *
 * Plan limits live in `@saas/billing` (`PLAN_ENTITLEMENTS.maxStorageBytes`);
 * this module only decides whether one more upload fits. Kept as a pure
 * function so the API can enforce it before handing out an upload URL — the
 * quota must be checked server-side, never in the browser.
 */

export interface StorageQuotaInput {
  /** Plan limit in bytes; null means unlimited. */
  limitBytes: number | null
  usedBytes: number
  requestedBytes: number
}

export type StorageQuotaDecision =
  | { ok: true; remainingBytes: number | null }
  | { ok: false; reason: string }

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${units[unitIndex]}`
}

export function storageQuotaDecision(input: StorageQuotaInput): StorageQuotaDecision {
  if (
    !Number.isInteger(input.usedBytes) ||
    input.usedBytes < 0 ||
    !Number.isInteger(input.requestedBytes) ||
    input.requestedBytes <= 0
  ) {
    throw new Error('Invalid storage quota input: sizes must be positive integers')
  }
  if (input.limitBytes === null) return { ok: true, remainingBytes: null }

  const remaining = input.limitBytes - input.usedBytes
  if (input.requestedBytes > remaining) {
    return {
      ok: false,
      reason: `Storage quota of ${formatBytes(input.limitBytes)} reached (used ${formatBytes(
        input.usedBytes,
      )})`,
    }
  }
  return { ok: true, remainingBytes: remaining - input.requestedBytes }
}
