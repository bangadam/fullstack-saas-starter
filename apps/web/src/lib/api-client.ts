import { ApiError, createApiClient } from '@saas/sdk'

/**
 * Browser/server client pointing at the same-origin /api proxy, which is
 * forwarded to the API Worker via the API_WORKER service binding.
 * Cookies ride along automatically on same-origin requests.
 */
export const apiBaseUrl = '/api'

export function getApiClient(headers?: Record<string, string>) {
  return createApiClient({ baseUrl: apiBaseUrl, headers })
}

export { ApiError }

/** Typed read of an env var with a fallback (wrangler vars / import.meta.env). */
export function envVar(key: string, fallback = ''): string {
  if (typeof import.meta.env !== 'undefined' && key in import.meta.env) {
    return String((import.meta.env as Record<string, unknown>)[key] ?? fallback)
  }
  return fallback
}
