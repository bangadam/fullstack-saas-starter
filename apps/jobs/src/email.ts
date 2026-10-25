// Email rendering + sending for the Jobs Worker, built on @saas/email
// templates and adapter. The queue payload carries templateId + payload, so
// the worker renders server-side right before sending.
import {
  type EmailTemplate,
  planChanged,
  receiptPlaceholder,
  resetPassword,
  verifyEmail,
  welcome,
} from '@saas/email'
// Intentionally no dry-run sender: missing credentials must leave durable work retryable.

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  send(input: {
    to: string
    subject: string
    html: string
    text: string
    idempotencyKey: string
  }): Promise<void>
}

export class ProviderError extends Error {
  constructor(readonly status: number) {
    super(`provider_${status}`)
  }
}

export function createResendSender(
  apiKey: string | undefined,
  from: string,
  fetcher: typeof fetch = fetch,
): EmailSender {
  return {
    async send({ idempotencyKey, ...input }) {
      if (!apiKey) throw new Error('email_not_configured')
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ from, ...input }),
        signal: AbortSignal.timeout(15_000),
      })
      // Never read/log provider response bodies: they can echo recipients or content.
      await response.body?.cancel()
      if (!response.ok) throw new ProviderError(response.status)
    },
  }
}

export interface TemplateContextInput {
  appName: string
  appUrl: string
}

export function renderTemplate(
  templateId: string,
  params: Record<string, unknown>,
  ctx: TemplateContextInput,
): RenderedEmail {
  const url = typeof params.url === 'string' ? params.url : ''
  const name = typeof params.name === 'string' ? params.name : 'there'
  let tpl: EmailTemplate
  switch (templateId) {
    case 'verify-email':
      tpl = verifyEmail(ctx, url)
      break
    case 'reset-password':
      tpl = resetPassword(ctx, url)
      break
    case 'plan-changed':
      tpl = planChanged(ctx, {
        plan: typeof params.plan === 'string' ? params.plan : 'pro',
        status: typeof params.status === 'string' ? params.status : 'active',
      })
      break
    case 'receipt':
      tpl = receiptPlaceholder(ctx, {
        plan: typeof params.plan === 'string' ? params.plan : 'pro',
        interval: typeof params.interval === 'string' ? params.interval : 'monthly',
      })
      break
    case 'welcome':
      tpl = welcome(ctx, name)
      break
    default:
      return { subject: 'Notification', html: `<p>Hi ${name},</p>`, text: `Hi ${name}` }
  }
  return { subject: tpl.subject, html: tpl.html, text: tpl.text }
}
