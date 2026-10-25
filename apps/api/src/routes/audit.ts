import { auditLogs } from '@saas/db'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { requireSession } from '../lib/session'
import type { AppBindings } from '../middleware'

export const auditRoutes = new Hono<AppBindings>()

// Scoped to the caller's own account.
auditRoutes.get('/', async (c) => {
  const ctx = await requireSession(c)
  const db = c.get('db')
  const limitRaw = Number(c.req.query('limit') ?? '50')
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? limitRaw : 50
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadataJson: auditLogs.metadataJson,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.userId, ctx.userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .all()
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadataJson ? JSON.parse(r.metadataJson) : null,
      createdAt: r.createdAt,
    })),
  })
})
