/**
 * Drizzle SQLite schema for Cloudflare D1.
 *
 * B2C single-user model: every table is scoped by user_id, there are no
 * organizations/memberships/invitations.
 *
 * IMPORTANT — D1 has no interactive transactions. Drizzle's `db.transaction()`
 * is NOT supported on D1. Any write that must be atomic (quota enforcement,
 * outbox pattern) must be issued as a single D1 batch via `db.batch([...])`
 * — D1 batch executes statements sequentially inside one atomic transaction,
 * and a failure rolls back the whole batch.
 *
 * Better Auth compatible core tables (users, sessions, accounts, verifications)
 * use the documented snake_case column names and text ids. Timestamps are
 * integer unix seconds.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  // Durable upload/checkout freeze; operator reconciliation is required to undo it.
  deletionRequestedAt: integer('deletion_requested_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  // Better Auth's newer Drizzle adapter expects an id_token column on accounts.
  idToken: text('id_token'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_user_idx').on(t.userId)],
)

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull().unique(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    contentType: text('content_type').notNull(),
    status: text('status', { enum: ['pending', 'completed', 'expired', 'deleting'] })
      .notNull()
      .default('pending'),
    uploadExpiresAt: integer('upload_expires_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('files_user_idx').on(t.userId),
    index('files_lifecycle_idx').on(t.status, t.expiresAt),
  ],
)

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['polar', 'stripe'] }).notNull(),
    environment: text('environment', { enum: ['sandbox', 'production'] }).notNull(),
    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id').notNull(),
    status: text('status', {
      enum: ['active', 'past_due', 'canceled', 'trialing', 'incomplete'],
    }).notNull(),
    plan: text('plan', { enum: ['free', 'pro'] }).notNull(),
    interval: text('interval', { enum: ['monthly', 'yearly'] }).notNull(),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp' }),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscriptions_provider_env_external_unique').on(
      t.provider,
      t.environment,
      t.externalSubscriptionId,
    ),
    index('subscriptions_user_idx').on(t.userId),
  ],
)

/** Unresolved external checkout attempts block account deletion until operator reconciliation. */
export const billingCheckoutIntents = sqliteTable(
  'billing_checkout_intents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('billing_checkout_intents_user_unique').on(t.userId)],
)

export const billingEvents = sqliteTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider', { enum: ['polar', 'stripe'] }).notNull(),
    environment: text('environment', { enum: ['sandbox', 'production'] }).notNull(),
    externalEventId: text('external_event_id').notNull(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: text('lease_token'),
    leaseUntil: integer('lease_until', { mode: 'timestamp' }),
    nextAttemptAt: integer('next_attempt_at').notNull().default(0),
    failedAt: integer('failed_at', { mode: 'timestamp' }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('billing_events_recovery_idx').on(
      t.processedAt,
      t.failedAt,
      t.nextAttemptAt,
      t.leaseUntil,
    ),
    uniqueIndex('billing_events_provider_env_external_unique').on(
      t.provider,
      t.environment,
      t.externalEventId,
    ),
  ],
)

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadataJson: text('metadata_json'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_user_idx').on(t.userId, t.createdAt)],
)

export const emailOutbox = sqliteTable(
  'email_outbox',
  {
    id: text('id').primaryKey(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    templateId: text('template_id').notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    leaseToken: text('lease_token'),
    leaseUntil: integer('lease_until', { mode: 'timestamp' }),
    firstAttemptAt: integer('first_attempt_at', { mode: 'timestamp' }),
    nextAttemptAt: integer('next_attempt_at').notNull().default(0),
    createdAt: createdAt(),
    sentAt: integer('sent_at', { mode: 'timestamp' }),
  },
  (t) => [index('email_outbox_recovery_idx').on(t.status, t.nextAttemptAt, t.leaseUntil)],
)

/** Operational cursor only; no tenant content or object keys. */
export const recoveryCursors = sqliteTable('recovery_cursors', {
  name: text('name').primaryKey(),
  cursor: text('cursor').notNull().default(''),
})

/**
 * Fixed-window rate limit counters (one row per bucket+client per window).
 * Kept in D1 so the limit holds across Worker isolates; the row is updated
 * with a single conditional upsert (see drizzle-rate-limit in apps/api).
 */
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [index('rate_limits_window_idx').on(t.windowStart)],
)
