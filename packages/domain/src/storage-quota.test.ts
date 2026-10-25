import { describe, expect, it } from 'vitest'
import { formatBytes, storageQuotaDecision } from './storage-quota'

const MB = 1024 * 1024

describe('storageQuotaDecision', () => {
  it('allows an upload that still fits the plan limit', () => {
    expect(
      storageQuotaDecision({ limitBytes: 100 * MB, usedBytes: 10 * MB, requestedBytes: 5 * MB }),
    ).toEqual({ ok: true, remainingBytes: 85 * MB })
  })

  it('allows an upload that exactly fills the limit', () => {
    expect(
      storageQuotaDecision({ limitBytes: 100 * MB, usedBytes: 95 * MB, requestedBytes: 5 * MB }).ok,
    ).toBe(true)
  })

  it('rejects an upload that would exceed the plan limit', () => {
    const decision = storageQuotaDecision({
      limitBytes: 100 * MB,
      usedBytes: 99 * MB,
      requestedBytes: 2 * MB,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.reason).toContain('Storage quota')
      expect(decision.reason).toContain('100')
    }
  })

  it('rejects when the account is already over the limit', () => {
    expect(storageQuotaDecision({ limitBytes: MB, usedBytes: 2 * MB, requestedBytes: 1 }).ok).toBe(
      false,
    )
  })

  it('treats a null limit as unlimited', () => {
    expect(
      storageQuotaDecision({ limitBytes: null, usedBytes: 10 ** 12, requestedBytes: 10 ** 9 }),
    ).toEqual({ ok: true, remainingBytes: null })
  })

  it('rejects nonsensical sizes instead of silently allowing them', () => {
    expect(() =>
      storageQuotaDecision({ limitBytes: MB, usedBytes: 0, requestedBytes: -1 }),
    ).toThrow(/Invalid storage quota input/)
    expect(() =>
      storageQuotaDecision({ limitBytes: MB, usedBytes: -1, requestedBytes: 1 }),
    ).toThrow(/Invalid storage quota input/)
  })
})

describe('formatBytes', () => {
  it('renders human readable sizes for error messages', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(100 * MB)).toBe('100 MB')
    expect(formatBytes(2 * 1024 * MB)).toBe('2 GB')
  })
})
