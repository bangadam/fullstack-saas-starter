import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPLOAD_POLICY,
  allowedTypesMessage,
  isUploadAllowed,
  rejectionReasonFor,
} from './upload-policy'

const MAX = DEFAULT_UPLOAD_POLICY.maxBytes

describe('upload-policy content types', () => {
  it('accepts markdown from browsers that know the type', () => {
    expect(
      rejectionReasonFor({
        name: '2026-09-24-line-mini-app-00-overview.md',
        size: 16_839,
        contentType: 'text/markdown',
      }),
    ).toBeNull()
    expect(
      rejectionReasonFor({ name: 'notes.md', size: 10, contentType: 'text/x-markdown' }),
    ).toBeNull()
  })

  it('accepts markdown sent as application/octet-stream, keyed on the extension', () => {
    // macOS/Linux/Windows disagree about .md, so the extension is the fallback.
    expect(
      rejectionReasonFor({ name: 'readme.md', size: 10, contentType: 'application/octet-stream' }),
    ).toBeNull()
    expect(rejectionReasonFor({ name: 'NOTES.MARKDOWN', size: 10, contentType: '' })).toBeNull()
  })

  it('accepts the image, pdf, csv, text and json types the app advertises', () => {
    for (const contentType of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/json',
    ]) {
      expect(rejectionReasonFor({ name: 'f.bin', size: 10, contentType })).toBeNull()
    }
  })

  it('is case-insensitive about the declared type', () => {
    expect(rejectionReasonFor({ name: 'f.bin', size: 10, contentType: 'IMAGE/PNG' })).toBeNull()
  })

  it('rejects a type that is not allowed and explains what is', () => {
    const reason = rejectionReasonFor({
      name: 'archive.zip',
      size: 10,
      contentType: 'application/zip',
    })
    expect(reason).toContain('application/zip is not allowed')
    expect(reason).toContain('text/markdown')
  })

  it('does not let an extension smuggle an unknown binary type through', () => {
    // .md is allowed, but an explicit dangerous type must still be refused.
    expect(
      rejectionReasonFor({ name: 'payload.md', size: 10, contentType: 'application/x-msdownload' }),
    ).toContain('not allowed')
    expect(
      rejectionReasonFor({ name: 'script.svg', size: 10, contentType: 'image/svg+xml' }),
    ).toContain('not allowed')
    expect(rejectionReasonFor({ name: 'archive.zip', size: 10, contentType: '' })).toContain(
      'not allowed',
    )
  })
})

describe('upload-policy size', () => {
  it('accepts a file at exactly the maximum size', () => {
    expect(rejectionReasonFor({ name: 'a.txt', size: MAX, contentType: 'text/plain' })).toBeNull()
  })

  it('rejects a file over the maximum with a readable limit', () => {
    const reason = rejectionReasonFor({
      name: 'a.txt',
      size: MAX + 1,
      contentType: 'text/plain',
    })
    expect(reason).toContain('maximum size of 25 MB')
  })

  it('rejects a non-positive size', () => {
    expect(rejectionReasonFor({ name: 'a.txt', size: 0, contentType: 'text/plain' })).toContain(
      'size',
    )
  })
})

describe('helpers', () => {
  it('exposes a predicate matching the rejection function', () => {
    expect(isUploadAllowed({ name: 'a.md', size: 5, contentType: 'text/markdown' })).toBe(true)
    expect(isUploadAllowed({ name: 'a.zip', size: 5, contentType: 'application/zip' })).toBe(false)
  })

  it('lists allowed types for error messages', () => {
    const message = allowedTypesMessage()
    expect(message).toContain('text/markdown')
    expect(message).toContain('application/pdf')
  })
})
