import type { EmailJobPayload } from '@saas/email'
import { type JobPayload, type JobType, jobPayloadSchema } from './payloads'

export * from './payloads'
export type { EmailJobPayload }

export interface QueueProducerLike {
  send(message: unknown): Promise<void>
}

/** Typed producer: validates payload and injects an idempotency key. */
export async function enqueue<Q extends QueueProducerLike>(
  queue: Q,
  payload: Omit<JobPayload, 'idempotencyKey'> & { idempotencyKey?: string },
): Promise<JobPayload> {
  const full = {
    ...payload,
    idempotencyKey: payload.idempotencyKey ?? crypto.randomUUID(),
  } as JobPayload
  const parsed = jobPayloadSchema.parse(full)
  await queue.send(parsed)
  return parsed
}

export interface ConsumerContext {
  /** Cloudflare Queues delivers attempts starting at 1. */
  attempt: number
  maxAttempts: number
}

export type Handler<P> = (payload: P, ctx: ConsumerContext) => Promise<void>

export interface DeadLetterReporter {
  report(payload: JobPayload, error: Error): Promise<void>
}

export type ConsumerResult = { ack: true } | { retry: true; error: Error }

/**
 * Typed consumer wrapper. Throws to signal retry when the handler fails and
 * attempts remain; reports to dead-letter after maxAttempts. Parsing failures
 * are never retried (poison messages go straight to dead-letter).
 */
export function createConsumer<P extends JobPayload>(type: P['type'], handler: Handler<P>) {
  return async (
    rawBody: unknown,
    ctx: ConsumerContext,
    deadLetter?: DeadLetterReporter,
  ): Promise<ConsumerResult> => {
    const parsed = jobPayloadSchema.safeParse(rawBody)
    if (!parsed.success || parsed.data.type !== type) {
      const err = new Error(
        parsed.success
          ? `Message type mismatch: expected ${type}`
          : `Invalid message body: ${parsed.error.message}`,
      )
      await deadLetter?.report(parsed.success ? parsed.data : (rawBody as JobPayload), err)
      return { ack: true, ...({ poison: true } as object) } as ConsumerResult
    }
    try {
      await handler(parsed.data as P, ctx)
      return { ack: true }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      if (ctx.attempt >= ctx.maxAttempts) {
        await deadLetter?.report(parsed.data, err)
        return { ack: true }
      }
      return { retry: true, error: err }
    }
  }
}

export type JobHandlerMap = { [K in JobType]: Handler<Extract<JobPayload, { type: K }>> }
