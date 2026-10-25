import { describe, expect, it, vi } from 'vitest'
import { type AccountDeletionStore, accountDeletionBarrier } from '../src/lib/account'

const now = new Date('2026-10-25T12:00:00Z')
function fixture(overrides: Partial<AccountDeletionStore> = {}) {
  const store: AccountDeletionStore = {
    user: vi.fn().mockResolvedValue({
      id: 'fixture-a',
      deletionRequestedAt: new Date(now.getTime() - 4_201_000),
    }),
    subscriptions: vi.fn().mockResolvedValue([]),
    files: vi
      .fn()
      .mockResolvedValue([
        { userId: 'fixture-a', r2Key: 'fixture-a/file', expiresAt: new Date(now.getTime() - 1) },
      ]),
    billingSafe: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  const bucket = {
    delete: vi.fn().mockResolvedValue(undefined),
    head: vi.fn().mockResolvedValue(null),
  }
  return { store, bucket }
}

describe('account deletion safety barrier', () => {
  it('cleans owned R2 objects before allowing auth cascade', async () => {
    const { store, bucket } = fixture()
    await accountDeletionBarrier('fixture-a', store, bucket, now)
    expect(store.user).toHaveBeenCalledWith('fixture-a')
    expect(store.files).toHaveBeenCalledWith('fixture-a')
    expect(store.subscriptions).toHaveBeenCalledWith('fixture-a')
    expect(bucket.delete).toHaveBeenCalledWith('fixture-a/file')
    expect(bucket.head).toHaveBeenCalledWith('fixture-a/file')
  })
  it.each(['active', 'trialing', 'past_due', 'incomplete', 'unknown'])(
    'blocks %s subscriptions before cleanup',
    async (status) => {
      const { store, bucket } = fixture({
        subscriptions: vi.fn().mockResolvedValue([{ userId: 'fixture-a', status }]),
      })
      await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow(
        'billing',
      )
      expect(bucket.delete).not.toHaveBeenCalled()
    },
  )
  it('allows canceled subscriptions only after billing intent reconciliation', async () => {
    const { store, bucket } = fixture({
      subscriptions: vi.fn().mockResolvedValue([{ userId: 'fixture-a', status: 'canceled' }]),
      billingSafe: vi.fn().mockResolvedValue(false),
    })
    await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow(
      'checkout',
    )
    expect(bucket.delete).not.toHaveBeenCalled()
  })
  it('requires preparation and upload grace even without file rows', async () => {
    const { store, bucket } = fixture({
      user: vi.fn().mockResolvedValue({ id: 'fixture-a', deletionRequestedAt: null }),
    })
    await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow('Prepare')
    store.user = vi.fn().mockResolvedValue({ id: 'fixture-a', deletionRequestedAt: now })
    store.files = vi.fn().mockResolvedValue([])
    await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow(
      '2026-10-25T13:10:00',
    )
    expect(bucket.delete).not.toHaveBeenCalled()
  })
  it('waits for the latest file expiry even after marker grace', async () => {
    const { store, bucket } = fixture({
      files: vi.fn().mockResolvedValue([
        {
          userId: 'fixture-a',
          r2Key: 'fixture-a/file',
          expiresAt: new Date(now.getTime() + 1000),
        },
      ]),
    })
    await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow(
      'Wait until',
    )
    expect(bucket.delete).not.toHaveBeenCalled()
  })
  it('rejects tenant mismatches without touching storage', async () => {
    const { store, bucket } = fixture({
      files: vi
        .fn()
        .mockResolvedValue([{ userId: 'fixture-b', r2Key: 'fixture-b/file', expiresAt: null }]),
    })
    await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow(
      'ownership',
    )
    expect(bucket.delete).not.toHaveBeenCalled()
  })
  it('does not allow deletion when R2 cleanup fails or object remains', async () => {
    const { store, bucket } = fixture()
    bucket.delete.mockRejectedValueOnce(new Error('R2 unavailable'))
    await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow('cleanup')
    bucket.head.mockResolvedValueOnce({ key: 'fixture-a/file' })
    await expect(accountDeletionBarrier('fixture-a', store, bucket, now)).rejects.toThrow('cleanup')
  })
})
