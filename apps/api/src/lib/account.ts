import { accountExportSchema } from '@saas/contracts'
import { type Db, auditLogs, files, projects, subscriptions, users } from '@saas/db'
import { APIError } from 'better-auth/api'
import { and, eq, sql } from 'drizzle-orm'

export const ACCOUNT_UPLOAD_DRAIN_MS = 4_200_000
export interface AccountDeletionStore {
  user(userId: string): Promise<{ id: string; deletionRequestedAt: Date | null } | undefined>
  subscriptions(userId: string): Promise<Array<{ userId: string; status: string }>>
  files(userId: string): Promise<Array<{ userId: string; r2Key: string; expiresAt: Date | null }>>
  billingSafe(userId: string): Promise<boolean>
}
type CleanupBucket = { delete(key: string): Promise<unknown>; head(key: string): Promise<unknown> }
function blocked(message: string): never {
  throw new APIError('CONFLICT', { message })
}

export async function accountDeletionBarrier(
  userId: string,
  store: AccountDeletionStore,
  bucket: CleanupBucket,
  now = new Date(),
) {
  const user = await store.user(userId)
  if (!user || user.id !== userId) blocked('Account ownership could not be verified.')
  if (!user.deletionRequestedAt) blocked('Prepare account deletion in Settings first.')
  const plans = await store.subscriptions(userId)
  if (plans.some((plan) => plan.userId !== userId || plan.status !== 'canceled')) {
    blocked(
      'Resolve all billing subscriptions in the billing portal before deleting your account. Cancellation must have taken effect.',
    )
  }
  if (!(await store.billingSafe(userId)))
    blocked(
      'A checkout may still complete. Contact support to reconcile pending checkout attempts before deletion.',
    )
  const objects = await store.files(userId)
  if (objects.some((file) => file.userId !== userId))
    blocked('File ownership could not be verified.')
  const retryAt = Math.max(
    user.deletionRequestedAt.getTime() + ACCOUNT_UPLOAD_DRAIN_MS,
    ...objects.map((file) => file.expiresAt?.getTime() ?? 0),
  )
  if (now.getTime() < retryAt)
    blocked(
      `Wait until ${new Date(retryAt).toISOString()} for uploads to finish safely, then retry deletion.`,
    )
  try {
    // Do not delete metadata: on failure the next attempt still knows every R2 key.
    for (const file of objects) {
      await bucket.delete(file.r2Key)
      if (await bucket.head(file.r2Key)) throw new Error('Object remains')
    }
  } catch {
    blocked(
      'File cleanup could not be completed. Your account has not been deleted; uploads remain paused. Retry later or contact support.',
    )
  }
  // Catch subscription state changes during a slow cleanup. Checkout intents
  // cannot be created once the durable marker is set (conditional SQL insert).
  if (
    (await store.subscriptions(userId)).some(
      (plan) => plan.userId !== userId || plan.status !== 'canceled',
    ) ||
    !(await store.billingSafe(userId))
  ) {
    blocked(
      'Billing changed during cleanup. Your account was not deleted. Contact support to reconcile billing.',
    )
  }
}

export function createAccountDeletionGuard(options: {
  db: Db
  bucket: CleanupBucket
  billingSafe?: (userId: string) => Promise<boolean>
}) {
  const { db, bucket } = options
  return {
    beforeDelete: (userId: string) =>
      accountDeletionBarrier(
        userId,
        {
          user: async (id) =>
            (
              await db
                .select({ id: users.id, deletionRequestedAt: users.deletionRequestedAt })
                .from(users)
                .where(eq(users.id, id))
                .limit(1)
            )[0],
          subscriptions: (id) =>
            db
              .select({ userId: subscriptions.userId, status: subscriptions.status })
              .from(subscriptions)
              .where(eq(subscriptions.userId, id)),
          files: (id) =>
            db
              .select({ userId: files.userId, r2Key: files.r2Key, expiresAt: files.expiresAt })
              .from(files)
              .where(eq(files.userId, id)),
          billingSafe: options.billingSafe ?? (async () => false),
        },
        bucket,
      ),
  }
}

export async function accountDeletionState(db: Db, userId: string) {
  const [user] = await db
    .select({ at: users.deletionRequestedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const [latest] = await db
    .select({ at: sql<number | null>`max(${files.expiresAt})` })
    .from(files)
    .where(eq(files.userId, userId))
  return {
    preparedAt: user?.at?.toISOString() ?? null,
    retryAfter: user?.at
      ? new Date(
          Math.max(user.at.getTime() + ACCOUNT_UPLOAD_DRAIN_MS, (latest?.at ?? 0) * 1000),
        ).toISOString()
      : null,
  }
}

export async function prepareAccountDeletion(db: Db, userId: string) {
  // Atomic with checkout intent creation and storage reservation. The billing
  // table is installed by migration0005; absent table -> fail closed.
  const rows = await db
    .update(users)
    .set({ deletionRequestedAt: sql`coalesce(${users.deletionRequestedAt}, unixepoch())` })
    .where(
      and(
        eq(users.id, userId),
        sql`not exists (select 1 from subscriptions where user_id = ${userId} and status != 'canceled')`,
        sql`not exists (select 1 from billing_checkout_intents where user_id = ${userId})`,
      ),
    )
    .returning({ id: users.id })
  if (!rows.length)
    blocked(
      'Resolve billing subscriptions and pending checkout attempts before preparing deletion. Contact support if a checkout needs reconciliation.',
    )
  return accountDeletionState(db, userId)
}

export async function exportAccountData(db: Db, userId: string) {
  // SQL column allowlists prevent loading credential/token and internal fields.
  const [userRows, projectRows, fileRows, planRows, auditRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId)),
    db
      .select({
        id: projects.id,
        userId: projects.userId,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        deletedAt: projects.deletedAt,
      })
      .from(projects)
      .where(eq(projects.userId, userId)),
    db
      .select({
        id: files.id,
        userId: files.userId,
        name: files.name,
        size: files.size,
        contentType: files.contentType,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(eq(files.userId, userId)),
    db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        provider: subscriptions.provider,
        environment: subscriptions.environment,
        status: subscriptions.status,
        plan: subscriptions.plan,
        interval: subscriptions.interval,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId)),
    db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId)),
  ])
  return accountExportSchema.parse(
    JSON.parse(
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        user: userRows[0],
        projects: projectRows,
        files: fileRows,
        subscriptions: planRows,
        audit: auditRows,
      }),
    ),
  )
}
