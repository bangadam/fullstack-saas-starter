// Queue payload contracts come from @saas/jobs (single source of truth shared
// with the API producer). The billing queue message carries a
// NormalizedWebhookEvent serialized in payloadJson; the email queue message is
// the @saas/jobs send-email payload keyed by outboxId in the payload record.
export {
  auditRotatePayloadSchema,
  cleanupOrphanFilesPayloadSchema,
  jobPayloadSchema,
  sendEmailPayloadSchema,
  webhookBillingPayloadSchema,
} from '@saas/jobs'
export type {
  AuditRotatePayload,
  CleanupOrphanFilesPayload,
  JobPayload,
  JobType,
  SendEmailPayload,
  WebhookBillingPayload,
} from '@saas/jobs'

export type BillingQueueMessage = {
  type: 'webhook-billing'
  provider: 'polar' | 'stripe'
  environment: 'sandbox' | 'production'
  externalEventId: string
  payloadJson?: string
  idempotencyKey: string
}

export type CleanupQueueMessage = {
  type: 'cleanup'
  kind: 'full'
  triggeredBy?: 'cron' | 'manual'
}
