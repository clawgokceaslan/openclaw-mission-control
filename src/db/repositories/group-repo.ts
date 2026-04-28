import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { ProjectGroup } from '../../shared/types/entities.js'

export interface ProjectGroupMembership {
  projectId: string
  projectGroupId: string
}

export class GroupRepository extends BaseRepository<ProjectGroup> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<ProjectGroup[]> {
    const rows = await this.db.prepare('SELECT * FROM project_groups WHERE organization_id = @orgId ORDER BY created_at DESC').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async create(input: { organizationId: string; name: string; settings?: Record<string, unknown> }): Promise<ProjectGroup> {
    const now = Date.now()
    const row: ProjectGroup = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      settings: input.settings || {},
      description: typeof input.settings?.description === 'string' ? String(input.settings.description) : undefined,
      projectIds: [],
      projectCount: 0,
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        'INSERT INTO project_groups (id, organization_id, name, settings_json, created_at, updated_at) VALUES (@id, @organizationId, @name, @settingsJson, @createdAt, @updatedAt)'
      )
      .run({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        settingsJson: this.toJson(row.settings),
        createdAt: now,
        updatedAt: now
      })
    return row
  }

  async update(id: string, patch: { name?: string; settings?: Record<string, unknown> }): Promise<ProjectGroup | undefined> {
    const current = (await this.db.prepare('SELECT * FROM project_groups WHERE id = @id').get({ id })) as any
    if (!current) return undefined
    const next: ProjectGroup = {
      id,
      organizationId: current.organization_id,
      name: patch.name ?? current.name,
      settings: patch.settings ?? (this.parseJson(current.settings_json) || {}),
      description: undefined,
      projectIds: [],
      projectCount: 0,
      createdAt: current.created_at,
      updatedAt: Date.now()
    }
    next.description = typeof next.settings?.description === 'string' ? String(next.settings.description) : undefined
    await this.db
      .prepare('UPDATE project_groups SET name=@name, settings_json=@settingsJson, updated_at=@updatedAt WHERE id=@id')
      .run({
        id,
        name: next.name,
        settingsJson: this.toJson(next.settings),
        updatedAt: next.updatedAt
      })
    return next
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM project_groups WHERE id=@id').run({ id })
  }

  async listMembershipsByOrganization(orgId: string): Promise<ProjectGroupMembership[]> {
    const rows = await this.db.prepare(
      `SELECT m.project_id, m.project_group_id
       FROM project_group_memberships m
       INNER JOIN project_groups g ON g.id = m.project_group_id
       WHERE g.organization_id = @orgId`
    ).all({ orgId }) as Array<{ project_id: string; project_group_id: string }>

    return rows.map((row) => ({
      projectId: row.project_id,
      projectGroupId: row.project_group_id
    }))
  }

  async replaceMembershipsForGroup(groupId: string, projectIds: string[]): Promise<void> {
    const normalized = Array.from(new Set(projectIds.filter((item) => typeof item === 'string' && item.length > 0)))

    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM project_group_memberships WHERE project_group_id = @groupId').run({ groupId })

      for (const projectId of normalized) {
        await this.db.prepare(
          'INSERT INTO project_group_memberships (id, project_id, project_group_id) VALUES (@id, @projectId, @groupId)'
        ).run({
          id: randomUUID(),
          projectId,
          groupId
        })
      }
    })
  }

  async removeMembershipsForGroup(groupId: string): Promise<void> {
    await this.db.prepare('DELETE FROM project_group_memberships WHERE project_group_id = @groupId').run({ groupId })
  }

  private map(row: any): ProjectGroup {
    const settings = this.parseJson<Record<string, unknown>>(row.settings_json) || {}
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      settings,
      description: typeof settings.description === 'string' ? String(settings.description) : undefined,
      projectIds: [],
      projectCount: 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

export class OnboardingRepository {
  constructor(private readonly db: SqliteAdapter) {}

  async getState(projectId: string): Promise<string | null> {
    const row = (await this.db.prepare('SELECT state_json FROM onboarding_states WHERE project_id = @projectId ORDER BY updated_at DESC LIMIT 1').get({
      projectId
    })) as any
    return row ? (row.state_json as string) : null
  }

  async saveState(projectId: string, stateJson: string, status: string): Promise<void> {
    const now = Date.now()
    const existing = (await this.db.prepare('SELECT id FROM onboarding_states WHERE project_id = @projectId').get({ projectId })) as any
    if (existing) {
      await this.db
        .prepare('UPDATE onboarding_states SET state_json=@stateJson, status=@status, updated_at=@updatedAt WHERE project_id=@projectId')
        .run({ projectId, stateJson, status, updatedAt: now })
    } else {
      await this.db
        .prepare(
          'INSERT INTO onboarding_states (id, project_id, state_json, status, created_at, updated_at) VALUES (@id, @projectId, @stateJson, @status, @createdAt, @updatedAt)'
        )
        .run({ id: randomUUID(), projectId, stateJson, status, createdAt: now, updatedAt: now })
    }
  }
}

export class MemoryRepository {
  constructor(private readonly db: SqliteAdapter) {}

  async list(scope: string, subjectId: string) {
    return this.db.prepare('SELECT key, value_json FROM memory_entries WHERE scope=@scope AND subject_id=@subjectId ORDER BY created_at DESC').all({
      scope,
      subjectId
    })
  }

  async upsert(scope: string, subjectId: string, key: string, value: unknown): Promise<void> {
    const now = Date.now()
    const existing = (await this.db.prepare(
      'SELECT id FROM memory_entries WHERE scope=@scope AND subject_id=@subjectId AND key=@key'
    ).get({
      scope,
      subjectId,
      key
    })) as any
    const json = JSON.stringify(value)
    if (existing) {
      await this.db.prepare('UPDATE memory_entries SET value_json=@value, updated_at=@updatedAt WHERE id=@id').run({
        id: existing.id,
        value: json,
        updatedAt: now
      })
    } else {
      await this.db
        .prepare(
          'INSERT INTO memory_entries (id, scope, subject_id, key, value_json, created_at, updated_at) VALUES (@id, @scope, @subjectId, @key, @value, @createdAt, @updatedAt)'
        )
        .run({ id: randomUUID(), scope, subjectId, key, value: json, createdAt: now, updatedAt: now })
    }
  }
}
