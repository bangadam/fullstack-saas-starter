import {
  accountDeletionStateSchema,
  accountExportSchema,
  accountSessionsSchema,
  prepareAccountDeletionSchema,
} from '@saas/contracts'
import { z } from 'zod'
import { type ApiClientOptions, ApiError } from './index'

export function createAccountClient(options: ApiClientOptions) {
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await (options.fetchImpl ?? fetch)(
      `${options.baseUrl.replace(/\/$/, '')}/account${path}`,
      {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
      },
    )
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ message: z.string() }) })
        .safeParse(await response.json().catch(() => null))
      throw new ApiError(
        error.success ? error.data.error.message : `Account request failed (${response.status}).`,
        response.status,
      )
    }
    return response.json()
  }
  return {
    listSessions: async () => accountSessionsSchema.parse(await request('/sessions')),
    revokeSession: async (id: string) => {
      await request(`/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: '{}' })
    },
    exportData: async () => accountExportSchema.parse(await request('/export')),
    deletionState: async () => accountDeletionStateSchema.parse(await request('/deletion')),
    security: async () =>
      z
        .object({ turnstileRequired: z.boolean(), turnstileSiteKey: z.string().nullable() })
        .parse(await request('/security')),
    prepareDeletion: async (confirmation: string) =>
      accountDeletionStateSchema.parse(
        await request('/deletion/prepare', {
          method: 'POST',
          body: JSON.stringify(prepareAccountDeletionSchema.parse({ confirmation })),
        }),
      ),
  }
}
