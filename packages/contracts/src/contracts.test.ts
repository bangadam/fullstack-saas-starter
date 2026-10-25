import { describe, expect, it } from 'vitest'
import {
  createCheckoutSchema,
  createProjectSchema,
  healthResponseSchema,
  listProjectsSchema,
  signInSchema,
  signUpSchema,
  updateProjectSchema,
} from './index'

describe('project contracts', () => {
  it('accepts a minimal project and an optional description', () => {
    expect(createProjectSchema.parse({ name: 'Alpha' })).toEqual({ name: 'Alpha' })
    expect(createProjectSchema.parse({ name: 'Alpha', description: 'Notes' }).description).toBe(
      'Notes',
    )
  })

  it('rejects empty names and oversized fields', () => {
    expect(createProjectSchema.safeParse({ name: '' }).success).toBe(false)
    expect(createProjectSchema.safeParse({ name: 'a'.repeat(121) }).success).toBe(false)
    expect(
      createProjectSchema.safeParse({ name: 'Alpha', description: 'd'.repeat(2001) }).success,
    ).toBe(false)
  })

  it('allows clearing a description with null on update', () => {
    expect(updateProjectSchema.parse({ id: 'p1', description: null }).description).toBeNull()
  })

  it('applies pagination defaults and enforces bounds', () => {
    expect(listProjectsSchema.parse({})).toEqual({ limit: 20, offset: 0 })
    expect(listProjectsSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(listProjectsSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(listProjectsSchema.safeParse({ offset: -1 }).success).toBe(false)
  })
})

describe('auth contracts', () => {
  it('requires an 8 character minimum password on sign up', () => {
    expect(signUpSchema.safeParse({ email: 'a@b.co', password: 'short', name: 'A' }).success).toBe(
      false,
    )
    expect(signUpSchema.parse({ email: 'a@b.co', password: 'longenough', name: 'A' }).name).toBe(
      'A',
    )
  })

  it('requires a non-empty password on sign in', () => {
    expect(signInSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false)
  })
})

describe('billing contracts', () => {
  const urls = { successUrl: 'http://localhost:3000/ok', cancelUrl: 'http://localhost:3000/no' }

  it('accepts paid plans only for checkout', () => {
    expect(
      createCheckoutSchema.safeParse({ plan: 'free', interval: 'monthly', ...urls }).success,
    ).toBe(false)
    expect(
      createCheckoutSchema.safeParse({ plan: 'pro', interval: 'yearly', ...urls }).success,
    ).toBe(true)
  })

  it('requires absolute urls for redirects', () => {
    expect(
      createCheckoutSchema.safeParse({
        plan: 'pro',
        interval: 'monthly',
        successUrl: '/ok',
        cancelUrl: '/no',
      }).success,
    ).toBe(false)
  })
})

describe('health contract', () => {
  it('requires the ok literal and a version', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'degraded', version: '1', timestamp: '' }).success,
    ).toBe(false)
    expect(healthResponseSchema.parse({ status: 'ok', version: '1', timestamp: 't' }).status).toBe(
      'ok',
    )
  })
})
