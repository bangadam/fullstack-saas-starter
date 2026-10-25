import { describe, expect, it } from 'vitest'
import { checkOrigin, isSafeMethod, isWebhookPath, normalizeOrigin } from '../src/lib/origin'

const ALLOWED = ['http://localhost:3000']

describe('normalizeOrigin', () => {
  it('lowercases and strips a trailing slash', () => {
    expect(normalizeOrigin('HTTP://Localhost:3000/')).toBe('http://localhost:3000')
    expect(normalizeOrigin('https://app.example.com')).toBe('https://app.example.com')
  })

  it('returns null for the opaque "null" origin', () => {
    expect(normalizeOrigin('null')).toBeNull()
    expect(normalizeOrigin('')).toBeNull()
    expect(normalizeOrigin(null)).toBeNull()
  })
})

describe('isSafeMethod', () => {
  it('treats read-only methods as safe', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(isSafeMethod(method)).toBe(true)
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isSafeMethod(method)).toBe(false)
    }
  })
})

describe('isWebhookPath', () => {
  it('matches provider webhook endpoints under /webhooks', () => {
    expect(isWebhookPath('/webhooks/polar')).toBe(true)
    expect(isWebhookPath('/webhooks/stripe')).toBe(true)
    expect(isWebhookPath('/projects')).toBe(false)
  })
})

describe('checkOrigin', () => {
  it('allows safe methods without an Origin header', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(checkOrigin({ method, path: '/projects', origin: null, allowed: ALLOWED }).ok).toBe(
        true,
      )
    }
  })

  it('allows a mutating request from an allowed origin', () => {
    const decision = checkOrigin({
      method: 'POST',
      path: '/projects',
      origin: 'http://localhost:3000',
      allowed: ALLOWED,
    })
    expect(decision).toEqual({ ok: true })
  })

  it('allows trailing-slash and case differences in the origin', () => {
    const decision = checkOrigin({
      method: 'POST',
      path: '/projects',
      origin: 'HTTP://LOCALHOST:3000/',
      allowed: ALLOWED,
    })
    expect(decision.ok).toBe(true)
  })

  it('rejects a mutating request from a foreign origin', () => {
    const decision = checkOrigin({
      method: 'POST',
      path: '/projects',
      origin: 'https://evil.example',
      allowed: ALLOWED,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toContain('Origin')
  })

  it('rejects a mutating request with no Origin (login CSRF defence)', () => {
    const decision = checkOrigin({
      method: 'POST',
      path: '/auth/sign-in/email',
      origin: null,
      allowed: ALLOWED,
    })
    expect(decision.ok).toBe(false)
  })

  it('rejects the opaque "null" origin', () => {
    const decision = checkOrigin({
      method: 'DELETE',
      path: '/projects/1',
      origin: 'null',
      allowed: ALLOWED,
    })
    expect(decision.ok).toBe(false)
  })

  it('exempts webhook paths, which are authenticated by signature instead', () => {
    const decision = checkOrigin({
      method: 'POST',
      path: '/webhooks/polar',
      origin: null,
      allowed: ALLOWED,
    })
    expect(decision).toEqual({ ok: true })
  })

  it('allows a non-browser client that authenticates with a bearer token', () => {
    const decision = checkOrigin({
      method: 'POST',
      path: '/projects',
      origin: null,
      allowed: ALLOWED,
      hasAuthorizationHeader: true,
    })
    expect(decision.ok).toBe(true)
  })

  it('accepts several allowed origins (staging + production)', () => {
    const decision = checkOrigin({
      method: 'POST',
      path: '/projects',
      origin: 'https://staging.example.com',
      allowed: ['https://app.example.com', 'https://staging.example.com'],
    })
    expect(decision.ok).toBe(true)
  })
})
