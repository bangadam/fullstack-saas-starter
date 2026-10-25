#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = fileURLToPath(new URL('../apps/api/wrangler.jsonc', import.meta.url))
const numericFields = new Set([
  'emailPending',
  'emailFailed',
  'emailLagSeconds',
  'emailLeased',
  'billingPending',
  'billingFailed',
  'billingLagSeconds',
  'billingLeased',
  'storagePending',
  'storageExpired',
  'storageDeleting',
  'storageLagSeconds',
  'checkoutIntents',
  'changed',
])
const inspectSql = `SELECT
 (SELECT count(*) FROM email_outbox WHERE status='pending') AS emailPending,
 (SELECT count(*) FROM email_outbox WHERE status='failed') AS emailFailed,
 (SELECT count(*) FROM email_outbox WHERE lease_until>unixepoch()) AS emailLeased,
 MAX(0,COALESCE(unixepoch()-(SELECT min(created_at) FROM email_outbox WHERE status='pending'),0)) AS emailLagSeconds,
 (SELECT count(*) FROM billing_events WHERE processed_at IS NULL AND failed_at IS NULL) AS billingPending,
 (SELECT count(*) FROM billing_events WHERE failed_at IS NOT NULL) AS billingFailed,
 (SELECT count(*) FROM billing_events WHERE lease_until>unixepoch()) AS billingLeased,
 MAX(0,COALESCE(unixepoch()-(SELECT min(created_at) FROM billing_events WHERE processed_at IS NULL AND failed_at IS NULL),0)) AS billingLagSeconds,
 (SELECT count(*) FROM files WHERE status='pending') AS storagePending,
 (SELECT count(*) FROM files WHERE status='expired') AS storageExpired,
 (SELECT count(*) FROM files WHERE status='deleting') AS storageDeleting,
 MAX(0,COALESCE(unixepoch()-(SELECT min(expires_at) FROM files WHERE status IN ('pending','deleting') AND expires_at<=unixepoch()),0)) AS storageLagSeconds,
 (SELECT count(*) FROM billing_checkout_intents) AS checkoutIntents;`

export function buildOperation(argv) {
  const [operation, ...rest] = argv
  if (!['inspect', 'retry'].includes(operation))
    throw new Error('Use inspect or retry email|billing')
  const kind = operation === 'retry' ? rest.shift() : undefined
  if (operation === 'retry' && !['email', 'billing'].includes(kind))
    throw new Error('Retry kind must be email or billing')
  const options = {}
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    if (['--execute', '--remote'].includes(flag)) {
      if (options[flag]) throw new Error('Duplicate option')
      options[flag] = true
    } else if (['--env', '--id', '--provider', '--billing-env', '--confirm'].includes(flag)) {
      if (options[flag] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--'))
        throw new Error('Invalid option')
      options[flag] = rest[++i]
    } else throw new Error('Unknown option')
  }
  const environment = options['--env']
  if (!['local', 'staging', 'production'].includes(environment))
    throw new Error('Explicit --env local|staging|production environment required')
  if (environment === 'local' && options['--remote']) throw new Error('local cannot use --remote')
  if (environment !== 'local' && !options['--remote'])
    throw new Error('Remote environments require --remote')
  const execute = options['--execute'] === true
  let sql = inspectSql
  if (operation === 'retry') {
    const id = options['--id']
    if (typeof id !== 'string' || !/^[A-Za-z0-9_:-]{1,200}$/.test(id))
      throw new Error('A safe exact --id is required')
    if (execute && options['--confirm'] !== `${environment}:${kind}:${id}`)
      throw new Error('Write confirmation required: --confirm ENV:KIND:ID')
    if (kind === 'email') {
      // A retry must NEVER reset first_attempt_at or change provider key. Older
      // ambiguous sends require provider reconciliation, not an unsafe force flag.
      sql = `UPDATE email_outbox SET status='pending',attempts=0,last_error=NULL,next_attempt_at=0,lease_token=NULL,lease_until=NULL
        WHERE id='${id}' AND status='failed' AND (lease_until IS NULL OR lease_until<=unixepoch())
        AND (first_attempt_at IS NULL OR first_attempt_at>unixepoch()-23*3600)
        AND COALESCE(last_error,'')<>'legacy_attempt_requires_review'; SELECT changes() AS changed;`
    } else {
      const provider = options['--provider']
      const billingEnv = options['--billing-env']
      if (
        !['polar', 'stripe'].includes(provider) ||
        !['sandbox', 'production'].includes(billingEnv)
      )
        throw new Error(
          'Billing retry requires --provider polar|stripe and --billing-env sandbox|production',
        )
      sql = `UPDATE billing_events SET failed_at=NULL,attempts=0,last_error=NULL,next_attempt_at=0,lease_token=NULL,lease_until=NULL
        WHERE id='${id}' AND provider='${provider}' AND environment='${billingEnv}' AND processed_at IS NULL
        AND failed_at IS NOT NULL AND (lease_until IS NULL OR lease_until<=unixepoch()); SELECT changes() AS changed;`
    }
  } else if (
    ['--id', '--provider', '--billing-env', '--confirm'].some((flag) => options[flag] !== undefined)
  ) {
    throw new Error('Inspect accepts only environment and execution options')
  }
  const args = [
    '--filter',
    '@saas/api',
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--config',
    config,
    ...(environment === 'local' ? ['--local'] : ['--env', environment, '--remote']),
    '--command',
    sql,
    '--json',
  ]
  return { operation, environment, execute, sql, args }
}

export async function runOperation(op, runner = spawnSync) {
  if (!op.execute)
    return {
      dryRun: true,
      environment: op.environment,
      operation: op.operation,
      sql: op.sql,
      note: 'No command executed; add --execute (and exact confirmation for writes).',
    }
  let result
  try {
    result = runner('pnpm', op.args, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    })
  } catch {
    throw new Error('Operation failed; provider output suppressed')
  }
  if (result.status !== 0 || result.error)
    throw new Error('Operation failed; provider output suppressed')
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error('Invalid operator response; output suppressed')
  }
  if (!Array.isArray(parsed) || parsed.some((part) => part.success === false))
    throw new Error('Invalid operator response; output suppressed')
  const metrics = {}
  for (const part of parsed) {
    for (const row of Array.isArray(part.results) ? part.results : []) {
      for (const [key, value] of Object.entries(row)) {
        if (
          numericFields.has(key) &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0
        )
          metrics[key] = value
      }
    }
  }
  return { dryRun: false, environment: op.environment, operation: op.operation, metrics }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runOperation(buildOperation(process.argv.slice(2))), null, 2))
  } catch (error) {
    // All errors emitted here are fixed, local diagnostic strings, never child output.
    console.error(error instanceof Error ? error.message : 'Operation failed')
    process.exitCode = 1
  }
}
