import { describe, expect, it } from 'vitest'
import { ApiError, createApiClient } from './index'

type Call = { url: string; init?: RequestInit }

function fakeFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init }
    calls.push(call)
    return responder(call)
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('createApiClient', () => {
  it('joins the base url without doubling or dropping slashes', async () => {
    const { impl, calls } = fakeFetch(() => json({ status: 'ok', version: '1', timestamp: 't' }))
    const client = createApiClient({ baseUrl: '/api/', fetchImpl: impl })

    await client.health()
    expect(calls[0]?.url).toBe('/api/health')
  })

  it('sends JSON content type and parses list responses', async () => {
    const { impl, calls } = fakeFetch(() => json({ items: [], total: 0, limit: 5, offset: 10 }))
    const client = createApiClient({ baseUrl: '/api', fetchImpl: impl })

    const page = await client.listProjects({ limit: 5, offset: 10 })

    expect(calls[0]?.url).toBe('/api/projects?limit=5&offset=10')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(page).toEqual({ items: [], total: 0, limit: 5, offset: 10 })
  })

  it('posts a project payload as JSON', async () => {
    const { impl, calls } = fakeFetch(() =>
      json({ id: 'p1', userId: 'u1', name: 'Alpha', description: null, createdAt: 'now' }, 201),
    )
    const client = createApiClient({ baseUrl: '/api', fetchImpl: impl })

    await client.createProject({ name: 'Alpha' })

    expect(calls[0]?.url).toBe('/api/projects')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ name: 'Alpha' })
  })

  it('throws ApiError carrying the HTTP status on failure', async () => {
    const { impl } = fakeFetch(() => json({ error: 'nope' }, 402))
    const client = createApiClient({ baseUrl: '/api', fetchImpl: impl })

    await expect(client.getSubscription()).rejects.toMatchObject({
      name: 'ApiError',
      status: 402,
    })
    await expect(client.getSubscription()).rejects.toBeInstanceOf(ApiError)
  })

  it('merges caller headers (for SSR cookie forwarding)', async () => {
    const { impl, calls } = fakeFetch(() => json({ status: 'ok', version: '1', timestamp: 't' }))
    const client = createApiClient({
      baseUrl: '/api',
      fetchImpl: impl,
      headers: { Cookie: 'session=abc' },
    })

    await client.health()
    expect(calls[0]?.init?.headers).toMatchObject({ Cookie: 'session=abc' })
  })
})
