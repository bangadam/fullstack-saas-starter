export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

export class ValidationError extends StorageError {
  constructor(message: string) {
    super(message, 'validation')
    this.name = 'ValidationError'
  }
}

export class ForbiddenError extends StorageError {
  constructor(message = 'Forbidden') {
    super(message, 'forbidden')
    this.name = 'ForbiddenError'
  }
}
