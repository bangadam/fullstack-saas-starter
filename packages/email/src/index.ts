export * from './templates'

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text: string
}

export interface SendEmailResult {
  id: string | null
  dryRun: boolean
}

export interface EmailJobPayload {
  type: 'send-email'
  to: string
  subject: string
  templateId: string
  payload: Record<string, unknown>
  idempotencyKey: string
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'EmailError'
  }
}

/**
 * Resend HTTP adapter (no SDK — Workers compatible).
 * Idempotency: callers pass an Idempotency-Key so Resend can dedupe retries.
 * dryRun resolves without any network call.
 */
export function createEmailSender(opts: {
  apiKey?: string
  from?: string
  dryRun?: boolean
  fetchImpl?: typeof fetch
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    async sendEmail(input: SendEmailInput, idempotencyKey?: string): Promise<SendEmailResult> {
      if (opts.dryRun || !opts.apiKey) {
        return { id: null, dryRun: true }
      }
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: opts.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      })
      if (!res.ok) throw new EmailError(`Resend send failed with status ${res.status}`, res.status)
      const body = (await res.json()) as { id?: string }
      return { id: body.id ?? null, dryRun: false }
    },
  }
}
