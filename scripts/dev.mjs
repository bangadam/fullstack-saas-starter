// Root dev orchestrator. Wrangler 4.152 has a startup race: two `wrangler dev`
// instances launched at the same instant can both fail with
// "Address already in use (socket \"direct:1:default\")" even on distinct
// ports. Staggering each app's start by a few seconds avoids it while keeping
// all three servers in one foreground process (Ctrl+C kills the whole tree).
//
// Startup is also gated on readiness: the API Worker needs ~20s before its
// service binding answers, and until then the Web Worker proxy returns 500
// "Network connection lost". Waiting for /api/health removes that confusing
// window and prints one clear banner with URLs and demo credentials.
import { spawn } from 'node:child_process'
import process from 'node:process'

const STAGGER_MS = 4000
const READY_TIMEOUT_MS = 120_000
const READY_POLL_MS = 1500

const WEB_URL = 'http://localhost:3000'

const apps = [
  { name: 'web', pkg: '@saas/web' },
  { name: 'api', pkg: '@saas/api' },
  { name: 'jobs', pkg: '@saas/jobs-worker' },
]

const children = []
let shuttingDown = false

function start(app) {
  const child = spawn('pnpm', ['--filter', app.pkg, 'run', 'dev'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  })
  children.push(child)
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[${app.name}] exited unexpectedly with code ${code} — shutting down.`)
      shutdown(code ?? 1)
    }
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try {
      child.kill('SIGINT')
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(code), 1500)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls the proxied health endpoint until the whole stack answers. */
async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastStatus = 'no response'
  while (Date.now() < deadline) {
    if (shuttingDown) return false
    try {
      const res = await fetch(`${WEB_URL}/api/health`)
      lastStatus = `HTTP ${res.status}`
      if (res.ok) return true
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    await sleep(READY_POLL_MS)
  }
  console.error(`[dev] stack did not become ready (${lastStatus}).`)
  return false
}

function printBanner() {
  console.log(
    [
      '',
      '  ✓ SaaS boilerplate is running',
      '',
      `    app         ${WEB_URL}`,
      '    api worker  http://localhost:8787 (private, via service binding)',
      '    jobs worker http://localhost:8788 (queues + cron)',
      '',
      '    demo logins (after `pnpm bootstrap`):',
      '      budi@example.com / password123',
      '      sari@example.com / password123',
      '',
      '    pnpm check | pnpm smoke | pnpm test | pnpm stop',
      '',
    ].join('\n'),
  )
}

for (const [index, app] of apps.entries()) {
  if (index > 0) await sleep(STAGGER_MS)
  console.log(`[dev] starting ${app.name} (${app.pkg})...`)
  start(app)
}

if (await waitForReady()) {
  printBanner()
} else if (!shuttingDown) {
  console.error('[dev] giving up on the readiness check — the processes keep running.')
}
