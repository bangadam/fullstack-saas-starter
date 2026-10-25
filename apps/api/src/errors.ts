export type ApiErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'INTERNAL'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly issues?: { path: string; message: string }[]

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    issues?: { path: string; message: string }[],
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.issues = issues
  }

  static validation(message: string, issues?: { path: string; message: string }[]) {
    return new ApiError(400, 'VALIDATION', message, issues)
  }
  static badRequest(message: string) {
    return new ApiError(400, 'BAD_REQUEST', message)
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message)
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, 'FORBIDDEN', message)
  }
  static notFound(resource = 'Resource') {
    return new ApiError(404, 'NOT_FOUND', `${resource} not found`)
  }
  static conflict(message: string) {
    return new ApiError(409, 'CONFLICT', message)
  }
  static quotaExceeded(message: string) {
    return new ApiError(402, 'QUOTA_EXCEEDED', message)
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL', message)
  }
  static tooManyRequests(message = 'Too many requests, please slow down') {
    return new ApiError(429, 'RATE_LIMITED', message)
  }
}
