import { execSync } from 'node:child_process'
// Seed dummy data for local development.
// Usage: node scripts/seed.mjs            (local .wrangler D1)
//        node scripts/seed.mjs --remote   (remote D1 — careful!)
// Passwords are hashed with the exact @better-auth/utils node algorithm
// (scrypt N=16384 r=16 p=1 dkLen=64, "salt:key" hex) so seeded users can log in.
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password.normalize('NFKC'), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  })
  return `${salt}:${key.toString('hex')}`
}

const PASSWORD = 'password123'
const now = Math.floor(Date.now() / 1000)
const daysAgo = (d) => now - d * 24 * 60 * 60

const q = (s) => `'${s.replace(/'/g, "''")}'`

const users = [
  { id: 'seed-user-1', name: 'Budi Santoso', email: 'budi@example.com', createdAt: daysAgo(30) },
  { id: 'seed-user-2', name: 'Sari Dewi', email: 'sari@example.com', createdAt: daysAgo(12) },
]

const projects = [
  {
    id: 'seed-project-1',
    userId: 'seed-user-1',
    name: 'Personal Website',
    description: 'Portfolio and blog',
    createdAt: daysAgo(25),
  },
  {
    id: 'seed-project-2',
    userId: 'seed-user-1',
    name: 'Habit Tracker',
    description: 'Daily habit tracking app',
    createdAt: daysAgo(10),
  },
  {
    id: 'seed-project-3',
    userId: 'seed-user-1',
    name: 'Recipe Box',
    description: 'Collection of family recipes',
    createdAt: daysAgo(3),
  },
  {
    id: 'seed-project-4',
    userId: 'seed-user-2',
    name: 'Thesis Notes',
    description: 'Research notes and drafts',
    createdAt: daysAgo(6),
  },
]

const files = [
  {
    id: 'seed-file-1',
    userId: 'seed-user-1',
    r2Key: 'user/seed-user-1/00000000-0000-4000-8000-000000000001/requirements.txt',
    name: 'requirements.txt',
    size: 1024,
    contentType: 'text/plain',
    createdAt: daysAgo(20),
  },
  {
    id: 'seed-file-2',
    userId: 'seed-user-1',
    r2Key: 'user/seed-user-1/00000000-0000-4000-8000-000000000002/logo.png',
    name: 'logo.png',
    size: 45230,
    contentType: 'image/png',
    createdAt: daysAgo(8),
  },
]

const subscriptions = [
  {
    id: 'seed-sub-1',
    userId: 'seed-user-1',
    provider: 'polar',
    environment: 'sandbox',
    externalCustomerId: 'cus_seed_1',
    externalSubscriptionId: 'sub_seed_1',
    status: 'active',
    plan: 'pro',
    interval: 'monthly',
    currentPeriodEnd: now + 30 * 24 * 60 * 60,
    createdAt: daysAgo(15),
  },
]

const auditLogs = [
  ...projects.slice(0, 3).map((p, i) => ({
    id: randomUUID(),
    userId: p.userId,
    action: 'project.created',
    targetType: 'project',
    targetId: p.id,
    createdAt: p.createdAt,
    i,
  })),
  {
    id: randomUUID(),
    userId: 'seed-user-1',
    action: 'subscription.activated',
    targetType: 'subscription',
    targetId: 'sub_seed_1',
    createdAt: daysAgo(15),
    i: 0,
  },
]

const statements = []
statements.push(
  `delete from audit_logs; delete from subscriptions; delete from billing_events; delete from files; delete from projects; delete from sessions; delete from accounts; delete from users;`,
)

for (const u of users) {
  statements.push(
    `insert into users (id, name, email, email_verified, image, created_at, updated_at) values (${q(u.id)}, ${q(u.name)}, ${q(u.email)}, 1, null, ${u.createdAt}, ${u.createdAt});`,
  )
  statements.push(
    `insert into accounts (id, user_id, account_id, provider_id, password, created_at, updated_at) values (${q(randomUUID())}, ${q(u.id)}, ${q(u.id)}, 'credential', ${q(hashPassword(PASSWORD))}, ${u.createdAt}, ${u.createdAt});`,
  )
}
for (const p of projects) {
  statements.push(
    `insert into projects (id, user_id, name, description, created_at, updated_at) values (${q(p.id)}, ${q(p.userId)}, ${q(p.name)}, ${q(p.description)}, ${p.createdAt}, ${p.createdAt});`,
  )
}
for (const f of files) {
  statements.push(
    `insert into files (id, user_id, r2_key, name, size, content_type, created_at) values (${q(f.id)}, ${q(f.userId)}, ${q(f.r2Key)}, ${q(f.name)}, ${f.size}, ${q(f.contentType)}, ${f.createdAt});`,
  )
}
for (const s of subscriptions) {
  statements.push(
    `insert into subscriptions (id, user_id, provider, environment, external_customer_id, external_subscription_id, status, plan, interval, current_period_end, cancel_at_period_end, created_at, updated_at) values (${q(s.id)}, ${q(s.userId)}, ${q(s.provider)}, ${q(s.environment)}, ${q(s.externalCustomerId)}, ${q(s.externalSubscriptionId)}, ${q(s.status)}, ${q(s.plan)}, ${q(s.interval)}, ${s.currentPeriodEnd}, 0, ${s.createdAt}, ${s.createdAt});`,
  )
}
for (const a of auditLogs) {
  statements.push(
    `insert into audit_logs (id, user_id, action, target_type, target_id, metadata_json, created_at) values (${q(a.id)}, ${q(a.userId)}, ${q(a.action)}, ${q(a.targetType)}, ${q(a.targetId)}, null, ${a.createdAt});`,
  )
}

const sql = statements.join('\n') + '\n'

const isRemote = process.argv.includes('--remote')
const args = isRemote ? ['--remote'] : []
const dir = mkdtempSync(join(tmpdir(), 'saas-seed-'))
const file = join(dir, 'seed.sql')
writeFileSync(file, sql)
try {
  execSync(
    `pnpm --filter @saas/api exec wrangler d1 execute saas-db ${args.join(' ')} --file=${file}`,
    {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,
    },
  )
  rmSync(dir, { recursive: true, force: true })
  console.log(`\nSeed complete (${isRemote ? 'REMOTE' : 'local'} D1).`)
  console.log('Dummy accounts:')
  for (const u of users) console.log(`  ${u.email} / ${PASSWORD}`)
} catch {
  process.exit(1)
}
