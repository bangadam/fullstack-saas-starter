import type { NormalizedWebhookEvent } from '@saas/billing'

export const LEASE_SECONDS = 120
export interface EmailOutboxRow {
  id: string
  to: string
  subject: string
  templateId: string
  payloadJson: string
  attempts: number
  firstAttemptAt: number
}
export interface BillingKey {
  provider: 'polar' | 'stripe'
  environment: 'sandbox' | 'production'
  externalEventId: string
}
export interface BillingEventRow {
  id: string
  payloadJson: string
  attempts: number
}
export interface Health {
  emailPending: number
  emailFailed: number
  billingPending: number
  billingFailed: number
  emailLagSeconds: number
  billingLagSeconds: number
}
export interface Db {
  claimEmail(id: string, token: string, now: number): Promise<EmailOutboxRow | null>
  finishEmail(id: string, token: string, now: number): Promise<void>
  failEmail(id: string, token: string, code: string, terminal: boolean, next: number): Promise<void>
  claimBilling(key: BillingKey, token: string, now: number): Promise<BillingEventRow | null>
  applyBilling(id: string, token: string, event: NormalizedWebhookEvent, now: number): Promise<void>
  failBilling(
    id: string,
    token: string,
    code: string,
    terminal: boolean,
    next: number,
  ): Promise<void>
  recoveryCandidates(
    now: number,
    limit: number,
  ): Promise<{ emails: { id: string }[]; billing: BillingKey[] }>
  health(now: number): Promise<Health>
  deleteOldAuditLogs(before: number, limit: number): Promise<void>
}

/** Conditional UPDATE RETURNING is the claim; never read-then-write enforcement. */
export function createDb(d1: D1Database): Db {
  return {
    claimEmail(id, token, now) {
      return d1
        .prepare(`UPDATE email_outbox SET lease_token=?, lease_until=?,
        attempts=attempts+1, first_attempt_at=COALESCE(first_attempt_at, ?)
        WHERE id=? AND status='pending' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)
        RETURNING id, "to", subject, template_id AS templateId, payload_json AS payloadJson,
        attempts, first_attempt_at AS firstAttemptAt`)
        .bind(token, now + LEASE_SECONDS, now, id, now, now)
        .first<EmailOutboxRow>()
    },
    async finishEmail(id, token, now) {
      await d1
        .prepare(`UPDATE email_outbox SET status='sent',sent_at=?,last_error=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=? AND lease_token=? AND status='pending'`)
        .bind(now, id, token)
        .run()
    },
    async failEmail(id, token, code, terminal, next) {
      await d1
        .prepare(`UPDATE email_outbox SET status=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL
        WHERE id=? AND lease_token=? AND status='pending'`)
        .bind(terminal ? 'failed' : 'pending', code, next, id, token)
        .run()
    },
    claimBilling(key, token, now) {
      return d1
        .prepare(`UPDATE billing_events SET lease_token=?,lease_until=?,attempts=attempts+1
        WHERE provider=? AND environment=? AND external_event_id=? AND processed_at IS NULL AND failed_at IS NULL
        AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)
        RETURNING id,payload_json AS payloadJson,attempts`)
        .bind(
          token,
          now + LEASE_SECONDS,
          key.provider,
          key.environment,
          key.externalEventId,
          now,
          now,
        )
        .first<BillingEventRow>()
    },
    async applyBilling(id, token, event, now) {
      const statements: D1PreparedStatement[] = []
      const sub = event.subscription
      if (sub) {
        statements.push(
          d1
            .prepare(`INSERT INTO subscriptions
          (id,user_id,provider,environment,external_customer_id,external_subscription_id,plan,interval,status,current_period_end,cancel_at_period_end,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS
          (SELECT 1 FROM billing_events WHERE id=? AND lease_token=? AND processed_at IS NULL AND failed_at IS NULL)
          ON CONFLICT(provider,environment,external_subscription_id) DO UPDATE SET
          external_customer_id=excluded.external_customer_id,plan=excluded.plan,interval=excluded.interval,
          status=excluded.status,current_period_end=excluded.current_period_end,
          cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at
          WHERE subscriptions.user_id=excluded.user_id`)
            .bind(
              crypto.randomUUID(),
              event.userId ?? '',
              event.provider,
              event.environment,
              sub.externalCustomerId,
              sub.externalSubscriptionId,
              sub.plan,
              sub.interval,
              sub.status,
              sub.currentPeriodEnd ? Math.floor(sub.currentPeriodEnd.getTime() / 1000) : null,
              Number(sub.cancelAtPeriodEnd),
              now,
              now,
              id,
              token,
            ),
        )
        // A provider subscription cannot silently migrate between tenants.
        statements.push(
          d1
            .prepare(`UPDATE billing_events SET failed_at=?,last_error='subscription_owner_mismatch'
          WHERE id=? AND lease_token=? AND EXISTS (SELECT 1 FROM subscriptions
          WHERE provider=? AND environment=? AND external_subscription_id=? AND user_id<>?)`)
            .bind(
              now,
              id,
              token,
              event.provider,
              event.environment,
              sub.externalSubscriptionId,
              event.userId ?? '',
            ),
        )
      }
      statements.push(
        d1
          .prepare(`UPDATE billing_events SET processed_at=?,lease_token=NULL,lease_until=NULL,last_error=NULL
        WHERE id=? AND lease_token=? AND processed_at IS NULL AND failed_at IS NULL`)
          .bind(now, id, token),
      )
      // D1 batch is transactional; the state write and processed marker commit together.
      await d1.batch(statements)
    },
    async failBilling(id, token, code, terminal, next) {
      await d1
        .prepare(`UPDATE billing_events SET failed_at=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL
        WHERE id=? AND lease_token=? AND processed_at IS NULL`)
        .bind(terminal ? Math.floor(Date.now() / 1000) : null, code, next, id, token)
        .run()
    },
    async recoveryCandidates(now, limit) {
      const emails = await d1
        .prepare(`SELECT id FROM email_outbox WHERE status='pending' AND next_attempt_at<=?
        AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at,created_at,id LIMIT ?`)
        .bind(now, now, limit)
        .all<{ id: string }>()
      const billing = await d1
        .prepare(`SELECT provider,environment,external_event_id AS externalEventId FROM billing_events
        WHERE processed_at IS NULL AND failed_at IS NULL AND next_attempt_at<=?
        AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at,created_at,id LIMIT ?`)
        .bind(now, now, limit)
        .all<BillingKey>()
      return { emails: emails.results, billing: billing.results }
    },
    async health(now) {
      const result = await d1
        .prepare(`SELECT
        (SELECT count(*) FROM email_outbox WHERE status='pending') AS emailPending,
        (SELECT count(*) FROM email_outbox WHERE status='failed') AS emailFailed,
        (SELECT count(*) FROM billing_events WHERE processed_at IS NULL AND failed_at IS NULL) AS billingPending,
        (SELECT count(*) FROM billing_events WHERE failed_at IS NOT NULL) AS billingFailed,
        MAX(0,COALESCE(?-(SELECT MIN(created_at) FROM email_outbox WHERE status='pending'),0)) AS emailLagSeconds,
        MAX(0,COALESCE(?-(SELECT MIN(created_at) FROM billing_events WHERE processed_at IS NULL AND failed_at IS NULL),0)) AS billingLagSeconds`)
        .bind(now, now)
        .first<Health>()
      if (!result) throw new Error('health_query_failed')
      return result
    },
    async deleteOldAuditLogs(before, limit) {
      await d1
        .prepare(
          'DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at<? ORDER BY created_at LIMIT ?)',
        )
        .bind(before, limit)
        .run()
    },
  }
}
