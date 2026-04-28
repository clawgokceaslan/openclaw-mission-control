import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Pack, Skill } from '../../shared/types/entities.js'

export interface SkillPageInput {
  page: number
  pageSize: number
  query?: string
  category?: string
  enabled?: boolean
  status?: 'active' | 'inactive'
}

export interface SkillPageResult {
  rows: Skill[]
  total: number
  page: number
  pageSize: number
}

export class SkillRepository extends BaseRepository<Skill> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Skill[]> {
    const rows = await this.db.prepare('SELECT * FROM skills WHERE organization_id = @orgId ORDER BY name').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async listPage(orgId: string, input: SkillPageInput): Promise<SkillPageResult> {
    const page = Math.max(1, Math.floor(input.page || 1))
    const pageSize = Math.max(5, Math.min(100, Math.floor(input.pageSize || 20)))
    const clauses = ['organization_id = @orgId']
    const params: Record<string, unknown> = { orgId }

    if (input.query?.trim()) {
      clauses.push('(LOWER(name) LIKE @query OR LOWER(slug) LIKE @query OR LOWER(category) LIKE @query)')
      params.query = `%${input.query.trim().toLowerCase()}%`
    }
    if (input.category?.trim()) {
      clauses.push('category = @category')
      params.category = input.category.trim()
    }
    const enabledFilter = input.status ? input.status === 'active' : input.enabled
    if (typeof enabledFilter === 'boolean') {
      clauses.push('enabled = @enabled')
      params.enabled = enabledFilter ? 1 : 0
    }

    const where = clauses.join(' AND ')
    const totalRow = await this.db.prepare(`SELECT COUNT(*) AS total FROM skills WHERE ${where}`).get(params) as { total?: number } | undefined
    const rows = await this.db
      .prepare(`SELECT * FROM skills WHERE ${where} ORDER BY name LIMIT @limit OFFSET @offset`)
      .all({
        ...params,
        limit: pageSize,
        offset: (page - 1) * pageSize
      })

    return {
      rows: rows.map((row: any) => this.map(row)),
      total: totalRow?.total ?? 0,
      page,
      pageSize
    }
  }

  async create(orgId: string, input: { title: string; descriptionMarkdown?: string; status?: 'active' | 'inactive' }): Promise<Skill> {
    const title = input.title.trim()
    const now = Date.now()
    const slug = await this.uniqueSlug(orgId, title)
    const row = {
      id: randomUUID(),
      organizationId: orgId,
      name: title,
      slug,
      category: 'custom',
      version: '1.0.0',
      enabled: input.status !== 'inactive',
      metadataJson: JSON.stringify({ descriptionMarkdown: input.descriptionMarkdown ?? '' }),
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO skills (id, organization_id, name, slug, category, version, enabled, metadata_json, created_at, updated_at)
         VALUES (@id, @organizationId, @name, @slug, @category, @version, @enabled, @metadataJson, @createdAt, @updatedAt)`
      )
      .run({ ...row, enabled: row.enabled ? 1 : 0 })
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      category: row.category,
      version: row.version,
      enabled: row.enabled,
      descriptionMarkdown: input.descriptionMarkdown ?? '',
      status: row.enabled ? 'active' : 'inactive',
      updatedAt: now
    }
  }

  async update(orgId: string, id: string, input: { title?: string; descriptionMarkdown?: string; status?: 'active' | 'inactive' }): Promise<Skill | undefined> {
    const current = await this.db.prepare('SELECT * FROM skills WHERE id = @id AND organization_id = @orgId').get({ id, orgId }) as any
    if (!current) return undefined
    const now = Date.now()
    const name = input.title?.trim() || current.name
    const metadata = this.parseMetadata(current.metadata_json)
    const nextMetadata = {
      ...metadata,
      descriptionMarkdown: input.descriptionMarkdown ?? metadata.descriptionMarkdown ?? ''
    }
    await this.db
      .prepare(
        `UPDATE skills
         SET name = @name,
             enabled = @enabled,
             metadata_json = @metadataJson,
             updated_at = @updatedAt
         WHERE id = @id AND organization_id = @orgId`
      )
      .run({
        id,
        orgId,
        name,
        enabled: (input.status ? input.status === 'active' : Boolean(current.enabled)) ? 1 : 0,
        metadataJson: JSON.stringify(nextMetadata),
        updatedAt: now
      })
    const updated = await this.db.prepare('SELECT * FROM skills WHERE id = @id AND organization_id = @orgId').get({ id, orgId }) as any
    return updated ? this.map(updated) : undefined
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM skills WHERE id = @id AND organization_id = @orgId').run({ id, orgId }) as { changes?: number }
    return (result.changes ?? 0) > 0
  }

  private async uniqueSlug(orgId: string, title: string): Promise<string> {
    const base = this.slugify(title) || 'skill'
    let candidate = base
    let suffix = 2
    while (await this.db.prepare('SELECT 1 FROM skills WHERE organization_id = @orgId AND slug = @slug').get({ orgId, slug: candidate })) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private parseMetadata(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string' || !value.trim()) return {}
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }

  private map(row: any): Skill {
    const metadata = this.parseMetadata(row.metadata_json)
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      version: row.version,
      enabled: Boolean(row.enabled),
      descriptionMarkdown: typeof metadata.descriptionMarkdown === 'string' ? metadata.descriptionMarkdown : '',
      status: row.enabled ? 'active' : 'inactive',
      updatedAt: row.updated_at
    }
  }
}

export class PackRepository extends BaseRepository<Pack> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Pack[]> {
    const rows = await this.db.prepare('SELECT * FROM packs WHERE organization_id = @orgId ORDER BY name').all({ orgId })
    return rows.map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      version: row.version,
      enabled: Boolean(row.enabled)
    }))
  }
}
