import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type {
  McpApprovalPolicy,
  McpAuditEvent,
  McpCapability,
  McpCapabilityType,
  McpOAuthStatus,
  McpRiskTier,
  McpServer,
  McpServerStatus,
  McpTransport
} from '../../shared/types/entities.js'

export interface McpServerListInput {
  query?: string
  status?: McpServerStatus
  transport?: McpTransport
}

export interface McpServerWriteInput {
  name?: string
  transport?: McpTransport
  status?: McpServerStatus
  riskTier?: McpRiskTier
  enabled?: boolean
  required?: boolean
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  envVars?: string[]
  url?: string
  authType?: 'none' | 'bearer_env' | 'oauth'
  bearerTokenEnvVar?: string
  httpHeaders?: Record<string, string>
  envHttpHeaders?: Record<string, string>
  enabledTools?: string[]
  disabledTools?: string[]
  startupTimeoutSec?: number | null
  toolTimeoutSec?: number | null
  lastDiscoveredAt?: number | null
  lastError?: string | null
}

export interface McpLinkWriteInput {
  serverId: string
  enabledTools?: string[]
  disabledTools?: string[]
  approvalPolicy?: McpApprovalPolicy
  linkType?: 'required' | 'recommended'
}

export class McpRepository extends BaseRepository<McpServer> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string, input: McpServerListInput = {}): Promise<McpServer[]> {
    const clauses = ['organization_id = @orgId']
    const params: Record<string, unknown> = { orgId }
    if (input.query?.trim()) {
      clauses.push('(LOWER(name) LIKE @query OR LOWER(slug) LIKE @query OR LOWER(url) LIKE @query OR LOWER(command) LIKE @query)')
      params.query = `%${input.query.trim().toLowerCase()}%`
    }
    if (input.status) {
      clauses.push('status = @status')
      params.status = input.status
    }
    if (input.transport) {
      clauses.push('transport = @transport')
      params.transport = input.transport
    }
    const rows = await this.db
      .prepare(`SELECT * FROM mcp_servers WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, name ASC`)
      .all(params)
    return this.hydrate(rows.map((row: any) => this.map(row)))
  }

  async get(id: string): Promise<McpServer | undefined> {
    const row = await this.db.prepare('SELECT * FROM mcp_servers WHERE id = @id').get<any>({ id })
    if (!row) return undefined
    const [server] = await this.hydrate([this.map(row)])
    return server
  }

  async create(orgId: string, input: McpServerWriteInput): Promise<McpServer> {
    const now = Date.now()
    const name = input.name?.trim() || 'MCP server'
    const row = this.normalizeWrite({
      id: randomUUID(),
      organizationId: orgId,
      name,
      slug: await this.uniqueSlug(orgId, name),
      transport: input.transport ?? 'stdio',
      status: input.status ?? 'inactive',
      riskTier: input.riskTier ?? 'medium',
      enabled: input.enabled ?? true,
      required: input.required ?? false,
      auth: { type: input.authType ?? 'none' },
      createdAt: now,
      updatedAt: now
    }, input)
    await this.insertRow(row)
    return (await this.get(row.id)) ?? row
  }

  async update(orgId: string, id: string, input: Partial<McpServerWriteInput>): Promise<McpServer | undefined> {
    const current = await this.get(id)
    if (!current || current.organizationId !== orgId) return undefined
    const nextName = input.name?.trim() || current.name
    const next = this.normalizeWrite({
      ...current,
      name: nextName,
      slug: nextName !== current.name ? await this.uniqueSlug(orgId, nextName, id) : current.slug,
      updatedAt: Date.now()
    }, input)
    await this.updateRow(next)
    return this.get(id)
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    const current = await this.get(id)
    if (!current || current.organizationId !== orgId) return false
    await this.db.prepare('DELETE FROM mcp_servers WHERE id = @id').run({ id })
    return true
  }

  async listByIds(orgId: string, ids: string[]): Promise<McpServer[]> {
    const normalized = Array.from(new Set(ids.filter(Boolean)))
    if (normalized.length === 0) return []
    const placeholders = normalized.map((_, index) => `@id${index}`).join(', ')
    const params = normalized.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, { orgId })
    const rows = await this.db
      .prepare(`SELECT * FROM mcp_servers WHERE organization_id = @orgId AND id IN (${placeholders}) ORDER BY name ASC`)
      .all(params)
    return this.hydrate(rows.map((row: any) => this.map(row)))
  }

  async replaceCapabilities(orgId: string, serverId: string, capabilities: Array<Omit<McpCapability, 'id' | 'organizationId' | 'serverId' | 'discoveredAt'>>): Promise<void> {
    const now = Date.now()
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM mcp_capabilities WHERE server_id = @serverId').run({ serverId })
      for (const capability of capabilities) {
        await this.db.prepare(
          `INSERT INTO mcp_capabilities (
            id, organization_id, server_id, capability_type, name, title, description, input_schema_json, metadata_json, discovered_at
          ) VALUES (
            @id, @organizationId, @serverId, @capabilityType, @name, @title, @description, @inputSchemaJson, @metadataJson, @discoveredAt
          )`
        ).run({
          id: randomUUID(),
          organizationId: orgId,
          serverId,
          capabilityType: capability.capabilityType,
          name: capability.name,
          title: capability.title ?? null,
          description: capability.description ?? null,
          inputSchemaJson: this.toJson(capability.inputSchemaJson),
          metadataJson: this.toJson(capability.metadata),
          discoveredAt: now
        })
      }
      await this.db.prepare('UPDATE mcp_servers SET last_discovered_at = @now, last_error = NULL, status = @status, updated_at = @now WHERE id = @serverId AND organization_id = @orgId')
        .run({ now, status: 'active', serverId, orgId })
    })
  }

  async listCapabilities(serverIds: string[]): Promise<Record<string, McpCapability[]>> {
    const normalized = Array.from(new Set(serverIds.filter(Boolean)))
    if (normalized.length === 0) return {}
    const placeholders = normalized.map((_, index) => `@id${index}`).join(', ')
    const params = normalized.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(`SELECT * FROM mcp_capabilities WHERE server_id IN (${placeholders}) ORDER BY server_id ASC, capability_type ASC, name ASC`)
      .all(params)
    const byServer: Record<string, McpCapability[]> = {}
    for (const row of rows as any[]) {
      const capability = this.mapCapability(row)
      byServer[capability.serverId] = byServer[capability.serverId] ?? []
      byServer[capability.serverId].push(capability)
    }
    return byServer
  }

  async markError(orgId: string, serverId: string, error: string): Promise<void> {
    await this.db.prepare('UPDATE mcp_servers SET status = @status, last_error = @error, updated_at = @updatedAt WHERE id = @serverId AND organization_id = @orgId')
      .run({ status: 'error', error, updatedAt: Date.now(), serverId, orgId })
  }

  async replaceOwnerLinks(kind: 'agent' | 'skill' | 'project', ownerId: string, links: McpLinkWriteInput[]): Promise<void> {
    const table = kind === 'agent' ? 'agent_mcp_servers' : kind === 'skill' ? 'skill_mcp_servers' : 'project_mcp_servers'
    const ownerColumn = kind === 'agent' ? 'agent_id' : kind === 'skill' ? 'skill_id' : 'project_id'
    const now = Date.now()
    await this.db.transaction(async () => {
      await this.db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = @ownerId`).run({ ownerId })
      for (const link of links) {
        await this.db.prepare(
          `INSERT INTO ${table} (
            id, ${ownerColumn}, server_id, ${kind === 'skill' ? 'link_type,' : ''} enabled_tools_json, disabled_tools_json, approval_policy, created_at
          ) VALUES (
            @id, @ownerId, @serverId, ${kind === 'skill' ? '@linkType,' : ''} @enabledToolsJson, @disabledToolsJson, @approvalPolicy, @createdAt
          )`
        ).run({
          id: randomUUID(),
          ownerId,
          serverId: link.serverId,
          linkType: link.linkType ?? 'recommended',
          enabledToolsJson: this.toJson(this.normalizeList(link.enabledTools)),
          disabledToolsJson: this.toJson(this.normalizeList(link.disabledTools)),
          approvalPolicy: this.normalizeApprovalPolicy(link.approvalPolicy),
          createdAt: now
        })
      }
    })
  }

  async listServerLinksByOwnerIds(kind: 'agent' | 'skill' | 'project', ownerIds: string[]): Promise<Record<string, McpServer[]>> {
    const normalized = Array.from(new Set(ownerIds.filter(Boolean)))
    if (normalized.length === 0) return {}
    const table = kind === 'agent' ? 'agent_mcp_servers' : kind === 'skill' ? 'skill_mcp_servers' : 'project_mcp_servers'
    const ownerColumn = kind === 'agent' ? 'agent_id' : kind === 'skill' ? 'skill_id' : 'project_id'
    const placeholders = normalized.map((_, index) => `@id${index}`).join(', ')
    const params = normalized.reduce<Record<string, string>>((acc, id, index) => {
      acc[`id${index}`] = id
      return acc
    }, {})
    const rows = await this.db
      .prepare(
        `SELECT links.${ownerColumn} AS owner_id, servers.*
         FROM ${table} links
         INNER JOIN mcp_servers servers ON servers.id = links.server_id
         WHERE links.${ownerColumn} IN (${placeholders})
         ORDER BY links.${ownerColumn} ASC, servers.name ASC`
      )
      .all(params) as Array<Record<string, unknown> & { owner_id: string }>
    const servers = await this.hydrate(rows.map((row) => this.map(row)))
    const byId = new Map(servers.map((server) => [server.id, server]))
    const byOwner: Record<string, McpServer[]> = {}
    for (const row of rows) {
      const ownerId = row.owner_id
      const server = byId.get(String(row.id))
      if (!server) continue
      byOwner[ownerId] = byOwner[ownerId] ?? []
      byOwner[ownerId].push(server)
    }
    return byOwner
  }

  async upsertOAuthToken(input: { organizationId: string; userId: string; serverId: string; encryptedTokenJson: string; scopes?: string[]; audience?: string; expiresAt?: number | null }): Promise<McpOAuthStatus> {
    const now = Date.now()
    await this.db.prepare(
      `INSERT INTO mcp_oauth_tokens (
        id, organization_id, user_id, server_id, encrypted_token_json, scopes_json, audience, expires_at, created_at, updated_at
      ) VALUES (
        @id, @organizationId, @userId, @serverId, @encryptedTokenJson, @scopesJson, @audience, @expiresAt, @createdAt, @updatedAt
      )
      ON CONFLICT(user_id, server_id) DO UPDATE SET
        encrypted_token_json = excluded.encrypted_token_json,
        scopes_json = excluded.scopes_json,
        audience = excluded.audience,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`
    ).run({
      id: randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      serverId: input.serverId,
      encryptedTokenJson: input.encryptedTokenJson,
      scopesJson: this.toJson(input.scopes ?? []),
      audience: input.audience ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now
    })
    return {
      serverId: input.serverId,
      connected: true,
      scopes: input.scopes ?? [],
      audience: input.audience,
      expiresAt: input.expiresAt ?? undefined,
      updatedAt: now
    }
  }

  async getOAuthToken(userId: string, serverId: string): Promise<{ encryptedTokenJson: string; status: McpOAuthStatus } | undefined> {
    const row = await this.db.prepare('SELECT * FROM mcp_oauth_tokens WHERE user_id = @userId AND server_id = @serverId').get<any>({ userId, serverId })
    if (!row) return undefined
    return {
      encryptedTokenJson: row.encrypted_token_json,
      status: {
        serverId,
        connected: true,
        scopes: this.parseJson<string[]>(row.scopes_json) ?? [],
        audience: row.audience ?? undefined,
        expiresAt: row.expires_at ?? undefined,
        updatedAt: row.updated_at
      }
    }
  }

  async removeOAuthToken(userId: string, serverId: string): Promise<void> {
    await this.db.prepare('DELETE FROM mcp_oauth_tokens WHERE user_id = @userId AND server_id = @serverId').run({ userId, serverId })
  }

  async appendAudit(input: Omit<McpAuditEvent, 'id' | 'createdAt'>): Promise<McpAuditEvent> {
    const row: McpAuditEvent = { ...input, id: randomUUID(), createdAt: Date.now() }
    await this.db.prepare(
      `INSERT INTO mcp_audit_log (id, organization_id, server_id, user_id, event_type, status, summary, metadata_json, created_at)
       VALUES (@id, @organizationId, @serverId, @userId, @eventType, @status, @summary, @metadataJson, @createdAt)`
    ).run({
      id: row.id,
      organizationId: row.organizationId,
      serverId: row.serverId ?? null,
      userId: row.userId ?? null,
      eventType: row.eventType,
      status: row.status,
      summary: row.summary ?? null,
      metadataJson: this.toJson(row.metadata),
      createdAt: row.createdAt
    })
    return row
  }

  async listAudit(orgId: string, input: { serverId?: string; limit?: number } = {}): Promise<McpAuditEvent[]> {
    const clauses = ['organization_id = @orgId']
    const params: Record<string, unknown> = { orgId, limit: Math.max(1, Math.min(200, Math.floor(input.limit ?? 50))) }
    if (input.serverId) {
      clauses.push('server_id = @serverId')
      params.serverId = input.serverId
    }
    const rows = await this.db
      .prepare(`SELECT * FROM mcp_audit_log WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT @limit`)
      .all(params)
    return (rows as any[]).map((row) => this.mapAudit(row))
  }

  private async hydrate(servers: McpServer[]): Promise<McpServer[]> {
    const capabilities = await this.listCapabilities(servers.map((server) => server.id))
    return servers.map((server) => ({
      ...server,
      capabilities: capabilities[server.id] ?? []
    }))
  }

  private normalizeWrite(base: McpServer, input: Partial<McpServerWriteInput>): McpServer {
    const authType = input.authType ?? base.auth?.type ?? 'none'
    return {
      ...base,
      transport: input.transport ?? base.transport,
      status: input.status ?? base.status,
      riskTier: input.riskTier ?? base.riskTier,
      enabled: input.enabled ?? base.enabled,
      required: input.required ?? base.required,
      command: input.command ?? base.command ?? '',
      args: input.args ?? base.args ?? [],
      cwd: input.cwd ?? base.cwd ?? '',
      env: input.env ?? base.env ?? {},
      envVars: input.envVars ?? base.envVars ?? [],
      url: input.url ?? base.url ?? '',
      auth: {
        type: authType,
        bearerTokenEnvVar: input.bearerTokenEnvVar ?? base.auth?.bearerTokenEnvVar ?? ''
      },
      httpHeaders: input.httpHeaders ?? base.httpHeaders ?? {},
      envHttpHeaders: input.envHttpHeaders ?? base.envHttpHeaders ?? {},
      enabledTools: input.enabledTools ?? base.enabledTools ?? [],
      disabledTools: input.disabledTools ?? base.disabledTools ?? [],
      startupTimeoutSec: input.startupTimeoutSec === undefined ? base.startupTimeoutSec ?? null : input.startupTimeoutSec,
      toolTimeoutSec: input.toolTimeoutSec === undefined ? base.toolTimeoutSec ?? null : input.toolTimeoutSec,
      lastDiscoveredAt: input.lastDiscoveredAt === undefined ? base.lastDiscoveredAt ?? null : input.lastDiscoveredAt,
      lastError: input.lastError === undefined ? base.lastError ?? null : input.lastError
    }
  }

  private rowParams(row: McpServer): Record<string, unknown> {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      transport: row.transport,
      status: row.status,
      riskTier: row.riskTier,
      enabled: row.enabled ? 1 : 0,
      required: row.required ? 1 : 0,
      command: row.command ?? null,
      argsJson: this.toJson(row.args ?? []),
      cwd: row.cwd ?? null,
      envJson: this.toJson(row.env ?? {}),
      envVarsJson: this.toJson(row.envVars ?? []),
      url: row.url ?? null,
      authType: row.auth?.type ?? 'none',
      bearerTokenEnvVar: row.auth?.bearerTokenEnvVar ?? null,
      httpHeadersJson: this.toJson(row.httpHeaders ?? {}),
      envHttpHeadersJson: this.toJson(row.envHttpHeaders ?? {}),
      enabledToolsJson: this.toJson(row.enabledTools ?? []),
      disabledToolsJson: this.toJson(row.disabledTools ?? []),
      startupTimeoutSec: row.startupTimeoutSec ?? null,
      toolTimeoutSec: row.toolTimeoutSec ?? null,
      lastDiscoveredAt: row.lastDiscoveredAt ?? null,
      lastError: row.lastError ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }

  private async insertRow(row: McpServer): Promise<void> {
    await this.db.prepare(
      `INSERT INTO mcp_servers (
        id, organization_id, name, slug, transport, status, risk_tier, enabled, required,
        command, args_json, cwd, env_json, env_vars_json, url, auth_type, bearer_token_env_var,
        http_headers_json, env_http_headers_json, enabled_tools_json, disabled_tools_json,
        startup_timeout_sec, tool_timeout_sec, last_discovered_at, last_error, created_at, updated_at
      ) VALUES (
        @id, @organizationId, @name, @slug, @transport, @status, @riskTier, @enabled, @required,
        @command, @argsJson, @cwd, @envJson, @envVarsJson, @url, @authType, @bearerTokenEnvVar,
        @httpHeadersJson, @envHttpHeadersJson, @enabledToolsJson, @disabledToolsJson,
        @startupTimeoutSec, @toolTimeoutSec, @lastDiscoveredAt, @lastError, @createdAt, @updatedAt
      )`
    ).run(this.rowParams(row))
  }

  private async updateRow(row: McpServer): Promise<void> {
    const { createdAt: _createdAt, ...params } = this.rowParams(row)
    await this.db.prepare(
      `UPDATE mcp_servers SET
        name=@name, slug=@slug, transport=@transport, status=@status, risk_tier=@riskTier,
        enabled=@enabled, required=@required, command=@command, args_json=@argsJson, cwd=@cwd,
        env_json=@envJson, env_vars_json=@envVarsJson, url=@url, auth_type=@authType,
        bearer_token_env_var=@bearerTokenEnvVar, http_headers_json=@httpHeadersJson,
        env_http_headers_json=@envHttpHeadersJson, enabled_tools_json=@enabledToolsJson,
        disabled_tools_json=@disabledToolsJson, startup_timeout_sec=@startupTimeoutSec,
        tool_timeout_sec=@toolTimeoutSec, last_discovered_at=@lastDiscoveredAt,
        last_error=@lastError, updated_at=@updatedAt
       WHERE id=@id AND organization_id=@organizationId`
    ).run(params)
  }

  private map(row: any): McpServer {
    const authType = ['none', 'bearer_env', 'oauth'].includes(row.auth_type) ? row.auth_type : 'none'
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      name: String(row.name),
      slug: String(row.slug),
      transport: row.transport === 'streamable_http' ? 'streamable_http' : 'stdio',
      status: ['active', 'error'].includes(row.status) ? row.status : 'inactive',
      riskTier: ['low', 'high', 'critical'].includes(row.risk_tier) ? row.risk_tier : 'medium',
      enabled: Boolean(row.enabled),
      required: Boolean(row.required),
      command: row.command ?? '',
      args: this.parseJson<string[]>(row.args_json) ?? [],
      cwd: row.cwd ?? '',
      env: this.parseJson<Record<string, string>>(row.env_json) ?? {},
      envVars: this.parseJson<string[]>(row.env_vars_json) ?? [],
      url: row.url ?? '',
      auth: { type: authType, bearerTokenEnvVar: row.bearer_token_env_var ?? '' },
      httpHeaders: this.parseJson<Record<string, string>>(row.http_headers_json) ?? {},
      envHttpHeaders: this.parseJson<Record<string, string>>(row.env_http_headers_json) ?? {},
      enabledTools: this.parseJson<string[]>(row.enabled_tools_json) ?? [],
      disabledTools: this.parseJson<string[]>(row.disabled_tools_json) ?? [],
      startupTimeoutSec: row.startup_timeout_sec === null || row.startup_timeout_sec === undefined ? null : Number(row.startup_timeout_sec),
      toolTimeoutSec: row.tool_timeout_sec === null || row.tool_timeout_sec === undefined ? null : Number(row.tool_timeout_sec),
      lastDiscoveredAt: row.last_discovered_at === null || row.last_discovered_at === undefined ? null : Number(row.last_discovered_at),
      lastError: row.last_error ?? null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    }
  }

  private mapCapability(row: any): McpCapability {
    const capabilityType: McpCapabilityType = row.capability_type === 'resource' || row.capability_type === 'prompt' ? row.capability_type : 'tool'
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      serverId: String(row.server_id),
      capabilityType,
      name: String(row.name),
      title: row.title ?? '',
      description: row.description ?? '',
      inputSchemaJson: this.parseJson<Record<string, unknown>>(row.input_schema_json),
      metadata: this.parseJson<Record<string, unknown>>(row.metadata_json) ?? {},
      discoveredAt: Number(row.discovered_at)
    }
  }

  private mapAudit(row: any): McpAuditEvent {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      serverId: row.server_id ?? null,
      userId: row.user_id ?? null,
      eventType: String(row.event_type),
      status: row.status === 'failed' || row.status === 'blocked' ? row.status : 'ok',
      summary: row.summary ?? '',
      metadata: this.parseJson<Record<string, unknown>>(row.metadata_json) ?? {},
      createdAt: Number(row.created_at)
    }
  }

  private normalizeApprovalPolicy(value: unknown): McpApprovalPolicy {
    return value === 'auto' || value === 'deny' ? value : 'ask'
  }

  private normalizeList(value: unknown): string[] {
    return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))) : []
  }

  private async uniqueSlug(orgId: string, name: string, exceptId?: string): Promise<string> {
    const base = this.slugify(name) || 'mcp-server'
    let candidate = base
    let suffix = 2
    while (await this.db.prepare('SELECT 1 FROM mcp_servers WHERE organization_id = @orgId AND slug = @slug AND id != @exceptId').get({ orgId, slug: candidate, exceptId: exceptId ?? '' })) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  private slugify(value: string): string {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }
}
