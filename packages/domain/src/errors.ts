export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Not allowed') {
    super(message, 'forbidden')
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found') {
    super(message, 'not_found')
    this.name = 'NotFoundError'
  }
}

export class QuotaExceededError extends DomainError {
  constructor(message = 'Quota exceeded') {
    super(message, 'quota_exceeded')
    this.name = 'QuotaExceededError'
  }
}
