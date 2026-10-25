import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { Command } from 'commander'
import {
  CONFIG_FILENAME,
  ENV_LOCAL_FILENAME,
  SAAS_CONFIG_SCHEMA_VERSION,
  type SaasConfig,
  envLocalTemplate,
  saasConfigSchema,
} from './config-schema.js'
import { EXIT_FAILED, exitCodeFor, runChecks } from './doctor.js'
import { configToTs, readLocalEnv, readSaasConfig } from './local-setup.js'
import { writeFiles } from './write-files.js'

interface SetupAnswers {
  projectName: string
  preset: 'local' | 'cloudflare'
  billing: 'polar' | 'stripe' | 'none'
  environment: 'sandbox' | 'production'
  appUrl: string
}

async function gatherAnswers(
  nonInteractive: Partial<SetupAnswers> & { yes?: boolean },
): Promise<SaasConfig> {
  // `--yes` (CI/quickstart) takes documented defaults for anything the caller
  // did not pass explicitly, so setup never blocks waiting for stdin.
  const auto = nonInteractive.yes === true
  const projectName =
    nonInteractive.projectName ??
    (auto
      ? 'my-saas'
      : await p.text({ message: 'Project name (lowercase, dashes):', placeholder: 'my-saas' }))
  if (typeof projectName !== 'string' || projectName.length === 0) throw new Error('Cancelled')
  const preset =
    nonInteractive.preset ??
    (auto
      ? 'local'
      : await p.select({
          message: 'Preset:',
          options: [
            { value: 'local', label: 'local (quickstart, simulated bindings)' },
            { value: 'cloudflare', label: 'cloudflare (deployment configuration)' },
          ],
        }))
  const billing =
    nonInteractive.billing ??
    (auto
      ? 'polar'
      : await p.select({
          message: 'Billing provider:',
          initialValue: 'polar',
          options: [
            { value: 'polar', label: 'Polar (default)' },
            { value: 'stripe', label: 'Stripe' },
            { value: 'none', label: 'None (no billing)' },
          ],
        }))
  const environment =
    billing === 'none'
      ? 'sandbox'
      : (nonInteractive.environment ??
        (auto
          ? 'sandbox'
          : await p.select({
              message: 'Billing environment:',
              initialValue: 'sandbox',
              options: [
                { value: 'sandbox', label: 'sandbox/test (default)' },
                { value: 'production', label: 'production' },
              ],
            })))
  return saasConfigSchema.parse({
    schemaVersion: SAAS_CONFIG_SCHEMA_VERSION,
    projectName,
    preset,
    billing: billing === 'none' ? { provider: 'none' } : { provider: billing, environment },
    appUrl: nonInteractive.appUrl,
  })
}

export function buildProgram(): Command {
  const program = new Command()
  program.name('saas').description('SaaS boilerplate installation wizard').version('0.1.0')

  program
    .command('setup')
    .description(
      'Interactive setup wizard: writes saas.config.ts and .env.local (config only, no provisioning). Invoke as `pnpm wizard` — bare `pnpm setup` belongs to pnpm itself.',
    )
    .option('--yes', 'non-interactive mode with defaults (CI)')
    .option('--name <name>', 'project name')
    .option('--preset <preset>', 'local | cloudflare')
    .option('--billing <provider>', 'polar | stripe | none')
    .option('--environment <environment>', 'sandbox | production')
    .option('--app-url <url>', 'public application origin')
    .option('--dry-run', 'show the plan without writing files')
    .option('--force', 'explicitly replace config; preserve existing secrets')
    .action(
      async (opts: {
        yes?: boolean
        name?: string
        preset?: string
        billing?: string
        environment?: string
        appUrl?: string
        dryRun?: boolean
        force?: boolean
      }) => {
        try {
          const answers = {
            projectName: opts.name,
            preset: opts.preset as 'local' | 'cloudflare' | undefined,
            billing: opts.billing as 'polar' | 'stripe' | 'none' | undefined,
            environment: opts.environment as 'sandbox' | 'production' | undefined,
            appUrl: opts.appUrl,
            yes: opts.yes,
          }
          const config =
            existsSync(join(process.cwd(), CONFIG_FILENAME)) && !opts.force
              ? readSaasConfig(process.cwd())
              : await gatherAnswers(answers)
          const secret = randomBytes(32).toString('base64url')

          const files = [
            { path: CONFIG_FILENAME, content: configToTs(config) },
            { path: ENV_LOCAL_FILENAME, content: envLocalTemplate(secret), ownerOnlyPerms: true },
          ]

          p.intro('Setup summary')
          p.log.info(`project: ${config.projectName}`)
          p.log.info(`preset: ${config.preset}`)
          p.log.info(
            `billing: ${config.billing.provider}${config.billing.provider === 'none' ? '' : ` (${config.billing.environment})`}`,
          )
          p.log.info(`appUrl: ${config.appUrl}`)
          p.log.message(`Files to write: ${files.map((f) => f.path).join(', ')}`)
          p.log.warn('No resources are provisioned. Secrets go to .env.local (gitignored).')

          if (opts.dryRun) {
            p.outro('Dry run — nothing written. Existing files and secrets are preserved.')
            return
          }
          // --yes accepts defaults, never grants permission to overwrite.
          const proceed = opts.yes === true ? true : await p.confirm({ message: 'Write files?' })
          if (p.isCancel(proceed) || !proceed) {
            p.outro('Cancelled — nothing written.')
            return
          }

          const outcome = await writeFiles(process.cwd(), files, async (path) => {
            // Rotating credentials must be a separate, deliberate operator action.
            return path !== ENV_LOCAL_FILENAME && opts.force === true
          })
          p.outro(
            `Done. Written: ${outcome.written.join(', ') || 'nothing'}. Next: pnpm bootstrap && pnpm dev`,
          )
        } catch (err) {
          p.log.error(err instanceof Error ? err.message : String(err))
          process.exitCode = EXIT_FAILED
        }
      },
    )

  program
    .command('doctor')
    .description('Check prerequisites and config; exit 0 ok / 1 pending / 2 failed')
    .action(async () => {
      const { execFileSync } = await import('node:child_process')
      const { existsSync, readFileSync } = await import('node:fs')
      const { join } = await import('node:path')

      let pnpmVersion: string | null = null
      try {
        pnpmVersion = execFileSync('pnpm', ['--version']).toString().trim()
      } catch {
        pnpmVersion = null
      }

      let configValid = false
      let configError: string | undefined
      const configPath = join(process.cwd(), CONFIG_FILENAME)
      if (existsSync(configPath)) {
        try {
          readSaasConfig(process.cwd())
          configValid = true
        } catch (e) {
          configError = e instanceof Error ? e.message : 'unreadable config'
        }
      } else {
        configError = 'saas.config.ts not found — run `saas setup`'
      }

      const envKeys: Record<string, string | undefined> = readLocalEnv(
        join(process.cwd(), ENV_LOCAL_FILENAME),
      )
      if (configValid) envKeys.BILLING_PROVIDER = readSaasConfig(process.cwd()).billing.provider

      // Per-app local env files (created by `pnpm bootstrap`). Only apps that
      // ship a .dev.vars.example need one, so the check follows the repo
      // instead of a hardcoded list.
      const { globSync } = await import('node:fs')
      const devVars: Record<string, boolean> = {}
      for (const app of ['web', 'api', 'jobs']) {
        if (!existsSync(join(process.cwd(), 'apps', app, '.dev.vars.example'))) continue
        devVars[app] = existsSync(join(process.cwd(), 'apps', app, '.dev.vars'))
      }

      // Local D1 state means migrations were applied at least once.
      const hasD1File = (): boolean => {
        try {
          const matches = globSync('apps/*/.wrangler/state/v3/d1/**/*.sqlite', {
            exclude: ['**/metadata.sqlite', '**/*.sqlite-shm', '**/*.sqlite-wal'],
          })
          return matches.length > 0
        } catch {
          return false
        }
      }

      const results = runChecks({
        nodeVersion: process.version.slice(1),
        pnpmVersion,
        configValid,
        configError,
        envKeys,
        devVars,
        d1Migrated: hasD1File(),
      })
      for (const r of results) {
        const icon = r.status === 'ready' ? '✔' : r.status === 'pending' ? '…' : '✖'
        p.log.info(
          `${icon} ${r.name}: ${r.status} — ${r.detail}${r.remediation ? ` | ${r.remediation}` : ''}`,
        )
      }
      process.exitCode = exitCodeFor(results)
    })

  program
    .command('scan-secrets')
    .description('Scan git-tracked files for committed credentials; exit 1 when found')
    .action(async () => {
      const { execFileSync } = await import('node:child_process')
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { formatFindings, findSecrets } = await import('./secret-scan.js')

      let tracked: string[]
      try {
        tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
          .split('\0')
          .filter(Boolean)
      } catch {
        p.log.error('Not a git repository — cannot enumerate tracked files.')
        process.exitCode = EXIT_FAILED
        return
      }

      const files = tracked.map((path) => {
        let content = ''
        try {
          content = readFileSync(join(process.cwd(), path), 'utf8')
        } catch {
          // Binary or unreadable files: skip silently.
        }
        return { path, content }
      })

      const findings = findSecrets(files)
      if (findings.length === 0) {
        p.log.success(formatFindings(findings))
        return
      }
      p.log.error(formatFindings(findings))
      process.exitCode = EXIT_FAILED
    })

  return program
}

export async function main(argv: string[] = process.argv) {
  await buildProgram().parseAsync(argv)
}
