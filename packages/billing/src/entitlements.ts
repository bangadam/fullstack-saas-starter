import type { BillingPlan } from '@saas/contracts'

export interface PlanEntitlements {
  maxProjects: number | null
  maxStorageBytes: number
}

const GB = 1024 ** 3

export const PLAN_ENTITLEMENTS: Record<BillingPlan, PlanEntitlements> = {
  free: { maxProjects: 3, maxStorageBytes: 100 * 1024 * 1024 },
  pro: { maxProjects: null, maxStorageBytes: 10 * GB },
}

export class EntitlementError extends Error {
  constructor(
    message: string,
    readonly feature: keyof PlanEntitlements,
    readonly plan: BillingPlan,
  ) {
    super(message)
    this.name = 'EntitlementError'
  }
}

export function getEntitlements(plan: BillingPlan): PlanEntitlements {
  return PLAN_ENTITLEMENTS[plan]
}

/** Throws a typed EntitlementError when the plan does not cover the usage. */
export function requireEntitlement(
  plan: BillingPlan,
  feature: keyof PlanEntitlements,
  currentUsage: number,
  requestedDelta = 1,
): void {
  const limits = PLAN_ENTITLEMENTS[plan]
  const limit = limits[feature]
  if (typeof limit !== 'number') return
  if (limit === 0) {
    throw new EntitlementError(`Feature ${feature} is not available on plan ${plan}`, feature, plan)
  }
  if (currentUsage + requestedDelta > limit) {
    throw new EntitlementError(
      `Plan ${plan} limit of ${limit} for ${feature} exceeded (current ${currentUsage}, requested ${requestedDelta})`,
      feature,
      plan,
    )
  }
}
