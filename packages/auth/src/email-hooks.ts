/**
 * Better Auth email hooks.
 *
 * Better Auth decides the link (`url`) and calls these hooks; the app only
 * delivers the message. Keeping the mapping here means the auth package stays
 * transport-agnostic — the API Worker supplies a port that writes to the email
 * outbox and produces a queue message.
 *
 * Failures are swallowed on purpose: a queue outage must not turn a successful
 * password-reset request into a 500 for the user. The durable outbox row is
 * still written by the port when it can, and the error is reported through
 * `onError` for logs.
 */

export interface AuthEmailMessage {
  to: string
  templateId: string
  subject: string
  payload: Record<string, unknown>
  idempotencyKey: string
}

export interface AuthEmailPort {
  sendEmail(message: AuthEmailMessage): Promise<void>
}

interface AuthUserLike {
  id: string
  email: string
  name?: string | null
}

export interface ResetPasswordArgs {
  user: AuthUserLike
  url: string
  token: string
}

export interface VerificationArgs {
  user: AuthUserLike
  url: string
  token: string
}

/** Retries for the same user collapse instead of sending duplicate emails. */
export function resetPasswordIdempotencyKey(userId: string): string {
  return `reset-password:${userId}`
}

export function verificationIdempotencyKey(userId: string): string {
  return `verify-email:${userId}`
}

export interface AuthEmailCallbacks {
  sendResetPassword(args: ResetPasswordArgs): Promise<void>
  sendVerificationEmail(args: VerificationArgs): Promise<void>
}

export function createAuthEmailCallbacks(
  port: AuthEmailPort,
  onError: (error: unknown) => void = () => {},
): AuthEmailCallbacks {
  const deliver = async (message: AuthEmailMessage) => {
    try {
      await port.sendEmail(message)
    } catch (error) {
      onError(error)
    }
  }

  return {
    async sendResetPassword({ user, url }) {
      await deliver({
        to: user.email,
        templateId: 'reset-password',
        subject: 'Reset your password',
        payload: { url, name: user.name || 'there' },
        idempotencyKey: resetPasswordIdempotencyKey(user.id),
      })
    },

    async sendVerificationEmail({ user, url }) {
      await deliver({
        to: user.email,
        templateId: 'verify-email',
        subject: 'Verify your email',
        payload: { url, name: user.name || 'there' },
        idempotencyKey: verificationIdempotencyKey(user.id),
      })
    },
  }
}
