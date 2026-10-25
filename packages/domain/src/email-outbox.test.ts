import { describe, expect, it, vi } from 'vitest'
import {
  type EmailOutboxInsert,
  type EmailOutboxPort,
  EmailOutboxService,
  type EmailQueueMessage,
  type EmailQueuePort,
} from './email-outbox'

function makePorts() {
  const inserted: EmailOutboxInsert[] = []
  const sent: EmailQueueMessage[] = []
  const outbox: EmailOutboxPort = {
    async insert(row) {
      inserted.push(row)
    },
  }
  let failNext = false
  const queue: EmailQueuePort = {
    async send(message) {
      if (failNext) throw new Error('queue unavailable')
      sent.push(message)
    },
  }
  return {
    outbox,
    queue,
    inserted,
    sent,
    failQueue: () => {
      failNext = true
    },
  }
}

const input = (overrides: Partial<Parameters<EmailOutboxService['dispatch']>[0]> = {}) => ({
  to: 'sari@example.com',
  templateId: 'reset-password',
  subject: 'Reset your password',
  payload: { url: 'https://app.example.com/reset', name: 'Sari' },
  idempotencyKey: 'reset-password:user-1:abc',
  ...overrides,
})

describe('EmailOutboxService.dispatch', () => {
  it('persists the outbox row before enqueueing', async () => {
    const ports = makePorts()
    const service = new EmailOutboxService(ports)

    const result = await service.dispatch(input())

    expect(ports.inserted).toHaveLength(1)
    const row = ports.inserted[0]
    expect(row).toMatchObject({
      to: 'sari@example.com',
      templateId: 'reset-password',
      subject: 'Reset your password',
      status: 'pending',
      attempts: 0,
      lastError: null,
    })
    expect(JSON.parse(String(row?.payloadJson))).toEqual({
      url: 'https://app.example.com/reset',
      name: 'Sari',
    })
    expect(result.outboxId).toBe(row?.id)
    expect(result.queued).toBe(true)
  })

  it('sends a queue message the consumer schema accepts, carrying the outbox id', async () => {
    const ports = makePorts()
    const service = new EmailOutboxService(ports)

    const result = await service.dispatch(input())

    expect(ports.sent).toHaveLength(1)
    expect(ports.sent[0]).toMatchObject({
      type: 'send-email',
      to: 'sari@example.com',
      subject: 'Reset your password',
      templateId: 'reset-password',
      idempotencyKey: 'reset-password:user-1:abc',
    })
    expect(ports.sent[0]?.payload).toMatchObject({
      outboxId: result.outboxId,
      url: 'https://app.example.com/reset',
    })
  })

  it('keeps the row pending and reports queued=false when enqueue fails', async () => {
    const ports = makePorts()
    const onEnqueueError = vi.fn()
    const service = new EmailOutboxService({ ...ports, onEnqueueError })
    ports.failQueue()

    const result = await service.dispatch(input())

    // The durable row is the recovery point: a repair job re-enqueues it.
    expect(result.queued).toBe(false)
    expect(ports.inserted[0]?.status).toBe('pending')
    expect(ports.sent).toHaveLength(0)
    expect(onEnqueueError).toHaveBeenCalledOnce()
  })

  it('rejects incomplete input instead of queueing a malformed message', async () => {
    const ports = makePorts()
    const service = new EmailOutboxService(ports)

    for (const bad of [
      input({ to: '' }),
      input({ templateId: '' }),
      input({ idempotencyKey: '' }),
      input({ subject: '' }),
    ]) {
      await expect(service.dispatch(bad)).rejects.toThrow(/Invalid email outbox input/)
    }
    expect(ports.inserted).toHaveLength(0)
  })

  it('generates distinct ids per dispatch', async () => {
    const ports = makePorts()
    const service = new EmailOutboxService(ports)

    const a = await service.dispatch(input())
    const b = await service.dispatch(input())

    expect(a.outboxId).not.toBe(b.outboxId)
  })

  it('uses the injected clock for createdAt so rows are deterministic in tests', async () => {
    const ports = makePorts()
    const service = new EmailOutboxService({
      ...ports,
      now: () => new Date('2026-01-02T03:04:05Z'),
    })

    await service.dispatch(input())

    expect(ports.inserted[0]?.createdAt).toEqual(new Date('2026-01-02T03:04:05Z'))
  })
})
