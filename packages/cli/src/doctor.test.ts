import { describe, expect, it } from 'vitest'
import { saasConfigSchema } from './config-schema'
import { type CheckResult, exitCodeFor, runChecks } from './doctor'

describe('doctor exit codes', () => {
  const ready: CheckResult = { name: 'a', status: 'ready', detail: '' }
  const pending: CheckResult = { name: 'b', status: 'pending', detail: '' }
  const failed: CheckResult = { name: 'c', status: 'failed', detail: '' }

  it('maps result mixes to exit codes 0/1/2', () => {
    expect(exitCodeFor([ready, ready])).toBe(0)
    expect(exitCodeFor([ready, pending])).toBe(1)
    expect(exitCodeFor([pending, ready])).toBe(1)
    expect(exitCodeFor([failed])).toBe(2)
    expect(exitCodeFor([ready, pending, failed])).toBe(2)
  })
})

describe('runChecks', () => {
  it('reports failed node when under 22 and pending billing keys', () => {
    const results = runChecks({
      nodeVersion: '20.1.0',
      pnpmVersion: '12.14.0',
      configValid: true,
      envKeys: { BILLING_PROVIDER: 'polar' },
    })
    expect(results.find((r) => r.name === 'node')?.status).toBe('failed')
    expect(results.find((r) => r.name === 'billing')?.status).toBe('pending')
  })

  it('never includes secret values in details', () => {
    const results = runChecks({
      nodeVersion: '22.0.0',
      pnpmVersion: '12.14.0',
      configValid: true,
      envKeys: {
        BILLING_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_live_supersecret',
        BETTER_AUTH_SECRET: 'x'.repeat(40),
      },
    })
    const text = JSON.stringify(results)
    expect(text).not.toContain('sk_live_supersecret')
    expect(text).not.toContain('x'.repeat(40))
  })

  it('treats a missing config as pending, not failed (fresh clone)', () => {
    const results = runChecks({
      nodeVersion: '22.0.0',
      pnpmVersion: '12.14.0',
      configValid: false,
      configError: 'saas.config.ts not found — run `saas setup`',
      envKeys: {},
    })
    const config = results.find((r) => r.name === 'config')
    expect(config?.status).toBe('pending')
    expect(config?.remediation).toContain('saas setup')
  })

  it('reports pending dev-vars with the missing apps listed', () => {
    const results = runChecks({
      nodeVersion: '22.0.0',
      pnpmVersion: '12.14.0',
      configValid: true,
      envKeys: {},
      devVars: { web: false, api: true, jobs: true },
    })
    const devVars = results.find((r) => r.name === 'dev-vars')
    expect(devVars?.status).toBe('pending')
    expect(devVars?.detail).toContain('web')
    expect(devVars?.remediation).toContain('bootstrap')
  })

  it('reports ready dev-vars and a migrated local database', () => {
    const results = runChecks({
      nodeVersion: '22.0.0',
      pnpmVersion: '12.14.0',
      configValid: true,
      envKeys: {},
      devVars: { web: true, api: true, jobs: true },
      d1Migrated: true,
    })
    expect(results.find((r) => r.name === 'dev-vars')?.status).toBe('ready')
    expect(results.find((r) => r.name === 'local-db')?.status).toBe('ready')
  })

  it('reports pending local-db when no local D1 state exists yet', () => {
    const results = runChecks({
      nodeVersion: '22.0.0',
      pnpmVersion: '12.14.0',
      configValid: true,
      envKeys: {},
      d1Migrated: false,
    })
    const localDb = results.find((r) => r.name === 'local-db')
    expect(localDb?.status).toBe('pending')
    expect(localDb?.remediation).toContain('bootstrap')
  })
})

describe('config schema', () => {
  it('accepts a valid v1 config', () => {
    const parsed = saasConfigSchema.parse({
      schemaVersion: 1,
      projectName: 'my-app',
      preset: 'local',
      billing: { provider: 'polar', environment: 'sandbox' },
    })
    expect(parsed.appUrl).toBe('http://localhost:3000')
  })

  it('rejects wrong schemaVersion and bad slugs', () => {
    expect(
      saasConfigSchema.safeParse({
        schemaVersion: 2,
        projectName: 'my-app',
        preset: 'local',
        billing: { provider: 'none' },
      }).success,
    ).toBe(false)
    expect(
      saasConfigSchema.safeParse({
        schemaVersion: 1,
        projectName: 'My App!',
        preset: 'local',
        billing: { provider: 'none' },
      }).success,
    ).toBe(false)
  })
})
