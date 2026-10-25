import { describe, expect, it, vi } from 'vitest'
import type { Db, EmailOutboxRow } from './db'
import { ProviderError } from './email'
import {
  type HandlerDeps,
  billingHandler,
  cleanupHandler,
  emailHandler,
  recoverJobs,
} from './handlers'
import { dispatchMessage, queueKindForName } from './registry'

const now = 1_800_000_000
const row: EmailOutboxRow = {
  id: 'outbox-1',
  to: 'private@example.com',
  subject: 'ignored',
  templateId: 'welcome',
  payloadJson: '{"name":"A"}',
  attempts: 1,
  firstAttemptAt: now,
}
const message = { type: 'send-email' as const, outboxId: row.id, idempotencyKey: row.id }
const billing = {
  type: 'webhook-billing' as const,
  provider: 'polar' as const,
  environment: 'sandbox' as const,
  externalEventId: 'evt-1',
  idempotencyKey: 'polar:sandbox:evt-1',
}
const event = {
  ...billing,
  type: 'subscription.updated',
  userId: 'user-1',
  subscription: {
    externalSubscriptionId: 'sub-1',
    externalCustomerId: 'cus-1',
    status: 'active',
    plan: 'pro',
    interval: 'monthly',
    currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  },
}
function deps(): HandlerDeps {
  return {
    db: {
      claimEmail: vi.fn().mockResolvedValue(row),
      finishEmail: vi.fn(),
      failEmail: vi.fn(),
      claimBilling: vi
        .fn()
        .mockResolvedValue({ id: 'row-1', payloadJson: JSON.stringify(event), attempts: 1 }),
      applyBilling: vi.fn(),
      failBilling: vi.fn(),
      recoveryCandidates: vi.fn().mockResolvedValue({ emails: [], billing: [] }),
      health: vi.fn().mockResolvedValue({
        emailPending: 0,
        emailFailed: 0,
        billingPending: 0,
        billingFailed: 0,
        emailLagSeconds: 0,
        billingLagSeconds: 0,
      }),
      deleteOldAuditLogs: vi.fn(),
    } as unknown as Db,
    emailSender: { send: vi.fn().mockResolvedValue(undefined) },
    emailFrom: 'sender@example.com',
    bucket: {} as R2Bucket,
    cleanupStorage: vi.fn().mockResolvedValue(undefined),
    now: () => now,
    newToken: () => 'lease-1',
    config: {
      appName: 'SaaS',
      appUrl: 'https://example.com',
      auditLogRetentionDays: 90,
      orphanObjectGraceDays: 7,
      staleOutboxHours: 24,
    },
  }
}
describe('email recovery', () => {
  it('claims atomically before sending and fences completion with lease token', async () => {
    const d = deps()
    expect(await emailHandler(message, d)).toEqual({ outcome: 'ack' })
    expect(d.db.claimEmail).toHaveBeenCalledWith(row.id, 'lease-1', now)
    expect(d.emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `email:${row.id}` }),
    )
    expect(d.db.finishEmail).toHaveBeenCalledWith(row.id, 'lease-1', now)
  })
  it('does not send when another delivery owns lease or row is terminal', async () => {
    const d = deps()
    vi.mocked(d.db.claimEmail).mockResolvedValue(null)
    await emailHandler(message, d)
    expect(d.emailSender.send).not.toHaveBeenCalled()
  })
  it('retries network failures with safe error code, without incrementing attempts twice', async () => {
    const d = deps()
    vi.mocked(d.emailSender.send).mockRejectedValue(new TypeError('secret recipient token'))
    expect((await emailHandler(message, d)).outcome).toBe('retry')
    expect(d.db.claimEmail).toHaveBeenCalledOnce()
    expect(d.db.failEmail).toHaveBeenCalledWith(row.id, 'lease-1', 'network', false, now + 60)
  })
  it.each([408, 409, 429, 500, 503])('retries transient HTTP %s', async (status) => {
    const d = deps()
    vi.mocked(d.emailSender.send).mockRejectedValue(new ProviderError(status))
    expect((await emailHandler(message, d)).outcome).toBe('retry')
  })
  it('quarantines permanent failures', async () => {
    const d = deps()
    vi.mocked(d.emailSender.send).mockRejectedValue(new ProviderError(422))
    expect((await emailHandler(message, d)).outcome).toBe('ack')
    expect(d.db.failEmail).toHaveBeenCalledWith(row.id, 'lease-1', 'provider_422', true, now + 60)
  })
  it('does not resend beyond the safe provider idempotency window', async () => {
    const d = deps()
    vi.mocked(d.db.claimEmail).mockResolvedValue({ ...row, firstAttemptAt: now - 23 * 3600 })
    await emailHandler(message, d)
    expect(d.emailSender.send).not.toHaveBeenCalled()
    expect(d.db.failEmail).toHaveBeenCalledWith(
      row.id,
      'lease-1',
      'idempotency_window_expired',
      true,
      now,
    )
  })
  it('stops after a bounded retry budget', async () => {
    const d = deps()
    vi.mocked(d.db.claimEmail).mockResolvedValue({ ...row, attempts: 8 })
    vi.mocked(d.emailSender.send).mockRejectedValue(new TypeError('fetch failed'))
    expect((await emailHandler(message, d)).outcome).toBe('ack')
    expect(d.db.failEmail).toHaveBeenCalledWith(
      row.id,
      'lease-1',
      'network',
      true,
      expect.any(Number),
    )
  })
  it('leaves lease in place if provider succeeded but durable completion failed', async () => {
    const d = deps()
    vi.mocked(d.db.finishEmail).mockRejectedValue(new Error('D1 unavailable'))
    await expect(emailHandler(message, d)).rejects.toThrow()
    expect(d.db.failEmail).not.toHaveBeenCalled()
  })
  it('quarantines invalid template inputs without sending', async () => {
    const d = deps()
    vi.mocked(d.db.claimEmail).mockResolvedValue({ ...row, payloadJson: 'null' })
    expect((await emailHandler(message, d)).outcome).toBe('ack')
    expect(d.emailSender.send).not.toHaveBeenCalled()
  })
})
describe('billing recovery', () => {
  it('reads trusted durable data not queue payload, normalizes dates and applies atomically', async () => {
    const d = deps()
    await billingHandler({ ...billing, payloadJson: '{malicious' }, d)
    expect(d.db.claimBilling).toHaveBeenCalledWith(billing, 'lease-1', now)
    expect(d.db.applyBilling).toHaveBeenCalledWith(
      'row-1',
      'lease-1',
      expect.objectContaining({
        subscription: expect.objectContaining({ currentPeriodEnd: new Date('2027-01-01') }),
      }),
      now,
    )
  })
  it('refuses cross-provider/environment payload mismatch', async () => {
    const d = deps()
    vi.mocked(d.db.claimBilling).mockResolvedValue({
      id: 'row-1',
      attempts: 1,
      payloadJson: JSON.stringify({ ...event, environment: 'production' }),
    })
    await billingHandler(billing, d)
    expect(d.db.applyBilling).not.toHaveBeenCalled()
    expect(d.db.failBilling).toHaveBeenCalledWith('row-1', 'lease-1', 'invalid_event', true, now)
  })
  it('marks non-subscription events processed too', async () => {
    const d = deps()
    vi.mocked(d.db.claimBilling).mockResolvedValue({
      id: 'row-1',
      attempts: 1,
      payloadJson: JSON.stringify({ ...event, subscription: undefined }),
    })
    await billingHandler(billing, d)
    expect(d.db.applyBilling).toHaveBeenCalledOnce()
  })
})
describe('scheduled recovery and routing', () => {
  it('replays bounded durable rows and continues after individual failures', async () => {
    const d = deps()
    vi.mocked(d.db.recoveryCandidates).mockResolvedValue({
      emails: [{ id: row.id }, { id: 'outbox-2' }],
      billing: [billing],
    })
    vi.mocked(d.db.claimEmail).mockRejectedValueOnce(new Error('sensitive message'))
    const result = await recoverJobs(d)
    expect(d.db.recoveryCandidates).toHaveBeenCalledWith(now, 50)
    expect(d.db.claimEmail).toHaveBeenCalledTimes(2)
    expect(d.db.applyBilling).toHaveBeenCalledOnce()
    expect(result.failed).toBe(1)
  })
  it('runs actual bounded storage cleanup, never a bucket-wide orphan delete', async () => {
    const d = deps()
    await cleanupHandler({ type: 'cleanup', kind: 'full' }, d)
    expect(d.cleanupStorage).toHaveBeenCalledOnce()
    expect(d.db.deleteOldAuditLogs).toHaveBeenCalledWith(expect.any(Number), 500)
  })
  it('supports environment queue names and retries unknown routing instead of dropping', async () => {
    expect(queueKindForName('saas-email-queue-staging')).toBe('EMAIL_QUEUE')
    expect(queueKindForName('saas-billing-queue-production')).toBe('BILLING_QUEUE')
    const msg = { body: message, ack: vi.fn(), retry: vi.fn() } as unknown as Message<never>
    expect(await dispatchMessage(msg, 'unknown', deps())).toBe('retry')
    expect(msg.ack).not.toHaveBeenCalled()
  })
})
