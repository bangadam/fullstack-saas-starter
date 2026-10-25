import type { NormalizedWebhookEvent } from '@saas/billing'
import { z } from 'zod'
import type { Db } from './db'
import { type EmailSender, ProviderError, renderTemplate } from './email'
import type { BillingQueueMessage, CleanupQueueMessage, SendEmailPayload } from './jobs-types'

export interface HandlerDeps {
  db: Db
  emailSender: EmailSender
  emailFrom: string
  bucket: R2Bucket
  cleanupStorage: () => Promise<unknown>
  now?: () => number
  newToken?: () => string
  config: {
    appName: string
    appUrl: string
    auditLogRetentionDays: number
    orphanObjectGraceDays: number
    staleOutboxHours: number
  }
}
export type JobResult = { outcome: 'ack' } | { outcome: 'retry'; error?: unknown }
export type JobHandler<P> = (payload: P, deps: HandlerDeps) => Promise<JobResult>
const nowFor = (deps: HandlerDeps) => deps.now?.() ?? Math.floor(Date.now() / 1000)
const tokenFor = (deps: HandlerDeps) => deps.newToken?.() ?? crypto.randomUUID()
const retryDelay = (attempt: number) =>
  Math.min(3600, 60 * 2 ** Math.min(6, Math.max(0, attempt - 1)))
const MAX_ATTEMPTS = 8

export const emailHandler: JobHandler<SendEmailPayload> = async (payload, deps) => {
  const id = payload.outboxId ?? payload.payload?.outboxId
  if (typeof id !== 'string') return { outcome: 'ack' }
  const now = nowFor(deps)
  const token = tokenFor(deps)
  const row = await deps.db.claimEmail(id, token, now)
  if (!row) return { outcome: 'ack' }
  // Resend retains dedup keys for 24h. Stop BEFORE that window can lapse.
  if (now - row.firstAttemptAt >= 23 * 3600 || row.attempts > MAX_ATTEMPTS) {
    await deps.db.failEmail(id, token, 'idempotency_window_expired', true, now)
    return { outcome: 'ack' }
  }
  let rendered: ReturnType<typeof renderTemplate>
  try {
    const params = z.record(z.unknown()).parse(JSON.parse(row.payloadJson))
    if (
      !['welcome', 'verify-email', 'reset-password', 'plan-changed', 'receipt'].includes(
        row.templateId,
      )
    )
      throw new Error('template')
    rendered = renderTemplate(row.templateId, params, deps.config)
  } catch {
    await deps.db.failEmail(id, token, 'invalid_template_payload', true, now)
    return { outcome: 'ack' }
  }
  try {
    await deps.emailSender.send({ to: row.to, ...rendered, idempotencyKey: `email:${row.id}` })
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 0
    const transient = status === 0 || [408, 409, 429].includes(status) || status >= 500
    const terminal = !transient || row.attempts >= MAX_ATTEMPTS
    const code = status ? `provider_${status}` : 'network'
    await deps.db.failEmail(id, token, code, terminal, now + retryDelay(row.attempts))
    return { outcome: terminal ? 'ack' : 'retry' }
  }
  // Keep completion outside send catch: a DB failure after acceptance is ambiguous.
  // Reclaim retains the same provider key and first-attempt window.
  await deps.db.finishEmail(id, token, nowFor(deps))
  return { outcome: 'ack' }
}

const eventSchema = z.object({
  provider: z.enum(['polar', 'stripe']),
  environment: z.enum(['sandbox', 'production']),
  externalEventId: z.string().min(1),
  type: z.string().min(1),
  userId: z.string().min(1).optional(),
  subscription: z
    .object({
      externalSubscriptionId: z.string().min(1),
      externalCustomerId: z.string().min(1),
      status: z.enum(['active', 'past_due', 'canceled', 'trialing', 'incomplete']),
      plan: z.enum(['free', 'pro']),
      interval: z.enum(['monthly', 'yearly']),
      currentPeriodEnd: z
        .string()
        .datetime()
        .transform((v) => new Date(v))
        .nullable(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .optional(),
})
export const billingHandler: JobHandler<BillingQueueMessage> = async (payload, deps) => {
  const now = nowFor(deps)
  const token = tokenFor(deps)
  const { payloadJson: _untrusted, ...reference } = payload
  const row = await deps.db.claimBilling(reference, token, now)
  if (!row) return { outcome: 'ack' }
  let event: NormalizedWebhookEvent
  try {
    event = eventSchema.parse(JSON.parse(row.payloadJson))
    if (
      event.provider !== payload.provider ||
      event.environment !== payload.environment ||
      event.externalEventId !== payload.externalEventId ||
      (event.subscription && !event.userId)
    )
      throw new Error('invalid_event')
  } catch {
    await deps.db.failBilling(row.id, token, 'invalid_event', true, now)
    return { outcome: 'ack' }
  }
  try {
    await deps.db.applyBilling(row.id, token, event, now)
  } catch {
    const terminal = row.attempts >= MAX_ATTEMPTS
    await deps.db.failBilling(
      row.id,
      token,
      'billing_apply_failed',
      terminal,
      now + retryDelay(row.attempts),
    )
    return { outcome: terminal ? 'ack' : 'retry' }
  }
  return { outcome: 'ack' }
}

export const cleanupHandler: JobHandler<CleanupQueueMessage> = async (_payload, deps) => {
  try {
    await deps.db.deleteOldAuditLogs(nowFor(deps) - deps.config.auditLogRetentionDays * 86400, 500)
    await deps.cleanupStorage()
    return { outcome: 'ack' }
  } catch {
    return { outcome: 'retry' }
  }
}

/** Durable rows are the source of truth; queue publish loss/DLQ never loses work. */
export async function recoverJobs(deps: HandlerDeps) {
  const candidates = await deps.db.recoveryCandidates(nowFor(deps), 50)
  let failed = 0
  for (const { id } of candidates.emails) {
    try {
      if (
        (await emailHandler({ type: 'send-email', outboxId: id, idempotencyKey: id }, deps))
          .outcome === 'retry'
      )
        failed++
    } catch {
      failed++
    }
  }
  for (const key of candidates.billing) {
    try {
      if (
        (
          await billingHandler(
            {
              type: 'webhook-billing',
              ...key,
              idempotencyKey: `${key.provider}:${key.environment}:${key.externalEventId}`,
            },
            deps,
          )
        ).outcome === 'retry'
      )
        failed++
    } catch {
      failed++
    }
  }
  return { emails: candidates.emails.length, billing: candidates.billing.length, failed }
}
export const handlers = {
  email: emailHandler,
  billing: billingHandler,
  cleanup: cleanupHandler,
} as const
