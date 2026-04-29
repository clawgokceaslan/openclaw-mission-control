import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Agent, AgentReasoningLevel, AgentStep } from '../../shared/types/entities.js'

function asConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseSteps(value: unknown): AgentStep[] {
  if (!Array.isArray(value)) return []
  return value.map((raw, index) => {
    const item = asConfig(raw)
    return {
      id: typeof item.id === 'string' ? item.id : randomUUID(),
      title: typeof item.title === 'string' ? item.title : '',
      description: typeof item.description === 'string' ? item.description : '',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index
    }
  }).filter((item) => item.title.trim() || item.description.trim())
}

function parseReasoning(value: unknown): AgentReasoningLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'extra_high' ? value : 'medium'
}

export class AgentRepository extends BaseRepository<Agent> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Agent[]> {
    const rows = await this.db.prepare('SELECT * FROM agents WHERE organization_id = @orgId ORDER BY created_at DESC').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<Agent | undefined> {
    const row = await this.db.prepare('SELECT * FROM agents WHERE id = @id').get({ id }) as any
    return row ? this.map(row) : undefined
  }

  async create(input: Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'heartbeatAt'>): Promise<Agent> {
    const now = Date.now()
    const row: Agent = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      status: input.status,
      heartbeatAt: now,
      config: input.config,
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO agents (id, organization_id, name, status, heartbeat_at, config_json, created_at, updated_at)
         VALUES (@id, @organizationId, @name, @status, @heartbeatAt, @configJson, @createdAt, @updatedAt)`
      )
      .run({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        status: row.status,
        heartbeatAt: row.heartbeatAt,
        configJson: this.toJson(row.config),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      })
    return row
  }

  async updateHeartbeat(id: string): Promise<Agent | undefined> {
    const now = Date.now()
    const row = await this.get(id)
    if (!row) return undefined
    await this.db
      .prepare('UPDATE agents SET heartbeat_at = @now, updated_at = @now WHERE id = @id')
      .run({ now, id })
    return { ...row, heartbeatAt: now, updatedAt: now }
  }

  async update(id: string, patch: Partial<Agent>): Promise<Agent | undefined> {
    const current = await this.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch, updatedAt: Date.now() }
    await this.db
      .prepare('UPDATE agents SET name=@name, status=@status, config_json=@configJson, updated_at=@updatedAt WHERE id=@id')
      .run({
        id,
        name: next.name,
        status: next.status,
        configJson: this.toJson(next.config),
        updatedAt: next.updatedAt
      })
    return next
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM agents WHERE id = @id').run({ id })
  }

  private map(row: any): Agent {
    const config = this.parseJson<Record<string, unknown>>(row.config_json) || {}
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      status: row.status,
      heartbeatAt: row.heartbeat_at,
      config,
      title: typeof config.title === 'string' ? config.title : '',
      trainingMarkdown: typeof config.trainingMarkdown === 'string' ? config.trainingMarkdown : '',
      steps: parseSteps(config.steps),
      reasoningLevel: parseReasoning(config.reasoningLevel),
      outputFormatId: typeof config.outputFormatId === 'string' ? config.outputFormatId : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
