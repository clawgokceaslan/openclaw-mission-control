import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Skill, Tag, TaskComment, TaskEntity, TaskSubtask } from '../../shared/types/entities.js'
import { resolveTagColor } from './tag-color.js'

export type PlannedGatewayTaskRepositoryRow = {
  task: TaskEntity
  project: {
    id: string
    name: string
    description?: string
    metrics?: Record<string, unknown>
  }
}

export type RunningGatewayTaskRepositoryRow = PlannedGatewayTaskRepositoryRow

type TaskPayload = Record<string, unknown> & {
  description?: string
  comments?: TaskComment[]
  customFields?: Record<string, unknown>
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseTaskComments(value: unknown): TaskComment[] {
  if (!Array.isArray(value)) return []
  const comments: TaskComment[] = []
  for (const raw of value) {
    const item = asObject(raw)
    const id = typeof item.id === 'string' ? item.id : randomUUID()
    const body = typeof item.body === 'string' ? item.body : ''
    if (!body.trim()) continue
    comments.push({
      id,
      body,
      authorName: typeof item.authorName === 'string' && item.authorName.trim() ? item.authorName : 'Operator',
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
    })
  }
  return comments
}

export class TaskRepository extends BaseRepository<TaskEntity> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(projectId: string): Promise<TaskEntity[]> {
    const rows = await this.db.prepare('SELECT * FROM tasks WHERE project_id = @projectId ORDER BY updated_at DESC').all({ projectId })
    return rows.map((row: any) => this.map(row))
  }

  async listAll(orgId: string): Promise<TaskEntity[]> {
    const rows = await this.db
      .prepare(
        'SELECT t.* FROM tasks t JOIN projects b ON t.project_id = b.id WHERE b.organization_id = @orgId ORDER BY t.updated_at DESC'
      )
      .all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async listPlannedGateway(orgId: string, page: number, pageSize: number): Promise<{ rows: PlannedGatewayTaskRepositoryRow[]; total: number }> {
    const limit = Math.max(1, Math.min(100, Math.floor(pageSize)))
    const offset = Math.max(0, Math.floor((page - 1) * limit))
    const params = { orgId, limit, offset }
    const where = `
      p.organization_id = @orgId
      AND json_extract(t.payload_json, '$.gatewayPlanState.state') = 'planned'
      AND COALESCE(ps.category, lower(t.status)) NOT IN ('done', 'closed')
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(t.payload_json, '$.activityMessages') AS activity
        WHERE json_extract(activity.value, '$.source') = 'gateway-run'
      )
    `
    const totalRow = await this.db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_statuses ps ON ps.id = t.status AND ps.project_id = t.project_id
        WHERE ${where}
      `)
      .get<{ total: number }>({ orgId })
    const rows = await this.db
      .prepare(
        `SELECT
           t.*,
           p.id AS project_id_for_context,
           p.name AS project_name,
           p.description AS project_description,
           p.metrics_json AS project_metrics_json
         FROM tasks t
         JOIN projects p ON t.project_id = p.id
         LEFT JOIN project_statuses ps ON ps.id = t.status AND ps.project_id = t.project_id
         WHERE ${where}
         ORDER BY t.updated_at DESC
         LIMIT @limit OFFSET @offset`
      )
      .all(params) as any[]

    return {
      total: Number(totalRow?.total ?? 0),
      rows: rows.map((row) => ({
        task: this.map(row),
        project: {
          id: row.project_id_for_context,
          name: row.project_name,
          description: row.project_description ?? undefined,
          metrics: this.parseJson<Record<string, unknown>>(row.project_metrics_json) ?? {}
        }
      }))
    }
  }

  async listRunningGateway(orgId: string): Promise<RunningGatewayTaskRepositoryRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT
           t.*,
           p.id AS project_id_for_context,
           p.name AS project_name,
           p.description AS project_description,
           p.metrics_json AS project_metrics_json
         FROM tasks t
         JOIN projects p ON t.project_id = p.id
         LEFT JOIN project_statuses ps ON ps.id = t.status AND ps.project_id = t.project_id
         WHERE p.organization_id = @orgId
           AND COALESCE(ps.category, lower(t.status)) NOT IN ('done', 'closed')
           AND EXISTS (
             SELECT 1
             FROM json_each(t.payload_json, '$.activityMessages') AS activity
             WHERE json_extract(activity.value, '$.source') IN ('gateway-plan', 'gateway-run', 'gateway-chat')
           )
         ORDER BY t.updated_at DESC`
      )
      .all({ orgId }) as any[]

    return rows.map((row) => ({
      task: this.map(row),
      project: {
        id: row.project_id_for_context,
        name: row.project_name,
        description: row.project_description ?? undefined,
        metrics: this.parseJson<Record<string, unknown>>(row.project_metrics_json) ?? {}
      }
    }))
  }

  async get(id: string): Promise<TaskEntity | undefined> {
    const row = (await this.db.prepare('SELECT * FROM tasks WHERE id = @id').get({ id })) as any
    return row ? this.map(row) : undefined
  }

  async create(input: Omit<TaskEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskEntity> {
    const now = Date.now()
    const task: TaskEntity = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      status: input.status,
      agentId: input.agentId,
      payload: input.payload,
      result: input.result,
      description: input.description,
      comments: input.comments,
      commentCount: input.commentCount,
      tags: input.tags,
      skills: input.skills,
      subtasks: input.subtasks,
      customFieldValues: input.customFieldValues,
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, status, agent_id, payload_json, result_json, updated_at, created_at)
         VALUES (@id, @projectId, @title, @status, @agentId, @payloadJson, @resultJson, @updatedAt, @createdAt)`
      )
      .run({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        agentId: task.agentId,
        payloadJson: this.toJson(task.payload),
        resultJson: this.toJson(task.result),
        updatedAt: task.updatedAt,
        createdAt: task.createdAt
      })
    return task
  }

  async update(id: string, patch: Partial<TaskEntity>): Promise<TaskEntity | undefined> {
    const current = await this.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch, updatedAt: Date.now() }
    await this.db
      .prepare(
        `UPDATE tasks
         SET title = @title,
             status = @status,
             agent_id = @agentId,
             payload_json = @payloadJson,
             result_json = @resultJson,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        title: next.title,
        status: next.status,
        agentId: next.agentId,
        payloadJson: this.toJson(next.payload),
        resultJson: this.toJson(next.result),
        updatedAt: next.updatedAt
      })
    return next
  }

  async history(id: string): Promise<Array<{ at: number; patch: string }>> {
    const row = await this.get(id)
    if (!row) return []
    return [
      {
        at: row.createdAt,
        patch: JSON.stringify({ action: 'created', id })
      },
      {
        at: row.updatedAt,
        patch: JSON.stringify({ action: 'updated', id, status: row.status })
      }
    ]
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM tasks WHERE id = @id').run({ id })
  }

  private map(row: any): TaskEntity {
    const payload = (this.parseJson<TaskPayload>(row.payload_json) || {}) as TaskPayload
    const comments = parseTaskComments(payload.comments)
    const description = typeof payload.description === 'string' ? payload.description : ''
    const customFieldValues = asObject(payload.customFields)

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      agentId: row.agent_id,
      payload,
      result: this.parseJson(row.result_json) || {},
      description,
      comments,
      commentCount: comments.length,
      tags: [],
      skills: [],
      subtasks: [],
      customFieldValues,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

export class TaskSubtaskRepository extends BaseRepository<TaskSubtask> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async get(id: string): Promise<TaskSubtask | undefined> {
    const row = await this.db.prepare('SELECT * FROM task_subtasks WHERE id = @id').get({ id }) as any
    return row ? this.map(row) : undefined
  }

  async listByTask(taskId: string): Promise<TaskSubtask[]> {
    const rows = await this.db
      .prepare('SELECT * FROM task_subtasks WHERE task_id = @taskId ORDER BY sort_order ASC, created_at ASC')
      .all({ taskId }) as any[]
    return rows.map((row) => this.map(row))
  }

  async listByTaskIds(taskIds: string[]): Promise<Record<string, TaskSubtask[]>> {
    if (taskIds.length === 0) return {}
    const placeholders = taskIds.map((_, index) => `@id${index}`).join(', ')
    const params = taskIds.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(
        `SELECT * FROM task_subtasks WHERE task_id IN (${placeholders}) ORDER BY task_id ASC, sort_order ASC, created_at ASC`
      )
      .all(params) as any[]

    const byTaskId: Record<string, TaskSubtask[]> = {}
    for (const row of rows) {
      const item = this.map(row)
      byTaskId[item.taskId] = byTaskId[item.taskId] ?? []
      byTaskId[item.taskId].push(item)
    }
    return byTaskId
  }

  async create(input: { taskId: string; title: string; status?: TaskSubtask['status'] }): Promise<TaskSubtask> {
    const now = Date.now()
    const orderRow = await this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM task_subtasks WHERE task_id = @taskId')
      .get<{ maxOrder: number }>({ taskId: input.taskId })
    const sortOrder = (orderRow?.maxOrder ?? -1) + 1
    const row: TaskSubtask = {
      id: randomUUID(),
      taskId: input.taskId,
      title: input.title,
      status: input.status ?? 'pending',
      sortOrder,
      payload: {},
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO task_subtasks (id, task_id, title, status, sort_order, payload_json, created_at, updated_at)
         VALUES (@id, @taskId, @title, @status, @sortOrder, @payloadJson, @createdAt, @updatedAt)`
      )
      .run({
        id: row.id,
        taskId: row.taskId,
        title: row.title,
        status: row.status,
        sortOrder: row.sortOrder,
        payloadJson: this.toJson(row.payload),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      })
    return row
  }

  async update(id: string, patch: Partial<TaskSubtask>): Promise<TaskSubtask | undefined> {
    const current = await this.db.prepare('SELECT * FROM task_subtasks WHERE id = @id').get({ id }) as any
    if (!current) return undefined
    const row: TaskSubtask = {
      id: current.id,
      taskId: current.task_id,
      title: patch.title ?? current.title,
      status: patch.status ?? current.status,
      sortOrder: patch.sortOrder ?? current.sort_order,
      payload: patch.payload ?? (this.parseJson(current.payload_json) || {}),
      createdAt: current.created_at,
      updatedAt: Date.now()
    }
    await this.db
      .prepare(
        `UPDATE task_subtasks
         SET title = @title, status = @status, sort_order = @sortOrder, payload_json = @payloadJson, updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        title: row.title,
        status: row.status,
        sortOrder: row.sortOrder,
        payloadJson: this.toJson(row.payload),
        updatedAt: row.updatedAt
      })
    return row
  }

  async updateStatusesByTask(taskId: string, status: string): Promise<void> {
    await this.db
      .prepare('UPDATE task_subtasks SET status = @status, updated_at = @updatedAt WHERE task_id = @taskId')
      .run({ taskId, status, updatedAt: Date.now() })
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM task_subtasks WHERE id = @id').run({ id })
  }

  async removeByTask(taskId: string): Promise<void> {
    await this.db.prepare('DELETE FROM task_subtasks WHERE task_id = @taskId').run({ taskId })
  }

  private map(row: any): TaskSubtask {
    return {
      id: row.id,
      taskId: row.task_id,
      title: row.title,
      status: row.status,
      sortOrder: row.sort_order,
      payload: this.parseJson(row.payload_json) || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

export class TaskTagRepository extends BaseRepository<Tag> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async listTaskTags(taskId: string): Promise<Tag[]> {
    const rows = await this.db
      .prepare(
        `SELECT t.id, t.organization_id, t.name, t.color, t.description, t.updated_at, t.created_at
         FROM task_tags tt
         INNER JOIN tags t ON t.id = tt.tag_id
         WHERE tt.task_id = @taskId
         ORDER BY t.name ASC`
      )
      .all({ taskId }) as Array<{ id: string; organization_id: string; name: string; color?: string; description?: string; updated_at?: number; created_at?: number }>
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      color: resolveTagColor(row.color, row.name),
      description: row.description,
      updatedAt: row.updated_at ?? row.created_at
    }))
  }

  async listByTaskIds(taskIds: string[]): Promise<Record<string, Tag[]>> {
    if (taskIds.length === 0) return {}
    const placeholders = taskIds.map((_, index) => `@id${index}`).join(', ')
    const params = taskIds.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(
        `SELECT tt.task_id, t.id, t.organization_id, t.name, t.color, t.description, t.updated_at, t.created_at
         FROM task_tags tt
         INNER JOIN tags t ON t.id = tt.tag_id
         WHERE tt.task_id IN (${placeholders})
         ORDER BY tt.task_id ASC, t.name ASC`
      )
      .all(params) as Array<{ task_id: string; id: string; organization_id: string; name: string; color?: string; description?: string; updated_at?: number; created_at?: number }>

    const byTaskId: Record<string, Tag[]> = {}
    for (const row of rows) {
      byTaskId[row.task_id] = byTaskId[row.task_id] ?? []
      byTaskId[row.task_id].push({
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        color: resolveTagColor(row.color, row.name),
        description: row.description,
        updatedAt: row.updated_at ?? row.created_at
      })
    }
    return byTaskId
  }

  async setTaskTags(taskId: string, tagIds: string[]): Promise<void> {
    const normalized = Array.from(new Set(tagIds.filter((item) => typeof item === 'string' && item.length > 0)))
    const now = Date.now()
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM task_tags WHERE task_id = @taskId').run({ taskId })
      for (const tagId of normalized) {
        await this.db
          .prepare('INSERT INTO task_tags (id, task_id, tag_id, created_at) VALUES (@id, @taskId, @tagId, @createdAt)')
          .run({
            id: randomUUID(),
            taskId,
            tagId,
            createdAt: now
          })
      }
    })
  }
}

export class TaskSkillRepository extends BaseRepository<Skill> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async listTaskSkills(taskId: string): Promise<Skill[]> {
    const rows = await this.db
      .prepare(
        `SELECT s.id, s.organization_id, s.name, s.slug, s.category, s.version, s.enabled
         FROM task_skills ts
         INNER JOIN skills s ON s.id = ts.skill_id
         WHERE ts.task_id = @taskId
         ORDER BY s.name ASC`
      )
      .all({ taskId }) as Array<{ id: string; organization_id: string; name: string; slug: string; category: string; version: string; enabled: number }>
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      version: row.version,
      enabled: Boolean(row.enabled),
      status: row.enabled ? 'active' : 'inactive'
    }))
  }

  async listByTaskIds(taskIds: string[]): Promise<Record<string, Skill[]>> {
    if (taskIds.length === 0) return {}
    const placeholders = taskIds.map((_, index) => `@id${index}`).join(', ')
    const params = taskIds.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(
        `SELECT ts.task_id, s.id, s.organization_id, s.name, s.slug, s.category, s.version, s.enabled
         FROM task_skills ts
         INNER JOIN skills s ON s.id = ts.skill_id
         WHERE ts.task_id IN (${placeholders})
         ORDER BY ts.task_id ASC, s.name ASC`
      )
      .all(params) as Array<{ task_id: string; id: string; organization_id: string; name: string; slug: string; category: string; version: string; enabled: number }>

    const byTaskId: Record<string, Skill[]> = {}
    for (const row of rows) {
      byTaskId[row.task_id] = byTaskId[row.task_id] ?? []
      byTaskId[row.task_id].push({
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        slug: row.slug,
        category: row.category,
        version: row.version,
        enabled: Boolean(row.enabled),
        status: row.enabled ? 'active' : 'inactive'
      })
    }
    return byTaskId
  }

  async setTaskSkills(taskId: string, skillIds: string[]): Promise<void> {
    const normalized = Array.from(new Set(skillIds.filter((item) => typeof item === 'string' && item.length > 0)))
    const now = Date.now()
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM task_skills WHERE task_id = @taskId').run({ taskId })
      for (const skillId of normalized) {
        await this.db
          .prepare('INSERT INTO task_skills (id, task_id, skill_id, created_at) VALUES (@id, @taskId, @skillId, @createdAt)')
          .run({
            id: randomUUID(),
            taskId,
            skillId,
            createdAt: now
          })
      }
    })
  }
}
