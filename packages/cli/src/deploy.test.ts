import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeployPlan, deploy, patchWebConfig } from './deploy.js'

const roots: string[] = []
const account = 'a'.repeat(32)
const database = {
  binding: 'DB',
  database_name: 'saas-db-staging',
  database_id: '11111111-2222-4333-8444-555555555555',
  migrations_dir: '../../packages/db/drizzle',
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'saas-deploy-'))
  roots.push(root)
  mkdirSync(join(root, 'packages/db/drizzle'), { recursive: true })
  writeFileSync(join(root, 'packages/db/drizzle/0000.sql'), 'SELECT 1;')
  for (const app of ['api', 'jobs', 'web']) {
    mkdirSync(join(root, 'apps', app, 'src'), { recursive: true })
    writeFileSync(join(root, 'apps', app, 'src/index.ts'), 'export default {}')
    const env = {
      name: `saas-${app}-staging`,
      vars: { APP_URL: 'https://staging.example.com' },
      ...(app === 'web'
        ? { services: [{ binding: 'API_WORKER', service: 'saas-api-staging' }] }
        : {
            d1_databases: [database],
            r2_buckets: [{ binding: 'BUCKET', bucket_name: 'saas-files-staging' }],
            queues:
              app === 'api'
                ? { producers: [{ binding: 'EMAIL_QUEUE', queue: 'saas-email-staging' }] }
                : {
                    consumers: [
                      { queue: 'saas-email-staging', dead_letter_queue: 'saas-dlq-staging' },
                    ],
                  },
          }),
    }
    writeFileSync(
      join(root, 'apps', app, 'wrangler.jsonc'),
      `// fixture\n${JSON.stringify({ name: `saas-${app}`, main: 'src/index.ts', compatibility_date: '2025-10-01', env: { staging: env } })}`,
    )
  }
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const options = {
  environment: 'staging',
  appUrl: 'https://staging.example.com',
  accountId: account,
}

describe('deployment safety', () => {
  it('requires explicit environment configuration and rejects unknown targets', () => {
    const root = fixture()
    expect(() => createDeployPlan(root, { ...options, environment: 'preview' })).toThrow(
      /environment/i,
    )
    expect(() => createDeployPlan(root, { ...options, environment: 'production' })).toThrow(
      /production/,
    )
  })
  it('plans build, migration, api/jobs/web deployment and smoke in order', () => {
    const plan = createDeployPlan(fixture(), options)
    expect(plan.steps.map((step) => step.id)).toEqual([
      'build-api',
      'build-jobs',
      'build-web',
      'migrate',
      'deploy-api',
      'deploy-jobs',
      'deploy-web',
      'smoke',
    ])
    expect(plan.steps.find((step) => step.id === 'build-jobs')?.args).toEqual([
      '--filter',
      '@saas/jobs-worker',
      'build',
    ])
    expect(plan.steps.find((step) => step.id === 'deploy-jobs')?.args.slice(0, 5)).toEqual([
      '--filter',
      '@saas/jobs-worker',
      'exec',
      'wrangler',
      'deploy',
    ])
    expect(plan.configs.api.workers_dev).toBe(false)
    expect(plan.configs.api.routes).toEqual([])
    expect(plan.steps.find((step) => step.id === 'migrate')?.args).toContain('--remote')
    expect(JSON.stringify(plan)).not.toContain('secret put')
  })
  it('rejects placeholders, cross-environment resources, and mismatched origins', () => {
    const root = fixture()
    const file = join(root, 'apps/api/wrangler.jsonc')
    const src = readFileSync(file, 'utf8')
    writeFileSync(file, src.replace(database.database_id, 'REPLACE_ME'))
    expect(() => createDeployPlan(root, options)).toThrow(/database_id/)
    writeFileSync(file, src.replace('saas-files-staging', 'saas-files-production'))
    expect(() => createDeployPlan(root, options)).toThrow(/bucket/)
    writeFileSync(file, src)
    expect(() =>
      createDeployPlan(root, { ...options, appUrl: 'https://wrong.example.com' }),
    ).toThrow(/APP_URL/)
  })
  it('patches generated web name and service binding without losing generated bundle paths', () => {
    const generated = {
      name: 'saas-web',
      main: 'index.js',
      assets: { directory: '../client', binding: 'ASSETS' },
      services: [{ binding: 'API_WORKER', service: 'saas-api' }],
      compatibility_date: '2025-10-01',
    }
    const plan = createDeployPlan(fixture(), options)
    const patched = patchWebConfig(generated, plan.configs.web)
    expect(patched.name).toBe('saas-web-staging')
    expect(patched.services).toEqual([{ binding: 'API_WORKER', service: 'saas-api-staging' }])
    expect(patched.main).toBe('index.js')
    expect(patched.assets).toEqual(generated.assets)
    expect(generated.name).toBe('saas-web')
  })
  it('dry-run writes nothing and executes no commands', async () => {
    const root = fixture()
    const run = vi.fn()
    await deploy(root, { ...options, dryRun: true, run, log: vi.fn() })
    expect(run).not.toHaveBeenCalled()
    expect(() => readFileSync(join(root, 'apps/api/.wrangler/deploy/staging.json'))).toThrow()
  })
  it('requires explicit target and SQL review acknowledgment before any effects', async () => {
    const run = vi.fn()
    await expect(deploy(fixture(), { ...options, run, log: vi.fn() })).rejects.toThrow(/confirm/)
    expect(run).not.toHaveBeenCalled()
  })
  it('executes the complete rollout with explicit generated configs and read-only smoke target', async () => {
    const root = fixture()
    const directory = join(root, 'apps/web/dist/server')
    mkdirSync(directory, { recursive: true })
    const generated = JSON.stringify({
      name: 'saas-web',
      main: 'index.js',
      assets: { directory: '../client' },
    })
    writeFileSync(join(directory, 'wrangler.json'), generated)
    const run = vi.fn()
    const plan = await deploy(root, {
      ...options,
      confirm: 'staging',
      migrationsReviewed: true,
      apiToken: 'fixture-token',
      run,
      log: vi.fn(),
    })
    expect(run.mock.calls.map((call) => call[1])).toEqual(plan.steps.map((step) => step.args))
    expect(run.mock.calls.at(-1)?.[2].SMOKE_BASE_URL).toBe(options.appUrl)
    const web = JSON.parse(readFileSync(plan.paths.web, 'utf8'))
    expect(web.main).toBe('index.js')
    expect(web.name).toBe('saas-web-staging')
    expect(readFileSync(join(directory, 'wrangler.json'), 'utf8')).toBe(generated)
    expect(JSON.stringify(plan)).not.toContain('fixture-token')
  })
  it('never deploys after a failed migration', async () => {
    const root = fixture()
    mkdirSync(join(root, 'apps/web/dist/server'), { recursive: true })
    writeFileSync(
      join(root, 'apps/web/dist/server/wrangler.json'),
      JSON.stringify({ name: 'saas-web', main: 'index.js', assets: { directory: '../client' } }),
    )
    const run = vi.fn((_command: string, args: string[]) => {
      if (args.includes('migrations')) throw new Error('migration failed')
    })
    await expect(
      deploy(root, {
        ...options,
        confirm: 'staging',
        migrationsReviewed: true,
        apiToken: 'fixture-token',
        run,
        log: vi.fn(),
      }),
    ).rejects.toThrow('migration failed')
    expect(run).toHaveBeenCalledTimes(4)
    expect(run.mock.calls.some((call) => call[1].includes('deploy'))).toBe(false)
  })
  it('stops before migration when a build fails', async () => {
    const run = vi.fn(() => {
      throw new Error('build failed')
    })
    await expect(
      deploy(fixture(), {
        ...options,
        confirm: 'staging',
        migrationsReviewed: true,
        apiToken: 'fixture-token',
        run,
        log: vi.fn(),
      }),
    ).rejects.toThrow('build failed')
    expect(run).toHaveBeenCalledTimes(1)
  })
})

it('both workflows are dispatch-only, environment-gated, and use the shared deploy command', () => {
  for (const environment of ['staging', 'production']) {
    const source = readFileSync(
      new URL(`../../../.github/workflows/deploy-${environment}.yml`, import.meta.url),
      'utf8',
    )
    expect(source).toContain('workflow_dispatch:')
    expect(source).not.toMatch(/^\s+push:/m)
    expect(source).toContain(`environment: ${environment}`)
    expect(source).toContain('migrations_reviewed')
    expect(source).toContain(`pnpm deploy:${environment}`)
    expect(source).not.toContain('if: false')
  }
})
