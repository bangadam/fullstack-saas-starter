import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'

const bindingSchema = z.object({ binding: z.string() }).passthrough()
const workerSchema = z
  .object({
    name: z.string(),
    main: z.string().optional(),
    account_id: z.string().optional(),
    vars: z.record(z.string()).optional(),
    workers_dev: z.boolean().optional(),
    preview_urls: z.boolean().optional(),
    routes: z.array(z.unknown()).optional(),
    assets: z.record(z.unknown()).optional(),
    services: z.array(bindingSchema.extend({ service: z.string() })).optional(),
    d1_databases: z
      .array(
        bindingSchema.extend({
          database_name: z.string(),
          database_id: z.string(),
          migrations_dir: z.string().optional(),
        }),
      )
      .optional(),
    r2_buckets: z.array(bindingSchema.extend({ bucket_name: z.string() })).optional(),
    queues: z
      .object({
        producers: z.array(bindingSchema.extend({ queue: z.string() })).optional(),
        consumers: z
          .array(z.object({ queue: z.string(), dead_letter_queue: z.string() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export type WorkerConfig = z.infer<typeof workerSchema>
type App = 'api' | 'jobs' | 'web'
const WORKER_PACKAGES: Record<App, string> = {
  api: '@saas/api',
  jobs: '@saas/jobs-worker',
  web: '@saas/web',
}

/** Strip comments without treating URL/string contents as comments. */
export function readJsonc(path: string): Record<string, unknown> {
  const source = readFileSync(path, 'utf8').replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith('"') ? token : ''),
  )
  return JSON.parse(
    source.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, (token) =>
      token.startsWith('"') ? token : '',
    ),
  )
}

export interface DeployOptions {
  environment: string
  appUrl: string
  accountId: string
  apiToken?: string
  confirm?: string
  migrationsReviewed?: boolean
  dryRun?: boolean
  preflight?: boolean
  run?: (command: string, args: string[], env: Record<string, string>) => void
  log?: (message: string) => void
}
interface Step {
  id: string
  args: string[]
}
export interface DeployPlan {
  environment: string
  configs: Record<App, WorkerConfig>
  paths: Record<App, string>
  steps: Step[]
  appUrl: string
}

function requireTarget(value: string, environment: string, label: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || !value.endsWith(`-${environment}`))
    throw new Error(`${label} must explicitly target -${environment}`)
}

export function createDeployPlan(root: string, options: DeployOptions): DeployPlan {
  const { environment, appUrl, accountId } = options
  if (!['staging', 'production'].includes(environment))
    throw new Error('Environment must be staging or production')
  if (!/^[a-f0-9]{32}$/i.test(accountId))
    throw new Error('A valid CLOUDFLARE_ACCOUNT_ID is required')
  let origin: URL
  try {
    origin = new URL(appUrl)
  } catch {
    throw new Error('APP_URL must be a public HTTPS origin')
  }
  if (origin.protocol !== 'https:' || origin.origin !== appUrl || origin.hostname === 'localhost')
    throw new Error('APP_URL must be a public HTTPS origin without a path')
  const configs = {} as Record<App, WorkerConfig>
  const paths = {} as Record<App, string>
  for (const app of ['api', 'jobs', 'web'] as const) {
    const directory = join(root, 'apps', app)
    const source = readJsonc(join(directory, 'wrangler.jsonc'))
    const environments = z.record(z.record(z.unknown())).parse(source.env ?? {})
    const target = environments[environment]
    if (!target)
      throw new Error(`apps/${app}/wrangler.jsonc has no explicit ${environment} environment`)
    // Bindings and vars are non-inheritable in Wrangler. Never leak local defaults.
    const {
      env: _env,
      vars: _vars,
      services: _services,
      d1_databases: _db,
      r2_buckets: _r2,
      queues: _queues,
      routes: _routes,
      dev: _dev,
      ...base
    } = source
    const parsed = workerSchema.safeParse({ ...base, ...target, account_id: accountId })
    if (!parsed.success)
      throw new Error(
        `Invalid apps/${app} ${environment} config: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      )
    const config = parsed.data
    requireTarget(config.name, environment, `${app} Worker name`)
    if (target.account_id !== undefined && target.account_id !== accountId)
      throw new Error(`${app} account_id mismatch`)
    if (
      config.vars &&
      Object.keys(config.vars).some((key) =>
        /SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|API_KEY/.test(key),
      )
    )
      throw new Error(
        `${app} vars must not contain secret keys; provision Worker secrets separately`,
      )
    if (app !== 'web') {
      if (config.vars?.APP_URL !== appUrl)
        throw new Error(`${app} APP_URL must match the requested smoke origin`)
      const db = config.d1_databases?.find((value) => value.binding === 'DB')
      const bucket = config.r2_buckets?.find((value) => value.binding === 'BUCKET')
      if (!db || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(db.database_id))
        throw new Error(`${app} database_id must be a real D1 UUID`)
      requireTarget(db.database_name, environment, `${app} database_name`)
      if (!bucket) throw new Error(`${app} BUCKET binding required`)
      requireTarget(bucket.bucket_name, environment, `${app} bucket_name`)
      if (
        config.vars?.R2_BUCKET_NAME !== undefined &&
        config.vars.R2_BUCKET_NAME !== bucket.bucket_name
      )
        throw new Error(`${app} R2_BUCKET_NAME must match BUCKET bucket_name`)
      config.workers_dev = false
      config.preview_urls = false
      config.routes = []
      if (!config.main || !existsSync(resolve(directory, config.main)))
        throw new Error(`${app} main entry is missing`)
      config.main = resolve(directory, config.main)
      if (app === 'api') {
        if (!db.migrations_dir) throw new Error('API migrations_dir is required')
        db.migrations_dir = resolve(directory, db.migrations_dir)
        if (
          !existsSync(db.migrations_dir) ||
          !readdirSync(db.migrations_dir).some((file) => file.endsWith('.sql'))
        )
          throw new Error('No SQL migrations found')
        if (!config.queues?.producers?.length) throw new Error('API queue producers are required')
        for (const producer of config.queues.producers)
          requireTarget(producer.queue, environment, 'producer queue')
      } else {
        if (!config.queues?.consumers?.length) throw new Error('Jobs queue consumers are required')
        for (const consumer of config.queues.consumers) {
          requireTarget(consumer.queue, environment, 'consumer queue')
          requireTarget(consumer.dead_letter_queue, environment, 'dead-letter queue')
        }
      }
    }
    configs[app] = config
    paths[app] =
      app === 'web'
        ? join(directory, 'dist/server', `wrangler.${environment}.json`)
        : join(directory, '.wrangler/deploy', `${environment}.json`)
  }
  const apiDb = configs.api.d1_databases?.find((db) => db.binding === 'DB')
  const jobsDb = configs.jobs.d1_databases?.find((db) => db.binding === 'DB')
  if (apiDb?.database_id !== jobsDb?.database_id || apiDb?.database_name !== jobsDb?.database_name)
    throw new Error('API and jobs D1 bindings must match')
  if (configs.api.r2_buckets?.[0]?.bucket_name !== configs.jobs.r2_buckets?.[0]?.bucket_name)
    throw new Error('API and jobs R2 bindings must match')
  for (const producer of configs.api.queues?.producers ?? []) {
    if (!configs.jobs.queues?.consumers?.some((consumer) => consumer.queue === producer.queue))
      throw new Error('Each produced queue must have a jobs consumer')
  }
  if (
    configs.web.services?.find((service) => service.binding === 'API_WORKER')?.service !==
    configs.api.name
  )
    throw new Error('Web API_WORKER must target this environment API Worker')
  if (
    environment === 'production' &&
    (!configs.web.routes?.length || configs.web.workers_dev !== false)
  )
    throw new Error('Production web requires explicit routes and workers_dev: false')
  const steps: Step[] = (['api', 'jobs', 'web'] as const).map((app) => ({
    id: `build-${app}`,
    args: ['--filter', WORKER_PACKAGES[app], 'build'],
  }))
  steps.push({
    id: 'migrate',
    args: [
      '--filter',
      '@saas/api',
      'exec',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--remote',
      '--config',
      paths.api,
    ],
  })
  for (const app of ['api', 'jobs', 'web'] as const)
    steps.push({
      id: `deploy-${app}`,
      args: [
        '--filter',
        WORKER_PACKAGES[app],
        'exec',
        'wrangler',
        'deploy',
        '--config',
        paths[app],
      ],
    })
  steps.push({ id: 'smoke', args: ['smoke'] })
  return { environment, configs, paths, steps, appUrl }
}

/** Preserve Vite's bundled entry/assets, replacing target identity and bindings. */
export function patchWebConfig(generated: WorkerConfig, target: WorkerConfig): WorkerConfig {
  const { main: _main, assets: _assets, ...deployment } = target
  const patched: WorkerConfig = {
    ...generated,
    ...deployment,
    vars: target.vars ?? {},
    services: target.services ?? [],
    routes: target.routes ?? [],
  }
  patched.env = undefined
  return patched
}

export async function deploy(root: string, options: DeployOptions): Promise<DeployPlan> {
  const plan = createDeployPlan(root, options)
  const log = options.log ?? console.log
  log(`Target: ${plan.environment}; public origin: ${plan.appUrl}`)
  for (const step of plan.steps) log(`Plan: pnpm ${step.args.join(' ')}`)
  if (options.dryRun || options.preflight) return plan
  if (options.confirm !== options.environment || !options.migrationsReviewed)
    throw new Error('Pass --confirm <environment> and --migrations-reviewed before deployment')
  if (!options.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required for deployment')
  const run =
    options.run ??
    ((command, args, env) => {
      execFileSync(command, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, ...env },
        shell: process.platform === 'win32',
      })
    })
  const executionEnv = {
    CLOUDFLARE_ACCOUNT_ID: options.accountId,
    CLOUDFLARE_API_TOKEN: options.apiToken,
    CLOUDFLARE_ENV: '',
    SMOKE_BASE_URL: plan.appUrl,
    CI: 'true',
  }
  // Finish all builds and generated-config validation before any remote mutation.
  for (const step of plan.steps.filter((step) => step.id.startsWith('build-')))
    run('pnpm', step.args, executionEnv)
  const generatedPath = join(root, 'apps/web/dist/server/wrangler.json')
  const generated = workerSchema.parse(JSON.parse(readFileSync(generatedPath, 'utf8')))
  if (!generated.main || !generated.assets)
    throw new Error('Generated web config must include bundled main and assets')
  plan.configs.web = patchWebConfig(generated, plan.configs.web)
  for (const app of ['api', 'jobs', 'web'] as const) {
    mkdirSync(dirname(plan.paths[app]), { recursive: true })
    writeFileSync(plan.paths[app], JSON.stringify(plan.configs[app], null, 2))
  }
  for (const step of plan.steps.filter((step) => !step.id.startsWith('build-')))
    run('pnpm', step.args, executionEnv)
  return plan
}
