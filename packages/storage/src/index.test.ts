import { describe, expect, it } from 'vitest'
import { generatePresignedDownloadUrl, generatePresignedUploadUrl } from './sigv4'
import type { SigV4Credentials } from './sigv4'
import { buildR2Key, safeName, validateUploadRequest } from './validate'

describe('key generation', () => {
  it('builds user/{userId}/{uuid}/{safeName} keys', () => {
    const key = buildR2Key('user-123', 'My File (1).pdf')
    expect(key).toMatch(/^user\/user-123\/[0-9a-f-]{36}\/My_File__1_\.pdf$/)
  })

  it('sanitizes traversal attempts', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd')
    expect(safeName('a/b/c.png')).toBe('c.png')
  })

  it('validates upload requests', () => {
    const v = validateUploadRequest({
      userId: 'user-1',
      name: 'photo.png',
      size: 1000,
      contentType: 'image/png',
    })
    expect(v.r2Key.startsWith('user/user-1/')).toBe(true)
    expect(() =>
      validateUploadRequest({
        userId: 'user-1',
        name: 'x.exe',
        size: 10,
        contentType: 'application/x-msdownload',
      }),
    ).toThrow()
    expect(() =>
      validateUploadRequest({
        userId: 'user-1',
        name: 'big.png',
        size: 51 * 1024 * 1024,
        contentType: 'image/png',
      }),
    ).toThrow()
  })
})

describe('SigV4 presigning determinism', () => {
  const creds: SigV4Credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    accountId: 'abc123',
    bucket: 'my-bucket',
  }
  const fixedNow = new Date('2026-10-24T00:00:00.000Z')

  it('produces a stable, correctly-shaped upload URL', () => {
    const url1 = generatePresignedUploadUrl(creds, {
      method: 'PUT',
      key: 'user/u1/x/f.txt',
      expiresIn: 900,
      now: fixedNow,
    })
    const url2 = generatePresignedUploadUrl(creds, {
      method: 'PUT',
      key: 'user/u1/x/f.txt',
      expiresIn: 900,
      now: fixedNow,
    })
    expect(url1).toBe(url2)
    expect(url1).toContain('https://abc123.r2.cloudflarestorage.com/my-bucket/user/u1/x/f.txt')
    expect(url1).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url1).toContain('X-Amz-Expires=900')
    expect(url1).toMatch(/X-Amz-Signature=[0-9a-f]{64}/)
  })

  it('uses AWS timestamp syntax, encoded keys and signed immutable upload headers', () => {
    const url = new URL(
      generatePresignedUploadUrl(creds, {
        method: 'PUT',
        key: 'user/u1/a b/日本.txt',
        expiresIn: 600,
        now: fixedNow,
        contentType: 'text/plain',
      }),
    )
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261024T000000Z')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host;if-none-match')
    expect(url.pathname).toBe('/my-bucket/user/u1/a%20b/%E6%97%A5%E6%9C%AC.txt')
  })

  it('produces a stable download URL and rejects bad expiry', () => {
    const url = generatePresignedDownloadUrl(creds, {
      method: 'GET',
      key: 'user/u1/x/f.txt',
      expiresIn: 60,
      now: fixedNow,
    })
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url).toContain('X-Amz-Signature=')
    expect(() =>
      generatePresignedUploadUrl(creds, {
        method: 'PUT',
        key: 'k',
        expiresIn: 3600,
        now: fixedNow,
      }),
    ).toThrow('expiresIn')
  })
})
