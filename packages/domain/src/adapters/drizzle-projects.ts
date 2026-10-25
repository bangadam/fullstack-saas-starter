import { type Db, projects } from '@saas/db'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import type { InsertProjectInput, ProjectRecord, ProjectRepository } from '../projects'

/** D1/Drizzle implementation of the projects port. */
export class DrizzleProjectsRepository implements ProjectRepository {
  constructor(private readonly db: Db) {}

  async insertWithinQuota(input: InsertProjectInput): Promise<boolean> {
    // D1 has no interactive transactions, so the quota check and insert run as
    // one conditional INSERT..SELECT. D1's serial per-database execution keeps
    // racing inserts from passing the count check. A null cap means the plan
    // has no limit, so a plain insert is used instead.
    const result =
      input.maxProjects === null
        ? await this.db.run(sql`insert into projects (id, user_id, name, description, created_at, updated_at)
              values (${input.id}, ${input.userId}, ${input.name}, ${input.description}, unixepoch(), unixepoch())`)
        : await this.db.run(sql`insert into projects (id, user_id, name, description, created_at, updated_at)
              select ${input.id}, ${input.userId}, ${input.name}, ${input.description}, unixepoch(), unixepoch()
              where (select count(*) from projects where user_id = ${input.userId} and deleted_at is null) < ${input.maxProjects}`)
    return (result.meta?.changes ?? 0) > 0
  }

  async findById(userId: string, id: string): Promise<ProjectRecord | null> {
    const row = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
      .get()
    if (!row) return null
    return toRecord(row)
  }

  async list(userId: string, limit: number, offset: number) {
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
        .limit(limit)
        .offset(offset)
        .all(),
      this.db
        .select({ value: count() })
        .from(projects)
        .where(and(eq(projects.userId, userId), isNull(projects.deletedAt))),
    ])
    return {
      items: rows.map(toRecord),
      total: Number(totals[0]?.value ?? 0),
    }
  }

  async update(
    userId: string,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<void> {
    await this.db
      .update(projects)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
  }

  async softDelete(userId: string, id: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
  }
}

type ProjectRow = typeof projects.$inferSelect

function toRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
  }
}
