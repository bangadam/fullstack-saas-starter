import { describe, expect, it, vi } from 'vitest'
import {
  type AuthEmailPort,
  createAuthEmailCallbacks,
  resetPasswordIdempotencyKey,
  verificationIdempotencyKey,
} from './email-hooks'

function makePort() {
  const calls: Parameters<AuthEmailPort['sendEmail']>[0][] = []
  const port: AuthEmailPort = {
    async sendEmail(input) {
      calls.push(input)
    },
  }
  return { port, calls }
}

describe('idempotency keys', () => {
  it('namespaces reset-password by user, not by token, so retries collapse', () => {
    expect(resetPasswordIdempotencyKey('user-1')).toBe('reset-password:user-1')
  })

  it('namespaces verification by user', () => {
    expect(verificationIdempotencyKey('user-1')).toBe('verify-email:user-1')
  })
})

describe('createAuthEmailCallbacks', () => {
  it('enqueues a reset-password email with the URL Better Auth generated', async () => {
    const { port, calls } = makePort()
    const callbacks = createAuthEmailCallbacks(port)

    await callbacks.sendResetPassword({
      user: { id: 'user-1', email: 'sari@example.com', name: 'Sari Dewi' },
      url: 'http://localhost:3000/api/auth/reset-password/tok123?callbackURL=%2Freset-password',
      token: 'tok123',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      to: 'sari@example.com',
      templateId: 'reset-password',
      subject: 'Reset your password',
      payload: {
        url: 'http://localhost:3000/api/auth/reset-password/tok123?callbackURL=%2Freset-password',
        name: 'Sari Dewi',
      },
      idempotencyKey: 'reset-password:user-1',
    })
  })

  it('enqueues a verification email with the URL Better Auth generated', async () => {
    const { port, calls } = makePort()
    const callbacks = createAuthEmailCallbacks(port)

    await callbacks.sendVerificationEmail({
      user: { id: 'user-2', email: 'budi@example.com', name: '' },
      url: 'http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2Fverify-email',
      token: 'abc',
    })

    expect(calls[0]).toEqual({
      to: 'budi@example.com',
      templateId: 'verify-email',
      subject: 'Verify your email',
      payload: {
        url: 'http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2Fverify-email',
        name: 'there',
      },
      idempotencyKey: 'verify-email:user-2',
    })
  })

  it('falls back to a friendly greeting when the provider has no name', async () => {
    const { port, calls } = makePort()
    const callbacks = createAuthEmailCallbacks(port)

    await callbacks.sendResetPassword({
      user: { id: 'u', email: 'a@b.co', name: null },
      url: 'u',
      token: 't',
    })

    expect((calls[0]?.payload as { name: string }).name).toBe('there')
  })

  it('never lets an email failure break the auth request', async () => {
    const failing: AuthEmailPort = {
      async sendEmail() {
        throw new Error('queue down')
      },
    }
    const onError = vi.fn()
    const callbacks = createAuthEmailCallbacks(failing, onError)

    await expect(
      callbacks.sendResetPassword({
        user: { id: 'u1', email: 'a@b.co', name: 'A' },
        url: 'u',
        token: 't',
      }),
    ).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
  })
})
