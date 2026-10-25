// Hand-written to match wrangler.jsonc bindings exactly. Regenerate or align
// manually whenever wrangler.jsonc changes.
import type { BillingQueueMessage, CleanupQueueMessage, SendEmailPayload } from './src/jobs-types'

declare global {
  interface CloudflareEnvironment {
    DB: D1Database
    BUCKET: R2Bucket
    EMAIL_QUEUE: Queue<SendEmailPayload>
    BILLING_QUEUE: Queue<BillingQueueMessage>
    CLEANUP_QUEUE: Queue<CleanupQueueMessage>
    APP_NAME: string
    APP_URL: string
    EMAIL_FROM: string
    RESEND_API_KEY?: string
    AUDIT_LOG_RETENTION_DAYS: string
    ORPHAN_OBJECT_GRACE_DAYS: string
    STALE_OUTBOX_HOURS: string
  }
}
