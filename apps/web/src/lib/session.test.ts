import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSession } from './session'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return typeof response === 'function' ? response() : response
  }) as unknown as typeof fetch
  return calls
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('fetchSession', () => {
  it('maps a Better Auth session payload to SessionInfo', async () => {
    stubFetch(
      json({
        session: { id: 's1' },
        user: { id: 'u1', email: 'sari@example.com', name: 'Sari Dewi', emailVerified: true },
      }),
    )

    const session = await fetchSession()
    expect(session).toEqual({
      userId: 'u1',
      email: 'sari@example.com',
      name: 'Sari Dewi',
      emailVerified: true,
    })
  })

  it('defaults emailVerified to false when the field is missing or not a boolean', async () => {
    stubFetch(json({ user: { id: 'u1', email: 'a@b.co', name: 'A' } }))
    expect((await fetchSession())?.emailVerified).toBe(false)

    stubFetch(json({ user: { id: 'u1', email: 'a@b.co', name: 'A', emailVerified: 'yes' } }))
    expect((await fetchSession())?.emailVerified).toBe(false)
  })

  it('accepts the legacy userId field on user objects', async () => {
    stubFetch(json({ user: { userId: 'u2', email: 'a@b.co', name: 'A' } }))
    expect((await fetchSession())?.userId).toBe('u2')
  })

  it('returns null for a signed-out response (200 with no user)', async () => {
    stubFetch(json({ session: null, user: null }))
    expect(await fetchSession()).toBeNull()
  })

  it('returns null instead of throwing on HTTP errors', async () => {
    stubFetch(json({ message: 'nope' }, 500))
    expect(await fetchSession()).toBeNull()
  })

  it('returns null instead of throwing on network failures', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')))
    expect(await fetchSession()).toBeNull()
  })

  it('returns null when the payload is not JSON', async () => {
    stubFetch(new Response('<html>oops</html>', { status: 200 }))
    expect(await fetchSession()).toBeNull()
  })

  it('forwards the cookie header and base url during SSR', async () => {
    const calls = stubFetch(json({ user: { id: 'u1', email: 'a@b.co', name: 'A' } }))

    await fetchSession('session=abc', 'http://localhost:3000')

    expect(calls[0]?.url).toBe('http://localhost:3000/api/auth/get-session')
    expect(calls[0]?.init?.headers).toMatchObject({ Cookie: 'session=abc' })
  })

  it('omits the cookie header on the client', async () => {
    const calls = stubFetch(json({ user: { id: 'u1', email: 'a@b.co', name: 'A' } }))

    await fetchSession()

    expect(calls[0]?.url).toBe('/api/auth/get-session')
    expect(calls[0]?.init?.headers).toBeUndefined()
  })
})
