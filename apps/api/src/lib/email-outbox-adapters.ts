import { type Db, emailOutbox } from '@saas/db'
import type { EmailOutboxInsert, EmailOutboxPort, EmailQueuePort } from '@saas/domain'

/** D1 implementation of the outbox port used by EmailOutboxService. */
export class DrizzleEmailOutboxRepository implements EmailOutboxPort {
  constructor(private readonly db: Db) {}

  async insert(row: EmailOutboxInsert): Promise<void> {
    await this.db.insert(emailOutbox).values({
      id: row.id,
      to: row.to,
      subject: row.subject,
      templateId: row.templateId,
      payloadJson: row.payloadJson,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt,
    })
  }
}

/** Cloudflare Queues producer adapter for the email queue. */
export class QueueEmailProducer implements EmailQueuePort {
  constructor(private readonly queue: Queue<Record<string, unknown>>) {}

  async send(message: Parameters<EmailQueuePort['send']>[0]): Promise<void> {
    // The consumer validates the body against the job payload schema, so the
    // message is sent as a plain record.
    await this.queue.send({ ...message })
  }
}
