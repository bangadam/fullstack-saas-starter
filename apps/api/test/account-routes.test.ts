import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { type Auth, createAuth } from '@saas/auth'
import { createDb } from '@saas/db'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountDeletionGuard } from '../src/lib/account'
import { errorHandler } from '../src/lib/validation'
import type { AppBindings } from '../src/middleware'
import { accountRoutes } from '../src/routes/account'

const databases: DatabaseSync[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function harness() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  for (const name of [
    '0000_b2c_baseline.sql',
    '0002_storage_lifecycle.sql',
    '0004_account_lifecycle.sql',
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../../../packages/db/drizzle/${name}`, import.meta.url), 'utf8'),
    )
  }
  sqlite.exec(
    "CREATE TABLE billing_checkout_intents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at INTEGER); INSERT INTO users(id,name,email,created_at,updated_at) VALUES('fixture-a','Alice','a@fixture.test',0,0),('fixture-b','Bob','b@fixture.test',0,0)",
  )
  const prepare = (query: string) => {
    let values: (string | number | null)[] = []
    const statement = {
      bind: (...args: typeof values) => {
        values = args
        return statement
      },
      all: async () => ({ results: sqlite.prepare(query).all(...values), success: true, meta: {} }),
      raw: async () => {
        const stmt = sqlite.prepare(query)
        stmt.setReturnArrays(true)
        return stmt.all(...values)
      },
      run: async () => ({
        results: [],
        success: true,
        meta: { changes: Number(sqlite.prepare(query).run(...values).changes) },
      }),
      first: async () => sqlite.prepare(query).get(...values) ?? null,
    }
    return statement
  }
  const db = createDb({ prepare } as never)
  const revokeSession = vi.fn().mockResolvedValue(Response.json({ status: true }))
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get('x-anonymous')
          ? null
          : { user: { id: 'fixture-a' }, session: { id: 'session-a' } },
      listSessions: async () => [
        {
          id: 'session-a',
          userId: 'fixture-a',
          token: 'sensitive-token',
          createdAt: new Date(0),
          expiresAt: new Date('2030-01-01'),
        },
        {
          id: 'session-b',
          userId: 'fixture-b',
          token: 'other-sensitive-token',
          createdAt: new Date(0),
          expiresAt: new Date('2030-01-01'),
        },
      ],
      revokeSession,
    },
  } as unknown as Auth
  const app = new Hono<AppBindings>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('auth', auth)
    await next()
  })
  app.route('/api/account', accountRoutes)
  const request = (path: string, method = 'GET', body?: unknown, anonymous = false) =>
    app.request(
      `/api/account${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(anonymous ? { 'x-anonymous': '1' } : {}),
        },
        ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
      },
      {} as never,
    )
  return { sqlite, db, request, revokeSession }
}

describe('account routes with disposable SQLite fixtures', () => {
  it('requires authentication for all self-service routes', async () => {
    const h = harness()
    for (const [path, method] of [
      ['/export', 'GET'],
      ['/sessions', 'GET'],
      ['/security', 'GET'],
      ['/deletion', 'GET'],
      ['/deletion/prepare', 'POST'],
      ['/sessions/session-b/revoke', 'POST'],
    ]) {
      expect((await h.request(path ?? '', method, { confirmation: 'DELETE' }, true)).status).toBe(
        401,
      )
    }
  })
  it('exports only the authenticated tenant and omits secrets/internal metadata', async () => {
    const h = harness()
    for (const user of ['fixture-a', 'fixture-b']) {
      h.sqlite
        .prepare(
          'INSERT INTO projects(id,user_id,name,description,created_at,updated_at) VALUES(?,?,?,?,0,0)',
        )
        .run(`p-${user}`, user, user, 'Owned project')
      h.sqlite
        .prepare(
          'INSERT INTO files(id,user_id,r2_key,name,size,content_type,created_at) VALUES(?,?,?,?,1,?,0)',
        )
        .run(`f-${user}`, user, `secret-key-${user}`, 'readme.txt', 'text/plain')
      h.sqlite
        .prepare(
          'INSERT INTO audit_logs(id,user_id,action,metadata_json,created_at) VALUES(?,?,?,?,0)',
        )
        .run(`a-${user}`, user, 'project.created', '{"password":"sensitive-audit-secret"}')
    }
    h.sqlite.exec(
      "INSERT INTO accounts(id,user_id,account_id,provider_id,password,access_token,created_at,updated_at) VALUES('credential','fixture-a','fixture-a','credential','sensitive-hash','sensitive-oauth',0,0)",
    )
    const response = await h.request('/export')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(text).not.toMatch(
      /fixture-b|secret-key|sensitive|metadataJson|accessToken|password|sessions/,
    )
    const data = JSON.parse(text)
    expect(data.user.id).toBe('fixture-a')
    expect(data.projects).toHaveLength(1)
    expect(data.files).toHaveLength(1)
    expect(data.audit).toHaveLength(1)
  })
  it('lists safe session IDs and refuses another tenant session revocation', async () => {
    const h = harness()
    const response = await h.request('/sessions')
    const text = await response.text()
    expect(text).not.toMatch(/token|sensitive|session-b/)
    expect(JSON.parse(text).items[0]).toMatchObject({ id: 'session-a', current: true })
    h.sqlite.exec(
      "INSERT INTO sessions(id,user_id,token,expires_at,created_at,updated_at) VALUES('session-b','fixture-b','other-token',2000000000,0,0),('session-a','fixture-a','private-token',2000000000,0,0)",
    )
    expect((await h.request('/sessions/session-b/revoke', 'POST')).status).toBe(404)
    expect(h.revokeSession).not.toHaveBeenCalled()
    expect((await h.request('/sessions/session-a/revoke', 'POST')).status).toBe(200)
    expect(h.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: 'private-token' }, asResponse: true }),
    )
  })
  it('atomically prepares only owned account and blocks nonterminal billing and checkout intents', async () => {
    const h = harness()
    expect((await h.request('/deletion/prepare', 'POST', { confirmation: 'delete' })).status).toBe(
      400,
    )
    h.sqlite.exec(
      "INSERT INTO subscriptions(id,user_id,provider,environment,external_subscription_id,status,plan,interval,created_at,updated_at) VALUES('sub','fixture-a','polar','production','external','active','pro','monthly',0,0)",
    )
    expect(
      (
        await h.request('/deletion/prepare', 'POST', {
          confirmation: 'DELETE',
          userId: 'fixture-b',
        })
      ).status,
    ).toBe(409)
    expect(
      h.sqlite.prepare("SELECT deletion_requested_at FROM users WHERE id='fixture-a'").get()
        ?.deletion_requested_at,
    ).toBeNull()
    h.sqlite.exec(
      "UPDATE subscriptions SET status='canceled'; INSERT INTO billing_checkout_intents VALUES('intent','fixture-a',0)",
    )
    expect((await h.request('/deletion/prepare', 'POST', { confirmation: 'DELETE' })).status).toBe(
      409,
    )
    h.sqlite.exec('DELETE FROM billing_checkout_intents')
    expect(
      (
        await h.request('/deletion/prepare', 'POST', {
          confirmation: 'DELETE',
          userId: 'fixture-b',
        })
      ).status,
    ).toBe(200)
    expect(
      h.sqlite.prepare("SELECT deletion_requested_at FROM users WHERE id='fixture-a'").get()
        ?.deletion_requested_at,
    ).toBeTypeOf('number')
    expect(
      h.sqlite.prepare("SELECT deletion_requested_at FROM users WHERE id='fixture-b'").get()
        ?.deletion_requested_at,
    ).toBeNull()
  })
  it('native password change revokes other sessions even when caller sends false', async () => {
    const h = harness()
    const auth = createAuth({
      db: h.db,
      env: {
        APP_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'disposable-test-secret-at-least-thirty-two-characters',
      },
    })
    const call = (path: string, body: unknown, cookie = '') =>
      auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify(body),
        }),
      )
    const first = await call('/sign-up/email', {
      name: 'Password fixture',
      email: 'password@fixture.test',
      password: 'fixture-password-old',
    })
    const cookie = first.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(first.status).toBe(200)
    expect(
      (
        await call('/sign-in/email', {
          email: 'password@fixture.test',
          password: 'fixture-password-old',
        })
      ).status,
    ).toBe(200)
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(2)
    expect((await call('/update-user', { name: '   ' }, cookie)).status).toBe(400)
    expect((await call('/update-user', { name: '  Updated fixture  ' }, cookie)).status).toBe(200)
    expect(
      h.sqlite.prepare("SELECT name FROM users WHERE email='password@fixture.test'").get()?.name,
    ).toBe('Updated fixture')
    expect(
      (
        await call(
          '/change-password',
          {
            currentPassword: 'fixture-password-old',
            newPassword: 'fixture-password-new',
            revokeOtherSessions: false,
          },
          cookie,
        )
      ).status,
    ).toBe(200)
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(1)
  })
  it('native Better Auth verifies passwords before cleanup and cascade; direct callbacks cannot bypass', async () => {
    const h = harness()
    const bucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      head: vi.fn().mockResolvedValue(null),
    }
    const port = createAccountDeletionGuard({ db: h.db, bucket, billingSafe: async () => true })
    const beforeDelete = vi.fn(port.beforeDelete)
    const auth = createAuth({
      db: h.db,
      env: {
        APP_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'disposable-test-secret-at-least-thirty-two-characters',
      },
      accountDeletion: { beforeDelete },
    })
    const call = (path: string, body: unknown, cookie = '', confirmation = '') =>
      auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
            Cookie: cookie,
            'x-account-delete-confirmation': confirmation,
          },
          body: JSON.stringify(body),
        }),
      )
    const signUp = await call('/sign-up/email', {
      name: 'Disposable',
      email: 'disposable@fixture.test',
      password: 'fixture-password-strong',
    })
    expect(signUp.status).toBe(200)
    const cookie = signUp.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(cookie).not.toBe('')
    const userId = h.sqlite
      .prepare("SELECT id FROM users WHERE email='disposable@fixture.test'")
      .get()?.id as string
    h.sqlite.prepare('UPDATE users SET deletion_requested_at=0 WHERE id=?').run(userId)
    h.sqlite
      .prepare(
        'INSERT INTO files(id,user_id,r2_key,name,size,content_type,created_at) VALUES(?,?,?,?,1,?,0)',
      )
      .run('disposable-file', userId, 'disposable-key', 'file.txt', 'text/plain')
    expect(
      (await call('/delete-user', { password: 'wrong-password' }, cookie, 'DELETE')).status,
    ).toBe(400)
    expect(beforeDelete).not.toHaveBeenCalled()
    expect(
      (await call('/delete-user', { password: 'fixture-password-strong' }, cookie)).status,
    ).toBe(400)
    expect(beforeDelete).not.toHaveBeenCalled()
    const callback = await auth.handler(
      new Request('http://localhost:3000/api/auth/delete-user/callback?token=fixture-token', {
        headers: { Cookie: cookie },
      }),
    )
    expect(callback.status).toBe(403)
    expect(beforeDelete).not.toHaveBeenCalled()
    h.sqlite
      .prepare(
        "INSERT INTO subscriptions(id,user_id,provider,environment,external_subscription_id,status,plan,interval,created_at,updated_at) VALUES('native-sub',?,'stripe','sandbox','native-external','active','pro','monthly',0,0)",
      )
      .run(userId)
    expect(
      (await call('/delete-user', { password: 'fixture-password-strong' }, cookie, 'DELETE'))
        .status,
    ).toBe(409)
    expect(bucket.delete).not.toHaveBeenCalled()
    expect(h.sqlite.prepare('SELECT id FROM users WHERE id=?').get(userId)?.id).toBe(userId)
    h.sqlite.exec("UPDATE subscriptions SET status='canceled' WHERE id='native-sub'")
    expect(
      (await call('/delete-user', { password: 'fixture-password-strong' }, cookie, 'DELETE'))
        .status,
    ).toBe(200)
    expect(bucket.delete).toHaveBeenCalledWith('disposable-key')
    expect(h.sqlite.prepare('SELECT id FROM users WHERE id=?').get(userId)).toBeUndefined()
    expect(h.sqlite.prepare("SELECT id FROM users WHERE id='fixture-b'").get()?.id).toBe(
      'fixture-b',
    )
  })
})
