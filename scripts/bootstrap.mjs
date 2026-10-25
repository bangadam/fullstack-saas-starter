// Local-only setup. Configuration planning lives in @saas/cli and is fixture-tested.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { bootstrapLocal } from '../packages/cli/dist/local-setup.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
try {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      preflight: { type: 'boolean' },
      force: { type: 'boolean' },
    },
  })
  await bootstrapLocal(root, {
    dryRun: values['dry-run'],
    preflight: values.preflight,
    force: values.force,
  })
  console.log(
    values['dry-run'] || values.preflight
      ? 'Preflight complete; no local files or database changed.'
      : 'Local bootstrap complete. Next: pnpm dev; pnpm check',
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Bootstrap failed')
  process.exitCode = 1
}
