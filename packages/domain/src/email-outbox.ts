import { randomUUID } from 'node:crypto'

/**
 * Transactional email dispatch through the outbox pattern.
 *
 * Order matters and is the whole point of this service: the durable
 * `email_outbox` row is written first, then the queue message is produced.
 * If the enqueue fails the row stays `pending`, so a repair job can pick it up
 * — at-least-once delivery means redelivery is safe because the consumer
 * treats `status = sent` as its idempotency guard.
 *
 * Pure domain code: persistence and queueing arrive as ports, so the rules are
 * unit-tested without D1, Workers or a real queue.
 */

export interface EmailOutboxInsert {
  id: string
  to: string
  subject: string
  templateId: string
  payloadJson: string
  status: 'pending'
  attempts: number
  lastError: string | null
  createdAt: Date
}

export interface EmailOutboxPort {
  insert(row: EmailOutboxInsert): Promise<void>
}

export interface EmailQueueMessage {
  type: 'send-email'
  to: string
  subject: string
  templateId: string
  payload: Record<string, unknown>
  idempotencyKey: string
}

export interface EmailQueuePort {
  send(message: EmailQueueMessage): Promise<void>
}

export interface DispatchEmailInput {
  to: string
  templateId: string
  subject: string
  payload: Record<string, unknown>
  /** Stable per side effect, e.g. `reset-password:<userId>:<token>`. */
  idempotencyKey: string
}

export interface DispatchEmailResult {
  outboxId: string
  queued: boolean
}

export interface EmailOutboxDeps {
  outbox: EmailOutboxPort
  queue: EmailQueuePort
  now?: () => Date
  newId?: () => string
  /** Observability hook for enqueue failures; never swallows silently. */
  onEnqueueError?: (error: unknown) => void
}

export class EmailOutboxService {
  constructor(private readonly deps: EmailOutboxDeps) {}

  async dispatch(input: DispatchEmailInput): Promise<DispatchEmailResult> {
    if (!input.to || !input.templateId || !input.subject || !input.idempotencyKey) {
      throw new Error(
        'Invalid email outbox input: to, templateId, subject and idempotencyKey are required',
      )
    }

    const id = this.deps.newId?.() ?? randomUUID()
    const createdAt = this.deps.now?.() ?? new Date()

    await this.deps.outbox.insert({
      id,
      to: input.to,
      subject: input.subject,
      templateId: input.templateId,
      payloadJson: JSON.stringify(input.payload),
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt,
    })

    try {
      await this.deps.queue.send({
        type: 'send-email',
        to: input.to,
        subject: input.subject,
        templateId: input.templateId,
        payload: { ...input.payload, outboxId: id },
        idempotencyKey: input.idempotencyKey,
      })
      return { outboxId: id, queued: true }
    } catch (error) {
      // Row remains pending on purpose: the repair job re-enqueues it.
      this.deps.onEnqueueError?.(error)
      return { outboxId: id, queued: false }
    }
  }
}
