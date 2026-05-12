import { randomBytes, createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import {
  errorResponse,
  okResponse,
  type ServiceResponse
} from '../../shared/contracts/response.js'
import type {
  LinkMcpServersRequest,
  ListMcpServersRequest,
  McpAuditRequest,
  McpOAuthCompleteRequest,
  McpServerRequest,
  UpsertMcpServerRequest
} from '../../shared/contracts/ipc.js'
import type {
  McpAuditEvent,
  McpCapability,
  McpServer
} from '../../shared/types/entities.js'
import { McpRepository, type McpLinkWriteInput, type McpServerWriteInput } from '../../db/repositories/mcp-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { SkillRepository } from '../../db/repositories/skill-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { AuthService } from './auth.service.js'
import { electronRuntime } from '../utils/electron-runtime.js'

const LOCAL_COMMAND_ALLOWLIST = new Set(['node', 'npx', 'npm', 'pnpm', 'yarn', 'python', 'python3', 'uvx', 'bun', 'deno'])
const MCP_OAUTH_CALLBACK_PATH = '/api/mcp/oauth/callback'

type PendingOAuth = {
  state: string
  serverId: string
  organizationId: string
  userId: string
  codeVerifier: string
  tokenEndpoint: string
  redirectUri: string
  scopes: string[]
  audience?: string
  createdAt: number
}

const pendingOAuth = new Map<string, PendingOAuth>()

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
    : []
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const record = asRecord(value)
  const next: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') next[key] = item
  }
  return next
}

function isLocalhost(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function codeChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

function timeoutMs(seconds: number | null | undefined, fallback: number): number {
  return Math.max(1000, Math.min(120_000, Math.floor((seconds ?? fallback) * 1000)))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.ceil(ms / 1000)}s`)), ms)
    promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    }, (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function encryptTokenPayload(value: unknown): string {
  const raw = JSON.stringify(value)
  const safeStorage = electronRuntime.safeStorage
  if (safeStorage?.isEncryptionAvailable?.()) {
    return `safe:${safeStorage.encryptString(raw).toString('base64')}`
  }
  return `base64:${Buffer.from(raw, 'utf8').toString('base64')}`
}

function decryptTokenPayload(value: string): Record<string, unknown> | null {
  try {
    if (value.startsWith('safe:')) {
      const safeStorage = electronRuntime.safeStorage
      if (!safeStorage?.isEncryptionAvailable?.()) return null
      const raw = safeStorage.decryptString(Buffer.from(value.slice('safe:'.length), 'base64'))
      return asRecord(JSON.parse(raw))
    }
    if (value.startsWith('base64:')) {
      return asRecord(JSON.parse(Buffer.from(value.slice('base64:'.length), 'base64').toString('utf8')))
    }
  } catch {
    return null
  }
  return null
}

function redactMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = /token|secret|password|authorization/i.test(key) ? 'redacted' : item
  }
  return redacted
}

async function safeList<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call()
  } catch {
    return fallback
  }
}

export class McpService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: McpRepository,
    private readonly agents: AgentRepository,
    private readonly skills: SkillRepository,
    private readonly projects: ProjectRepository
  ) {}

  async list(payload: ListMcpServersRequest): Promise<ServiceResponse<McpServer[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(actor.user.organizationId, {
      query: payload?.query,
      status: payload?.status,
      transport: payload?.transport
    }))
  }

  async get(payload: McpServerRequest): Promise<ServiceResponse<McpServer>> {
    const access = await this.requireServer(payload?.actorToken, payload?.id)
    if (!access.ok) return access.response
    return okResponse(access.server)
  }

  async create(payload: UpsertMcpServerRequest): Promise<ServiceResponse<McpServer>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const normalized = this.normalizeWritePayload(payload, false)
    if (!normalized.ok) return normalized.response
    const created = await this.repo.create(actor.user.organizationId, normalized.data)
    await this.audit(actor.user.organizationId, actor.user.id, created.id, 'server.create', 'ok', `Created MCP server ${created.name}`)
    return okResponse(created)
  }

  async update(payload: UpsertMcpServerRequest): Promise<ServiceResponse<McpServer>> {
    const access = await this.requireServer(payload?.actorToken, payload?.id)
    if (!access.ok) return access.response
    const normalized = this.normalizeWritePayload(payload, true)
    if (!normalized.ok) return normalized.response
    const updated = await this.repo.update(access.actor.user.organizationId, access.server.id, normalized.data)
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'MCP server not found')
    await this.audit(access.actor.user.organizationId, access.actor.user.id, updated.id, 'server.update', 'ok', `Updated MCP server ${updated.name}`)
    return okResponse(updated)
  }

  async remove(payload: McpServerRequest): Promise<ServiceResponse<{ ok: true }>> {
    const access = await this.requireServer(payload?.actorToken, payload?.id)
    if (!access.ok) return access.response as ServiceResponse<{ ok: true }>
    const removed = await this.repo.remove(access.actor.user.organizationId, access.server.id)
    if (!removed) return errorResponse(ErrorCodes.NotFound, 'MCP server not found')
    await this.audit(access.actor.user.organizationId, access.actor.user.id, access.server.id, 'server.remove', 'ok', `Removed MCP server ${access.server.name}`)
    return okResponse({ ok: true })
  }

  async test(payload: McpServerRequest): Promise<ServiceResponse<{ ok: true; capabilities: McpCapability[] }>> {
    return this.discover(payload)
  }

  async discover(payload: McpServerRequest): Promise<ServiceResponse<{ ok: true; capabilities: McpCapability[] }>> {
    const access = await this.requireServer(payload?.actorToken, payload?.id)
    if (!access.ok) return access.response as ServiceResponse<{ ok: true; capabilities: McpCapability[] }>
    const validation = this.validateRunnableServer(access.server)
    if (validation) return validation as ServiceResponse<{ ok: true; capabilities: McpCapability[] }>
    try {
      const capabilities = await this.discoverCapabilities(access.server, access.actor.user.id)
      await this.repo.replaceCapabilities(access.actor.user.organizationId, access.server.id, capabilities)
      await this.audit(access.actor.user.organizationId, access.actor.user.id, access.server.id, 'server.discover', 'ok', `Discovered ${capabilities.length} MCP capabilities`, { capabilityCount: capabilities.length })
      const updated = await this.repo.get(access.server.id)
      return okResponse({ ok: true, capabilities: updated?.capabilities ?? [] })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.repo.markError(access.actor.user.organizationId, access.server.id, message)
      await this.audit(access.actor.user.organizationId, access.actor.user.id, access.server.id, 'server.discover', 'failed', message)
      return errorResponse(ErrorCodes.GatewayUnavailable, message)
    }
  }

  async oauthStart(payload: McpServerRequest): Promise<ServiceResponse<{ authorizationUrl: string; state: string; callbackUrl: string }>> {
    const access = await this.requireServer(payload?.actorToken, payload?.id)
    if (!access.ok) return access.response as ServiceResponse<{ authorizationUrl: string; state: string; callbackUrl: string }>
    if (access.server.transport !== 'streamable_http' || access.server.auth.type !== 'oauth' || !access.server.url) {
      return errorResponse(ErrorCodes.Validation, 'OAuth is only available for remote Streamable HTTP MCP servers configured with OAuth auth')
    }
    const serverUrl = new URL(access.server.url)
    const callbackUrl = this.callbackUrl(serverUrl)
    const metadata = await this.discoverOAuthMetadata(serverUrl)
    if (!metadata.authorizationEndpoint || !metadata.tokenEndpoint) {
      return errorResponse(ErrorCodes.Validation, 'MCP OAuth metadata did not expose authorization and token endpoints')
    }
    const state = base64Url(randomBytes(24))
    const codeVerifier = base64Url(randomBytes(32))
    const scopes = normalizeList(metadata.scopesSupported).slice(0, 20)
    const authorizationUrl = new URL(metadata.authorizationEndpoint)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('client_id', metadata.clientId || 'open-mission-control')
    authorizationUrl.searchParams.set('redirect_uri', callbackUrl)
    authorizationUrl.searchParams.set('state', state)
    authorizationUrl.searchParams.set('code_challenge', codeChallenge(codeVerifier))
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')
    if (scopes.length > 0) authorizationUrl.searchParams.set('scope', scopes.join(' '))
    pendingOAuth.set(state, {
      state,
      serverId: access.server.id,
      organizationId: access.actor.user.organizationId,
      userId: access.actor.user.id,
      codeVerifier,
      tokenEndpoint: metadata.tokenEndpoint,
      redirectUri: callbackUrl,
      scopes,
      audience: metadata.audience,
      createdAt: Date.now()
    })
    await this.audit(access.actor.user.organizationId, access.actor.user.id, access.server.id, 'oauth.start', 'ok', `Started OAuth for ${access.server.name}`, { authorizationEndpoint: metadata.authorizationEndpoint })
    const shell = electronRuntime.shell
    if (shell) await shell.openExternal(authorizationUrl.toString()).catch(() => undefined)
    return okResponse({ authorizationUrl: authorizationUrl.toString(), state, callbackUrl })
  }

  async oauthComplete(payload: McpOAuthCompleteRequest): Promise<ServiceResponse<{ ok: true; serverId: string }>> {
    const state = payload?.state?.trim() ?? ''
    const pending = state ? pendingOAuth.get(state) : undefined
    if (!pending) return errorResponse(ErrorCodes.Validation, 'OAuth state is invalid or expired')
    pendingOAuth.delete(state)
    if (payload.error) {
      await this.audit(pending.organizationId, pending.userId, pending.serverId, 'oauth.complete', 'failed', payload.errorDescription || payload.error)
      return errorResponse(ErrorCodes.Validation, payload.errorDescription || payload.error)
    }
    if (!payload.code?.trim()) return errorResponse(ErrorCodes.Validation, 'OAuth authorization code is required')
    const tokenResponse = await fetch(pending.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: payload.code.trim(),
        redirect_uri: pending.redirectUri,
        client_id: 'open-mission-control',
        code_verifier: pending.codeVerifier
      })
    })
    const tokenJson = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>
    if (!tokenResponse.ok) {
      await this.audit(pending.organizationId, pending.userId, pending.serverId, 'oauth.complete', 'failed', `Token exchange failed with ${tokenResponse.status}`, redactMetadata(tokenJson))
      return errorResponse(ErrorCodes.GatewayUnavailable, `OAuth token exchange failed with ${tokenResponse.status}`)
    }
    const expiresIn = typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : undefined
    await this.repo.upsertOAuthToken({
      organizationId: pending.organizationId,
      userId: pending.userId,
      serverId: pending.serverId,
      encryptedTokenJson: encryptTokenPayload({
        ...tokenJson,
        token_endpoint: pending.tokenEndpoint,
        issued_at: Date.now()
      }),
      scopes: pending.scopes,
      audience: pending.audience,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined
    })
    await this.audit(pending.organizationId, pending.userId, pending.serverId, 'oauth.complete', 'ok', 'OAuth token stored', { scopes: pending.scopes, audience: pending.audience })
    return okResponse({ ok: true, serverId: pending.serverId })
  }

  async oauthLogout(payload: McpServerRequest): Promise<ServiceResponse<{ ok: true }>> {
    const access = await this.requireServer(payload?.actorToken, payload?.id)
    if (!access.ok) return access.response as ServiceResponse<{ ok: true }>
    await this.repo.removeOAuthToken(access.actor.user.id, access.server.id)
    await this.audit(access.actor.user.organizationId, access.actor.user.id, access.server.id, 'oauth.logout', 'ok', `Removed OAuth token for ${access.server.name}`)
    return okResponse({ ok: true })
  }

  async linkAgents(payload: LinkMcpServersRequest): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const ownerId = payload?.ownerId?.trim()
    if (!ownerId) return errorResponse(ErrorCodes.Validation, 'Agent id required')
    const agent = await this.agents.get(ownerId)
    if (!agent || agent.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    const links = await this.normalizeLinks(payload, actor.user.organizationId)
    if (!links.ok) return links.response
    await this.repo.replaceOwnerLinks('agent', ownerId, links.links)
    return okResponse({ ok: true })
  }

  async linkSkills(payload: LinkMcpServersRequest): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const ownerId = payload?.ownerId?.trim()
    if (!ownerId) return errorResponse(ErrorCodes.Validation, 'Skill id required')
    const skill = (await this.skills.list(actor.user.organizationId)).find((item) => item.id === ownerId)
    if (!skill) return errorResponse(ErrorCodes.NotFound, 'Skill not found')
    const links = await this.normalizeLinks(payload, actor.user.organizationId, true)
    if (!links.ok) return links.response
    await this.repo.replaceOwnerLinks('skill', ownerId, links.links)
    return okResponse({ ok: true })
  }

  async linkProjects(payload: LinkMcpServersRequest): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const ownerId = payload?.ownerId?.trim()
    if (!ownerId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const project = await this.projects.get(ownerId)
    if (!project || project.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    const links = await this.normalizeLinks(payload, actor.user.organizationId)
    if (!links.ok) return links.response
    await this.repo.replaceOwnerLinks('project', ownerId, links.links)
    return okResponse({ ok: true })
  }

  async audit(payload: McpAuditRequest): Promise<ServiceResponse<McpAuditEvent[]>>
  async audit(organizationId: string, userId: string | undefined, serverId: string | undefined, eventType: string, status: 'ok' | 'failed' | 'blocked', summary?: string, metadata?: Record<string, unknown>): Promise<McpAuditEvent>
  async audit(
    arg1: McpAuditRequest | string,
    userId?: string,
    serverId?: string,
    eventType?: string,
    status?: 'ok' | 'failed' | 'blocked',
    summary?: string,
    metadata?: Record<string, unknown>
  ): Promise<ServiceResponse<McpAuditEvent[]> | McpAuditEvent> {
    if (typeof arg1 === 'string') {
      return this.repo.appendAudit({
        organizationId: arg1,
        userId,
        serverId,
        eventType: eventType ?? 'event',
        status: status ?? 'ok',
        summary,
        metadata: metadata ? redactMetadata(metadata) : undefined
      })
    }
    const actor = await this.auth.requireActor(arg1?.actorToken)
    return okResponse(await this.repo.listAudit(actor.user.organizationId, {
      serverId: arg1?.serverId,
      limit: arg1?.limit
    }))
  }

  private normalizeWritePayload(payload: UpsertMcpServerRequest, partial: boolean): { ok: true; data: McpServerWriteInput } | { ok: false; response: ServiceResponse<McpServer> } {
    if (!partial && !payload.name?.trim()) return { ok: false, response: errorResponse(ErrorCodes.Validation, 'MCP server name required') }
    if (payload.name !== undefined && !payload.name.trim()) return { ok: false, response: errorResponse(ErrorCodes.Validation, 'MCP server name required') }
    const transport = payload.transport === 'streamable_http' ? 'streamable_http' : payload.transport === 'stdio' ? 'stdio' : undefined
    if (!partial && !transport) return { ok: false, response: errorResponse(ErrorCodes.Validation, 'MCP transport required') }
    const data: McpServerWriteInput = {
      ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
      ...(transport ? { transport } : {}),
      ...(payload.status === 'active' || payload.status === 'error' || payload.status === 'inactive' ? { status: payload.status } : {}),
      ...(payload.riskTier === 'low' || payload.riskTier === 'high' || payload.riskTier === 'critical' || payload.riskTier === 'medium' ? { riskTier: payload.riskTier } : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {}),
      ...(payload.required !== undefined ? { required: Boolean(payload.required) } : {}),
      ...(payload.command !== undefined ? { command: payload.command.trim() } : {}),
      ...(payload.args !== undefined ? { args: normalizeList(payload.args) } : {}),
      ...(payload.cwd !== undefined ? { cwd: payload.cwd.trim() } : {}),
      ...(payload.env !== undefined ? { env: normalizeStringMap(payload.env) } : {}),
      ...(payload.envVars !== undefined ? { envVars: normalizeList(payload.envVars) } : {}),
      ...(payload.url !== undefined ? { url: payload.url.trim() } : {}),
      ...(payload.authType === 'bearer_env' || payload.authType === 'oauth' || payload.authType === 'none' ? { authType: payload.authType } : {}),
      ...(payload.bearerTokenEnvVar !== undefined ? { bearerTokenEnvVar: payload.bearerTokenEnvVar.trim() } : {}),
      ...(payload.httpHeaders !== undefined ? { httpHeaders: normalizeStringMap(payload.httpHeaders) } : {}),
      ...(payload.envHttpHeaders !== undefined ? { envHttpHeaders: normalizeStringMap(payload.envHttpHeaders) } : {}),
      ...(payload.enabledTools !== undefined ? { enabledTools: normalizeList(payload.enabledTools) } : {}),
      ...(payload.disabledTools !== undefined ? { disabledTools: normalizeList(payload.disabledTools) } : {}),
      ...(payload.startupTimeoutSec !== undefined ? { startupTimeoutSec: this.normalizeTimeout(payload.startupTimeoutSec) } : {}),
      ...(payload.toolTimeoutSec !== undefined ? { toolTimeoutSec: this.normalizeTimeout(payload.toolTimeoutSec) } : {})
    }
    return { ok: true, data }
  }

  private normalizeTimeout(value: unknown): number | null {
    if (value === null || value === '') return null
    const normalized = Number(value)
    if (!Number.isInteger(normalized) || normalized < 1 || normalized > 3600) return null
    return normalized
  }

  private validateRunnableServer(server: McpServer): ServiceResponse<McpServer> | null {
    if (!server.enabled) return errorResponse(ErrorCodes.Validation, 'MCP server is disabled')
    if (server.transport === 'stdio') {
      const command = server.command?.trim() ?? ''
      if (!command) return errorResponse(ErrorCodes.Validation, 'Local MCP command is required')
      if (!LOCAL_COMMAND_ALLOWLIST.has(command) && !isAbsolute(command)) {
        return errorResponse(ErrorCodes.Forbidden, `Local MCP command "${command}" is not allowlisted`)
      }
      if (server.cwd && !isAbsolute(server.cwd)) return errorResponse(ErrorCodes.Validation, 'Local MCP cwd must be an absolute path')
    } else {
      if (!server.url?.trim()) return errorResponse(ErrorCodes.Validation, 'Remote MCP URL is required')
      let parsed: URL
      try {
        parsed = new URL(server.url)
      } catch {
        return errorResponse(ErrorCodes.Validation, 'Remote MCP URL is invalid')
      }
      if (parsed.protocol !== 'https:' && !isLocalhost(parsed)) {
        return errorResponse(ErrorCodes.Forbidden, 'Remote MCP URL must use HTTPS unless it targets localhost')
      }
    }
    return null
  }

  private async discoverCapabilities(server: McpServer, userId: string): Promise<Array<Omit<McpCapability, 'id' | 'organizationId' | 'serverId' | 'discoveredAt'>>> {
    const client = new Client({ name: 'open-mission-control', version: '0.1.0' })
    const headers = await this.httpHeaders(server, userId)
    const transport = server.transport === 'stdio'
      ? new StdioClientTransport({
        command: server.command || 'node',
        args: server.args ?? [],
        cwd: server.cwd || undefined,
        env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
        stderr: 'pipe'
      })
      : new StreamableHTTPClientTransport(new URL(server.url || ''), {
        requestInit: Object.keys(headers).length ? { headers } : undefined
      })
    try {
      await withTimeout(client.connect(transport), timeoutMs(server.startupTimeoutSec, 10), 'MCP initialize')
      const tools = await safeList(() => client.listTools(), { tools: [] })
      const resources = await safeList(() => client.listResources(), { resources: [] })
      const prompts = await safeList(() => client.listPrompts(), { prompts: [] })
      return [
        ...(tools.tools ?? []).map((tool: any) => ({
          capabilityType: 'tool' as const,
          name: String(tool.name ?? ''),
          title: typeof tool.title === 'string' ? tool.title : '',
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchemaJson: asRecord(tool.inputSchema),
          metadata: asRecord(tool)
        })).filter((item) => item.name),
        ...(resources.resources ?? []).map((resource: any) => ({
          capabilityType: 'resource' as const,
          name: String(resource.name ?? resource.uri ?? ''),
          title: typeof resource.title === 'string' ? resource.title : '',
          description: typeof resource.description === 'string' ? resource.description : '',
          metadata: asRecord(resource)
        })).filter((item) => item.name),
        ...(prompts.prompts ?? []).map((prompt: any) => ({
          capabilityType: 'prompt' as const,
          name: String(prompt.name ?? ''),
          title: typeof prompt.title === 'string' ? prompt.title : '',
          description: typeof prompt.description === 'string' ? prompt.description : '',
          metadata: asRecord(prompt)
        })).filter((item) => item.name)
      ]
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  private async httpHeaders(server: McpServer, userId: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...(server.httpHeaders ?? {}) }
    for (const [header, envName] of Object.entries(server.envHttpHeaders ?? {})) {
      const value = process.env[envName]
      if (value) headers[header] = value
    }
    if (server.auth.type === 'bearer_env' && server.auth.bearerTokenEnvVar) {
      const token = process.env[server.auth.bearerTokenEnvVar]
      if (token) headers.Authorization = `Bearer ${token}`
    } else if (server.auth.type === 'oauth') {
      const accessToken = await this.oauthAccessToken(server, userId)
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    }
    return headers
  }

  private async oauthAccessToken(server: McpServer, userId: string): Promise<string | null> {
    const stored = await this.repo.getOAuthToken(userId, server.id)
    if (!stored) return null
    const tokenPayload = decryptTokenPayload(stored.encryptedTokenJson)
    if (!tokenPayload) return null
    const accessToken = typeof tokenPayload.access_token === 'string' ? tokenPayload.access_token : null
    const refreshToken = typeof tokenPayload.refresh_token === 'string' ? tokenPayload.refresh_token : null
    const tokenEndpoint = typeof tokenPayload.token_endpoint === 'string' ? tokenPayload.token_endpoint : null
    const expiresAt = stored.status.expiresAt ?? 0
    if (!refreshToken || !tokenEndpoint || expiresAt === 0 || expiresAt > Date.now() + 60_000) return accessToken

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'open-mission-control'
      })
    }).catch(() => null)
    if (!response?.ok) return accessToken
    const refreshed = await response.json().catch(() => ({})) as Record<string, unknown>
    const expiresIn = typeof refreshed.expires_in === 'number' ? refreshed.expires_in : undefined
    const merged = {
      ...tokenPayload,
      ...refreshed,
      refresh_token: typeof refreshed.refresh_token === 'string' ? refreshed.refresh_token : refreshToken,
      token_endpoint: tokenEndpoint,
      issued_at: Date.now()
    }
    await this.repo.upsertOAuthToken({
      organizationId: server.organizationId,
      userId,
      serverId: server.id,
      encryptedTokenJson: encryptTokenPayload(merged),
      scopes: stored.status.scopes,
      audience: stored.status.audience,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : stored.status.expiresAt
    })
    return typeof merged.access_token === 'string' ? merged.access_token : accessToken
  }

  private async normalizeLinks(payload: LinkMcpServersRequest, organizationId: string, allowLinkType = false): Promise<{ ok: true; links: McpLinkWriteInput[] } | { ok: false; response: ServiceResponse<{ ok: true }> }> {
    const rawLinks = Array.isArray(payload.links) && payload.links.length > 0
      ? payload.links
      : normalizeList(payload.serverIds).map((serverId) => ({ serverId }))
    const serverIds = normalizeList(rawLinks.map((link) => link.serverId))
    const allowed = new Set((await this.repo.listByIds(organizationId, serverIds)).map((server) => server.id))
    const invalid = serverIds.filter((serverId) => !allowed.has(serverId))
    if (invalid.length > 0) return { ok: false, response: errorResponse(ErrorCodes.Validation, `Invalid MCP server ids: ${invalid.join(', ')}`) }
    return {
      ok: true,
      links: rawLinks
        .filter((link) => allowed.has(link.serverId))
        .map((link) => ({
          serverId: link.serverId,
          enabledTools: normalizeList(link.enabledTools),
          disabledTools: normalizeList(link.disabledTools),
          approvalPolicy: link.approvalPolicy === 'auto' || link.approvalPolicy === 'deny' ? link.approvalPolicy : 'ask',
          ...(allowLinkType ? { linkType: link.linkType === 'required' ? 'required' : 'recommended' } : {})
        }))
    }
  }

  private async requireServer(actorToken?: string, id?: string): Promise<
    { ok: true; actor: Awaited<ReturnType<AuthService['requireActor']>>; server: McpServer } |
    { ok: false; response: ServiceResponse<McpServer> }
  > {
    const actor = await this.auth.requireActor(actorToken)
    if (!id) return { ok: false, response: errorResponse(ErrorCodes.Validation, 'MCP server id required') }
    const server = await this.repo.get(id)
    if (!server) return { ok: false, response: errorResponse(ErrorCodes.NotFound, 'MCP server not found') }
    if (server.organizationId !== actor.user.organizationId) return { ok: false, response: errorResponse(ErrorCodes.Forbidden, 'Access denied') }
    return { ok: true, actor, server }
  }

  private callbackUrl(serverUrl: URL): string {
    return `http://localhost:19219${MCP_OAUTH_CALLBACK_PATH}`
  }

  private async discoverOAuthMetadata(serverUrl: URL): Promise<{ authorizationEndpoint?: string; tokenEndpoint?: string; scopesSupported?: string[]; clientId?: string; audience?: string }> {
    const resourceMetadataUrl = new URL('/.well-known/oauth-protected-resource', serverUrl)
    let resourceMetadata = await fetch(resourceMetadataUrl).then((response) => response.ok ? response.json() : {}).catch(() => ({})) as Record<string, unknown>
    if (Object.keys(resourceMetadata).length === 0) {
      const response = await fetch(serverUrl, { method: 'GET' }).catch(() => null)
      const header = response?.headers.get('www-authenticate') ?? ''
      const match = /resource_metadata="([^"]+)"/i.exec(header)
      if (match?.[1]) {
        resourceMetadata = await fetch(match[1]).then((res) => res.ok ? res.json() : {}).catch(() => ({})) as Record<string, unknown>
      }
    }
    const authServers = Array.isArray(resourceMetadata.authorization_servers) ? resourceMetadata.authorization_servers.filter((item): item is string => typeof item === 'string') : []
    const issuer = authServers[0] ?? (typeof resourceMetadata.authorization_server === 'string' ? resourceMetadata.authorization_server : undefined)
    const audience = typeof resourceMetadata.resource === 'string' ? resourceMetadata.resource : serverUrl.toString()
    if (!issuer) return { audience }
    const authMetadataUrl = new URL('/.well-known/oauth-authorization-server', issuer)
    const authMetadata = await fetch(authMetadataUrl).then((response) => response.ok ? response.json() : {}).catch(() => ({})) as Record<string, unknown>
    return {
      authorizationEndpoint: typeof authMetadata.authorization_endpoint === 'string' ? authMetadata.authorization_endpoint : undefined,
      tokenEndpoint: typeof authMetadata.token_endpoint === 'string' ? authMetadata.token_endpoint : undefined,
      scopesSupported: normalizeList(authMetadata.scopes_supported),
      clientId: typeof authMetadata.client_id === 'string' ? authMetadata.client_id : undefined,
      audience
    }
  }
}
