import { z } from 'zod'

export const sendEmailPayloadSchema = z.object({
  type: z.literal('send-email'),
  // New producers send a reference only. Legacy render fields remain accepted
  // during rollout but consumers exclusively trust the durable outbox row.
  outboxId: z.string().min(1).optional(),
  to: z.string().email().optional(),
  subject: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  payload: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(1),
})
export type SendEmailPayload = z.infer<typeof sendEmailPayloadSchema>

export const webhookBillingPayloadSchema = z.object({
  type: z.literal('webhook-billing'),
  provider: z.enum(['polar', 'stripe']),
  environment: z.enum(['sandbox', 'production']),
  externalEventId: z.string().min(1),
  payloadJson: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
})
export type WebhookBillingPayload = z.infer<typeof webhookBillingPayloadSchema>

export const cleanupOrphanFilesPayloadSchema = z.object({
  type: z.literal('cleanup-orphan-files'),
  olderThan: z.string().datetime(),
  idempotencyKey: z.string().min(1),
})
export type CleanupOrphanFilesPayload = z.infer<typeof cleanupOrphanFilesPayloadSchema>

export const auditRotatePayloadSchema = z.object({
  type: z.literal('audit-rotate'),
  olderThan: z.string().datetime(),
  idempotencyKey: z.string().min(1),
})
export type AuditRotatePayload = z.infer<typeof auditRotatePayloadSchema>

export const jobPayloadSchema = z.discriminatedUnion('type', [
  sendEmailPayloadSchema,
  webhookBillingPayloadSchema,
  cleanupOrphanFilesPayloadSchema,
  auditRotatePayloadSchema,
])
export type JobPayload = z.infer<typeof jobPayloadSchema>

export type JobType = JobPayload['type']

export const JOB_TYPES = [
  'send-email',
  'webhook-billing',
  'cleanup-orphan-files',
  'audit-rotate',
] as const
