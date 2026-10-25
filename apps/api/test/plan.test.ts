import { describe, expect, it } from 'vitest'
import { resolvePlan } from '../src/lib/plan'

describe('resolvePlan', () => {
  it('expires paid access at the exact current period boundary', () => {
    const end = new Date('2030-01-01T00:00:00Z')
    expect(resolvePlan({ plan: 'pro', status: 'active', currentPeriodEnd: end }, end)).toBe('free')
    expect(
      resolvePlan(
        { plan: 'pro', status: 'active', currentPeriodEnd: end },
        new Date(end.getTime() - 1),
      ),
    ).toBe('pro')
    expect(
      resolvePlan({ plan: 'pro', status: 'trialing', currentPeriodEnd: new Date('invalid') }),
    ).toBe('free')
  })
  it('defaults users without a subscription row to free', () => {
    expect(resolvePlan(null)).toBe('free')
    expect(resolvePlan(undefined)).toBe('free')
  })

  it('grants pro only for active or trialing subscriptions', () => {
    expect(resolvePlan({ plan: 'pro', status: 'active' })).toBe('pro')
    expect(resolvePlan({ plan: 'pro', status: 'trialing' })).toBe('pro')
  })

  it('falls back to free for lapsed or incomplete subscriptions', () => {
    for (const status of ['past_due', 'canceled', 'incomplete']) {
      expect(resolvePlan({ plan: 'pro', status })).toBe('free')
    }
  })

  it('never upgrades a free row regardless of status', () => {
    expect(resolvePlan({ plan: 'free', status: 'active' })).toBe('free')
  })
})
