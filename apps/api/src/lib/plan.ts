import { getEntitlements } from '@saas/billing'
import type { BillingPlan } from '@saas/contracts'
import { type Db, subscriptions } from '@saas/db'
import { and, desc, eq } from 'drizzle-orm'
import type { BillingScope } from './billing'

/** Active/trialing access ends at the recorded expiry, including scheduled cancellation. */
export function resolvePlan(
  row: { plan: BillingPlan; status: string; currentPeriodEnd?: Date | null } | null | undefined,
  now = new Date(),
): BillingPlan {
  if (!row || row.plan !== 'pro' || !['active', 'trialing'].includes(row.status)) return 'free'
  if (row.currentPeriodEnd && !(row.currentPeriodEnd.getTime() > now.getTime())) return 'free'
  return 'pro'
}

/** Explicit null scope disables paid access. Omission is legacy/demo compatibility only. */
export async function currentSubscription(db: Db, userId: string, scope?: BillingScope | null) {
  if (scope === null) return undefined
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        scope ? eq(subscriptions.provider, scope.provider) : undefined,
        scope ? eq(subscriptions.environment, scope.environment) : undefined,
      ),
    )
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
    .limit(1)
    .get()
}
export async function maxProjectsForUser(
  db: Db,
  userId: string,
  scope?: BillingScope | null,
): Promise<number | null> {
  return getEntitlements(resolvePlan(await currentSubscription(db, userId, scope))).maxProjects
}
export async function storageLimitForUser(
  db: Db,
  userId: string,
  scope?: BillingScope | null,
): Promise<number> {
  return getEntitlements(resolvePlan(await currentSubscription(db, userId, scope))).maxStorageBytes
}
