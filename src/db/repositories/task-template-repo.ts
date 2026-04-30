import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { TaskTemplate, TaskTemplatePayload } from '../../shared/types/entities.js'

function asTemplate(value: unknown): TaskTemplatePayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as TaskTemplatePayload : {}
}

export class TaskTemplateRepository extends BaseRepository<TaskTemplate> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<TaskTemplate[]> {
    const rows = await this.db.prepare('SELECT * FROM task_templates WHERE organization_id = @orgId ORDER BY updated_at DESC').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async get(orgId: string, id: string): Promise<TaskTemplate | undefined> {
    const row = await this.db.prepare('SELECT * FROM task_templates WHERE id = @id AND organization_id = @orgId').get<any>({ id, orgId })
    return row ? this.map(row) : undefined
  }

  async create(orgId: string, input: { name: string; description?: string; template: TaskTemplatePayload }): Promise<TaskTemplate> {
    const now = Date.now()
    const item: TaskTemplate = {
      id: randomUUID(),
      organizationId: orgId,
      name: input.name,
      description: input.description,
      template: input.template,
      createdAt: now,
      updatedAt: now
    }
    await this.db.prepare(`INSERT INTO task_templates (id, organization_id, name, description, template_json, created_at, updated_at)
      VALUES (@id, @organizationId, @name, @description, @templateJson, @createdAt, @updatedAt)`).run({
      id: item.id,
      organizationId: item.organizationId,
      name: item.name,
      description: item.description,
      templateJson: this.toJson(item.template),
      createdAt: now,
      updatedAt: now
    })
    return item
  }

  async update(orgId: string, id: string, input: { name: string; description?: string; template: TaskTemplatePayload }): Promise<TaskTemplate | undefined> {
    const current = await this.db.prepare('SELECT * FROM task_templates WHERE id = @id AND organization_id = @orgId').get<any>({ id, orgId })
    if (!current) return undefined
    const now = Date.now()
    await this.db.prepare(`UPDATE task_templates
      SET name = @name, description = @description, template_json = @templateJson, updated_at = @updatedAt
      WHERE id = @id AND organization_id = @orgId`).run({
      id,
      orgId,
      name: input.name,
      description: input.description,
      templateJson: this.toJson(input.template),
      updatedAt: now
    })
    return this.map({ ...current, name: input.name, description: input.description, template_json: this.toJson(input.template), updated_at: now })
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.db.prepare('DELETE FROM task_templates WHERE id = @id AND organization_id = @orgId').run({ id, orgId })
  }

  private map(row: any): TaskTemplate {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description ?? undefined,
      template: asTemplate(this.parseJson(row.template_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
