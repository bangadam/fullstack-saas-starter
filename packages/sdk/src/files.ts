import {
  type UploadRequestInput,
  fileItemSchema,
  filesPageSchema,
  uploadRequestSchema,
  uploadTicketSchema,
} from '@saas/contracts'
import { z } from 'zod'

export class FilesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'FilesApiError'
  }
}

export function createFilesClient(options: {
  baseUrl: string
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
}) {
  const fetcher = options.fetchImpl ?? fetch
  const base = options.baseUrl.replace(/\/$/, '')
  async function request(path: string, init?: RequestInit) {
    const res = await fetcher(`${base}/files${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...options.headers, ...init?.headers },
    })
    if (!res.ok) {
      let message = `Files request failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        message = body.error?.message ?? message
      } catch {
        /* Preserve status when an upstream returns non-JSON. */
      }
      throw new FilesApiError(message, res.status)
    }
    return res.json()
  }
  const complete = async (id: string) =>
    fileItemSchema.parse(await request(`/${encodeURIComponent(id)}/complete`, { method: 'POST' }))
  const remove = async (id: string) => {
    await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
  const authorize = async (input: UploadRequestInput) =>
    uploadTicketSchema.parse(
      await request('/upload-url', {
        method: 'POST',
        body: JSON.stringify(uploadRequestSchema.parse(input)),
      }),
    )
  return {
    list: async () => filesPageSchema.parse(await request('')),
    authorize,
    complete,
    remove,
    downloadUrl: async (id: string) =>
      z
        .object({ downloadUrl: z.string() })
        .parse(await request(`/${encodeURIComponent(id)}/download-url`)),
    upload: async (file: File) => {
      const ticket = await authorize({
        name: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      })
      try {
        const res = await fetcher(ticket.uploadUrl, {
          method: ticket.method,
          headers: ticket.headers,
          body: await file.arrayBuffer(),
          credentials: ticket.mode === 'presigned' ? 'omit' : 'same-origin',
        })
        if (!res.ok) throw new FilesApiError(`Upload failed (${res.status})`, res.status)
        // Direct PUT completes atomically on the server; completion remains idempotent.
        return await complete(ticket.fileId)
      } catch (error) {
        // Best-effort cancellation retains the server-side cleanup tombstone.
        // Never conceal the original PUT/verification/network failure.
        await remove(ticket.fileId).catch(() => undefined)
        throw error
      }
    },
  }
}
