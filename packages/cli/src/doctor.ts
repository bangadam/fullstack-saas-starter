export type CheckStatus = 'ready' | 'pending' | 'failed'

export interface CheckResult {
  name: string
  status: CheckStatus
  detail: string
  remediation?: string
}

/** Exit codes: 0 = all ready, 1 = at least one pending, 2 = at least one failed. */
export const EXIT_OK = 0
export const EXIT_PENDING = 1
export const EXIT_FAILED = 2

export function exitCodeFor(results: CheckResult[]): number {
  if (results.some((r) => r.status === 'failed')) return EXIT_FAILED
  if (results.some((r) => r.status === 'pending')) return EXIT_PENDING
  return EXIT_OK
}

export interface DoctorEnv {
  nodeVersion: string
  pnpmVersion: string | null
  configValid: boolean
  configError?: string
  envKeys: Record<string, string | undefined>
  /** Apps with a .dev.vars file, keyed by app dir (only apps that ship an example need one). */
  devVars?: Record<string, boolean>
  /** Whether a local D1 database file exists under .wrangler state. */
  d1Migrated?: boolean
}

const SECRET_KEY_NAMES = [
  'BETTER_AUTH_SECRET',
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
]

function has(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/** Pure doctor evaluation — never prints secret values, only presence. */
export function runChecks(env: DoctorEnv): CheckResult[] {
  const results: CheckResult[] = []

  const nodeMajor = Number.parseInt(env.nodeVersion.split('.')[0] ?? '0', 10)
  results.push({
    name: 'node',
    status: nodeMajor >= 22 ? 'ready' : 'failed',
    detail: `node ${env.nodeVersion}`,
    remediation: nodeMajor >= 22 ? undefined : 'Install Node.js 22 or newer.',
  })

  results.push({
    name: 'pnpm',
    status: env.pnpmVersion ? 'ready' : 'failed',
    detail: env.pnpmVersion ? `pnpm ${env.pnpmVersion}` : 'pnpm not found',
    remediation: env.pnpmVersion ? undefined : 'Install pnpm: corepack enable pnpm.',
  })

  results.push({
    name: 'config',
    // A missing config is normal on a fresh clone — it is a setup step, not a
    // system failure. Report pending so `doctor` stays green-red friendly.
    status: env.configValid ? 'ready' : 'pending',
    detail: env.configValid ? 'saas.config.ts is valid' : (env.configError ?? 'invalid config'),
    remediation: env.configValid ? undefined : 'Run `saas setup` to regenerate saas.config.ts.',
  })

  if (env.devVars) {
    const missing = (Object.entries(env.devVars) as Array<[string, boolean]>)
      .filter(([, present]) => !present)
      .map(([app]) => app)
    results.push({
      name: 'dev-vars',
      status: missing.length === 0 ? 'ready' : 'pending',
      detail:
        missing.length === 0
          ? `apps/${Object.keys(env.devVars).join(', apps/')} .dev.vars present`
          : `missing .dev.vars for: ${missing.join(', ')}`,
      remediation:
        missing.length === 0
          ? undefined
          : 'Run `pnpm bootstrap` to copy apps/*/.dev.vars.example files.',
    })
  }

  if (typeof env.d1Migrated === 'boolean') {
    results.push({
      name: 'local-db',
      status: env.d1Migrated ? 'ready' : 'pending',
      detail: env.d1Migrated ? 'local D1 state exists' : 'no local D1 state yet',
      remediation: env.d1Migrated
        ? undefined
        : 'Run `pnpm bootstrap` to migrate and seed the local database.',
    })
  }

  const billing = (env.envKeys.BILLING_PROVIDER ?? 'polar') as 'polar' | 'stripe' | 'none'
  const providerKeys: Record<string, string[]> = {
    polar: ['POLAR_ACCESS_TOKEN', 'POLAR_WEBHOOK_SECRET', 'POLAR_ORGANIZATION_ID'],
    stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    none: [],
  }
  const missing = (providerKeys[billing] ?? []).filter((k) => !has(env.envKeys[k]))
  if (billing === 'none') {
    results.push({ name: 'billing', status: 'ready', detail: 'billing disabled (none)' })
  } else {
    results.push({
      name: 'billing',
      status: missing.length === 0 ? 'ready' : 'pending',
      detail:
        missing.length === 0
          ? `${billing} credentials present`
          : `missing ${missing.length} key(s): ${missing.join(', ')}`,
      remediation: missing.length === 0 ? undefined : `Add ${missing.join(', ')} to .env.local.`,
    })
  }

  results.push({
    name: 'auth-secret',
    status: has(env.envKeys.BETTER_AUTH_SECRET) ? 'ready' : 'pending',
    detail: has(env.envKeys.BETTER_AUTH_SECRET)
      ? 'BETTER_AUTH_SECRET set'
      : 'BETTER_AUTH_SECRET missing',
    remediation: has(env.envKeys.BETTER_AUTH_SECRET)
      ? undefined
      : 'Run `saas setup` to generate a secret into .env.local.',
  })

  return results
}
