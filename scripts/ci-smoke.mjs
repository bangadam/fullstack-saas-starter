import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

if (!process.env.CI)
  throw new Error('ci-smoke starts a disposable CI stack; use pnpm dev and pnpm smoke locally')
const stack = spawn('pnpm', ['dev'], { stdio: 'inherit', detached: process.platform !== 'win32' })
let exited = false
stack.on('exit', () => {
  exited = true
})
stack.on('error', () => {
  exited = true
})
try {
  const deadline = Date.now() + 180_000
  let ready = false
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch('http://localhost:3000/api/health', {
        signal: AbortSignal.timeout(3000),
      })
      if (response.ok) {
        ready = true
        break
      }
    } catch {}
    await delay(1500)
  }
  if (!ready) throw new Error('Local CI stack did not become ready')
  for (const script of ['scripts/smoke.mjs', 'scripts/lifecycle-smoke.mjs']) {
    const code = await new Promise((resolve, reject) => {
      const smoke = spawn(process.execPath, [script], { stdio: 'inherit' })
      smoke.on('error', reject)
      smoke.on('exit', (status) => resolve(status ?? 1))
    })
    if (code !== 0) {
      process.exitCode = code
      break
    }
  }
} finally {
  if (stack.pid) {
    try {
      if (process.platform === 'win32') stack.kill('SIGTERM')
      else process.kill(-stack.pid, 'SIGTERM')
    } catch {}
    await delay(2000)
    if (process.platform !== 'win32') {
      try {
        process.kill(-stack.pid, 'SIGKILL')
      } catch {}
    }
  }
}
