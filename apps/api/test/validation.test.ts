import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiError } from '../src/errors'
import { errorBody, errorHandler, parse, zodToApiError } from '../src/lib/validation'
import { secureHeaders } from '../src/middleware'

const schema = z.object({ name: z.string().min(1) })

type Json = {
  error: { code: string; message: string; issues?: { path: string; message: string }[] }
}

describe('validation helpers', () => {
  it('parses valid input', () => {
    expect(parse(schema, { name: 'ok' })).toEqual({ name: 'ok' })
  })

  it('throws ApiError VALIDATION with issues for invalid input', () => {
    try {
      parse(schema, { name: '' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(400)
      expect(apiErr.code).toBe('VALIDATION')
      expect(apiErr.issues?.[0]?.path).toBe('name')
    }
  })
})

describe('error handler', () => {
  const app = new Hono<{ Variables: { logError?: string } }>()
  app.onError(errorHandler)
  app.get('/api-error', () => {
    throw ApiError.notFound('Widget')
  })
  app.get('/zod', () => {
    // parse throws ZodError synchronously; return type must still be Response|Promise.
    throw schema.safeParse({}).error ?? new Error('expected validation error')
  })
  app.get('/unknown', () => {
    throw new Error('internal detail with secrets')
  })

  it('renders ApiError with typed code', async () => {
    const res = await app.request('/api-error')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Json
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toBe('Widget not found')
  })

  it('renders zod errors as 400 VALIDATION', async () => {
    const res = await app.request('/zod')
    expect(res.status).toBe(400)
    const body = (await res.json()) as Json
    expect(body.error.code).toBe('VALIDATION')
    expect(body.error.issues?.length ?? 0).toBeGreaterThan(0)
  })

  it('hides internal error details for unexpected errors', async () => {
    const res = await app.request('/unknown')
    expect(res.status).toBe(500)
    const body = (await res.json()) as Json
    expect(body.error.code).toBe('INTERNAL')
    expect(body.error.message).not.toContain('secrets')
  })

  it('errorBody omits issues when absent', () => {
    expect(errorBody(ApiError.forbidden()).error.issues).toBeUndefined()
  })

  it('zodToApiError maps issue paths', () => {
    try {
      z.object({ a: z.string().email() }).parse({ a: 'nope' })
    } catch (err) {
      const apiErr = zodToApiError(err as z.ZodError)
      expect(apiErr.issues?.[0]?.path).toBe('a')
    }
  })
})

describe('middleware', () => {
  const app = new Hono()
  app.use('*', secureHeaders)
  app.get('/', (c) => c.text('ok'))

  it('sets secure headers on responses', async () => {
    const res = await app.request('/')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })
})
