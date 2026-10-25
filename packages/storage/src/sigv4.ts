/** AWS SigV4 query signing for R2. Uploads are write-once, including retries. */
import { createHash, createHmac } from 'node:crypto'

export interface SigV4Credentials {
  accessKeyId: string
  secretAccessKey: string
  accountId: string
  bucket: string
}
export const R2_REGION = 'auto'
export const R2_SERVICE = 's3'
const sha256Hex = (data: string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest()
const uriEncode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )

export interface PresignInput {
  method: 'PUT' | 'GET'
  key: string
  expiresIn: number
  now?: Date
  contentType?: string
}

function presignUrl(creds: SigV4Credentials, input: PresignInput): string {
  if (!Number.isInteger(input.expiresIn) || input.expiresIn <= 0 || input.expiresIn > 900) {
    throw new Error('expiresIn must be between 1 and 900 seconds')
  }
  const now = input.now ?? new Date()
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`
  const host = `${creds.accountId}.r2.cloudflarestorage.com`
  const headers: Record<string, string> = { host }
  if (input.method === 'PUT') {
    headers['if-none-match'] = '*'
    if (input.contentType) headers['content-type'] = input.contentType.trim()
  }
  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(';')
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresIn),
    'X-Amz-SignedHeaders': signedHeaders,
  }
  const qs = Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key] ?? '')}`)
    .join('&')
  const path = `/${creds.bucket}/${input.key}`.split('/').map(uriEncode).join('/')
  const canonical = [
    input.method,
    path,
    qs,
    `${names.map((name) => `${name}:${headers[name]}`).join('\n')}\n`,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const key = hmac(
    hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, dateStamp), R2_REGION), R2_SERVICE),
    'aws4_request',
  )
  const signature = createHmac('sha256', key)
    .update(`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`)
    .digest('hex')
  return `https://${host}${path}?${qs}&X-Amz-Signature=${signature}`
}

export function generatePresignedUploadUrl(creds: SigV4Credentials, input: PresignInput): string {
  return presignUrl(creds, { ...input, method: 'PUT' })
}
export function generatePresignedDownloadUrl(creds: SigV4Credentials, input: PresignInput): string {
  return presignUrl(creds, { ...input, method: 'GET' })
}
