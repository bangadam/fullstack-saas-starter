/**
 * Same-origin proxy routing for the Web Worker.
 *
 * `/api/*` and `/webhooks/*` go to the private API Worker over a fixed service
 * binding; everything else is rendered by TanStack Start.
 *
 * The path is forwarded UNCHANGED. The API Worker serves /api/* itself and
 * Better Auth's basePath is /api/auth, because Better Auth builds email links
 * and OAuth callbacks from its basePath — stripping the prefix produced
 * /auth/reset-password/<token> links that 404 on the public app.
 */

export const PROXY_PREFIXES = ['/api/', '/webhooks/'] as const

export function isProxiedPath(pathname: string): boolean {
  return PROXY_PREFIXES.some(
    (prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix),
  )
}

/** Returns the request to forward to the API Worker (never rewritten). */
export function upstreamRequest(request: Request): Request {
  return request
}
