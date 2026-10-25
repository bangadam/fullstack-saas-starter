/**
 * Cloudflare Turnstile server-side verification.
 *
 * Fail-closed by design: any error (bad token, provider failure, malformed
 * response) rejects the request. The only bypass is an absent secret, which
 * exists for local development before a site key is provisioned — callers
 * must log that mode loudly, never trust it silently.
 */

export interface TurnstileOptions {
  secret: string | undefined
  remoteip?: string
  fetchImpl?: typeof fetch
}

export type TurnstileResult =
  | { ok: true; mode: 'verified' | 'disabled' }
  | { ok: false; code: string }

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstileToken(
  token: string | null | undefined,
  opts: TurnstileOptions,
): Promise<TurnstileResult> {
  const secret = opts.secret?.trim()
  if (!secret) return { ok: true, mode: 'disabled' }
  if (!token || token.trim().length === 0) return { ok: false, code: 'missing-token' }

  try {
    const res = await (opts.fetchImpl ?? fetch)(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: opts.remoteip }),
    })
    const body = (await res.json()) as {
      success?: unknown
      'error-codes'?: string[]
    }
    if (body && body.success === true) return { ok: true, mode: 'verified' }
    const code =
      Array.isArray(body?.['error-codes']) && body['error-codes'].length > 0
        ? String(body['error-codes'][0])
        : 'invalid-token'
    return { ok: false, code }
  } catch {
    return { ok: false, code: 'verification-unavailable' }
  }
}
