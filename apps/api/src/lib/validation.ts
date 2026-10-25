import { ForbiddenError, NotFoundError, QuotaExceededError } from '@saas/domain'
import type { Context } from 'hono'
import { ZodError, type ZodSchema } from 'zod'
import { ApiError } from '../errors'

export type ErrorBody = {
  error: {
    code: string
    message: string
    issues?: { path: string; message: string }[]
  }
}

export function errorBody(err: ApiError): ErrorBody {
  return {
    error: { code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) },
  }
}

// Never leaks stack traces or internal messages to the client; details go to logs only.
// Structurally compatible with Hono's ErrorHandler for any env carrying logError.
export async function errorHandler(
  err: Error,
  c: {
    set: (key: 'logError', value: string) => void
    json: (data: unknown, status: 400 | 402 | 403 | 404 | 429 | 500) => Response
  },
): Promise<Response> {
  if (err instanceof ApiError) {
    return c.json(errorBody(err), err.status as 400 | 402 | 403 | 404 | 429 | 500)
  }
  if (err instanceof ZodError) {
    return c.json(errorBody(zodToApiError(err)), 400)
  }
  // Domain errors are expected client-facing outcomes, not 500s.
  if (err instanceof ForbiddenError) {
    return c.json(errorBody(ApiError.forbidden(err.message)), 403)
  }
  if (err instanceof NotFoundError) {
    return c.json(errorBody(ApiError.notFound()), 404)
  }
  if (err instanceof QuotaExceededError) {
    return c.json(errorBody(ApiError.quotaExceeded(err.message)), 402)
  }
  c.set('logError', err.message)
  return c.json(errorBody(ApiError.internal()), 500)
}

export function zodToApiError(err: ZodError): ApiError {
  return ApiError.validation(
    'Request validation failed',
    err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  )
}

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodToApiError(err)
    }
    throw err
  }
}

export function isValidOrganizationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
