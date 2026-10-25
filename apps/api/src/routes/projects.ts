import { createProjectSchema, updateProjectSchema } from '@saas/contracts'
import { QuotaExceededError } from '@saas/domain'
import { Hono } from 'hono'
import { ApiError } from '../errors'
import { requireSession } from '../lib/session'
import { parse } from '../lib/validation'
import type { AppBindings } from '../middleware'

export const projectRoutes = new Hono<AppBindings>()

projectRoutes.post('/', async (c) => {
  const ctx = await requireSession(c)
  const input = parse(createProjectSchema, await c.req.json())
  const { projects: projectsService } = c.get('services')
  try {
    const project = await projectsService.create({
      ...input,
      userId: ctx.userId,
    })
    return c.json(project, 201)
  } catch (err) {
    if (err instanceof QuotaExceededError) throw ApiError.quotaExceeded(err.message)
    throw err
  }
})

projectRoutes.get('/', async (c) => {
  const ctx = await requireSession(c)
  const limitRaw = Number(c.req.query('limit') ?? '20')
  const offsetRaw = Number(c.req.query('offset') ?? '0')
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 20
  const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0
  const { projects: projectsService } = c.get('services')
  const page = await projectsService.list({ userId: ctx.userId, limit, offset })
  return c.json(page)
})

projectRoutes.get('/:id', async (c) => {
  const ctx = await requireSession(c)
  const { projects: projectsService } = c.get('services')
  const project = await projectsService.getById(ctx.userId, c.req.param('id'))
  return c.json(project)
})

projectRoutes.patch('/:id', async (c) => {
  const ctx = await requireSession(c)
  const input = parse(updateProjectSchema.omit({ id: true }), await c.req.json())
  const { projects: projectsService } = c.get('services')
  const project = await projectsService.update(ctx.userId, {
    id: c.req.param('id'),
    ...input,
  })
  return c.json(project)
})

projectRoutes.delete('/:id', async (c) => {
  const ctx = await requireSession(c)
  const { projects: projectsService } = c.get('services')
  await projectsService.softDelete(ctx.userId, c.req.param('id'))
  return c.json({ ok: true })
})
