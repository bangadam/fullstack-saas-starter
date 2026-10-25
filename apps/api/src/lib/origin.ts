/**
 * CSRF / cross-origin write protection for the API Worker.
 *
 * The API is private (service binding only), but the browser still reaches it
 * through the Web Worker with the user's session cookie attached. That makes
 * cross-site request forgery a real risk for cookie-authenticated mutations,
 * so every unsafe method must name an allowed Origin.
 *
 * Exemptions are deliberate and narrow:
 *  - /webhooks/* authenticate with a provider signature over the raw body and
 *    never send an Origin header.
 *  - Bearer-token clients (future API keys) are not cookie-authenticated, so
 *    they carry no ambient authority to forge.
 * Login itself is checked too: login CSRF would otherwise let an attacker
 * sign a victim into the attacker's account.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase())
}

export function isWebhookPath(path: string): boolean {
  return path === '/webhooks' || path.startsWith('/webhooks/')
}

/** Lowercases the origin and drops a trailing slash; null for missing/opaque. */
export function normalizeOrigin(origin: string | null | undefined): string | null {
  if (typeof origin !== 'string') return null
  const trimmed = origin.trim()
  if (trimmed.length === 0 || trimmed === 'null') return null
  return trimmed.toLowerCase().replace(/\/+$/, '')
}

export interface OriginCheckInput {
  method: string
  path: string
  origin: string | null | undefined
  allowed: readonly string[]
  hasAuthorizationHeader?: boolean
}

export type OriginDecision = { ok: true } | { ok: false; reason: string }

export function checkOrigin(input: OriginCheckInput): OriginDecision {
  if (isSafeMethod(input.method)) return { ok: true }
  if (isWebhookPath(input.path)) return { ok: true }
  if (input.hasAuthorizationHeader === true) return { ok: true }

  const origin = normalizeOrigin(input.origin)
  if (origin === null) {
    return { ok: false, reason: 'Missing Origin header on a mutating request' }
  }

  const allowed = input.allowed
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => value !== null)

  if (allowed.length === 0) {
    return { ok: false, reason: 'No allowed origins configured' }
  }
  if (!allowed.includes(origin)) {
    return { ok: false, reason: `Origin ${origin} is not allowed` }
  }
  return { ok: true }
}
