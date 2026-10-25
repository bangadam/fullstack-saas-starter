import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProgram } from './cli.js'
import { saasConfigSchema } from './config-schema.js'
import { bootstrapLocal, configToTs, planLocalEnvironment } from './local-setup.js'
import { writeFiles } from './write-files.js'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'saas-setup-'))
  roots.push(root)
  for (const app of ['api', 'jobs', 'web']) mkdirSync(join(root, 'apps', app), { recursive: true })
  return root
}
const config = saasConfigSchema.parse({
  schemaVersion: 1,
  projectName: 'test-app',
  preset: 'local',
  billing: { provider: 'stripe', environment: 'sandbox' },
  appUrl: 'http://localhost:3000',
})
function configured() {
  const root = fixture()
  writeFileSync(join(root, 'saas.config.ts'), configToTs(config))
  writeFileSync(
    join(root, '.env.local'),
    'BETTER_AUTH_SECRET=fixture-auth-secret-with-at-least-32-characters\nSTRIPE_SECRET_KEY="fixture # token"\nRESEND_API_KEY=fixture-mail\nEMAIL_FROM=dev@localhost\n',
  )
  return root
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('safe local setup', () => {
  it('never overwrites by default', async () => {
    const root = fixture()
    writeFileSync(join(root, '.env.local'), 'keep me')
    await writeFiles(root, [{ path: '.env.local', content: 'replacement' }])
    expect(readFileSync(join(root, '.env.local'), 'utf8')).toBe('keep me')
  })

  it('--yes preserves config and secrets across repeated wizard runs', async () => {
    const root = configured()
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    const before = ['saas.config.ts', '.env.local'].map((file) =>
      readFileSync(join(root, file), 'utf8'),
    )
    await buildProgram().parseAsync(['setup', '--yes'], { from: 'user' })
    expect(
      ['saas.config.ts', '.env.local'].map((file) => readFileSync(join(root, file), 'utf8')),
    ).toEqual(before)
  })

  it('explicit wizard force updates selected config without rotating existing credentials', async () => {
    const root = configured()
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    const secretFile = readFileSync(join(root, '.env.local'), 'utf8')
    await buildProgram().parseAsync(['setup', '--yes', '--force', '--billing', 'none'], {
      from: 'user',
    })
    expect(readFileSync(join(root, '.env.local'), 'utf8')).toBe(secretFile)
    expect(
      planLocalEnvironment(root).files.find((file) => file.path === 'apps/api/.dev.vars')?.content,
    ).toContain('BILLING_PROVIDER="none"')
  })

  it('explicit bootstrap force reconciles managed values while preserving additional worker keys', async () => {
    const root = configured()
    const file = join(root, 'apps/api/.dev.vars')
    writeFileSync(file, 'BETTER_AUTH_SECRET=existing-value\nCUSTOM_WORKER_KEY="retained"\n')
    await bootstrapLocal(root, { force: true, run: vi.fn(), log: vi.fn() })
    expect(readFileSync(file, 'utf8')).toContain('CUSTOM_WORKER_KEY="retained"')
    expect(readFileSync(file, 'utf8')).toContain('fixture-auth-secret')
  })

  it('accepts the previous wizard static object format without executing code', () => {
    const root = configured()
    writeFileSync(
      join(root, 'saas.config.ts'),
      `import type { SaasConfig } from '@saas/cli'\nexport default { schemaVersion: 1, projectName: 'old-app', preset: 'local', billing: {"provider":"none"}, appUrl: 'http://localhost:3000', } satisfies SaasConfig\n`,
    )
    expect(planLocalEnvironment(root).files.length).toBe(3)
  })

  it('wizard dry-run does not write files or expose generated secrets', async () => {
    const root = fixture()
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    await buildProgram().parseAsync(['setup', '--yes', '--dry-run'], { from: 'user' })
    expect(() => readFileSync(join(root, '.env.local'))).toThrow()
  })

  it('routes selected config and credentials only to consuming workers', () => {
    const root = configured()
    const plan = planLocalEnvironment(root)
    const api = plan.files.find((file) => file.path === 'apps/api/.dev.vars')?.content ?? ''
    const jobs = plan.files.find((file) => file.path === 'apps/jobs/.dev.vars')?.content ?? ''
    const web = plan.files.find((file) => file.path === 'apps/web/.dev.vars')?.content ?? ''
    expect(api).toContain('stripe')
    expect(api).toContain('fixture # token')
    expect(api).toContain('fixture-auth-secret')
    expect(jobs).toContain('fixture-mail')
    expect(jobs).toContain('http://localhost:3000')
    expect(jobs).not.toContain('fixture-auth-secret')
    expect(jobs).not.toContain('fixture # token')
    expect(web).not.toContain('fixture-')
  })

  it('bootstrap dry-run never writes or runs migration/seed', async () => {
    const root = configured()
    const run = vi.fn()
    await bootstrapLocal(root, { dryRun: true, run, log: vi.fn() })
    expect(run).not.toHaveBeenCalled()
    expect(() => statSync(join(root, 'apps/api/.dev.vars'))).toThrow()
  })

  it('bootstrap uses local scripts in order, writes owner-only files and is idempotent', async () => {
    const root = configured()
    const run = vi.fn()
    await bootstrapLocal(root, { run, log: vi.fn() })
    expect(run.mock.calls).toEqual([
      ['pnpm', ['db:migrate']],
      ['pnpm', ['db:seed']],
    ])
    const file = join(root, 'apps/api/.dev.vars')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const before = readFileSync(file, 'utf8')
    await bootstrapLocal(root, { run, log: vi.fn() })
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('detects configuration drift without modifying existing files or exposing values', async () => {
    const root = configured()
    const file = join(root, 'apps/api/.dev.vars')
    writeFileSync(file, 'BETTER_AUTH_SECRET=private-existing-value\n')
    const run = vi.fn()
    await expect(bootstrapLocal(root, { run, log: vi.fn() })).rejects.toThrow(
      /apps\/api\/\.dev.vars.*BETTER_AUTH_SECRET/,
    )
    expect(run).not.toHaveBeenCalled()
    expect(readFileSync(file, 'utf8')).toBe('BETTER_AUTH_SECRET=private-existing-value\n')
  })

  it('rejects an R2 signer bucket that differs from the local binding', () => {
    const root = configured()
    writeFileSync(
      join(root, 'apps/api/wrangler.jsonc'),
      JSON.stringify({ r2_buckets: [{ binding: 'BUCKET', bucket_name: 'saas-files' }] }),
    )
    writeFileSync(
      join(root, '.env.local'),
      'BETTER_AUTH_SECRET=fixture-auth-secret-with-at-least-32-characters\nR2_ACCESS_KEY_ID=fixture-id\nR2_SECRET_ACCESS_KEY=fixture-key\nCLOUDFLARE_ACCOUNT_ID=fixture-account\nR2_BUCKET_NAME=wrong-bucket\n',
    )
    expect(() => planLocalEnvironment(root)).toThrow(/R2_BUCKET_NAME/)
  })

  it('propagates public Turnstile keys to API and web, never the secret to web', () => {
    const root = configured()
    writeFileSync(
      join(root, '.env.local'),
      'BETTER_AUTH_SECRET=fixture-auth-secret-with-at-least-32-characters\nTURNSTILE_SITE_KEY=public-site\nTURNSTILE_SECRET_KEY=private-turnstile\n',
    )
    const plan = planLocalEnvironment(root)
    expect(plan.files.find((file) => file.path === 'apps/api/.dev.vars')?.content).toContain(
      'public-site',
    )
    expect(plan.files.find((file) => file.path === 'apps/web/.dev.vars')?.content).toContain(
      'public-site',
    )
    expect(plan.files.find((file) => file.path === 'apps/web/.dev.vars')?.content).not.toContain(
      'private-turnstile',
    )
  })

  it('propagates the actual API billing catalog keys without exposing them to other workers', () => {
    const root = configured()
    writeFileSync(
      join(root, '.env.local'),
      'BETTER_AUTH_SECRET=fixture-auth-secret-with-at-least-32-characters\nPRO_MONTHLY=fixture-monthly\nPRO_YEARLY=fixture-yearly\n',
    )
    const plan = planLocalEnvironment(root)
    expect(plan.files.find((file) => file.path === 'apps/api/.dev.vars')?.content).toContain(
      'PRO_MONTHLY="fixture-monthly"',
    )
    expect(plan.files.find((file) => file.path === 'apps/api/.dev.vars')?.content).toContain(
      'PRO_YEARLY="fixture-yearly"',
    )
    expect(plan.files.find((file) => file.path === 'apps/web/.dev.vars')?.content).not.toContain(
      'PRO_MONTHLY',
    )
  })

  it('refuses missing wizard config instead of copying insecure sample credentials', () => {
    expect(() => planLocalEnvironment(fixture())).toThrow(/pnpm wizard/)
  })
})
