/**
 * Upload policy: one place that decides which files this app accepts.
 *
 * Shared by the API route (authorization before an upload URL is issued) and by
 * the presign validator, so the browser and the server can never disagree.
 *
 * Content type is the primary gate. Real-world clients are inconsistent about
 * markdown and other plain-text formats — Chrome sends `text/markdown`, other
 * setups send `application/octet-stream` or nothing at all — so a *known safe
 * extension* is accepted as a fallback. The fallback never overrides an
 * explicitly dangerous type (e.g. `image/svg+xml`, executables).
 */

export interface UploadPolicy {
  maxBytes: number
  allowedTypes: readonly string[]
  /** Extensions accepted when the client sends no useful content type. */
  fallbackExtensions: readonly string[]
  label: string
}

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024

export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  maxBytes: UPLOAD_MAX_BYTES,
  allowedTypes: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/x-markdown',
    'application/json',
  ],
  fallbackExtensions: [
    'md',
    'markdown',
    'txt',
    'csv',
    'log',
    'json',
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
  ],
  label: '25 MB',
}

export interface UploadCandidate {
  name: string
  size: number
  contentType: string
}

/** Types that must never be accepted, whatever the extension says. */
const NEVER_ALLOWED_TYPES = ['image/svg+xml', 'application/x-msdownload', 'application/x-sh']

function normalizeType(contentType: string): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim())
  return match?.[1]?.toLowerCase() ?? ''
}

export function allowedTypesMessage(policy: UploadPolicy = DEFAULT_UPLOAD_POLICY): string {
  return policy.allowedTypes.join(', ')
}

export function isUploadAllowed(
  candidate: UploadCandidate,
  policy: UploadPolicy = DEFAULT_UPLOAD_POLICY,
): boolean {
  return rejectionReasonFor(candidate, policy) === null
}

/** Returns a human-readable rejection reason, or null when the upload is fine. */
export function rejectionReasonFor(
  candidate: UploadCandidate,
  policy: UploadPolicy = DEFAULT_UPLOAD_POLICY,
): string | null {
  if (!Number.isInteger(candidate.size) || candidate.size <= 0) {
    return 'File size must be a positive number of bytes'
  }
  if (candidate.size > policy.maxBytes) {
    return `File exceeds maximum size of ${policy.label}`
  }

  const type = normalizeType(candidate.contentType)
  const isGeneric = type === '' || type === 'application/octet-stream'

  if (!isGeneric) {
    if (NEVER_ALLOWED_TYPES.includes(type)) {
      return `Content type ${type} is not allowed. Allowed: ${allowedTypesMessage(policy)}`
    }
    if (policy.allowedTypes.includes(type)) return null
    return `Content type ${type} is not allowed. Allowed: ${allowedTypesMessage(policy)}`
  }

  const extension = extensionOf(candidate.name)
  if (extension && policy.fallbackExtensions.includes(extension)) return null
  return `Content type ${type || '(empty)'} is not allowed for ".${extension || 'unknown'}" files. Allowed: ${allowedTypesMessage(policy)}`
}
