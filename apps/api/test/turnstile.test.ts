import { describe, expect, it, vi } from 'vitest'
import { verifyTurnstileToken } from '../src/lib/turnstile'

const success = () =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const failure = () =>
  new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('verifyTurnstileToken', () => {
  it('is disabled without any network call when no secret is configured', async () => {
    const fetchImpl = vi.fn(async () => success())
    const result = await verifyTurnstileToken('some-token', { secret: undefined, fetchImpl })
    expect(result).toEqual({ ok: true, mode: 'disabled' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('treats blank secrets as missing', async () => {
    const fetchImpl = vi.fn(async () => success())
    const result = await verifyTurnstileToken('some-token', { secret: '  ', fetchImpl })
    expect(result.ok).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts a verified token and posts the secret plus token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return success()
    }) as unknown as typeof fetch

    const result = await verifyTurnstileToken('browser-token', {
      secret: 'secret-key',
      fetchImpl,
      remoteip: '1.2.3.4',
    })

    expect(result).toEqual({ ok: true, mode: 'verified' })
    expect(calls[0]?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(calls[0]?.init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0]?.init?.body))
    expect(body).toMatchObject({
      secret: 'secret-key',
      response: 'browser-token',
      remoteip: '1.2.3.4',
    })
  })

  it('rejects a missing token when a secret is configured', async () => {
    const fetchImpl = vi.fn(async () => success())
    const result = await verifyTurnstileToken(undefined, { secret: 'secret-key', fetchImpl })
    expect(result).toEqual({ ok: false, code: 'missing-token' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an invalid token and surfaces the provider code', async () => {
    const fetchImpl = vi.fn(async () => failure()) as unknown as typeof fetch
    const result = await verifyTurnstileToken('forged-token', { secret: 'secret-key', fetchImpl })
    expect(result).toEqual({ ok: false, code: 'invalid-input-response' })
  })

  it('fails closed when the verification request itself errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const result = await verifyTurnstileToken('token', { secret: 'secret-key', fetchImpl })
    expect(result.ok).toBe(false)
  })

  it('fails closed on a malformed provider response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not json', { status: 200 }),
    ) as unknown as typeof fetch
    const result = await verifyTurnstileToken('token', { secret: 'secret-key', fetchImpl })
    expect(result.ok).toBe(false)
  })
})
