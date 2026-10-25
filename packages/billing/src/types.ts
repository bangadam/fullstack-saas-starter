import type {
  BillingInterval,
  BillingPlan,
  CreateCheckoutInput,
  SubscriptionStatus,
} from '@saas/contracts'

export interface SubscriptionRecord {
  userId: string
  provider: 'polar' | 'stripe'
  environment: 'sandbox' | 'production'
  status: SubscriptionStatus
  plan: BillingPlan
  interval: BillingInterval
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export interface NormalizedWebhookEvent {
  provider: 'polar' | 'stripe'
  environment: 'sandbox' | 'production'
  externalEventId: string
  type: string
  userId?: string
  subscription?: {
    externalSubscriptionId: string
    externalCustomerId: string
    status: SubscriptionStatus
    plan: BillingPlan
    interval: BillingInterval
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
  }
}

export interface BillingCore {
  createCheckout(input: CreateCheckoutInput): Promise<{ url: string }>
  createCustomerPortal(input: { userId: string }): Promise<{ url: string }>
  getSubscription(userId: string): Promise<SubscriptionRecord | null>
  verifyAndNormalizeWebhook(
    provider: 'polar' | 'stripe',
    headers: Record<string, string>,
    rawBody: ArrayBuffer,
  ): Promise<NormalizedWebhookEvent>
}
