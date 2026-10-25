import { z } from 'zod'

export const billingPlanSchema = z.enum(['free', 'pro'])
export const billingIntervalSchema = z.enum(['monthly', 'yearly'])
export const subscriptionStatusSchema = z.enum([
  'active',
  'past_due',
  'canceled',
  'trialing',
  'incomplete',
])
export const billingProviderSchema = z.enum(['polar', 'stripe'])
export const billingEnvironmentSchema = z.enum(['sandbox', 'production'])

export type BillingPlan = z.infer<typeof billingPlanSchema>
export type BillingInterval = z.infer<typeof billingIntervalSchema>
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>

export const createCheckoutSchema = z.object({
  plan: billingPlanSchema.exclude(['free']),
  interval: billingIntervalSchema,
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
})

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>

export const createPortalSchema = z.object({ returnUrl: z.string().url().optional() })
export type CreatePortalInput = z.infer<typeof createPortalSchema>
export const billingRedirectSchema = z.object({ url: z.string().url() })
export const subscriptionResponseSchema = z.object({
  plan: billingPlanSchema,
  status: subscriptionStatusSchema,
  subscription: z
    .object({
      id: z.string(),
      provider: billingProviderSchema,
      environment: billingEnvironmentSchema,
      status: subscriptionStatusSchema,
      plan: billingPlanSchema,
      interval: billingIntervalSchema,
      currentPeriodEnd: z.string().datetime().nullable(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullable(),
  usage: z.object({
    projects: z.number().int().nonnegative(),
    storageBytes: z.number().nonnegative(),
  }),
  limits: z.object({
    maxProjects: z.number().int().nonnegative().nullable(),
    maxStorageBytes: z.number().nonnegative(),
  }),
  portalAvailable: z.boolean(),
  checkoutAvailable: z.boolean(),
  refreshAvailable: z.boolean(),
})
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>
