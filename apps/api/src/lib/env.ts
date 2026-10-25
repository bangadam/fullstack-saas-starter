import { appUrlSchema, parseEnv } from '@saas/config'
import type { Env } from '../../worker-configuration'

export interface AppEnv {
  APP_URL: string
  BILLING_PROVIDER: Env['BILLING_PROVIDER']
}

/**
 * Request-scoped env parsing. Bindings/secrets are only meaningful per-request
 * in Workers, so never cache this at module scope.
 */
export function getAppEnv(env: Env): AppEnv {
  const parsed = parseEnv(appUrlSchema, env as unknown as Record<string, string | undefined>)
  return {
    APP_URL: parsed.APP_URL,
    BILLING_PROVIDER: env.BILLING_PROVIDER,
  }
}
