import { randomUUID, createHash } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { ProjectStatus, ProjectStatusCategory, StatusTemplate } from '../../shared/types/entities.js'

export type StatusDraft = {
  id?: string
  name: string
  category: ProjectStatusCategory
  color?: string
  sortOrder?: number
  isDefault?: boolean
}

const DEFAULT_STATUS_DRAFTS: StatusDraft[] = [
  { name: 'Not started', category: 'not_started', color: '#8A99B4', sortOrder: 0, isDefault: true },
  { name: 'Active', category: 'active', color: '#2F80ED', sortOrder: 1 },
  { name: 'Review', category: 'active', color: '#8B5CF6', sortOrder: 2 },
  { name: 'Done', category: 'done', color: '#29B764', sortOrder: 3 },
  { name: 'Closed', category: 'closed', color: '#D94B5F', sortOrder: 4 }
]

const CATEGORY_PALETTES: Record<ProjectStatusCategory, string[]> = {
  not_started: ['#8A99B4', '#6B7280', '#94A3B8', '#64748B'],
  active: ['#2F80ED', '#4F46E5', '#8B5CF6', '#0EA5E9', '#7C3AED'],
  done: ['#29B764', '#16A34A', '#10B981', '#22C55E'],
  closed: ['#D94B5F', '#EF4444', '#DC2626', '#F97316']
}

function pickColor(category: ProjectStatusCategory, seed: string): string {
  const palette = CATEGORY_PALETTES[category]
  const digest = createHash('sha256').update(`${category}:${seed}`).digest()
  return palette[digest[0] % palette.length]
}

function normalizeColor(category: ProjectStatusCategory, name: string, color?: string): string {
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color.trim())) return color.trim().toUpperCase()
  return pickColor(category, name || 'status')
}

function validateStatusItems(items: StatusDraft[]): void {
  const counts = items.reduce<Record<ProjectStatusCategory, number>>((acc, item) => {
    acc[item.category] += 1
    return acc
  }, { not_started: 0, active: 0, done: 0, closed: 0 })
  if (counts.not_started !== 1) throw new Error('Exactly one Not started status is required')
  if (counts.active < 1) throw new Error('At least one Active status is required')
  if (counts.done !== 1) throw new Error('Exactly one Done status is required')
  if (counts.closed !== 1) throw new Error('Exactly one Closed status is required')
  for (const item of items) {
    if (!item.name?.trim()) throw new Error('Status name is required')
  }
}

export function defaultStatusDrafts(): StatusDraft[] {
  return DEFAULT_STATUS_DRAFTS.map((item) => ({ ...item }))
}

export class StatusRepository extends BaseRepository<ProjectStatus> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  suggestColor(category: ProjectStatusCategory, name: string): string {
    return normalizeColor(category, name)
  }

  async ensureDefaultTemplate(organizationId: string): Promise<StatusTemplate> {
    const existing = await this.db.prepare('SELECT * FROM status_templates WHERE organization_id = @organizationId AND name = @name LIMIT 1').get<any>({ organizationId, name: 'Default workflow' })
    if (existing) return this.mapTemplate(existing, await this.listTemplateItems(existing.id))
    const now = Date.now()
    const id = randomUUID()
    await this.db.prepare('INSERT INTO status_templates (id, organization_id, name, created_at, updated_at) VALUES (@id, @organizationId, @name, @createdAt, @updatedAt)').run({ id, organizationId, name: 'Default workflow', createdAt: now, updatedAt: now })
    await this.replaceTemplateItems(id, defaultStatusDrafts())
    return this.mapTemplate({ id, organization_id: organizationId, name: 'Default workflow', created_at: now, updated_at: now }, await this.listTemplateItems(id))
  }

  async ensureProjectDefaults(projectId: string, organizationId: string): Promise<ProjectStatus[]> {
    const existing = await this.listProjectStatuses(projectId)
    if (existing.length > 0) return existing
    await this.replaceProjectStatuses(projectId, organizationId, defaultStatusDrafts(), {})
    return this.listProjectStatuses(projectId)
  }

  async listTemplates(organizationId: string): Promise<StatusTemplate[]> {
    await this.ensureDefaultTemplate(organizationId)
    const rows = await this.db.prepare('SELECT * FROM status_templates WHERE organization_id = @organizationId ORDER BY updated_at DESC').all<any>({ organizationId })
    const templates: StatusTemplate[] = []
    for (const row of rows) {
      templates.push(this.mapTemplate(row, await this.listTemplateItems(row.id)))
    }
    return templates
  }

  async createTemplate(organizationId: string, name: string, items: StatusDraft[]): Promise<StatusTemplate> {
    validateStatusItems(items)
    const now = Date.now()
    const id = randomUUID()
    await this.db.prepare('INSERT INTO status_templates (id, organization_id, name, created_at, updated_at) VALUES (@id, @organizationId, @name, @createdAt, @updatedAt)').run({ id, organizationId, name, createdAt: now, updatedAt: now })
    await this.replaceTemplateItems(id, items)
    return this.mapTemplate({ id, organization_id: organizationId, name, created_at: now, updated_at: now }, await this.listTemplateItems(id))
  }

  async updateTemplate(organizationId: string, id: string, name: string, items: StatusDraft[]): Promise<StatusTemplate | undefined> {
    validateStatusItems(items)
    const current = await this.db.prepare('SELECT * FROM status_templates WHERE id = @id AND organization_id = @organizationId').get<any>({ id, organizationId })
    if (!current) return undefined
    const now = Date.now()
    await this.db.prepare('UPDATE status_templates SET name = @name, updated_at = @updatedAt WHERE id = @id').run({ id, name, updatedAt: now })
    await this.replaceTemplateItems(id, items)
    const updated = await this.db.prepare('SELECT * FROM status_templates WHERE id = @id').get<any>({ id })
    return this.mapTemplate(updated, await this.listTemplateItems(id))
  }

  async removeTemplate(organizationId: string, id: string): Promise<void> {
    await this.db.prepare('DELETE FROM status_templates WHERE id = @id AND organization_id = @organizationId').run({ id, organizationId })
  }

  async listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
    const rows = await this.db.prepare('SELECT * FROM project_statuses WHERE project_id = @projectId ORDER BY sort_order ASC, created_at ASC').all<any>({ projectId })
    return rows.map((row) => this.mapProjectStatus(row))
  }

  async replaceProjectStatuses(projectId: string, organizationId: string, items: StatusDraft[], mapping: Record<string, string>): Promise<ProjectStatus[]> {
    validateStatusItems(items)
    const existing = await this.listProjectStatuses(projectId)
    const keptIds = new Set(items.map((item) => item.id).filter(Boolean) as string[])
    const removed = existing.filter((item) => !keptIds.has(item.id))
    for (const item of removed) {
      if (!mapping[item.id]) throw new Error(`Missing mapping for removed status: ${item.name}`)
    }

    await this.db.run('BEGIN IMMEDIATE')
    try {
      await this.db.prepare('DELETE FROM project_statuses WHERE project_id = @projectId').run({ projectId })
      const idByOldId = new Map<string, string>()
      const now = Date.now()
      for (const [index, item] of items.entries()) {
        const id = item.id && existing.some((current) => current.id === item.id) ? item.id : randomUUID()
        if (item.id) idByOldId.set(item.id, id)
        await this.db.prepare(`INSERT INTO project_statuses (id, organization_id, project_id, name, category, color, sort_order, is_default, created_at, updated_at)
          VALUES (@id, @organizationId, @projectId, @name, @category, @color, @sortOrder, @isDefault, @createdAt, @updatedAt)`).run({
          id,
          organizationId,
          projectId,
          name: item.name.trim(),
          category: item.category,
          color: normalizeColor(item.category, item.name, item.color),
          sortOrder: item.sortOrder ?? index,
          isDefault: item.isDefault ? 1 : 0,
          createdAt: now,
          updatedAt: now
        })
      }
      for (const item of removed) {
        const target = mapping[item.id]
        const targetId = idByOldId.get(target) ?? target
        await this.db.prepare('UPDATE tasks SET status = @targetId WHERE project_id = @projectId AND status = @sourceId').run({ targetId, projectId, sourceId: item.id })
        await this.db.prepare(`UPDATE task_subtasks SET status = @targetId WHERE status = @sourceId AND task_id IN (SELECT id FROM tasks WHERE project_id = @projectId)`).run({ targetId, sourceId: item.id, projectId })
      }
      await this.db.run('COMMIT')
    } catch (error) {
      await this.db.run('ROLLBACK')
      throw error
    }
    return this.listProjectStatuses(projectId)
  }

  async applyTemplate(projectId: string, organizationId: string, templateId: string, mapping: Record<string, string>): Promise<ProjectStatus[]> {
    const items = await this.listTemplateItems(templateId)
    return this.replaceProjectStatuses(projectId, organizationId, items.map((item) => ({ id: item.id, name: item.name, category: item.category, color: item.color, sortOrder: item.sortOrder, isDefault: item.isDefault })), mapping)
  }

  private async replaceTemplateItems(templateId: string, items: StatusDraft[]): Promise<void> {
    validateStatusItems(items)
    await this.db.prepare('DELETE FROM status_template_items WHERE template_id = @templateId').run({ templateId })
    const now = Date.now()
    for (const [index, item] of items.entries()) {
      await this.db.prepare(`INSERT INTO status_template_items (id, template_id, name, category, color, sort_order, is_default, created_at, updated_at)
        VALUES (@id, @templateId, @name, @category, @color, @sortOrder, @isDefault, @createdAt, @updatedAt)`).run({
        id: randomUUID(),
        templateId,
        name: item.name.trim(),
        category: item.category,
        color: normalizeColor(item.category, item.name, item.color),
        sortOrder: item.sortOrder ?? index,
        isDefault: item.isDefault ? 1 : 0,
        createdAt: now,
        updatedAt: now
      })
    }
  }

  private async listTemplateItems(templateId: string): Promise<ProjectStatus[]> {
    const rows = await this.db.prepare('SELECT * FROM status_template_items WHERE template_id = @templateId ORDER BY sort_order ASC, created_at ASC').all<any>({ templateId })
    return rows.map((row) => this.mapTemplateItem(row))
  }

  private mapTemplate(row: any, items: ProjectStatus[]): StatusTemplate {
    return { id: row.id, organizationId: row.organization_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, items }
  }

  private mapProjectStatus(row: any): ProjectStatus {
    return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, name: row.name, category: row.category, color: row.color, sortOrder: row.sort_order, isDefault: row.is_default === 1, createdAt: row.created_at, updatedAt: row.updated_at }
  }

  private mapTemplateItem(row: any): ProjectStatus {
    return { id: row.id, organizationId: '', templateId: row.template_id, name: row.name, category: row.category, color: row.color, sortOrder: row.sort_order, isDefault: row.is_default === 1, createdAt: row.created_at, updatedAt: row.updated_at }
  }
}
