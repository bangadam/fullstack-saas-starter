import { describe, expect, it, vi } from 'vitest'
import { createAccountClient } from './account'

describe('account SDK', () => {
  it('lists safe sessions with cookie credentials and strips tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        items: [
          {
            id: 'fixture',
            current: true,
            userAgent: null,
            ipAddress: null,
            createdAt: 'date',
            expiresAt: 'date',
            token: 'must-not-escape',
          },
        ],
      }),
    )
    const result = await createAccountClient({ baseUrl: '/api', fetchImpl }).listSessions()
    expect(result.items[0]).not.toHaveProperty('token')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/account/sessions',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
  it('uses session IDs rather than tokens and encodes paths', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: true }))
    await createAccountClient({ baseUrl: '/api', fetchImpl }).revokeSession('a/b')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/account/sessions/a%2Fb/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
  })
  it('preserves safe actionable conflicts', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { message: 'Resolve billing before deletion.' } }, { status: 409 }),
      )
    await expect(
      createAccountClient({ baseUrl: '/api', fetchImpl }).prepareDeletion('DELETE'),
    ).rejects.toThrow('Resolve billing')
  })
})
