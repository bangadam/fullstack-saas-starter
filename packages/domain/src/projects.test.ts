import { describe, expect, it, vi } from 'vitest'
import type { AuditService } from './audit'
import { NotFoundError, QuotaExceededError } from './errors'
import { type ProjectRecord, type ProjectRepository, ProjectsService } from './projects'

/** In-memory repository implementing the ProjectsPort contract. */
class FakeProjectRepository implements ProjectRepository {
  rows: ProjectRecord[] = []
  lastInsertQuota: number | null | undefined
  lastListUser: string | undefined
  lastUpdateUser: string | undefined
  lastDeleteUser: string | undefined

  constructor(seed: ProjectRecord[] = []) {
    this.rows = [...seed]
  }

  async insertWithinQuota(input: {
    id: string
    userId: string
    name: string
    description: string | null
    maxProjects: number | null
  }): Promise<boolean> {
    this.lastInsertQuota = input.maxProjects
    const owned = this.rows.filter((r) => r.userId === input.userId)
    if (input.maxProjects !== null && owned.length >= input.maxProjects) return false
    this.rows.push({
      id: input.id,
      userId: input.userId,
      name: input.name,
      description: input.description,
      createdAt: new Date(),
    })
    return true
  }

  async findById(userId: string, id: string): Promise<ProjectRecord | null> {
    return this.rows.find((r) => r.id === id && r.userId === userId) ?? null
  }

  async list(userId: string, limit: number, offset: number) {
    this.lastListUser = userId
    const owned = this.rows.filter((r) => r.userId === userId)
    return { items: owned.slice(offset, offset + limit), total: owned.length }
  }

  async update(
    userId: string,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<void> {
    this.lastUpdateUser = userId
    const row = this.rows.find((r) => r.id === id && r.userId === userId)
    if (!row) return
    if (patch.name !== undefined) row.name = patch.name
    if (patch.description !== undefined) row.description = patch.description
  }

  async softDelete(userId: string, id: string): Promise<void> {
    this.lastDeleteUser = userId
    this.rows = this.rows.filter((r) => !(r.id === id && r.userId === userId))
  }
}

function makeAudit() {
  const appended: Array<{ userId: string; action: string; targetId?: string }> = []
  const audit = {
    append: vi.fn(async (input: { userId: string; action: string; targetId?: string }) => {
      appended.push(input)
    }),
  } as unknown as AuditService
  return { audit, appended }
}

const USER = 'user-1'
const OTHER_USER = 'user-2'

function record(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    userId: USER,
    name: 'Alpha',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('ProjectsService.create', () => {
  it('creates a project when under the plan limit and records an audit event', async () => {
    const repository = new FakeProjectRepository()
    const { audit, appended } = makeAudit()
    const service = new ProjectsService({
      repository,
      audit,
      maxProjectsFor: async () => 3,
    })

    const project = await service.create({ userId: USER, name: 'Alpha' })

    expect(project.name).toBe('Alpha')
    expect(project.userId).toBe(USER)
    expect(repository.rows).toHaveLength(1)
    expect(appended).toEqual([
      { userId: USER, action: 'project.created', targetId: project.id, targetType: undefined },
    ])
  })

  it('passes the plan limit to the repository so the quota check stays atomic', async () => {
    const repository = new FakeProjectRepository()
    const { audit } = makeAudit()
    const service = new ProjectsService({
      repository,
      audit,
      maxProjectsFor: async () => 3,
    })

    await service.create({ userId: USER, name: 'Alpha' })
    expect(repository.lastInsertQuota).toBe(3)
  })

  it('passes null (unlimited) for a plan without a project cap', async () => {
    const repository = new FakeProjectRepository()
    const { audit } = makeAudit()
    const service = new ProjectsService({
      repository,
      audit,
      maxProjectsFor: async () => null,
    })

    await service.create({ userId: USER, name: 'Alpha' })
    expect(repository.lastInsertQuota).toBeNull()
  })

  it('throws QuotaExceededError when the conditional insert writes no row', async () => {
    const repository = new FakeProjectRepository([
      record({ id: 'a' }),
      record({ id: 'b' }),
      record({ id: 'c' }),
    ])
    const { audit, appended } = makeAudit()
    const service = new ProjectsService({
      repository,
      audit,
      maxProjectsFor: async () => 3,
    })

    await expect(service.create({ userId: USER, name: 'Delta' })).rejects.toBeInstanceOf(
      QuotaExceededError,
    )
    expect(appended).toHaveLength(0)
  })

  it("does not count another user's projects against the quota", async () => {
    const repository = new FakeProjectRepository([
      record({ id: 'a', userId: OTHER_USER }),
      record({ id: 'b', userId: OTHER_USER }),
      record({ id: 'c', userId: OTHER_USER }),
    ])
    const { audit } = makeAudit()
    const service = new ProjectsService({
      repository,
      audit,
      maxProjectsFor: async () => 3,
    })

    await expect(service.create({ userId: USER, name: 'Delta' })).resolves.toBeDefined()
  })
})

describe('ProjectsService reads', () => {
  it('getById scopes the lookup to the calling user', async () => {
    const repository = new FakeProjectRepository([record()])
    const { audit } = makeAudit()
    const service = new ProjectsService({ repository, audit, maxProjectsFor: async () => 3 })

    const project = await service.getById(USER, 'p1')
    expect(project.id).toBe('p1')
  })

  it("getById throws NotFoundError for another user's project (tenant isolation)", async () => {
    const repository = new FakeProjectRepository([record()])
    const { audit } = makeAudit()
    const service = new ProjectsService({ repository, audit, maxProjectsFor: async () => 3 })

    await expect(service.getById(OTHER_USER, 'p1')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('list returns paginated items with the total for that user', async () => {
    const repository = new FakeProjectRepository([
      record({ id: 'p1' }),
      record({ id: 'p2' }),
      record({ id: 'p3' }),
      record({ id: 'other', userId: OTHER_USER }),
    ])
    const { audit } = makeAudit()
    const service = new ProjectsService({ repository, audit, maxProjectsFor: async () => 3 })

    const page = await service.list({ userId: USER, limit: 2, offset: 0 })
    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(3)
    expect(page.limit).toBe(2)
    expect(page.offset).toBe(0)
    expect(repository.lastListUser).toBe(USER)
  })
})

describe('ProjectsService.update and softDelete', () => {
  it('update throws NotFoundError when the project does not belong to the user', async () => {
    const repository = new FakeProjectRepository([record()])
    const { audit } = makeAudit()
    const service = new ProjectsService({ repository, audit, maxProjectsFor: async () => 3 })

    await expect(service.update(OTHER_USER, { id: 'p1', name: 'Hijacked' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('update applies the patch and records an audit event', async () => {
    const repository = new FakeProjectRepository([record()])
    const { audit, appended } = makeAudit()
    const service = new ProjectsService({ repository, audit, maxProjectsFor: async () => 3 })

    const updated = await service.update(USER, { id: 'p1', name: 'Beta' })

    expect(updated.name).toBe('Beta')
    expect(repository.lastUpdateUser).toBe(USER)
    expect(appended.map((a) => a.action)).toEqual(['project.updated'])
  })

  it('softDelete records an audit event after confirming ownership', async () => {
    const repository = new FakeProjectRepository([record()])
    const { audit, appended } = makeAudit()
    const service = new ProjectsService({ repository, audit, maxProjectsFor: async () => 3 })

    await service.softDelete(USER, 'p1')

    expect(repository.rows).toHaveLength(0)
    expect(repository.lastDeleteUser).toBe(USER)
    expect(appended.map((a) => a.action)).toEqual(['project.deleted'])
  })

  it("softDelete throws NotFoundError for another user's project", async () => {
    const repository = new FakeProjectRepository([record()])
    const { audit } = makeAudit()
    const service = new ProjectsService({ repository, audit, maxProjectsFor: async () => 3 })

    await expect(service.softDelete(OTHER_USER, 'p1')).rejects.toBeInstanceOf(NotFoundError)
    expect(repository.rows).toHaveLength(1)
  })
})
