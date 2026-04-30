import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Workspace } from '../../shared/types/entities.js'

export class WorkspaceRepository extends BaseRepository<Workspace> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Workspace[]> {
    const rows = await this.db.prepare('SELECT * FROM workspaces WHERE organization_id = @orgId ORDER BY updated_at DESC').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<Workspace | undefined> {
    const row = await this.db.prepare('SELECT * FROM workspaces WHERE id = @id').get<any>({ id })
    return row ? this.map(row) : undefined
  }

  async create(input: { organizationId: string; name: string; rootPath: string }): Promise<Workspace> {
    const now = Date.now()
    const row: Workspace = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      rootPath: input.rootPath,
      createdAt: now,
      updatedAt: now
    }
    await this.db.prepare(`INSERT INTO workspaces (id, organization_id, name, root_path, created_at, updated_at)
      VALUES (@id, @organizationId, @name, @rootPath, @createdAt, @updatedAt)`).run({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      rootPath: row.rootPath,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })
    return row
  }

  async update(orgId: string, id: string, patch: { name?: string; rootPath?: string }): Promise<Workspace | undefined> {
    const current = await this.get(id)
    if (!current || current.organizationId !== orgId) return undefined
    const next: Workspace = {
      ...current,
      name: patch.name ?? current.name,
      rootPath: patch.rootPath ?? current.rootPath,
      updatedAt: Date.now()
    }
    await this.db.prepare(`UPDATE workspaces
      SET name = @name, root_path = @rootPath, updated_at = @updatedAt
      WHERE id = @id AND organization_id = @organizationId`).run({
      id: next.id,
      organizationId: next.organizationId,
      name: next.name,
      rootPath: next.rootPath,
      updatedAt: next.updatedAt
    })
    return next
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.db.prepare('UPDATE projects SET workspace_id = NULL WHERE workspace_id = @id AND organization_id = @orgId').run({ id, orgId })
    await this.db.prepare('DELETE FROM workspaces WHERE id = @id AND organization_id = @orgId').run({ id, orgId })
  }

  private map(row: any): Workspace {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

export class AppSettingsRepository extends BaseRepository<Record<string, unknown>> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async get<T = unknown>(orgId: string, key: string): Promise<T | undefined> {
    const row = await this.db.prepare('SELECT value_json FROM app_settings WHERE organization_id = @orgId AND key = @key').get<any>({ orgId, key })
    return row ? this.parseJson<T>(row.value_json) : undefined
  }

  async set(orgId: string, key: string, value: unknown): Promise<void> {
    await this.db.prepare(`INSERT INTO app_settings (organization_id, key, value_json, updated_at)
      VALUES (@orgId, @key, @valueJson, @updatedAt)
      ON CONFLICT(organization_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).run({
      orgId,
      key,
      valueJson: this.toJson(value),
      updatedAt: Date.now()
    })
  }
}
