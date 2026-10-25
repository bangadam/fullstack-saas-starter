import { APIError } from 'better-auth/api'

export interface AccountDeletionPort {
  /** Must block writes, settle billing, drain uploads and finish R2 cleanup before returning. */
  beforeDelete(userId: string): Promise<void>
}

export function assertAccountMutation(
  path: string,
  body: Record<string, unknown> | undefined,
  headers: Headers,
) {
  if (path === '/delete-user/callback') {
    throw new APIError('FORBIDDEN', {
      message: 'Delete your account from Account settings with your password.',
    })
  }
  if (
    path === '/delete-user' &&
    (headers.get('x-account-delete-confirmation') !== 'DELETE' ||
      typeof body?.password !== 'string' ||
      !body.password ||
      body.token)
  ) {
    throw new APIError('BAD_REQUEST', {
      message:
        'Confirm DELETE and enter your current password. Passwordless accounts must set a password through account recovery first.',
    })
  }
  if (path === '/change-password' && body) body.revokeOtherSessions = true
  if (path === '/update-user' && body && 'name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
      throw new APIError('BAD_REQUEST', {
        message: 'Name must contain between 1 and 100 characters.',
      })
    }
    body.name = body.name.trim()
  }
}

export function createAccountDeletionHook(port?: AccountDeletionPort) {
  return async (user: { id: string }) => {
    if (!port)
      throw new APIError('CONFLICT', {
        message:
          'Account deletion is temporarily unavailable. Contact support; your account has not been deleted.',
      })
    await port.beforeDelete(user.id)
  }
}
