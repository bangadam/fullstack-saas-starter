#!/usr/bin/env node
// The CLI is compiled to dist/ by `pnpm --filter @saas/cli build`, which the
// root `setup`/`check` scripts run first. Importing the module alone does
// nothing — main() must be invoked to parse argv.
import { main } from '../dist/cli.js'

await main(process.argv)
