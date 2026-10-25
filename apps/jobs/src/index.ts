import { cleanupStorage } from './cleanup'
import { parseJobsConfig } from './config'
import { createDb } from './db'
import { createResendSender } from './email'
import { type HandlerDeps, cleanupHandler, recoverJobs } from './handlers'
import type { BillingQueueMessage, CleanupQueueMessage, SendEmailPayload } from './jobs-types'
import { dispatchBatch } from './registry'

type AnyPayload = SendEmailPayload | BillingQueueMessage | CleanupQueueMessage
function dependencies(env: CloudflareEnvironment): HandlerDeps {
  const config = parseJobsConfig(env)
  return {
    db: createDb(env.DB),
    emailSender: createResendSender(config.RESEND_API_KEY, config.EMAIL_FROM),
    emailFrom: config.EMAIL_FROM,
    bucket: env.BUCKET,
    cleanupStorage: async () => {
      const result = await cleanupStorage(env.DB, env.BUCKET)
      console.log(JSON.stringify({ event: 'storage_cleanup', ...result }))
      if (result.failed) throw new Error('storage_cleanup_incomplete')
    },
    config: {
      appName: config.APP_NAME,
      appUrl: config.APP_URL,
      auditLogRetentionDays: config.AUDIT_LOG_RETENTION_DAYS,
      orphanObjectGraceDays: config.ORPHAN_OBJECT_GRACE_DAYS,
      staleOutboxHours: config.STALE_OUTBOX_HOURS,
    },
  }
}
export default {
  async queue(batch: MessageBatch<AnyPayload>, env: CloudflareEnvironment): Promise<void> {
    const summary = await dispatchBatch(batch, dependencies(env))
    console.log(JSON.stringify({ event: 'queue_batch', ...summary }))
  },
  async scheduled(
    _controller: ScheduledController,
    env: CloudflareEnvironment,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const started = Date.now()
        try {
          const deps = dependencies(env)
          // Independently execute cleanup even if durable replay fails.
          const results = await Promise.allSettled([
            recoverJobs(deps),
            cleanupHandler({ type: 'cleanup', kind: 'full', triggeredBy: 'cron' }, deps),
          ])
          const replay = results[0]
          const cleanup = results[1]
          const healthy =
            replay.status === 'fulfilled' &&
            replay.value.failed === 0 &&
            cleanup.status === 'fulfilled' &&
            cleanup.value.outcome === 'ack'
          console.log(
            JSON.stringify({
              event: 'job_recovery',
              healthy,
              durationMs: Date.now() - started,
              ...(replay.status === 'fulfilled' ? replay.value : {}),
              ...(await deps.db.health(Math.floor(Date.now() / 1000))),
            }),
          )
          if (!healthy) throw new Error('recovery_incomplete')
        } catch {
          console.error(
            JSON.stringify({ event: 'job_recovery_failed', durationMs: Date.now() - started }),
          )
          throw new Error('job_recovery_failed')
        }
      })(),
    )
  },
}
