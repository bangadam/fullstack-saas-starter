import type { SubscriptionStatus } from '@saas/contracts'

/** Polar raw subscription statuses -> internal enum. */
export function normalizePolarStatus(raw: string): SubscriptionStatus {
  switch (raw) {
    case 'active':
      return 'active'
    case 'canceled': {
      // Polar keeps status 'active' while canceled_at_period_end is true; raw
      // 'canceled' means the period already ended.
      return 'canceled'
    }
    case 'past_due':
      return 'past_due'
    case 'trialing':
      return 'trialing'
    case 'incomplete':
    case 'incomplete_expired':
      return 'incomplete'
    case 'unpaid':
      return 'past_due'
    default:
      return 'incomplete'
  }
}

/** Stripe raw subscription statuses -> internal enum. */
export function normalizeStripeStatus(raw: string): SubscriptionStatus {
  switch (raw) {
    case 'active':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
      return 'canceled'
    case 'trialing':
      return 'trialing'
    case 'incomplete':
    case 'incomplete_expired':
      return 'incomplete'
    default:
      return 'incomplete'
  }
}
