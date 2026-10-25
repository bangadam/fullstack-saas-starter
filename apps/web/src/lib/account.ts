import { profileNameSchema } from '@saas/contracts'
import { createAccountClient } from '@saas/sdk'
import { AuthError } from './auth-client'

export const accountClient = createAccountClient({ baseUrl: '/api' })

async function authAction(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthError('Could not connect. Check your connection and try again.', 0)
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const message =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : response.status === 429
          ? 'Too many attempts. Wait a moment and try again.'
          : 'Could not complete this action. Check your password and security verification, then try again.'
    throw new AuthError(message, response.status)
  }
  // Do not return Better Auth password-change responses (which can contain tokens).
}
const challenge = (token?: string): Record<string, string> =>
  token ? { 'cf-turnstile-response': token } : {}
export function updateAccountName(name: string) {
  return authAction('update-user', { name: profileNameSchema.parse(name) })
}
export function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
  turnstileToken?: string,
) {
  return authAction(
    'change-password',
    { currentPassword, newPassword, revokeOtherSessions: true },
    challenge(turnstileToken),
  )
}
export async function deleteAccount(
  confirmation: string,
  password: string,
  turnstileToken?: string,
) {
  if (confirmation !== 'DELETE' || !password)
    throw new AuthError('Type DELETE and enter your current password.', 400)
  await authAction(
    'delete-user',
    { password },
    { ...challenge(turnstileToken), 'x-account-delete-confirmation': 'DELETE' },
  )
}
export function downloadAccountData(data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'account-data.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
