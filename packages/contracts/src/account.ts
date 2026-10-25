import { z } from 'zod'

export const profileNameSchema = z.string().trim().min(1).max(100)
export const prepareAccountDeletionSchema = z.object({ confirmation: z.literal('DELETE') })
export const accountSessionSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
})
export const accountSessionsSchema = z.object({ items: z.array(accountSessionSchema) })
export const accountDeletionStateSchema = z.object({
  preparedAt: z.string().nullable(),
  retryAfter: z.string().nullable(),
})
const owned = { id: z.string(), userId: z.string(), createdAt: z.string() }
/** Deliberate allowlist. Auth accounts, sessions/tokens, R2 keys and free-form audit metadata are excluded. */
export const accountExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    createdAt: z.string(),
  }),
  projects: z.array(
    z.object({
      ...owned,
      name: z.string(),
      description: z.string().nullable(),
      deletedAt: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
  files: z.array(
    z.object({ ...owned, name: z.string(), size: z.number(), contentType: z.string() }),
  ),
  subscriptions: z.array(
    z.object({
      ...owned,
      provider: z.string(),
      environment: z.string(),
      status: z.string(),
      plan: z.string(),
      interval: z.string(),
      currentPeriodEnd: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
    }),
  ),
  audit: z.array(
    z.object({
      ...owned,
      action: z.string(),
      targetType: z.string().nullable(),
      targetId: z.string().nullable(),
    }),
  ),
})
export type AccountSession = z.infer<typeof accountSessionSchema>
export type AccountExport = z.infer<typeof accountExportSchema>
