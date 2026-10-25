import { normalizePolarStatus } from '../normalize'
import type { NormalizedWebhookEvent } from '../types'

interface PolarLike {
  checkouts: {
    create: (
      body: Record<string, unknown>,
    ) => Promise<{ url?: string; customerSessionUrl?: string }>
  }
  customerSessions: {
    create: (body: Record<string, unknown>) => Promise<{ customerPortalUrl?: string; url?: string }>
  }
}

export function createPolarAdapter(opts: {
  accessToken: string
  environment?: 'sandbox' | 'production'
  // The SDK instance is injected so the exact import path can be pinned at the
  // app layer; this keeps the adapter independent of SDK subpath exports.
  client: PolarLike
}) {
  void opts.accessToken
  void opts.environment
  return {
    async createCheckout(input: {
      organizationId: string
      productId: string
      successUrl: string
      metadata: Record<string, string>
    }): Promise<{ url: string }> {
      const res = await opts.client.checkouts.create({
        products: [input.productId],
        success_url: input.successUrl,
        metadata: input.metadata,
      })
      const url = res.url ?? res.customerSessionUrl
      if (!url) throw new Error('Polar checkout returned no url')
      return { url }
    },
    async createCustomerPortal(input: {
      customerId: string
      returnUrl?: string
    }): Promise<{ url: string }> {
      const res = await opts.client.customerSessions.create({
        customer_id: input.customerId,
        ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      })
      const url = res.customerPortalUrl ?? res.url
      if (!url) throw new Error('Polar customer session returned no url')
      return { url }
    },
  }
}

/**
 * Polar webhook verification via Web Crypto HMAC-SHA256 over the raw body,
 * compared against the polar-signature header hex value.
 */
export async function verifyPolarSignature(
  secret: string,
  headers: Record<string, string>,
  rawBody: ArrayBuffer,
): Promise<void> {
  const header = headers['polar-signature'] ?? headers['Polar-Signature']
  if (!header) throw new Error('Missing polar-signature header')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, rawBody)
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (expected !== header) throw new Error('Polar signature verification failed')
}

interface PolarWebhookPayload {
  id?: string
  type?: string
  data?: Record<string, unknown>
}

/** Verify then normalize a Polar webhook payload. */
export async function verifyAndNormalizePolarWebhook(
  secret: string,
  headers: Record<string, string>,
  rawBody: ArrayBuffer,
): Promise<NormalizedWebhookEvent> {
  await verifyPolarSignature(secret, headers, rawBody)
  const payload = JSON.parse(new TextDecoder().decode(rawBody)) as PolarWebhookPayload
  const data = payload.data ?? {}
  const metadata = (data.metadata as Record<string, string> | undefined) ?? {}
  const productPrice = data.product_price as { metadata?: Record<string, string> } | undefined
  const plan = productPrice?.metadata?.plan === 'pro' || metadata.plan === 'pro' ? 'pro' : 'free'
  const interval =
    (productPrice?.metadata?.interval as 'monthly' | 'yearly' | undefined) ??
    (metadata.interval === 'yearly' ? 'yearly' : 'monthly')
  return {
    provider: 'polar',
    environment: 'sandbox',
    externalEventId: String(payload.id ?? ''),
    type: String(payload.type ?? 'unknown'),
    userId: metadata.user_id ?? '',
    subscription: {
      externalSubscriptionId: String(data.id ?? ''),
      externalCustomerId: String(data.customer_id ?? ''),
      status: normalizePolarStatus(String(data.status ?? 'incomplete')),
      plan,
      interval,
      currentPeriodEnd:
        typeof data.current_period_end === 'string'
          ? new Date(data.current_period_end as string)
          : null,
      cancelAtPeriodEnd: data.cancel_at_period_end === true,
    },
  }
}
