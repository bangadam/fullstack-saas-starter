import { describe, expect, it, vi } from 'vitest'
import { createFilesClient } from './files'

const item = {
  id: 'f',
  name: 'x.txt',
  size: 1,
  contentType: 'text/plain',
  status: 'completed',
  createdAt: 'now',
  expiresAt: null,
}
const ticket = {
  fileId: 'f',
  uploadUrl: 'https://r2.test/object',
  mode: 'presigned',
  method: 'PUT',
  headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' },
  uploadExpiresAt: 'later',
  expiresAt: 'later',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('files SDK upload lifecycle', () => {
  it('completes presigned upload before returning server metadata, without forwarding API credentials', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(ticket))
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(json(item))
    const client = createFilesClient({
      baseUrl: '/api',
      fetchImpl,
      headers: { Authorization: 'test-only' },
    })
    expect(await client.upload(new File(['x'], 'x.txt', { type: 'text/plain' }))).toEqual(item)
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      headers: ticket.headers,
      credentials: 'omit',
    })
    expect(fetchImpl.mock.calls[2]?.[0]).toBe('/api/files/f/complete')
  })
  it('cancels reservation on PUT failure and preserves the original error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(ticket))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new Error('cleanup offline'))
    const client = createFilesClient({ baseUrl: '/api', fetchImpl })
    await expect(client.upload(new File(['x'], 'x.txt'))).rejects.toMatchObject({ status: 503 })
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe('DELETE')
  })
  it('surfaces completion errors instead of reporting a successful upload', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(ticket))
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(json({ error: { message: 'Size mismatch' } }, 400))
      .mockResolvedValueOnce(json({ ok: true }))
    await expect(
      createFilesClient({ baseUrl: '/api', fetchImpl }).upload(new File(['x'], 'x.txt')),
    ).rejects.toMatchObject({ status: 400, message: 'Size mismatch' })
  })
})
