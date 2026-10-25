// Secrets remain optional so billing/cleanup run without email configured.
// Email delivery fails closed and remains recoverable; never mark a dry run sent.
import { z } from 'zod'

export const JobsEnvSchema = z.object({
  APP_NAME: z.string().min(1).default('SaaS'),
  APP_URL: z.string().url(),
  EMAIL_FROM: z.string().min(3),
  RESEND_API_KEY: z.string().min(1).optional(),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  ORPHAN_OBJECT_GRACE_DAYS: z.coerce.number().int().positive().default(7),
  STALE_OUTBOX_HOURS: z.coerce.number().int().positive().default(24),
})

export type JobsConfig = z.infer<typeof JobsEnvSchema>

export function parseJobsConfig(env: object): JobsConfig {
  return JobsEnvSchema.parse(env)
}
