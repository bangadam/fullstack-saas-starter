import { randomUUID } from 'node:crypto'
import { auditLogs } from '@saas/db'

export interface AuditInput {
  userId: string
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}

export interface AuditLike {
  insert(t: typeof auditLogs): { values(v: unknown): unknown }
}

/** Appends an audit log row. Caller must include the row in a batch if atomicity matters. */
export function auditAppend(db: AuditLike, input: AuditInput) {
  return db.insert(auditLogs).values({
    id: randomUUID(),
    userId: input.userId,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
  })
}

export class AuditService {
  constructor(private readonly db: AuditLike) {}

  /** Awaitable append; resolves once the insert has been executed. */
  async append(input: AuditInput): Promise<void> {
    await auditAppend(this.db, input)
  }
}
