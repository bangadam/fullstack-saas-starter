import type { BillingPlan, SubscriptionResponse } from '@saas/contracts'
import { ApiError } from './api-client'

export const billingQueryKey = ['billing', 'subscription'] as const
export function billingReturnUrl(origin: string) {
  return new URL('/dashboard/settings/billing', origin).href
}
export function formatBillingBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3)
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${['B', 'KB', 'MB', 'GB'][index]}`
}
export const billingStatusLabels = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Payment overdue',
  canceled: 'Canceled',
  incomplete: 'Payment incomplete',
} as const
export function billingAccessMessage(
  subscription: SubscriptionResponse['subscription'],
  plan: BillingPlan,
) {
  if (!subscription) return 'No paid subscription is linked to this account.'
  if (plan === 'free')
    return 'Paid access is not active. Free plan limits apply. Refresh the subscription if you recently made a payment.'
  const date = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null
  if (subscription.cancelAtPeriodEnd)
    return date
      ? `Cancellation scheduled. Paid access ends on ${date} (UTC).`
      : 'Cancellation scheduled. The provider has not supplied an access end date.'
  if (subscription.status === 'trialing')
    return date ? `Your trial ends on ${date} (UTC).` : 'Your trial is active.'
  return date
    ? `Your subscription renews on ${date} (UTC).`
    : 'Your subscription is active. The next renewal date is not available.'
}
export function billingErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return 'Billing state changed or an unresolved checkout is blocking this action. Refresh your subscription, or contact support to resolve it.'
    if (error.status === 401) return 'Your session expired. Sign in again to manage billing.'
    if (error.status === 429) return 'Too many requests. Please wait a moment and try again.'
    if (error.status === 503) return 'Billing is not configured for this action. Contact support.'
    return 'The billing provider could not complete this request. Try again later.'
  }
  return 'Could not reach billing. Check your connection and try again.'
}
