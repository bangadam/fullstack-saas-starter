import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildOperation, runOperation } from './operations.mjs'

 test('explicit environment and target required; all operations default to dry run', async () => {
  assert.throws(() => buildOperation(['inspect']), /environment/)
  assert.throws(() => buildOperation(['inspect', '--env', 'production']), /--remote/)
  const op = buildOperation(['inspect', '--env', 'local'])
  assert.equal(op.execute, false)
  assert.ok(op.args.includes('--local'))
  assert.ok(!op.args.includes('--remote'))
  let calls = 0
  const result = await runOperation(op, () => {
    calls++
    throw new Error('should not execute')
  })
  assert.equal(calls, 0)
  assert.equal(result.dryRun, true)
})
test('retry writes require exact env/kind/id confirmation', () => {
  const argv = ['retry', 'email', '--id', 'row-1', '--env', 'staging', '--remote']
  assert.equal(buildOperation(argv).execute, false)
  assert.throws(() => buildOperation([...argv, '--execute']), /confirmation/)
  assert.throws(
    () => buildOperation([...argv, '--execute', '--confirm', 'production:email:row-1']),
    /confirmation/,
  )
  const op = buildOperation([...argv, '--execute', '--confirm', 'staging:email:row-1'])
  assert.equal(op.execute, true)
  assert.ok(op.sql.includes("status='failed'"))
  assert.ok(op.sql.includes('first_attempt_at'))
  assert.ok(op.sql.includes('23*3600'))
  assert.ok(!op.sql.includes('first_attempt_at=NULL'))
})
test('billing retry requires scope and never replays processed events', () => {
  assert.throws(
    () => buildOperation(['retry', 'billing', '--id', 'b', '--env', 'local']),
    /provider/,
  )
  const op = buildOperation([
    'retry',
    'billing',
    '--id',
    'b',
    '--env',
    'local',
    '--provider',
    'polar',
    '--billing-env',
    'sandbox',
  ])
  assert.ok(op.sql.includes("provider='polar'"))
  assert.ok(op.sql.includes("environment='sandbox'"))
  assert.ok(op.sql.includes('processed_at IS NULL'))
})
test('rejects SQL injection, unknown flags and implicit production environment', () => {
  assert.throws(
    () => buildOperation(['retry', 'email', '--id', "x';DROP TABLE users;--", '--env', 'local']),
    /id/,
  )
  assert.throws(() => buildOperation(['inspect', '--env', 'prod']), /environment/)
  assert.throws(() => buildOperation(['inspect', '--env', 'local', '--force']), /Unknown/)
  assert.throws(() => buildOperation(['inspect', '--env', 'local', '--remote']), /local/)
})
test('only aggregate safe numeric output escapes wrangler, never stderr or payloads', async () => {
  const op = buildOperation(['inspect', '--env', 'local', '--execute'])
  const result = await runOperation(op, () => ({
    status: 0,
    stdout: JSON.stringify([
      {
        results: [
          {
            emailPending: 2,
            emailLagSeconds: 600,
            to: 'SECRET',
            payload_json: 'TOKEN',
            emailFailed: 'secret',
          },
        ],
      },
    ]),
    stderr: 'private',
  }))
  assert.deepEqual(result, {
    dryRun: false,
    environment: 'local',
    operation: 'inspect',
    metrics: { emailPending: 2, emailLagSeconds: 600 },
  })
  await assert.rejects(
    runOperation(op, () => ({ status: 1, stderr: 'SECRET API KEY' })),
    /Operation failed; provider output suppressed/,
  )
  await assert.rejects(
    runOperation(op, () => ({ status: 0, stdout: 'SECRET invalid JSON' })),
    /Invalid operator response/,
  )
})
test('executes argument array without shell interpolation and only reports affected row counts', async () => {
  const op = buildOperation([
    'retry',
    'email',
    '--id',
    'row-1',
    '--env',
    'local',
    '--execute',
    '--confirm',
    'local:email:row-1',
  ])
  const result = await runOperation(op, (command, args, options) => {
    assert.equal(command, 'pnpm')
    assert.deepEqual(args.slice(0, 6), [
      '--filter',
      '@saas/api',
      'exec',
      'wrangler',
      'd1',
      'execute',
    ])
    assert.equal(options.shell, false)
    assert.ok(args.includes('--json'))
    assert.ok(args.includes('--command'))
    assert.ok(args.includes(op.sql))
    return { status: 0, stdout: JSON.stringify([{ results: [{ changed: 1 }] }]) }
  })
  assert.deepEqual(result.metrics, { changed: 1 })
})
