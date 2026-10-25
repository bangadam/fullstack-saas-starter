import assert from 'node:assert/strict'
import { smokeOptions } from './smoke-options.mjs'

const { baseUrl, credentials } = smokeOptions(process.env)
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)) {
  throw new Error('Lifecycle smoke is local-only: it creates and deletes a temporary file')
}
let cookie = ''
async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Origin: baseUrl,
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}
const login = await request('/api/auth/sign-in/email', {
  method: 'POST',
  body: JSON.stringify(credentials),
})
assert.equal(login.status, 200, 'demo login')
cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .join('; ')
assert.ok(cookie, 'session issued')
let fileId
try {
  for (const path of [
    '/api/account/security',
    '/api/account/sessions',
    '/api/account/deletion',
    '/api/billing/subscription',
  ]) {
    const res = await request(path)
    assert.equal(res.status, 200, path)
    const body = await res.json()
    if (path.endsWith('/sessions')) {
      assert.ok(
        body.items.some((item) => item.current),
        'current session is identified',
      )
      assert.ok(
        body.items.every((item) => !('token' in item)),
        'session tokens excluded',
      )
    }
    console.log(`PASS ${path}`)
  }
  const exported = await request('/api/account/export')
  assert.equal(exported.status, 200, 'account export')
  assert.equal(exported.headers.get('cache-control'), 'no-store')
  const data = await exported.json()
  assert.ok(data.user.id, 'export has current user')
  for (const field of ['projects', 'files', 'subscriptions', 'audit']) {
    assert.ok(
      data[field].every((item) => item.userId === data.user.id),
      `export ${field} ownership`,
    )
  }
  assert.ok(!('accounts' in data) && !('sessions' in data), 'export excludes auth credentials')
  console.log('PASS account export ownership and secret exclusion')

  const bytes = 'Lifecycle smoke fixture\n'
  const ticketResponse = await request('/api/files/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      name: `lifecycle-smoke-${Date.now()}.txt`,
      size: Buffer.byteLength(bytes),
      contentType: 'text/plain',
    }),
  })
  assert.equal(ticketResponse.status, 201, 'upload reservation')
  const ticket = await ticketResponse.json()
  fileId = ticket.fileId
  assert.equal(ticket.mode, 'direct', 'local smoke requires direct local storage, not remote S3')
  const pending = await request(`/api/files/${fileId}/download-url`)
  assert.equal(pending.status, 409, 'pending file cannot be downloaded')
  const uploaded = await request(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: bytes,
  })
  assert.equal(uploaded.status, 200, 'direct upload')
  assert.equal((await uploaded.json()).status, 'completed')
  const completed = await request(`/api/files/${fileId}/complete`, { method: 'POST', body: '{}' })
  assert.equal(completed.status, 200, 'completion is idempotent')
  const listing = await (await request('/api/files')).json()
  assert.equal(listing.items.find((file) => file.id === fileId)?.status, 'completed')
  const downloadTicket = await (await request(`/api/files/${fileId}/download-url`)).json()
  const downloaded = await request(downloadTicket.downloadUrl)
  assert.equal(await downloaded.text(), bytes, 'downloaded bytes match upload')
  console.log('PASS storage reserve / pending guard / upload / complete / download')
} finally {
  if (fileId) {
    const deleted = await request(`/api/files/${fileId}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200, 'temporary file cleanup')
    const listing = await (await request('/api/files')).json()
    assert.ok(!listing.items.some((file) => file.id === fileId), 'deleted file is hidden')
    console.log('PASS temporary file deleted; cleanup reservation retained until expiry')
  }
  await request('/api/auth/sign-out', { method: 'POST', body: '{}' })
}
