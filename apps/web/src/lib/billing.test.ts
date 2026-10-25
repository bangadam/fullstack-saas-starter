import type { SubscriptionResponse } from '@saas/contracts'
import { describe, expect, it } from 'vitest'
import { ApiError } from './api-client'
import {
  billingAccessMessage,
  billingErrorMessage,
  billingReturnUrl,
  formatBillingBytes,
} from './billing'
const subscription: NonNullable<SubscriptionResponse['subscription']> = {
  id: '1',
  provider: 'polar',
  environment: 'sandbox',
  status: 'active',
  plan: 'pro',
  interval: 'monthly',
  currentPeriodEnd: '2030-01-01T00:00:00.000Z',
  cancelAtPeriodEnd: true,
}
describe('billing display helpers', () => {
  it('explains scheduled cancellation without claiming immediate loss of access', () => {
    expect(billingAccessMessage(subscription, 'pro')).toContain('ends on')
    expect(billingAccessMessage({ ...subscription, cancelAtPeriodEnd: false }, 'pro')).toContain(
      'renews on',
    )
    expect(billingAccessMessage({ ...subscription, status: 'canceled' }, 'free')).toContain(
      'Free plan limits apply',
    )
    expect(billingAccessMessage(null, 'free')).toContain('No paid subscription')
  })
  it('does not claim active access when the effective plan is free', () => {
    expect(billingAccessMessage(subscription, 'free')).toContain('Free plan limits apply')
  })
  it('formats byte counts and canonical return URL', () => {
    expect(formatBillingBytes(0)).toBe('0 B')
    expect(formatBillingBytes(1024 ** 3)).toBe('1 GB')
    expect(billingReturnUrl('https://app.example')).toBe(
      'https://app.example/dashboard/settings/billing',
    )
  })
  it('provides actionable errors without mislabeling every failure unconfigured', () => {
    expect(billingErrorMessage(new ApiError('failure', 409))).toContain('support')
    expect(billingErrorMessage(new ApiError('failure', 429))).toContain('wait')
    expect(billingErrorMessage(new Error('offline'))).toContain('connection')
  })
})
