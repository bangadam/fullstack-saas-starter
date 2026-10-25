import { afterEach, describe, expect, it, vi } from 'vitest'
import { changeAccountPassword, deleteAccount, updateAccountName } from './account'

afterEach(() => vi.unstubAllGlobals())
describe('account auth actions', () => {
  it('trims names and uses native update-user', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: true }))
    vi.stubGlobal('fetch', fetcher)
    await updateAccountName(' Ada ')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/update-user',
      expect.objectContaining({ body: JSON.stringify({ name: 'Ada' }), credentials: 'include' }),
    )
  })
  it('always requests revocation of other sessions and sends challenge header', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ token: 'never-expose' }))
    vi.stubGlobal('fetch', fetcher)
    expect(
      await changeAccountPassword('old-password', 'new-password', 'fixture-challenge'),
    ).toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/change-password',
      expect.objectContaining({
        body: JSON.stringify({
          currentPassword: 'old-password',
          newPassword: 'new-password',
          revokeOtherSessions: true,
        }),
        headers: expect.objectContaining({ 'cf-turnstile-response': 'fixture-challenge' }),
      }),
    )
  })
  it('requires exact confirmation before making any deletion request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(deleteAccount('delete', 'password')).rejects.toThrow('DELETE')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('delegates password reauthentication and deletion to Better Auth', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }))
    vi.stubGlobal('fetch', fetcher)
    await deleteAccount('DELETE', 'fixture-password')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/delete-user',
      expect.objectContaining({
        body: JSON.stringify({ password: 'fixture-password' }),
        headers: expect.objectContaining({ 'x-account-delete-confirmation': 'DELETE' }),
      }),
    )
  })
  it('shows actionable server conflicts without swallowing errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: 'Wait until tomorrow for uploads.' }, { status: 409 }),
        ),
    )
    await expect(deleteAccount('DELETE', 'fixture-password')).rejects.toThrow('Wait until tomorrow')
  })
})
