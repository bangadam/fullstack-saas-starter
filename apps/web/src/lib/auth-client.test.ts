import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthError,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  signIn,
  signOut,
  signUp,
} from './auth-client'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function stubFetch(response: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return response
  }) as unknown as typeof fetch
  return calls
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('signIn', () => {
  it('posts credentials to the Better Auth endpoint with cookies enabled', async () => {
    const calls = stubFetch(json({ user: { id: 'u1' } }))

    await signIn({ email: 'sari@example.com', password: 'password123' })

    expect(calls[0]?.url).toBe('/api/auth/sign-in/email')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.credentials).toBe('include')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: 'sari@example.com',
      password: 'password123',
    })
  })

  it('throws a friendly AuthError on 401', async () => {
    stubFetch(json({ message: 'invalid' }, 401))

    await expect(signIn({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
      message: 'Invalid email or password.',
    })
  })
})

describe('signUp', () => {
  it('posts the new account payload and lands on the verified page after the email link', async () => {
    const calls = stubFetch(json({ user: { id: 'u2' } }))

    await signUp({ name: 'Ada', email: 'ada@example.com', password: 'password123' })

    expect(calls[0]?.url).toBe('/api/auth/sign-up/email')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'password123',
      callbackURL: '/verify-email?status=verified',
    })
  })

  it('maps 409 to a duplicate-account message', async () => {
    stubFetch(json({ message: 'exists' }, 409))

    await expect(
      signUp({ name: 'Ada', email: 'ada@example.com', password: 'password123' }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'An account with this email already exists.',
    })
  })
})

describe('signOut', () => {
  it('posts to the sign-out endpoint', async () => {
    const calls = stubFetch(json({ success: true }))

    await signOut()

    expect(calls[0]?.url).toBe('/api/auth/sign-out')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.credentials).toBe('include')
  })

  it('rejects when the server refuses to end the session', async () => {
    stubFetch(json({ message: 'no session' }, 400))

    await expect(signOut()).rejects.toBeInstanceOf(AuthError)
  })
})

describe('requestPasswordReset', () => {
  it('posts the email and the page to land on after the reset link', async () => {
    const calls = stubFetch(json({ status: true }))

    await requestPasswordReset({ email: 'sari@example.com', redirectTo: '/reset-password' })

    expect(calls[0]?.url).toBe('/api/auth/request-password-reset')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: 'sari@example.com',
      redirectTo: '/reset-password',
    })
  })

  it('surfaces a rate limit as a friendly message', async () => {
    stubFetch(json({ message: 'too many' }, 429))

    await expect(requestPasswordReset({ email: 'a@b.co' })).rejects.toMatchObject({
      status: 429,
      message: 'Too many attempts. Please wait a moment and try again.',
    })
  })

  it('reports a generic failure without leaking whether the account exists', async () => {
    stubFetch(json({ message: 'boom' }, 500))

    await expect(requestPasswordReset({ email: 'a@b.co' })).rejects.toMatchObject({
      status: 500,
      message: 'Could not send the reset link. Please try again.',
    })
  })
})

describe('resetPassword', () => {
  it('posts the token together with the new password', async () => {
    const calls = stubFetch(json({ status: true }))

    await resetPassword({ token: 'tok123', newPassword: 'newpassword123' })

    expect(calls[0]?.url).toBe('/api/auth/reset-password')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      token: 'tok123',
      newPassword: 'newpassword123',
    })
  })

  it('maps an expired or already used token to an actionable message', async () => {
    stubFetch(json({ message: 'invalid token' }, 400))

    await expect(
      resetPassword({ token: 'stale', newPassword: 'x'.repeat(10) }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'This reset link is invalid or has expired. Request a new one.',
    })
  })
})

describe('sendVerificationEmail', () => {
  it('asks for a verification email and passes the callback page', async () => {
    const calls = stubFetch(json({ status: true }))

    await sendVerificationEmail({ callbackURL: '/verify-email?status=verified' })

    expect(calls[0]?.url).toBe('/api/auth/send-verification-email')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      callbackURL: '/verify-email?status=verified',
    })
  })

  it('explains that a session is required when signed out', async () => {
    stubFetch(json({ message: 'unauthorized' }, 401))

    await expect(sendVerificationEmail()).rejects.toMatchObject({
      status: 401,
      message: 'Sign in first to request a new verification email.',
    })
  })
})
