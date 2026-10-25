import { describe, expect, it, vi } from 'vitest'
import { assertAccountMutation, createAccountDeletionHook } from './account-hooks'

describe('account security hooks', () => {
  it('requires explicit confirmation and a password even on fresh sessions', () => {
    expect(() => assertAccountMutation('/delete-user', {}, new Headers())).toThrow()
    expect(() =>
      assertAccountMutation('/delete-user', { password: 'fixture-password' }, new Headers()),
    ).toThrow()
    expect(() =>
      assertAccountMutation(
        '/delete-user',
        { password: 'fixture-password' },
        new Headers({ 'x-account-delete-confirmation': 'DELETE' }),
      ),
    ).not.toThrow()
  })
  it('blocks token callback deletion and passwordless token shortcuts', () => {
    expect(() => assertAccountMutation('/delete-user/callback', {}, new Headers())).toThrow()
    expect(() =>
      assertAccountMutation(
        '/delete-user',
        { token: 'fixture-token' },
        new Headers({ 'x-account-delete-confirmation': 'DELETE' }),
      ),
    ).toThrow()
  })
  it('forces other-session revocation on password changes', () => {
    const body = { currentPassword: 'old', newPassword: 'new', revokeOtherSessions: false }
    assertAccountMutation('/change-password', body, new Headers())
    expect(body.revokeOtherSessions).toBe(true)
  })
  it('validates profile names on native update-user calls', () => {
    expect(() => assertAccountMutation('/update-user', { name: '  ' }, new Headers())).toThrow()
    const body = { name: '  Ada  ' }
    assertAccountMutation('/update-user', body, new Headers())
    expect(body.name).toBe('Ada')
  })
  it('fails closed when lifecycle safety has not been wired', async () => {
    await expect(createAccountDeletionHook()({ id: 'disposable' })).rejects.toThrow(
      'temporarily unavailable',
    )
  })
  it('passes only authenticated user ID to lifecycle barrier and propagates failure', async () => {
    const beforeDelete = vi.fn().mockRejectedValue(new Error('unsafe'))
    await expect(createAccountDeletionHook({ beforeDelete })({ id: 'disposable' })).rejects.toThrow(
      'unsafe',
    )
    expect(beforeDelete).toHaveBeenCalledWith('disposable')
  })
})
