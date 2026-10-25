import { healthResponseSchema } from '@saas/contracts'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppBindings } from '../middleware'

export const healthRoutes = new Hono<AppBindings>()

healthResponseSchema satisfies z.ZodType

// Readiness lite: verify bindings respond without heavy queries.
healthRoutes.get('/health', async (c) => {
  const checks: Record<string, 'ok' | 'error'> = { db: 'ok', bucket: 'ok', queue: 'ok' }
  try {
    await c.env.DB.prepare('select 1').first()
  } catch {
    checks.db = 'error'
  }
  try {
    // Head-like listing bounded to 1 object; cheap reachability probe.
    await c.env.BUCKET.list({ limit: 1 })
  } catch {
    checks.bucket = 'error'
  }
  const degraded = Object.values(checks).some((v) => v === 'error')
  const body = {
    status: 'ok' as const,
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    ...(degraded ? { checks } : {}),
  }
  return c.json(
    healthResponseSchema.extend({ checks: z.record(z.string()).optional() }).parse(body),
    degraded ? 503 : 200,
  )
})
