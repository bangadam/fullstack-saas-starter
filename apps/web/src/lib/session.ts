export interface SessionInfo {
  userId: string
  email: string
  name: string
  emailVerified: boolean
}

/**
 * Fetch the auth session from the API Worker through the same-origin proxy.
 * On the server (SSR), a relative URL cannot resolve inside workerd, so pass
 * `baseUrl` from the incoming request plus its cookies; on the client, the
 * same-origin default works and cookies ride along automatically.
 */
export async function fetchSession(
  forwardedCookie?: string,
  baseUrl = '',
): Promise<SessionInfo | null> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/get-session`, {
      headers: forwardedCookie ? { Cookie: forwardedCookie } : undefined,
    })
    if (!res.ok) return null
    return normalizeSession(await res.json())
  } catch {
    // Network/config failures must not crash SSR; treat as signed-out.
    return null
  }
}

function normalizeSession(data: unknown): SessionInfo | null {
  if (!data || typeof data !== 'object') return null
  const user = (data as { user?: Record<string, unknown> }).user
  if (!user) return null
  const userId = (user.userId ?? user.id) as string | undefined
  if (!userId) return null
  return {
    userId,
    email: (user.email as string | undefined) ?? '',
    name: (user.name as string | undefined) ?? '',
    emailVerified: user.emailVerified === true,
  }
}
