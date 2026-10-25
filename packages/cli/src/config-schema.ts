import { z } from 'zod'

export const SAAS_CONFIG_SCHEMA_VERSION = 1

export const billingProviderConfigSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('polar'),
    environment: z.enum(['sandbox', 'production']).default('sandbox'),
  }),
  z.object({
    provider: z.literal('stripe'),
    environment: z.enum(['sandbox', 'production']).default('sandbox'),
  }),
  z.object({
    provider: z.literal('none'),
  }),
])

export const saasConfigSchema = z.object({
  schemaVersion: z.literal(1),
  projectName: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase alphanumeric and dashes'),
  preset: z.enum(['local', 'cloudflare']),
  billing: billingProviderConfigSchema,
  appUrl: z.string().url().default('http://localhost:3000'),
})

export type SaasConfig = z.infer<typeof saasConfigSchema>
export type BillingProviderConfig = z.infer<typeof billingProviderConfigSchema>

export const ENV_LOCAL_FILENAME = '.env.local'
export const CONFIG_FILENAME = 'saas.config.ts'

/** Secrets never live in saas.config.ts — they go to .env.local (gitignored). */
export function envLocalTemplate(secret: string): string {
  return [
    '# Local secrets — never commit this file.',
    `BETTER_AUTH_SECRET=${secret}`,
    '# Fill in the provider credentials you intend to use:',
    '# POLAR_ACCESS_TOKEN=',
    '# POLAR_WEBHOOK_SECRET=',
    '# POLAR_ORGANIZATION_ID=',
    '# STRIPE_SECRET_KEY=',
    '# STRIPE_WEBHOOK_SECRET=',
    '# Provider catalog IDs for the active billing provider:',
    '# PRO_MONTHLY=',
    '# PRO_YEARLY=',
    '# TURNSTILE_SITE_KEY=',
    '# TURNSTILE_SECRET_KEY=',
    '# GOOGLE_CLIENT_ID=',
    '# GOOGLE_CLIENT_SECRET=',
    '# RESEND_API_KEY=',
    '# EMAIL_FROM=',
    '',
  ].join('\n')
}
