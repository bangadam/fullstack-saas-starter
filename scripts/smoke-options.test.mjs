import assert from 'node:assert/strict'
import { test } from 'node:test'
import { smokeOptions } from './smoke-options.mjs'

test('local smoke uses the seeded account', () => {
  assert.deepEqual(smokeOptions({}).credentials, {
    email: 'sari@example.com',
    password: 'password123',
  })
})

test('remote smoke never sends seeded credentials', () => {
  assert.equal(smokeOptions({ SMOKE_BASE_URL: 'https://example.com' }).credentials, null)
})

test('explicit credentials are paired and require HTTPS remotely', () => {
  assert.throws(() => smokeOptions({ SMOKE_EMAIL: 'test@example.com' }), /both/)
  assert.throws(
    () =>
      smokeOptions({
        SMOKE_BASE_URL: 'http://example.com',
        SMOKE_EMAIL: 'test@example.com',
        SMOKE_PASSWORD: 'fixture',
      }),
    /HTTPS/,
  )
  assert.deepEqual(
    smokeOptions({
      SMOKE_BASE_URL: 'https://example.com/',
      SMOKE_EMAIL: 'test@example.com',
      SMOKE_PASSWORD: 'fixture',
    }),
    {
      baseUrl: 'https://example.com',
      credentials: { email: 'test@example.com', password: 'fixture' },
    },
  )
})

test('rejects URLs with credentials, non-root paths or unsupported protocols', () => {
  for (const base of [
    'https://user:password@example.com',
    'https://example.com/path',
    'file:///tmp/app',
    'https://example.com/?secret=value',
  ]) {
    assert.throws(() => smokeOptions({ SMOKE_BASE_URL: base }))
  }
})
