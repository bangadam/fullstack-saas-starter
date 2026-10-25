import { normalizeStripeStatus } from '../normalize'
import type { NormalizedWebhookEvent } from '../types'

const TOLERANCE_SECONDS = 300

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return new Uint8Array(sig)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

/**
 * Verify Stripe-Signature header (t=...,v1=...) against the raw body using the
 * webhook secret, with a 5 minute timestamp tolerance. Throws on any failure.
 */
export async function verifyStripeSignature(
  secret: string,
  headers: Record<string, string>,
  rawBody: ArrayBuffer,
): Promise<void> {
  const header = headers['stripe-signature'] ?? headers['Stripe-Signature']
  if (!header) throw new Error('Missing Stripe-Signature header')
  const parts = header.split(',').map((p) => p.trim().split('='))
  const timestamp = parts.find((p) => p[0] === 't')?.[1]
  const signatures = parts.filter((p) => p[0] === 'v1').map((p) => p[1] ?? '')
  if (!timestamp || signatures.length === 0) throw new Error('Malformed Stripe-Signature header')

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    throw new Error('Stripe signature timestamp outside tolerance')
  }

  const signed = await hmacSha256(
    new TextEncoder().encode(secret),
    `${timestamp}.${new TextDecoder().decode(rawBody)}`,
  )
  for (const sig of signatures) {
    if (timingSafeEqual(signed, hexToBytes(sig))) return
  }
  throw new Error('Stripe signature verification failed')
}

interface StripeEvent {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

function mapStripeSubscription(
  userId: string,
  sub: Record<string, unknown>,
): NormalizedWebhookEvent {
  const items =
    (sub.items as { data?: { price?: { metadata?: Record<string, string> } }[] })?.data ?? []
  const price = items[0]?.price
  const plan = price?.metadata?.plan === 'pro' || sub.plan === 'pro' ? 'pro' : 'free'
  const interval =
    (price?.metadata?.interval as 'monthly' | 'yearly' | undefined) ??
    ((sub.interval as string) === 'yearly' ? 'yearly' : 'monthly')
  return {
    provider: 'stripe',
    environment: 'production',
    externalEventId: '',
    type: 'stripe.subscription',
    userId,
    subscription: {
      externalSubscriptionId: String(sub.id ?? ''),
      externalCustomerId: String(sub.customer ?? ''),
      status: normalizeStripeStatus(String(sub.status ?? 'incomplete')),
      plan,
      interval,
      currentPeriodEnd:
        typeof sub.current_period_end === 'number'
          ? new Date((sub.current_period_end as number) * 1000)
          : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    },
  }
}

/**
 * Verify then normalize a Stripe webhook. The organization id must come from
 * server-side mapping (metadata.organization_id); browser metadata is never trusted.
 */
export async function verifyAndNormalizeStripeWebhook(
  secret: string,
  headers: Record<string, string>,
  rawBody: ArrayBuffer,
): Promise<NormalizedWebhookEvent> {
  await verifyStripeSignature(secret, headers, rawBody)
  const event = JSON.parse(new TextDecoder().decode(rawBody)) as StripeEvent
  const object = event.data?.object ?? {}
  const userId = (object.metadata as Record<string, string> | undefined)?.user_id ?? ''
  const normalized = mapStripeSubscription(userId, object)
  normalized.externalEventId = event.id
  normalized.type = event.type
  return normalized
}

export interface StripeRestClient {
  get(path: string): Promise<unknown>
  post(path: string, form: Record<string, string>): Promise<unknown>
}

/** Minimal fetch-based Stripe REST client (no Node SDK — Workers compatible). */
export function createStripeRestClient(
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): StripeRestClient {
  return {
    async get(path: string) {
      const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secretKey}` },
      })
      if (!res.ok) throw new Error(`Stripe API request failed: ${res.status}`)
      return res.json()
    },
    async post(path: string, form: Record<string, string>) {
      const body = new URLSearchParams(form).toString()
      const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      if (!res.ok) throw new Error(`Stripe API ${path} failed: ${res.status}`)
      return res.json()
    },
  }
}

export async function createStripeCheckout(
  client: StripeRestClient,
  input: {
    userId: string
    priceId: string
    successUrl: string
    cancelUrl: string
  },
): Promise<{ url: string }> {
  const result = (await client.post('/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': '1',
    'metadata[user_id]': input.userId,
    'subscription_data[metadata][user_id]': input.userId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  })) as { url?: string }
  if (!result.url) throw new Error('Stripe checkout session returned no url')
  return { url: result.url }
}

export async function createStripeCustomerPortal(
  client: StripeRestClient,
  input: { customerId: string; returnUrl: string },
): Promise<{ url: string }> {
  const result = (await client.post('/billing_portal/sessions', {
    customer: input.customerId,
    return_url: input.returnUrl,
  })) as { url?: string }
  if (!result.url) throw new Error('Stripe portal session returned no url')
  return { url: result.url }
}
