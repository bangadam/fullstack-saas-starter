import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteFileError, UploadError, deleteFile, fetchFiles, uploadFile } from './files'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function stubFetch(responder: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return responder(url, init)
  }) as unknown as typeof fetch
  return calls
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const file = () => new File([new Uint8Array(6)], 'notes.txt', { type: 'text/plain' })
const item = {
  id: 'f2',
  name: 'notes.txt',
  size: 6,
  contentType: 'text/plain',
  status: 'completed',
  createdAt: 'now',
  expiresAt: null,
}
const ticketFields = {
  headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' },
  uploadExpiresAt: 'later',
  expiresAt: 'later',
}

describe('fetchFiles', () => {
  it('returns items together with usage and the plan limit', async () => {
    stubFetch(() =>
      json({
        items: [{ ...item, id: 'f1' }],
        reservedBytes: 0,
        usedBytes: 6,
        limitBytes: 1048576,
      }),
    )

    const page = await fetchFiles()
    expect(page.items).toHaveLength(1)
    expect(page.usedBytes).toBe(6)
    expect(page.limitBytes).toBe(1048576)
  })
})

describe('uploadFile', () => {
  it('requests an upload URL, declares the size, then sends the bytes', async () => {
    const calls = stubFetch((url) => {
      if (url === '/api/files/upload-url') {
        return json(
          {
            ...ticketFields,
            fileId: 'f2',
            uploadUrl: '/api/files/upload/f2',
            method: 'PUT',
            mode: 'direct',
          },
          201,
        )
      }
      return json(item, 200)
    })

    await uploadFile(file())

    expect(calls[0]?.url).toBe('/api/files/upload-url')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: 'notes.txt',
      size: 6,
      contentType: 'text/plain',
    })
    expect(calls[1]?.url).toBe('/api/files/upload/f2')
    expect(calls[1]?.init?.method).toBe('PUT')
    expect(calls[1]?.init?.body).toBeInstanceOf(ArrayBuffer)
  })

  it('PUTs to the presigned URL when the API hands one out', async () => {
    const calls = stubFetch((url) => {
      if (url === '/api/files/upload-url') {
        return json(
          {
            ...ticketFields,
            fileId: 'f3',
            uploadUrl: 'https://r2.example.com/key?sig=1',
            method: 'PUT',
            mode: 'presigned',
          },
          201,
        )
      }
      if (url === '/api/files/f3/complete') return json({ ...item, id: 'f3' })
      return new Response(null, { status: 200 })
    })

    await uploadFile(file())
    expect(calls[1]?.url).toBe('https://r2.example.com/key?sig=1')
    expect(calls[2]?.url).toBe('/api/files/f3/complete')
    expect(calls[1]?.init?.headers).toEqual(ticketFields.headers)
  })

  it('surfaces the quota message from a 402 response', async () => {
    stubFetch(() =>
      json({ error: { code: 'QUOTA_EXCEEDED', message: 'Storage quota of 100 MB reached' } }, 402),
    )

    await expect(uploadFile(file())).rejects.toMatchObject({
      name: 'UploadError',
      status: 402,
      message: 'Storage quota of 100 MB reached',
    })
  })

  it('falls back to a generic message when the API body is not an error envelope', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))

    await expect(uploadFile(file())).rejects.toBeInstanceOf(UploadError)
  })
})

describe('deleteFile', () => {
  it('sends a DELETE for the file id', async () => {
    const calls = stubFetch(() => json({ ok: true }))
    await deleteFile('f1')
    expect(calls[0]?.url).toBe('/api/files/f1')
    expect(calls[0]?.init?.method).toBe('DELETE')
  })

  it('rejects with a typed error on failure', async () => {
    stubFetch(() => json({ error: { message: 'not found' } }, 404))
    await expect(deleteFile('missing')).rejects.toBeInstanceOf(DeleteFileError)
  })
})
