import { createServerFn } from '@tanstack/react-start'
import { type SessionInfo, fetchSession } from './session'

/**
 * SSR session probe as a server function.
 *
 * The route gate needs the incoming request's cookies and origin to resolve a
 * relative fetch inside workerd, which only `@tanstack/react-start/server`
 * exposes. That module is server-only: importing it from a client-reachable
 * route file fails the production build (import protection) and is mocked in
 * dev. Declaring the probe as a server function keeps the server-only import
 * inside a handler the compiler extracts to the server bundle, so the route
 * module stays client-safe.
 */
export const readSessionOnServer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionInfo | null> => {
    const { getRequest, getRequestHeader } = await import('@tanstack/react-start/server')
    const request = getRequest()
    const cookie = getRequestHeader('cookie')
    return fetchSession(cookie, request.headers.get('origin') ?? new URL(request.url).origin)
  },
)
