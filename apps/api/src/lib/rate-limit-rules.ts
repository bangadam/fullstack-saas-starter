/**
 * Which requests get rate limited, and with what budget.
 *
 * Rules apply to unsafe methods only: reads are cheap, cacheable and already
 * gated by authorization, while credential endpoints are the ones worth
 * brute-forcing. `auth-strict` is deliberately tight (10 attempts / 10 min per
 * client) because it protects password guessing on sign-in, sign-up and the
 * password/email verification flows.
 */

export interface RateRule {
  bucket: string
  limit: number
  windowMs: number
}

// Internal paths equal public paths (the proxy does not rewrite /api), so
// these match what the browser and Better Auth's own links use.
const STRICT_PATHS = [
  '/api/auth/sign-in',
  '/api/auth/sign-up',
  '/api/auth/forget-password',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/send-verification-email',
  '/api/auth/change-password',
  '/api/auth/delete-user',
]

export const STRICT_RULE: RateRule = { bucket: 'auth-strict', limit: 10, windowMs: 600_000 }
export const WEBHOOK_RULE: RateRule = { bucket: 'webhooks', limit: 120, windowMs: 60_000 }
export const WRITE_RULE: RateRule = { bucket: 'write', limit: 120, windowMs: 60_000 }

/**
 * Optional env override in the form "limit/windowSeconds", e.g. "50/600".
 * Local dev stacks ship a looser override so iteration is not throttled;
 * production leaves these unset and gets the strict defaults. Malformed
 * values throw at startup instead of silently disabling the limit.
 */
export function parseRateRuleOverride(value: string | undefined, fallback: RateRule): RateRule {
  if (!value || value.trim().length === 0) return fallback
  const parts = value.trim().split('/')
  if (parts.length !== 2) throw new Error(`Invalid rate limit override: ${value}`)
  const limit = Number(parts[0])
  const windowSeconds = Number(parts[1])
  if (
    !Number.isInteger(limit) ||
    limit <= 0 ||
    !Number.isInteger(windowSeconds) ||
    windowSeconds <= 0
  ) {
    throw new Error(`Invalid rate limit override: ${value}`)
  }
  return { ...fallback, limit, windowMs: windowSeconds * 1000 }
}

export function overridesFromEnv(env: Record<string, string | undefined>): {
  strict: RateRule
  webhooks: RateRule
  write: RateRule
} {
  return {
    strict: parseRateRuleOverride(env.RATE_LIMIT_AUTH_STRICT, STRICT_RULE),
    webhooks: parseRateRuleOverride(env.RATE_LIMIT_WEBHOOKS, WEBHOOK_RULE),
    write: parseRateRuleOverride(env.RATE_LIMIT_WRITE, WRITE_RULE),
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isCredentialPath(path: string): boolean {
  return STRICT_PATHS.some((prefix) => path.startsWith(prefix))
}

export interface RateRuleSet {
  strict: RateRule
  webhooks: RateRule
  write: RateRule
}

export const DEFAULT_RULES: RateRuleSet = {
  strict: STRICT_RULE,
  webhooks: WEBHOOK_RULE,
  write: WRITE_RULE,
}

export function selectRateRule(
  method: string,
  path: string,
  rules: RateRuleSet = DEFAULT_RULES,
): RateRule | null {
  if (SAFE_METHODS.has(method.toUpperCase())) return null
  if (isCredentialPath(path)) return rules.strict
  if (path === '/webhooks' || path.startsWith('/webhooks/')) return rules.webhooks
  return rules.write
}

/**
 * Best-effort client identity for the counter key. `cf-connecting-ip` is set
 * by Cloudflare for real traffic; the X-Forwarded-For hop covers local
 * workerd dev, and the shared `unknown` bucket is the last resort so a missing
 * header degrades to a coarser limit instead of no limit at all.
 */
export function clientIdentity(headers: Record<string, string | undefined>): string {
  const cf = headers['cf-connecting-ip']?.trim()
  if (cf) return cf
  const forwarded = headers['x-forwarded-for']?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return 'unknown'
}
