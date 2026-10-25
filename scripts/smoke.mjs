// HTTP smoke test against a running dev stack (no browser, no extra deps).
// Usage: pnpm smoke   (expects `pnpm dev` to be running on :3000)
//
// Checks the wiring that unit tests cannot: the Web Worker serving pages, the
// /api/* proxy reaching the API Worker, the auth gate, and proxied auth.
import { setTimeout as delay } from 'node:timers/promises'

import { smokeOptions } from './smoke-options.mjs'

const { baseUrl: BASE, credentials } = smokeOptions(process.env)
const results = []
const request = (url, init = {}) =>
  fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'manual', ...init })

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, detail: message })
    console.log(`✖ ${name} — ${message}`)
  }
}

const fail = (message) => {
  throw new Error(message)
}

await check('web serves the landing page', async () => {
  const res = await request(`${BASE}/`)
  if (!res.ok) fail(`status ${res.status}`)
  return `status ${res.status}`
})

await check('web serves /login', async () => {
  const res = await request(`${BASE}/login`)
  if (!res.ok) fail(`status ${res.status}`)
  const html = await res.text()
  if (!html.includes('Log in')) fail('expected the login form in the HTML')
  return 'login form rendered'
})

await check('api health through the /api proxy', async () => {
  const res = await request(`${BASE}/api/health`)
  if (!res.ok) fail(`status ${res.status}`)
  const body = await res.json()
  if (body.status !== 'ok') fail(`unexpected body ${JSON.stringify(body)}`)
  return `version ${body.version}`
})

await check('auth gate redirects a signed-out /dashboard request', async () => {
  const res = await request(`${BASE}/dashboard`, { redirect: 'manual' })
  const location = res.headers.get('location') ?? ''
  if (res.status < 300 || res.status >= 400) fail(`status ${res.status}`)
  if (!location.includes('/login')) fail(`redirected to ${location || 'nowhere'}`)
  return `-> ${location}`
})

await check('session probe reports signed-out without cookies', async () => {
  const res = await request(`${BASE}/api/auth/get-session`)
  if (!res.ok) fail(`status ${res.status}`)
  const body = await res.json()
  if (body?.session) fail('unexpectedly returned a session')
  return 'no session'
})

if (credentials)
  await check('login with smoke credentials succeeds', async () => {
    const res = await request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify(credentials),
    })
    if (!res.ok) fail(`status ${res.status}`)
    const setCookie = res.headers.get('set-cookie') ?? ''
    if (!/better-auth/i.test(setCookie)) fail('no session cookie returned')
    return 'session cookie issued'
  })

await delay(50)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`)
if (failed.length > 0) {
  console.log('Is `pnpm dev` running and is the DB seeded (`pnpm bootstrap`)?')
  process.exit(1)
}
