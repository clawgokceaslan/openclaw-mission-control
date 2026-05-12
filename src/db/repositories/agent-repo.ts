import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Agent, AiTool, Tag } from '../../shared/types/entities.js'
import { resolveTagColor } from './tag-color.js'
import type { McpRepository } from './mcp-repo.js'

function asConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function withoutLegacyAgentConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
  const { steps: _steps, reasoningLevel: _reasoningLevel, status: _status, outputFormatId: _outputFormatId, ...rest } = config
  return rest
}

export class AgentRepository extends BaseRepository<Agent> {
  constructor(db: SqliteAdapter, private readonly mcpRepo?: McpRepository) {
    super(db)
  }

  async list(orgId: string): Promise<Agent[]> {
    const rows = await this.db.prepare('SELECT * FROM agents WHERE organization_id = @orgId ORDER BY created_at DESC').all({ orgId })
    const agents = rows.map((row: any) => this.map(row))
    return this.hydrateTags(agents)
  }

  async get(id: string): Promise<Agent | undefined> {
    const row = await this.db.prepare('SELECT * FROM agents WHERE id = @id').get({ id }) as any
    if (!row) return undefined
    const [agent] = await this.hydrateTags([this.map(row)])
    return agent
  }

  async create(input: Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'heartbeatAt' | 'tags' | 'tools'> & { tagIds?: string[]; toolIds?: string[] }): Promise<Agent> {
    const now = Date.now()
    const row: Agent = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      status: input.status ?? 'idle',
      heartbeatAt: now,
      config: input.config,
      createdAt: now,
      updatedAt: now
    }
    await this.db.transaction(async () => {
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
      await this.replaceAgentTags(row.id, input.tagIds ?? [])
      await this.replaceAgentTools(row.id, input.toolIds ?? [])
    })
    return (await this.get(row.id)) ?? row
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

  async update(id: string, patch: Partial<Agent> & { tagIds?: string[]; toolIds?: string[] }): Promise<Agent | undefined> {
    const current = await this.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch, updatedAt: Date.now() }
    await this.db.transaction(async () => {
      await this.db
        .prepare('UPDATE agents SET name=@name, status=@status, config_json=@configJson, updated_at=@updatedAt WHERE id=@id')
        .run({
          id,
          name: next.name,
          status: next.status ?? 'idle',
          configJson: this.toJson(next.config),
          updatedAt: next.updatedAt
        })
      if (patch.tagIds !== undefined) {
        await this.replaceAgentTags(id, patch.tagIds)
      }
      if (patch.toolIds !== undefined) {
        await this.replaceAgentTools(id, patch.toolIds)
      }
    })
    return this.get(id)
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM agents WHERE id = @id').run({ id })
  }

  async listAgentTags(agentId: string): Promise<Tag[]> {
    const rows = await this.db
      .prepare(
        `SELECT t.id, t.organization_id, t.name, t.color, t.description, t.updated_at, t.created_at
         FROM agent_tags at
         INNER JOIN tags t ON t.id = at.tag_id
         WHERE at.agent_id = @agentId
         ORDER BY t.name ASC`
      )
      .all({ agentId }) as Array<{ id: string; organization_id: string; name: string; color?: string; description?: string; updated_at?: number; created_at?: number }>
    return rows.map((row) => this.mapTag(row))
  }

  async listTagsByAgentIds(agentIds: string[]): Promise<Record<string, Tag[]>> {
    if (agentIds.length === 0) return {}
    const placeholders = agentIds.map((_, index) => `@id${index}`).join(', ')
    const params = agentIds.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(
        `SELECT at.agent_id, t.id, t.organization_id, t.name, t.color, t.description, t.updated_at, t.created_at
         FROM agent_tags at
         INNER JOIN tags t ON t.id = at.tag_id
         WHERE at.agent_id IN (${placeholders})
         ORDER BY at.agent_id ASC, t.name ASC`
      )
      .all(params) as Array<{ agent_id: string; id: string; organization_id: string; name: string; color?: string; description?: string; updated_at?: number; created_at?: number }>
    const byAgentId: Record<string, Tag[]> = {}
    for (const row of rows) {
      byAgentId[row.agent_id] = byAgentId[row.agent_id] ?? []
      byAgentId[row.agent_id].push(this.mapTag(row))
    }
    return byAgentId
  }

  async listToolsByAgentIds(agentIds: string[]): Promise<Record<string, AiTool[]>> {
    if (agentIds.length === 0) return {}
    const placeholders = agentIds.map((_, index) => `@id${index}`).join(', ')
    const params = agentIds.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(
        `SELECT at.agent_id, t.*
         FROM agent_tools at
         INNER JOIN ai_tools t ON t.id = at.tool_id
         WHERE at.agent_id IN (${placeholders})
         ORDER BY at.agent_id ASC, t.name ASC`
      )
      .all(params) as Array<Record<string, unknown> & { agent_id: string }>
    const byAgentId: Record<string, AiTool[]> = {}
    for (const row of rows) {
      byAgentId[row.agent_id] = byAgentId[row.agent_id] ?? []
      byAgentId[row.agent_id].push(this.mapTool(row))
    }
    return byAgentId
  }

  private async hydrateTags(agents: Agent[]): Promise<Agent[]> {
    const agentIds = agents.map((agent) => agent.id)
    const tagsByAgentId = await this.listTagsByAgentIds(agentIds)
    const toolsByAgentId = await this.listToolsByAgentIds(agentIds)
    const mcpByAgentId = this.mcpRepo ? await this.mcpRepo.listServerLinksByOwnerIds('agent', agentIds) : {}
    return agents.map((agent) => {
      const tags = tagsByAgentId[agent.id] ?? []
      const tools = toolsByAgentId[agent.id] ?? []
      const mcpServers = mcpByAgentId[agent.id] ?? []
      return {
        ...agent,
        tags,
        tagIds: tags.map((tag) => tag.id),
        tools,
        toolIds: tools.map((tool) => tool.id),
        mcpServers,
        mcpServerIds: mcpServers.map((server) => server.id)
      }
    })
  }

  private async replaceAgentTags(agentId: string, tagIds: string[]): Promise<void> {
    const normalized = Array.from(new Set(tagIds.filter((item) => typeof item === 'string' && item.length > 0)))
    const now = Date.now()
    await this.db.prepare('DELETE FROM agent_tags WHERE agent_id = @agentId').run({ agentId })
    for (const tagId of normalized) {
      await this.db
        .prepare('INSERT INTO agent_tags (id, agent_id, tag_id, created_at) VALUES (@id, @agentId, @tagId, @createdAt)')
        .run({
          id: randomUUID(),
          agentId,
          tagId,
          createdAt: now
        })
    }
  }

  private async replaceAgentTools(agentId: string, toolIds: string[]): Promise<void> {
    const normalized = Array.from(new Set(toolIds.filter((item) => typeof item === 'string' && item.length > 0)))
    const now = Date.now()
    await this.db.prepare('DELETE FROM agent_tools WHERE agent_id = @agentId').run({ agentId })
    for (const toolId of normalized) {
      await this.db
        .prepare('INSERT INTO agent_tools (id, agent_id, tool_id, created_at) VALUES (@id, @agentId, @toolId, @createdAt)')
        .run({
          id: randomUUID(),
          agentId,
          toolId,
          createdAt: now
        })
    }
  }

  private mapTag(row: { id: string; organization_id: string; name: string; color?: string; description?: string; updated_at?: number; created_at?: number }): Tag {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      color: resolveTagColor(row.color, row.name),
      description: row.description,
      updatedAt: row.updated_at ?? row.created_at
    }
  }

  private map(row: any): Agent {
    const config = withoutLegacyAgentConfigKeys(this.parseJson<Record<string, unknown>>(row.config_json) || {})
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      status: row.status,
      heartbeatAt: row.heartbeat_at,
      config,
      title: typeof config.title === 'string' ? config.title : '',
      description: typeof config.description === 'string' ? config.description : '',
      trainingMarkdown: typeof config.trainingMarkdown === 'string' ? config.trainingMarkdown : '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapTool(row: any): AiTool {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      slug: row.slug,
      status: row.status === 'inactive' ? 'inactive' : 'active',
      toolType: ['local_command', 'function', 'code', 'reference'].includes(row.tool_type) ? row.tool_type : 'local_command',
      descriptionMarkdown: row.description_markdown ?? '',
      codeLanguage: row.code_language ?? '',
      codeBody: row.code_body ?? '',
      functionName: row.function_name ?? '',
      commandTemplate: row.command_template ?? '',
      prepareCommand: row.prepare_command ?? '',
      workingDirectoryHint: row.working_directory_hint ?? '',
      inputSchemaJson: this.parseJson<Record<string, unknown>>(row.input_schema_json),
      outputSchemaJson: this.parseJson<Record<string, unknown>>(row.output_schema_json),
      executionFlowMarkdown: row.execution_flow_markdown ?? '',
      approvalRequired: Boolean(row.approval_required),
      timeoutSeconds: row.timeout_seconds === null || row.timeout_seconds === undefined ? null : Number(row.timeout_seconds),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
