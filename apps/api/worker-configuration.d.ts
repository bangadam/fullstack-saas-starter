// Hand-written to match wrangler.jsonc. Rerun `pnpm --filter @saas/api types`
// (wrangler types) after changing bindings to regenerate.
export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  EMAIL_QUEUE: Queue<{ type: string; payload: Record<string, unknown> }>
  BILLING_QUEUE: Queue<Record<string, unknown>>
  APP_URL: string
  // Comma-separated extra origins allowed to perform cookie-authenticated
  // writes (e.g. a staging hostname alongside APP_URL).
  EXTRA_ALLOWED_ORIGINS?: string
  // Rate limit overrides as "limit/windowSeconds". Unset = strict defaults.
  RATE_LIMIT_AUTH_STRICT?: string
  RATE_LIMIT_WRITE?: string
  RATE_LIMIT_WEBHOOKS?: string
  BILLING_PROVIDER: 'polar' | 'stripe' | 'none'
  POLAR_ENVIRONMENT: 'sandbox' | 'production'
  ENVIRONMENT: string
  // Secrets (set via wrangler secret / .dev.vars)
  BETTER_AUTH_SECRET: string
  /** @deprecated auth links derive from APP_URL; kept for deploy compatibility */
  BETTER_AUTH_URL?: string
  // Turnstile server-side verification. Absent secret = verification disabled
  // (local dev only); requests are never silently trusted in production.
  TURNSTILE_SECRET_KEY?: string
  TURNSTILE_SITE_KEY?: string
  R2_BUCKET_NAME?: string
  // 'true' requires a verified email before sign-in succeeds.
  REQUIRE_EMAIL_VERIFICATION?: string
  POLAR_ACCESS_TOKEN?: string
  POLAR_WEBHOOK_SECRET?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  // R2 S3 credentials for presigned URLs (secret)
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  CLOUDFLARE_ACCOUNT_ID?: string
}
