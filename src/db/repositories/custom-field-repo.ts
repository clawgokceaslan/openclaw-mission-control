import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { CustomField, Tag } from '../../shared/types/entities.js'
import { resolveTagColor } from './tag-color.js'

export class CustomFieldRepository extends BaseRepository<CustomField> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<CustomField[]> {
    const rows = await this.db
      .prepare('SELECT * FROM custom_fields WHERE organization_id = @orgId ORDER BY created_at DESC')
      .all({ orgId })
    return rows.map((row: any) => {
      const config = this.parseJson<Record<string, unknown>>(row.config_json) || {}
      return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        type: row.type,
        config,
        description: typeof config.description === 'string' ? config.description : '',
        defaultValue: Object.prototype.hasOwnProperty.call(config, 'defaultValue') ? config.defaultValue : undefined
      }
    })
  }

  async create(input: Omit<CustomField, 'id'>): Promise<CustomField> {
    const now = Date.now()
    const row: CustomField = { id: randomUUID(), ...input }
    await this.db
      .prepare('INSERT INTO custom_fields (id, organization_id, name, type, config_json, created_at) VALUES (@id, @organizationId, @name, @type, @configJson, @createdAt)')
      .run({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        type: row.type,
        configJson: this.toJson(row.config),
        createdAt: now
      })
    return row
  }

  async update(input: {
    id: string
    organizationId: string
    name: string
    type: CustomField['type']
    description?: string
    defaultValue?: unknown
  }): Promise<CustomField | null> {
    const config = {
      description: input.description ?? '',
      ...(Object.prototype.hasOwnProperty.call(input, 'defaultValue') ? { defaultValue: input.defaultValue } : {})
    }
    const result = await this.db
      .prepare(`
        UPDATE custom_fields
        SET name = @name,
            type = @type,
            config_json = @configJson
        WHERE id = @id AND organization_id = @organizationId
      `)
      .run({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        type: input.type,
        configJson: this.toJson(config)
      })
    if (((result as any)?.changes ?? 0) === 0) return null
    const rows = await this.list(input.organizationId)
    return rows.find((row) => row.id === input.id) ?? null
  }

  async remove(input: { id: string; organizationId: string }): Promise<boolean> {
    await this.removeFieldValues(input.id, input.organizationId)
    const result = await this.db
      .prepare('DELETE FROM custom_fields WHERE id = @id AND organization_id = @organizationId')
      .run({ id: input.id, organizationId: input.organizationId })
    return ((result as any)?.changes ?? 0) > 0
  }

  private async removeFieldValues(fieldId: string, organizationId: string): Promise<void> {
    const taskRows = await this.db
      .prepare(`
        SELECT t.id, t.payload_json
        FROM tasks t
        INNER JOIN projects p ON p.id = t.project_id
        WHERE p.organization_id = @organizationId
      `)
      .all({ organizationId }) as Array<{ id: string; payload_json: string | null }>

    for (const row of taskRows) {
      const payload = this.removeCustomFieldFromPayload(row.payload_json, fieldId)
      if (!payload.changed) continue
      await this.db
        .prepare('UPDATE tasks SET payload_json = @payloadJson, updated_at = @updatedAt WHERE id = @id')
        .run({ id: row.id, payloadJson: this.toJson(payload.value), updatedAt: Date.now() })
    }

    const subtaskRows = await this.db
      .prepare(`
        SELECT st.id, st.payload_json
        FROM task_subtasks st
        INNER JOIN tasks t ON t.id = st.task_id
        INNER JOIN projects p ON p.id = t.project_id
        WHERE p.organization_id = @organizationId
      `)
      .all({ organizationId }) as Array<{ id: string; payload_json: string | null }>

    for (const row of subtaskRows) {
      const payload = this.removeCustomFieldFromPayload(row.payload_json, fieldId)
      if (!payload.changed) continue
      await this.db
        .prepare('UPDATE task_subtasks SET payload_json = @payloadJson, updated_at = @updatedAt WHERE id = @id')
        .run({ id: row.id, payloadJson: this.toJson(payload.value), updatedAt: Date.now() })
    }
  }

  private removeCustomFieldFromPayload(payloadJson: string | null, fieldId: string): { changed: boolean; value: Record<string, unknown> } {
    const payload = this.parseJson<Record<string, unknown>>(payloadJson) || {}
    const customFields = payload.customFields
    if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) {
      return { changed: false, value: payload }
    }
    if (!Object.prototype.hasOwnProperty.call(customFields, fieldId)) {
      return { changed: false, value: payload }
    }
    const nextCustomFields = { ...(customFields as Record<string, unknown>) }
    delete nextCustomFields[fieldId]
    return {
      changed: true,
      value: {
        ...payload,
        customFields: nextCustomFields
      }
    }
  }
}

export class TagRepository extends BaseRepository<Tag> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Tag[]> {
    const rows = await this.db
      .prepare(`
        SELECT
          t.*,
          COUNT(tt.id) AS task_count
        FROM tags t
        LEFT JOIN task_tags tt ON tt.tag_id = t.id
        WHERE t.organization_id = @orgId
        GROUP BY t.id
        ORDER BY COALESCE(t.updated_at, t.created_at) DESC
      `)
      .all({ orgId })
    return rows.map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      color: resolveTagColor(row.color, row.name),
      description: row.description,
      updatedAt: row.updated_at ?? row.created_at,
      taskCount: Number(row.task_count ?? 0)
    }))
  }

  async create(input: Omit<Tag, 'id'>): Promise<Tag> {
    const now = Date.now()
    const color = resolveTagColor(input.color, input.name)
    const row: Tag = { id: randomUUID(), ...input, color }
    await this.db
      .prepare(`
        INSERT INTO tags (id, organization_id, name, color, description, created_at, updated_at)
        VALUES (@id, @organizationId, @name, @color, @description, @createdAt, @updatedAt)
      `)
      .run({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        color,
        description: row.description,
        createdAt: now,
        updatedAt: now
      })
    return { ...row, updatedAt: now, taskCount: 0 }
  }

  async update(input: { id: string; organizationId: string; name: string; color?: string; description?: string }): Promise<Tag | null> {
    const updatedAt = Date.now()
    const color = resolveTagColor(input.color, input.name)
    const result = await this.db
      .prepare(`
        UPDATE tags
        SET name = @name,
            color = @color,
            description = @description,
            updated_at = @updatedAt
        WHERE id = @id AND organization_id = @organizationId
      `)
      .run({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        color,
        description: input.description,
        updatedAt
      })

    if ((result as any)?.changes === 0) return null
    const rows = await this.list(input.organizationId)
    return rows.find((row) => row.id === input.id) ?? null
  }

  async remove(input: { id: string; organizationId: string }): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM tags WHERE id = @id AND organization_id = @organizationId')
      .run({
        id: input.id,
        organizationId: input.organizationId
      })
    return ((result as any)?.changes ?? 0) > 0
  }
}
