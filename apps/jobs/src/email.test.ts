import { describe, expect, it, vi } from 'vitest'
import { createResendSender } from './email'
const input = {
  to: 'private@example.test',
  subject: 'private',
  html: '<p>token</p>',
  text: 'token',
  idempotencyKey: 'email:durable-id',
}
describe('provider delivery', () => {
  it('uses stable provider idempotency header, configured sender and finite timeout', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await createResendSender('test-only-key', 'sender@example.test', fetcher).send(input)
    const [url, options] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://api.resend.com/emails')
    expect(options.headers['Idempotency-Key']).toBe(input.idempotencyKey)
    expect(JSON.parse(options.body).from).toBe('sender@example.test')
    expect(JSON.parse(options.body).idempotencyKey).toBeUndefined()
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it('does not consume/echo provider response bodies on errors', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('SECRET recipient token', { status: 422 }))
    await expect(createResendSender('key', 'from', fetcher).send(input)).rejects.toThrow(
      'provider_422',
    )
  })
  it('missing credentials fail closed without external calls or dry run success', async () => {
    const fetcher = vi.fn()
    await expect(createResendSender(undefined, 'from', fetcher).send(input)).rejects.toThrow(
      'email_not_configured',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
})
