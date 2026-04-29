import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { AgentOutputFormatField, OutputFormat } from '../../shared/types/entities.js'

function normalizeFields(value: unknown): AgentOutputFormatField[] {
  if (!Array.isArray(value)) return []
  return value.map((raw) => {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const children = normalizeFields(item.children)
    const valueType = typeof item.valueType === 'string' && ['string', 'number', 'boolean', 'array', 'enum'].includes(item.valueType) ? item.valueType as AgentOutputFormatField['valueType'] : 'string'
    const enumValues = Array.isArray(item.enumValues)
      ? item.enumValues.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : []
    return {
      id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
      key: typeof item.key === 'string' ? item.key : '',
      description: typeof item.description === 'string' ? item.description : '',
      defaultValue: typeof item.defaultValue === 'string' ? item.defaultValue : '',
      valueType,
      required: item.required === true,
      enumValues,
      children
    }
  }).filter((item) => item.key.trim() || item.description.trim() || item.defaultValue?.trim() || item.enumValues?.length || item.children?.length)
}

export class OutputFormatRepository extends BaseRepository<OutputFormat> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<OutputFormat[]> {
    const rows = await this.db.prepare('SELECT * FROM output_formats WHERE organization_id = @orgId ORDER BY updated_at DESC').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<OutputFormat | undefined> {
    const row = await this.db.prepare('SELECT * FROM output_formats WHERE id = @id').get({ id }) as any
    return row ? this.map(row) : undefined
  }

  async create(orgId: string, input: { name: string; description?: string; fields: AgentOutputFormatField[]; instructionsMarkdown?: string }): Promise<OutputFormat> {
    const now = Date.now()
    const item: OutputFormat = {
      id: randomUUID(),
      organizationId: orgId,
      name: input.name,
      description: input.description,
      fields: input.fields,
      instructionsMarkdown: input.instructionsMarkdown,
      createdAt: now,
      updatedAt: now
    }
    await this.db.prepare(`INSERT INTO output_formats (id, organization_id, name, description, fields_json, instructions_markdown, created_at, updated_at)
      VALUES (@id, @organizationId, @name, @description, @fieldsJson, @instructionsMarkdown, @createdAt, @updatedAt)`).run({
      id: item.id,
      organizationId: item.organizationId,
      name: item.name,
      description: item.description,
      fieldsJson: this.toJson(item.fields),
      instructionsMarkdown: item.instructionsMarkdown,
      createdAt: now,
      updatedAt: now
    })
    return item
  }

  async update(orgId: string, id: string, input: { name: string; description?: string; fields: AgentOutputFormatField[]; instructionsMarkdown?: string }): Promise<OutputFormat | undefined> {
    const current = await this.get(id)
    if (!current || current.organizationId !== orgId) return undefined
    const now = Date.now()
    await this.db.prepare(`UPDATE output_formats
      SET name = @name, description = @description, fields_json = @fieldsJson, instructions_markdown = @instructionsMarkdown, updated_at = @updatedAt
      WHERE id = @id AND organization_id = @orgId`).run({
      id,
      orgId,
      name: input.name,
      description: input.description,
      fieldsJson: this.toJson(input.fields),
      instructionsMarkdown: input.instructionsMarkdown,
      updatedAt: now
    })
    return {
      ...current,
      name: input.name,
      description: input.description,
      fields: input.fields,
      instructionsMarkdown: input.instructionsMarkdown,
      updatedAt: now
    }
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.db.prepare('DELETE FROM output_formats WHERE id = @id AND organization_id = @orgId').run({ id, orgId })
  }

  private map(row: any): OutputFormat {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description ?? undefined,
      fields: normalizeFields(this.parseJson(row.fields_json)),
      instructionsMarkdown: row.instructions_markdown ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
