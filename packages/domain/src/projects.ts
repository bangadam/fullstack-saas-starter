import { randomUUID } from 'node:crypto'
import type { AuditInput } from './audit'
import { NotFoundError, QuotaExceededError } from './errors'

/**
 * Projects domain service.
 *
 * Clean-architecture boundary: this module knows nothing about D1, Drizzle or
 * Hono. Persistence lives behind `ProjectRepository`, and the caller supplies
 * the plan cap through `maxProjectsFor` (null = unlimited). Business rules stay
 * unit-testable with an in-memory repository, and the same service can run
 * against a different database adapter without changes.
 */

export interface CreateProjectInput {
  userId: string
  name: string
  description?: string
}

export interface UpdateProjectInput {
  id: string
  name?: string
  description?: string | null
}

export interface ListProjectsInput {
  userId: string
  limit: number
  offset: number
}

export interface ProjectRecord {
  id: string
  userId: string
  name: string
  description: string | null
  createdAt: Date
}

export interface InsertProjectInput {
  id: string
  userId: string
  name: string
  description: string | null
  /** null means the plan has no project cap. */
  maxProjects: number | null
}

/** Persistence port. Implementations must scope every read/write by userId. */
export interface ProjectRepository {
  /**
   * Atomically inserts the row only while the owner is below `maxProjects`.
   * Returns false when the quota rejected the write, so the service can raise
   * a domain error without a second (racy) count query.
   */
  insertWithinQuota(input: InsertProjectInput): Promise<boolean>
  findById(userId: string, id: string): Promise<ProjectRecord | null>
  list(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: ProjectRecord[]; total: number }>
  update(
    userId: string,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<void>
  softDelete(userId: string, id: string): Promise<void>
}

/** Audit port — the subset of AuditService this service depends on. */
export interface AuditPort {
  append(input: AuditInput): Promise<unknown>
}

export interface ProjectsServiceDeps {
  repository: ProjectRepository
  audit: AuditPort
  /** Resolves the project cap for the owner's current plan. */
  maxProjectsFor: (userId: string) => Promise<number | null>
}

export class ProjectsService {
  constructor(private readonly deps: ProjectsServiceDeps) {}

  async create(input: CreateProjectInput) {
    const maxProjects = await this.deps.maxProjectsFor(input.userId)
    const id = randomUUID()

    const inserted = await this.deps.repository.insertWithinQuota({
      id,
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      maxProjects,
    })
    if (!inserted) {
      throw new QuotaExceededError(
        maxProjects === null
          ? 'Project could not be created'
          : `Project quota of ${maxProjects} reached`,
      )
    }

    await this.deps.audit.append({
      userId: input.userId,
      action: 'project.created',
      targetId: id,
    })
    return this.getById(input.userId, id)
  }

  async getById(userId: string, id: string): Promise<ProjectRecord> {
    const row = await this.deps.repository.findById(userId, id)
    if (!row) throw new NotFoundError('Project not found')
    return row
  }

  async list(input: ListProjectsInput) {
    const { items, total } = await this.deps.repository.list(
      input.userId,
      input.limit,
      input.offset,
    )
    return {
      items,
      total,
      limit: input.limit,
      offset: input.offset,
    }
  }

  async update(userId: string, input: UpdateProjectInput) {
    await this.getById(userId, input.id)
    await this.deps.repository.update(userId, input.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    await this.deps.audit.append({
      userId,
      action: 'project.updated',
      targetId: input.id,
    })
    return this.getById(userId, input.id)
  }

  async softDelete(userId: string, id: string) {
    await this.getById(userId, id)
    await this.deps.repository.softDelete(userId, id)
    await this.deps.audit.append({
      userId,
      action: 'project.deleted',
      targetId: id,
    })
  }
}
