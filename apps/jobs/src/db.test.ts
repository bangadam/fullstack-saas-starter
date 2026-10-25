import { describe, expect, it } from 'vitest'
import { fixture } from './test-db'

const event = {
  provider: 'polar' as const,
  environment: 'sandbox' as const,
  externalEventId: 'evt-1',
  type: 'subscription.updated',
  userId: 'user-1',
  subscription: {
    externalSubscriptionId: 'sub-1',
    externalCustomerId: 'cus-1',
    status: 'active' as const,
    plan: 'pro' as const,
    interval: 'monthly' as const,
    currentPeriodEnd: new Date(2_000_000_000_000),
    cancelAtPeriodEnd: false,
  },
}
describe('D1 recovery SQL', () => {
  it('claims only one concurrent sender, counts once, fences stale completion and reclaims crashed lease', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec(
      `INSERT INTO email_outbox(id,"to",subject,template_id,payload_json,created_at) VALUES('e','a@example.test','s','welcome','{}',1)`,
    )
    const claims = await Promise.all([db.claimEmail('e', 'a', 100), db.claimEmail('e', 'b', 100)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims[0]?.attempts).toBe(1)
    expect(await db.claimEmail('e', 'c', 219)).toBeNull()
    expect((await db.claimEmail('e', 'c', 221))?.attempts).toBe(2)
    await db.finishEmail('e', 'a', 222)
    expect(sqlite.prepare('SELECT status FROM email_outbox').get()?.status).toBe('pending')
    await db.finishEmail('e', 'c', 223)
    expect(await db.claimEmail('e', 'd', 500)).toBeNull()
  })
  it('persists retry deadline and does not count a failed send twice', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec(
      `INSERT INTO email_outbox(id,"to",subject,template_id,payload_json,created_at) VALUES('e','a@example.test','s','welcome','{}',1)`,
    )
    await db.claimEmail('e', 'a', 100)
    await db.failEmail('e', 'a', 'network', false, 160)
    expect(await db.claimEmail('e', 'b', 159)).toBeNull()
    expect((await db.claimEmail('e', 'b', 160))?.attempts).toBe(2)
    expect((await db.recoveryCandidates(300, 50)).emails).toHaveLength(1)
  })
  it('scopes billing ids and atomically marks processing with the subscription write', async () => {
    const { sqlite, db } = fixture()
    const insert = sqlite.prepare(
      'INSERT INTO billing_events(id,provider,environment,external_event_id,type,payload_json,created_at) VALUES(?,?,?,?,?,?,1)',
    )
    insert.run('sandbox', 'polar', 'sandbox', 'evt-1', event.type, JSON.stringify(event))
    insert.run(
      'production',
      'polar',
      'production',
      'evt-1',
      event.type,
      JSON.stringify({ ...event, environment: 'production' }),
    )
    expect((await db.claimBilling(event, 'a', 100))?.id).toBe('sandbox')
    expect(await db.claimBilling(event, 'b', 100)).toBeNull()
    await db.applyBilling('sandbox', 'wrong-token', event, 101)
    expect(sqlite.prepare('SELECT count(*) AS n FROM subscriptions').get()?.n).toBe(0)
    await db.applyBilling('sandbox', 'a', event, 102)
    expect(
      sqlite.prepare('SELECT current_period_end FROM subscriptions').get()?.current_period_end,
    ).toBe(2_000_000_000)
    expect(
      sqlite.prepare("SELECT processed_at FROM billing_events WHERE id='production'").get()
        ?.processed_at,
    ).toBeNull()
    expect(await db.claimBilling(event, 'c', 500)).toBeNull()
  })
  it('rolls back event processing when subscription cannot be applied', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec('PRAGMA foreign_keys=ON')
    sqlite
      .prepare(
        'INSERT INTO billing_events(id,provider,environment,external_event_id,type,payload_json,created_at) VALUES(?,?,?,?,?,?,1)',
      )
      .run('b', 'polar', 'sandbox', 'evt-1', event.type, JSON.stringify(event))
    await db.claimBilling(event, 'a', 100)
    await expect(db.applyBilling('b', 'a', { ...event, userId: 'missing' }, 101)).rejects.toThrow()
    expect(sqlite.prepare('SELECT processed_at FROM billing_events').get()?.processed_at).toBeNull()
  })
  it('provides aggregate health counts without sensitive columns', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec(
      `INSERT INTO email_outbox(id,"to",subject,template_id,payload_json,created_at) VALUES('e','SECRET','TOKEN','welcome','BODY',100)`,
    )
    const health = await db.health(200)
    expect(health.emailPending).toBe(1)
    expect(health.emailLagSeconds).toBe(100)
    expect(JSON.stringify(health)).not.toMatch(/SECRET|TOKEN|BODY/)
  })
})
