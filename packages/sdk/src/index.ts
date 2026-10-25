import {
  type CreateCheckoutInput,
  type CreatePortalInput,
  type HealthResponse,
  billingRedirectSchema,
  createCheckoutSchema,
  createPortalSchema,
  healthResponseSchema,
  listProjectsSchema,
  subscriptionResponseSchema,
} from '@saas/contracts'
import { z } from 'zod'

export interface ApiClientOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const projectSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
})

/**
 * Hand-written minimal client so dependents typecheck before codegen lands.
 * Methods are typed from @saas/contracts and validate responses with Zod.
 */
export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const res = await doFetch(`${opts.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers ?? {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) throw new ApiError(`API ${path} failed: ${res.status}`, res.status)
    return res.json()
  }

  return {
    health: async (): Promise<HealthResponse> =>
      healthResponseSchema.parse(await request('/health')),

    listProjects: async (input: { limit?: number; offset?: number } = {}) => {
      const query = listProjectsSchema.parse({ limit: 20, offset: 0, ...input })
      const data = await request(`/projects?limit=${query.limit}&offset=${query.offset}`)
      return z
        .object({
          items: z.array(projectSchema),
          total: z.number(),
          limit: z.number(),
          offset: z.number(),
        })
        .parse(data)
    },

    getProject: async (id: string) =>
      projectSchema.parse(await request(`/projects/${encodeURIComponent(id)}`)),

    createProject: async (input: { name: string; description?: string }) =>
      request('/projects', { method: 'POST', body: JSON.stringify(input) }) as Promise<{
        id: string
        userId: string
        name: string
      }>,

    updateProject: async (id: string, input: { name?: string; description?: string | null }) =>
      request(`/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }) as Promise<{ id: string; name: string }>,

    deleteProject: async (id: string) =>
      request(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }) as Promise<{
        ok: boolean
      }>,

    getSubscription: async () =>
      subscriptionResponseSchema.parse(await request('/billing/subscription')),

    refreshSubscription: async () =>
      subscriptionResponseSchema.parse(await request('/billing/refresh', { method: 'POST' })),

    createCustomerPortal: async (input: CreatePortalInput = {}) =>
      billingRedirectSchema.parse(
        await request('/billing/portal', {
          method: 'POST',
          body: JSON.stringify(createPortalSchema.parse(input)),
        }),
      ),

    createCheckout: async (input: CreateCheckoutInput) =>
      billingRedirectSchema.parse(
        await request('/billing/checkout', {
          method: 'POST',
          body: JSON.stringify(createCheckoutSchema.parse(input)),
        }),
      ),

    listAudit: async (limit = 50) =>
      request(`/audit?limit=${limit}`) as Promise<{
        items: Array<{
          id: string
          action: string
          targetType: string | null
          targetId: string | null
          metadata: Record<string, unknown> | null
          createdAt: string
        }>
      }>,
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
export { createAccountClient } from './account'
export { createFilesClient, FilesApiError } from './files'
