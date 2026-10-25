import { createHash, randomUUID } from 'node:crypto'
import { ValidationError } from './errors'
import { DEFAULT_UPLOAD_POLICY } from './upload-policy'

export interface UploadRequestInput {
  userId: string
  name: string
  size: number
  contentType: string
}

export interface ValidatedUpload {
  r2Key: string
  name: string
  size: number
  contentType: string
}

export const DEFAULT_MAX_SIZE = 50 * 1024 * 1024
/** Kept aligned with the shared upload policy so the two never diverge. */
export const DEFAULT_CONTENT_TYPES = [...DEFAULT_UPLOAD_POLICY.allowedTypes]

/** Sanitize the original filename into a safe trailing path segment. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file'
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  return cleaned.length > 0 ? cleaned : 'file'
}

/**
 * Server-generated key: org/{orgId}/{uuid}/{safeName}. The uuid segment makes
 * keys unguessable and avoids collisions on duplicate names.
 */
export function buildR2Key(userId: string, name: string): string {
  return `user/${userId}/${randomUUID()}/${safeName(name)}`
}

export function validateUploadRequest(
  input: UploadRequestInput,
  opts: { maxSize?: number; allowedContentTypes?: string[] } = {},
): ValidatedUpload {
  const maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE
  const allowed = opts.allowedContentTypes ?? DEFAULT_CONTENT_TYPES
  if (!input.userId || input.userId.includes('/') || input.userId.includes('..')) {
    throw new ValidationError('Invalid userId')
  }
  if (!input.name || input.name.length > 255) {
    throw new ValidationError('Invalid file name')
  }
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > maxSize) {
    throw new ValidationError(`File size must be between 1 and ${maxSize} bytes`)
  }
  if (!allowed.includes(input.contentType)) {
    throw new ValidationError(`Content type ${input.contentType} not allowed`)
  }
  return {
    r2Key: buildR2Key(input.userId, input.name),
    name: input.name,
    size: input.size,
    contentType: input.contentType,
  }
}

export function etagFor(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}
