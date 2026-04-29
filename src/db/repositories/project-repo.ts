import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Project } from '../../shared/types/entities.js'

const PROJECT_PROMPT_FIELDS = ['generalContext', 'generalPrompt', 'defaultOutput'] as const

type ProjectPromptKey = (typeof PROJECT_PROMPT_FIELDS)[number]

type ProjectMetricsInput = Record<string, unknown> | undefined

export class ProjectRepository extends BaseRepository<Project> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Project[]> {
    const rows = await this.db.prepare('SELECT * FROM projects WHERE organization_id = @orgId ORDER BY created_at DESC').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<Project | undefined> {
    const row = (await this.db.prepare('SELECT * FROM projects WHERE id = @id').get({ id })) as any
    return row ? this.map(row) : undefined
  }

  async create(input: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const now = Date.now()
    const project: Project = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      archived: false,
      metrics: input.metrics,
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO projects (id, organization_id, name, description, archived, metrics_json, created_at, updated_at)
         VALUES (@id, @organizationId, @name, @description, @archived, @metricsJson, @createdAt, @updatedAt)`
      )
      .run({
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        description: project.description,
        archived: project.archived ? 1 : 0,
        metricsJson: this.toJson(project.metrics),
        createdAt: now,
        updatedAt: now
      })
    return project
  }

  async update(id: string, patch: Partial<Project>): Promise<Project | undefined> {
    const current = await this.get(id)
    if (!current) return undefined
    const { metrics: incomingMetrics, generalContext, generalPrompt, defaultOutput, ...rest } = patch as Partial<Project> & {
      metrics?: ProjectMetricsInput
      generalContext?: string
      generalPrompt?: string
      defaultOutput?: string
    }

    const promptPatch: Partial<Record<ProjectPromptKey, string>> = {}
    if ('generalContext' in patch) promptPatch.generalContext = typeof generalContext === 'string' ? generalContext : ''
    if ('generalPrompt' in patch) promptPatch.generalPrompt = typeof generalPrompt === 'string' ? generalPrompt : ''
    if ('defaultOutput' in patch) promptPatch.defaultOutput = typeof defaultOutput === 'string' ? defaultOutput : ''

    const nextMetrics = this.buildProjectMetrics(current.metrics, incomingMetrics, promptPatch)
    const next: Project = {
      ...current,
      ...rest,
      metrics: nextMetrics,
      ...(promptPatch),
      updatedAt: Date.now()
    }

    await this.db
      .prepare(
        `UPDATE projects
         SET name = @name,
             description = @description,
        archived = @archived,
             metrics_json = @metricsJson,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        name: next.name,
        description: next.description,
        archived: next.archived ? 1 : 0,
        metricsJson: this.toJson(next.metrics),
        updatedAt: next.updatedAt
      })
    return next
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM projects WHERE id = @id').run({ id })
  }

  private map(row: any): Project {
    const metrics = this.parseJson<Record<string, unknown>>(row.metrics_json) ?? {}
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description ?? undefined,
      archived: Boolean(row.archived),
      metrics,
      generalContext: this.normalizeProjectPrompt(metrics.generalContext),
      generalPrompt: this.normalizeProjectPrompt(metrics.generalPrompt),
      defaultOutput: this.normalizeProjectPrompt(metrics.defaultOutput),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private buildProjectMetrics(
    currentMetrics: ProjectMetricsInput,
    incomingMetrics: ProjectMetricsInput,
    promptPatch: Partial<Record<ProjectPromptKey, string>>
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = {
      ...(this.parseMetrics(currentMetrics)),
      ...(this.parseMetrics(incomingMetrics))
    }

    PROJECT_PROMPT_FIELDS.forEach((field) => {
      if (field in promptPatch) {
        merged[field] = promptPatch[field] ?? ''
      }
    })

    return merged
  }

  private parseMetrics(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
  }

  private normalizeProjectPrompt(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }
}
