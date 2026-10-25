import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EnvParseError, parseEnv, polarEnvSchema, redactSecrets } from './index'

describe('parseEnv aggregate error', () => {
  it('lists all missing keys in one error', () => {
    const schema = z.object({
      A: z.string().min(1),
      B: z.string().min(1),
      C: z.string().min(1),
    })
    try {
      parseEnv(schema, {})
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(EnvParseError)
      const err = e as EnvParseError
      expect(err.issues).toHaveLength(3)
      expect(err.message).toContain('A')
      expect(err.message).toContain('B')
      expect(err.message).toContain('C')
    }
  })

  it('succeeds with a valid full polar env', () => {
    const env = parseEnv(polarEnvSchema, {
      POLAR_ACCESS_TOKEN: 'token',
      POLAR_WEBHOOK_SECRET: 'whsec',
      POLAR_ORGANIZATION_ID: 'org',
    })
    expect(env.POLAR_ENVIRONMENT).toBe('sandbox')
  })
})

describe('redactSecrets', () => {
  it('redacts known secret keys and keeps others', () => {
    const out = redactSecrets({
      POLAR_ACCESS_TOKEN: 'sk_live_secret',
      STRIPE_SECRET_KEY: 'whsec_secret',
      APP_URL: 'https://example.com',
    })
    expect(out.POLAR_ACCESS_TOKEN).toBe('[REDACTED]')
    expect(out.STRIPE_SECRET_KEY).toBe('[REDACTED]')
    expect(out.APP_URL).toBe('https://example.com')
  })

  it('never leaks secret values in EnvParseError message', () => {
    try {
      parseEnv(polarEnvSchema, { POLAR_ACCESS_TOKEN: 'short' })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain('sk_')
    }
  })
})
