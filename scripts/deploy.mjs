// Deployment is explicit and never provisions resources or uploads secrets.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { deploy } from '../packages/cli/dist/deploy.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
try {
  const { values } = parseArgs({
    options: {
      env: { type: 'string' },
      'app-url': { type: 'string' },
      confirm: { type: 'string' },
      'migrations-reviewed': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      preflight: { type: 'boolean' },
    },
  })
  await deploy(root, {
    environment: values.env ?? '',
    appUrl: values['app-url'] ?? process.env.DEPLOY_APP_URL ?? '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    confirm: values.confirm,
    migrationsReviewed: values['migrations-reviewed'],
    dryRun: values['dry-run'],
    preflight: values.preflight,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Deployment failed')
  process.exitCode = 1
}
