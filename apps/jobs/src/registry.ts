import { sendEmailPayloadSchema } from '@saas/jobs'
import { z } from 'zod'
import type { HandlerDeps } from './handlers'
import { billingHandler, cleanupHandler, emailHandler } from './handlers'
import type { BillingQueueMessage, CleanupQueueMessage, SendEmailPayload } from './jobs-types'

// Queue name -> handler mapping. Keep in sync with wrangler.jsonc consumers.
export type QueueKind = 'EMAIL_QUEUE' | 'BILLING_QUEUE' | 'CLEANUP_QUEUE'

export function queueKindForName(queueName: string): QueueKind | undefined {
  switch (queueName.replace(/-(staging|production)$/, '')) {
    case 'saas-email-queue':
      return 'EMAIL_QUEUE'
    case 'saas-billing-queue':
      return 'BILLING_QUEUE'
    case 'saas-cleanup-queue':
      return 'CLEANUP_QUEUE'
    default:
      return undefined
  }
}

const billingMessageSchema = z.object({
  type: z.literal('webhook-billing'),
  provider: z.enum(['polar', 'stripe']),
  environment: z.enum(['sandbox', 'production']),
  externalEventId: z.string().min(1),
  payloadJson: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
})

const cleanupMessageSchema = z.object({
  type: z.literal('cleanup'),
  kind: z.literal('full'),
  triggeredBy: z.enum(['cron', 'manual']).optional(),
})

type AnyQueueMessage = SendEmailPayload | BillingQueueMessage | CleanupQueueMessage

function parsePayload(
  kind: QueueKind,
  body: unknown,
): { ok: true; value: AnyQueueMessage } | { ok: false } {
  try {
    switch (kind) {
      case 'EMAIL_QUEUE':
        return { ok: true, value: sendEmailPayloadSchema.parse(body) }
      case 'BILLING_QUEUE':
        return { ok: true, value: billingMessageSchema.parse(body) }
      case 'CLEANUP_QUEUE':
        return { ok: true, value: cleanupMessageSchema.parse(body) }
    }
  } catch {
    return { ok: false }
  }
}

async function runHandler(kind: QueueKind, body: AnyQueueMessage, deps: HandlerDeps) {
  switch (kind) {
    case 'EMAIL_QUEUE':
      return emailHandler(body as SendEmailPayload, deps)
    case 'BILLING_QUEUE':
      return billingHandler(body as BillingQueueMessage, deps)
    case 'CLEANUP_QUEUE':
      return cleanupHandler(body as CleanupQueueMessage, deps)
  }
}

// Message itself carries no queue name; only MessageBatch does, so the batch
// passes it down. Ack/retry are called per message; exhausted retries route
// to the DLQ.
export async function dispatchMessage(
  message: Message<AnyQueueMessage>,
  queueName: string,
  deps: HandlerDeps,
): Promise<'acked' | 'retry'> {
  const kind = queueKindForName(queueName)
  if (!kind) {
    console.error(JSON.stringify({ event: 'job_unrouted', outcome: 'retry' }))
    message.retry()
    return 'retry'
  }
  const parsed = parsePayload(kind, message.body)
  if (!parsed.ok) {
    // Malformed payload is permanent (producer bug); ack to avoid burning
    // retries on a message that can never succeed.
    console.error(JSON.stringify({ event: 'job_invalid_payload', kind, outcome: 'ack' }))
    message.ack()
    return 'acked'
  }
  let outcome: 'ack' | 'retry'
  try {
    const result = await runHandler(kind, parsed.value, deps)
    outcome = result.outcome === 'ack' ? 'ack' : 'retry'
  } catch {
    // Never log exception messages: upstream errors can contain credentials.
    console.error(JSON.stringify({ event: 'job_handler_failed', kind }))
    outcome = 'retry'
  }
  if (outcome === 'retry') {
    message.retry()
    return 'retry'
  }
  message.ack()
  return 'acked'
}

export async function dispatchBatch(
  batch: MessageBatch<AnyQueueMessage>,
  deps: HandlerDeps,
): Promise<{ acked: number; retried: number }> {
  let acked = 0
  let retried = 0
  for (const message of batch.messages) {
    const result = await dispatchMessage(message, batch.queue, deps)
    if (result === 'acked') {
      acked += 1
    } else {
      retried += 1
    }
  }
  return { acked, retried }
}
