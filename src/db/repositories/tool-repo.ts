import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Agent, AiTool, AiToolStatus, AiToolType } from '../../shared/types/entities.js'

export interface AiToolPageInput {
  page: number
  pageSize: number
  query?: string
  status?: AiToolStatus
  toolType?: AiToolType
}

export interface AiToolPageResult {
  rows: AiTool[]
  total: number
  page: number
  pageSize: number
}

export interface AiToolWriteInput {
  name: string
  status?: AiToolStatus
  toolType?: AiToolType
  descriptionMarkdown?: string
  codeLanguage?: string
  codeBody?: string
  functionName?: string
  commandTemplate?: string
  prepareCommand?: string
  workingDirectoryHint?: string
  inputSchemaJson?: Record<string, unknown>
  outputSchemaJson?: Record<string, unknown>
  executionFlowMarkdown?: string
  approvalRequired?: boolean
  timeoutSeconds?: number | null
  agentIds?: string[]
}

export class ToolRepository extends BaseRepository<AiTool> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<AiTool[]> {
    const rows = await this.db.prepare('SELECT * FROM ai_tools WHERE organization_id = @orgId ORDER BY name ASC').all({ orgId })
    return this.hydrateAgents(rows.map((row: any) => this.map(row)))
  }

  async listPage(orgId: string, input: AiToolPageInput): Promise<AiToolPageResult> {
    const page = Math.max(1, Math.floor(input.page || 1))
    const pageSize = Math.max(5, Math.min(100, Math.floor(input.pageSize || 20)))
    const clauses = ['organization_id = @orgId']
    const params: Record<string, unknown> = { orgId }
    if (input.query?.trim()) {
      clauses.push('(LOWER(name) LIKE @query OR LOWER(slug) LIKE @query OR LOWER(tool_type) LIKE @query OR LOWER(description_markdown) LIKE @query)')
      params.query = `%${input.query.trim().toLowerCase()}%`
    }
    if (input.status) {
      clauses.push('status = @status')
      params.status = input.status
    }
    if (input.toolType) {
      clauses.push('tool_type = @toolType')
      params.toolType = input.toolType
    }
    const where = clauses.join(' AND ')
    const totalRow = await this.db.prepare(`SELECT COUNT(*) AS total FROM ai_tools WHERE ${where}`).get(params) as { total?: number } | undefined
    const rows = await this.db
      .prepare(`SELECT * FROM ai_tools WHERE ${where} ORDER BY updated_at DESC, name ASC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })
    return {
      rows: await this.hydrateAgents(rows.map((row: any) => this.map(row))),
      total: totalRow?.total ?? 0,
      page,
      pageSize
    }
  }

  async get(id: string): Promise<AiTool | undefined> {
    const row = await this.db.prepare('SELECT * FROM ai_tools WHERE id = @id').get({ id }) as any
    if (!row) return undefined
    const [tool] = await this.hydrateAgents([this.map(row)])
    return tool
  }

  async create(orgId: string, input: AiToolWriteInput): Promise<AiTool> {
    const now = Date.now()
    const name = input.name.trim()
    const row = this.normalizeWrite({
      id: randomUUID(),
      organizationId: orgId,
      name,
      slug: await this.uniqueSlug(orgId, name),
      createdAt: now,
      updatedAt: now
    }, input)
    await this.db.transaction(async () => {
      await this.insertRow(row)
      await this.replaceToolAgents(row.id, input.agentIds ?? [])
    })
    return (await this.get(row.id)) ?? row
  }

  async update(orgId: string, id: string, input: Partial<AiToolWriteInput>): Promise<AiTool | undefined> {
    const current = await this.get(id)
    if (!current || current.organizationId !== orgId) return undefined
    const nextName = input.name?.trim() || current.name
    const next = this.normalizeWrite({
      ...current,
      name: nextName,
      slug: nextName !== current.name ? await this.uniqueSlug(orgId, nextName, id) : current.slug,
      updatedAt: Date.now()
    }, input)
    await this.db.transaction(async () => {
      await this.updateRow(next)
      if (input.agentIds !== undefined) await this.replaceToolAgents(id, input.agentIds)
    })
    return this.get(id)
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    const current = await this.get(id)
    if (!current || current.organizationId !== orgId) return false
    await this.db.prepare('DELETE FROM ai_tools WHERE id = @id').run({ id })
    return true
  }

  async listByIds(orgId: string, ids: string[]): Promise<AiTool[]> {
    const normalized = Array.from(new Set(ids.filter(Boolean)))
    if (normalized.length === 0) return []
    const placeholders = normalized.map((_, index) => `@id${index}`).join(', ')
    const params = normalized.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, { orgId })
    const rows = await this.db
      .prepare(`SELECT * FROM ai_tools WHERE organization_id = @orgId AND id IN (${placeholders}) ORDER BY name ASC`)
      .all(params)
    return rows.map((row: any) => this.map(row))
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
      byAgentId[row.agent_id].push(this.map(row))
    }
    return byAgentId
  }

  private async hydrateAgents(tools: AiTool[]): Promise<AiTool[]> {
    if (tools.length === 0) return tools
    const toolIds = tools.map((tool) => tool.id)
    const placeholders = toolIds.map((_, index) => `@id${index}`).join(', ')
    const params = toolIds.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(
        `SELECT at.tool_id, a.id, a.organization_id, a.name, a.status, a.heartbeat_at, a.config_json, a.created_at, a.updated_at
         FROM agent_tools at
         INNER JOIN agents a ON a.id = at.agent_id
         WHERE at.tool_id IN (${placeholders})
         ORDER BY at.tool_id ASC, a.name ASC`
      )
      .all(params) as Array<Record<string, unknown> & { tool_id: string }>
    const byToolId: Record<string, Agent[]> = {}
    for (const row of rows) {
      byToolId[row.tool_id] = byToolId[row.tool_id] ?? []
      const config = this.parseJson<Record<string, unknown>>(row.config_json as string | null) || {}
      byToolId[row.tool_id].push({
        id: String(row.id),
        organizationId: String(row.organization_id),
        name: String(row.name),
        status: row.status as Agent['status'],
        heartbeatAt: Number(row.heartbeat_at ?? 0),
        config,
        title: typeof config.title === 'string' ? config.title : '',
        description: typeof config.description === 'string' ? config.description : '',
        trainingMarkdown: typeof config.trainingMarkdown === 'string' ? config.trainingMarkdown : '',
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at)
      })
    }
    return tools.map((tool) => {
      const agents = byToolId[tool.id] ?? []
      return { ...tool, agents, agentIds: agents.map((agent) => agent.id) }
    })
  }

  private normalizeWrite(base: Partial<AiTool> & Pick<AiTool, 'id' | 'organizationId' | 'name' | 'slug' | 'createdAt' | 'updatedAt'>, input: Partial<AiToolWriteInput>): AiTool {
    return {
      id: base.id,
      organizationId: base.organizationId,
      name: base.name,
      slug: base.slug,
      status: input.status ?? base.status ?? 'active',
      toolType: input.toolType ?? base.toolType ?? 'local_command',
      descriptionMarkdown: input.descriptionMarkdown ?? base.descriptionMarkdown ?? '',
      codeLanguage: input.codeLanguage ?? base.codeLanguage ?? '',
      codeBody: input.codeBody ?? base.codeBody ?? '',
      functionName: input.functionName ?? base.functionName ?? '',
      commandTemplate: input.commandTemplate ?? base.commandTemplate ?? '',
      prepareCommand: input.prepareCommand ?? base.prepareCommand ?? '',
      workingDirectoryHint: input.workingDirectoryHint ?? base.workingDirectoryHint ?? '',
      inputSchemaJson: input.inputSchemaJson ?? base.inputSchemaJson,
      outputSchemaJson: input.outputSchemaJson ?? base.outputSchemaJson,
      executionFlowMarkdown: input.executionFlowMarkdown ?? base.executionFlowMarkdown ?? '',
      approvalRequired: input.approvalRequired ?? base.approvalRequired ?? true,
      timeoutSeconds: input.timeoutSeconds === undefined ? base.timeoutSeconds ?? null : input.timeoutSeconds,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt
    }
  }

  private async insertRow(row: AiTool): Promise<void> {
    await this.db.prepare(
      `INSERT INTO ai_tools (
        id, organization_id, name, slug, status, tool_type, description_markdown, code_language, code_body,
        function_name, command_template, prepare_command, working_directory_hint, input_schema_json,
        output_schema_json, execution_flow_markdown, approval_required, timeout_seconds, created_at, updated_at
      ) VALUES (
        @id, @organizationId, @name, @slug, @status, @toolType, @descriptionMarkdown, @codeLanguage, @codeBody,
        @functionName, @commandTemplate, @prepareCommand, @workingDirectoryHint, @inputSchemaJson,
        @outputSchemaJson, @executionFlowMarkdown, @approvalRequired, @timeoutSeconds, @createdAt, @updatedAt
      )`
    ).run(this.rowParams(row))
  }

  private async updateRow(row: AiTool): Promise<void> {
    const { createdAt: _createdAt, ...params } = this.rowParams(row)
    await this.db.prepare(
      `UPDATE ai_tools SET
        name=@name, slug=@slug, status=@status, tool_type=@toolType, description_markdown=@descriptionMarkdown,
        code_language=@codeLanguage, code_body=@codeBody, function_name=@functionName,
        command_template=@commandTemplate, prepare_command=@prepareCommand, working_directory_hint=@workingDirectoryHint,
        input_schema_json=@inputSchemaJson, output_schema_json=@outputSchemaJson,
        execution_flow_markdown=@executionFlowMarkdown, approval_required=@approvalRequired,
        timeout_seconds=@timeoutSeconds, updated_at=@updatedAt
       WHERE id=@id AND organization_id=@organizationId`
    ).run(params)
  }

  private rowParams(row: AiTool): Record<string, unknown> {
    return {
      ...row,
      inputSchemaJson: this.toJson(row.inputSchemaJson),
      outputSchemaJson: this.toJson(row.outputSchemaJson),
      approvalRequired: row.approvalRequired ? 1 : 0
    }
  }

  private async replaceToolAgents(toolId: string, agentIds: string[]): Promise<void> {
    const normalized = Array.from(new Set(agentIds.filter((item) => typeof item === 'string' && item.length > 0)))
    const now = Date.now()
    await this.db.prepare('DELETE FROM agent_tools WHERE tool_id = @toolId').run({ toolId })
    for (const agentId of normalized) {
      await this.db.prepare('INSERT INTO agent_tools (id, agent_id, tool_id, created_at) VALUES (@id, @agentId, @toolId, @createdAt)')
        .run({ id: randomUUID(), agentId, toolId, createdAt: now })
    }
  }

  private async uniqueSlug(orgId: string, name: string, exceptId?: string): Promise<string> {
    const base = this.slugify(name) || 'tool'
    let candidate = base
    let suffix = 2
    while (await this.db.prepare('SELECT 1 FROM ai_tools WHERE organization_id = @orgId AND slug = @slug AND id != @exceptId').get({ orgId, slug: candidate, exceptId: exceptId ?? '' })) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  private slugify(value: string): string {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }

  private map(row: any): AiTool {
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
