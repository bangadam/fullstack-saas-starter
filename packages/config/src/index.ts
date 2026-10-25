import { z } from 'zod'

/** Secret keys whose values must never be logged or serialized. */
const SECRET_KEYS = [
  'BETTER_AUTH_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
] as const

const requiredString = (key: string) =>
  z
    .string()
    .min(1, `${key} is required`)
    .transform((v) => v.trim())

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))

export const d1BindingSchema = z.object({
  DB: requiredString('DB'),
})
export type D1BindingConfig = z.infer<typeof d1BindingSchema>

export const r2BindingSchema = z.object({
  BUCKET: requiredString('BUCKET'),
})
export type R2BindingConfig = z.infer<typeof r2BindingSchema>

export const queueBindingsSchema = z.object({
  QUEUE: optionalString,
  QUEUE_CONSUMER: optionalString,
})
export type QueueBindingsConfig = z.infer<typeof queueBindingsSchema>

export const polarEnvSchema = z.object({
  POLAR_ACCESS_TOKEN: requiredString('POLAR_ACCESS_TOKEN'),
  POLAR_WEBHOOK_SECRET: requiredString('POLAR_WEBHOOK_SECRET'),
  POLAR_ORGANIZATION_ID: requiredString('POLAR_ORGANIZATION_ID'),
  POLAR_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
})
export type PolarEnv = z.infer<typeof polarEnvSchema>

export const stripeEnvSchema = z.object({
  STRIPE_SECRET_KEY: requiredString('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: requiredString('STRIPE_WEBHOOK_SECRET'),
})
export type StripeEnv = z.infer<typeof stripeEnvSchema>

export const authSecretsSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 chars'),
  BETTER_AUTH_URL: z.string().url(),
})
export type AuthSecrets = z.infer<typeof authSecretsSchema>

export const googleOAuthEnvSchema = z.object({
  GOOGLE_CLIENT_ID: requiredString('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: requiredString('GOOGLE_CLIENT_SECRET'),
})
export type GoogleOAuthEnv = z.infer<typeof googleOAuthEnvSchema>

export const resendEnvSchema = z.object({
  RESEND_API_KEY: requiredString('RESEND_API_KEY'),
  EMAIL_FROM: z.string().email(),
})
export type ResendEnv = z.infer<typeof resendEnvSchema>

export const appUrlSchema = z.object({
  APP_URL: z.string().url(),
})
export type AppUrlConfig = z.infer<typeof appUrlSchema>

/**
 * Sensitive keys recognized by redactSecrets. Values for these keys are
 * replaced with a fixed placeholder before any error/report output.
 */
export const SECRET_KEY_NAMES: readonly string[] = SECRET_KEYS

export function redactSecrets(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) {
    out[k] = SECRET_KEY_NAMES.includes(k) ? '[REDACTED]' : v
  }
  return out
}

export type EnvSource = Record<string, string | undefined>

export class EnvParseError extends Error {
  readonly issues: z.ZodIssue[]
  constructor(issues: z.ZodIssue[]) {
    super(EnvParseError.format(issues))
    this.name = 'EnvParseError'
    this.issues = issues
  }

  static format(issues: z.ZodIssue[]): string {
    const lines = issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '(root)'
      // issue messages may embed the offending value; strip anything after a
      // colon that looks like a value echo for secret keys.
      const msg = SECRET_KEY_NAMES.includes(String(i.path[0] ?? ''))
        ? i.message.split(':')[0]
        : i.message
      return `  - ${path}: ${msg}`
    })
    return `Invalid environment configuration (${issues.length} issue(s)):\n${lines.join('\n')}`
  }
}

/**
 * Parse an env source against a schema. Throws EnvParseError listing every
 * missing/invalid key at once. Secret values are never included.
 */
export function parseEnv<S extends z.ZodTypeAny>(schema: S, source: EnvSource): z.infer<S> {
  const result = schema.safeParse(source)
  if (result.success) return result.data
  throw new EnvParseError(result.error.issues)
}
