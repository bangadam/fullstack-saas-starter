import type { SignInInput, SignUpInput } from '@saas/contracts'

/**
 * Single source of truth for browser auth calls against the same-origin
 * `/api/auth/*` proxy. Every form and the dashboard sign-out go through here
 * so error messages and cookie handling stay consistent.
 */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

function messageFor(path: string, status: number): string {
  if (path === '/api/auth/sign-in/email' && status === 401) return 'Invalid email or password.'
  if (path === '/api/auth/sign-up/email' && status === 409) {
    return 'An account with this email already exists.'
  }
  if (path === '/api/auth/request-password-reset') {
    if (status === 429) return 'Too many attempts. Please wait a moment and try again.'
    return 'Could not send the reset link. Please try again.'
  }
  if (path === '/api/auth/reset-password' && status === 400) {
    return 'This reset link is invalid or has expired. Request a new one.'
  }
  if (path === '/api/auth/send-verification-email' && status === 401) {
    return 'Sign in first to request a new verification email.'
  }
  const action = path.includes('sign-up')
    ? 'Sign up'
    : path.includes('sign-out')
      ? 'Sign out'
      : 'Sign in'
  return `${action} failed (${status}).`
}

async function post(path: string, body: unknown = {}): Promise<void> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthError('Network error. Is the API Worker running?', 0)
  }
  if (!res.ok) throw new AuthError(messageFor(path, res.status), res.status)
}

export function signIn(input: SignInInput): Promise<void> {
  return post('/api/auth/sign-in/email', input)
}

export function signUp(input: SignUpInput): Promise<void> {
  // callbackURL is where the verification email lands after the user clicks it.
  return post('/api/auth/sign-up/email', {
    ...input,
    callbackURL: '/verify-email?status=verified',
  })
}

export function signOut(): Promise<void> {
  return post('/api/auth/sign-out')
}

/** Request a password reset email. Never reveals whether the account exists. */
export function requestPasswordReset(input: { email: string; redirectTo?: string }): Promise<void> {
  return post('/api/auth/request-password-reset', {
    email: input.email,
    redirectTo: input.redirectTo ?? '/reset-password',
  })
}

/** Complete a password reset with the single-use token from the email link. */
export function resetPassword(input: { token: string; newPassword: string }): Promise<void> {
  return post('/api/auth/reset-password', {
    token: input.token,
    newPassword: input.newPassword,
  })
}

/** Ask for a fresh verification email (requires an active session). */
export function sendVerificationEmail(input: { callbackURL?: string } = {}): Promise<void> {
  return post('/api/auth/send-verification-email', {
    callbackURL: input.callbackURL ?? '/verify-email?status=verified',
  })
}
