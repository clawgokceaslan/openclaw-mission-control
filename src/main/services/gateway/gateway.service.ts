import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import EventEmitter from 'node:events'
import { promisify } from 'node:util'
import { ErrorCodes } from '../../../shared/contracts/error-codes.js'
import { IPC_CHANNELS, UpsertGatewayRequest } from '../../../shared/contracts/ipc.js'
import { errorResponse, okResponse, ServiceResponse } from '../../../shared/contracts/response.js'
import {
  Gateway,
  GatewayCommand,
  GatewayHistoryItem,
  ClaudeCliGatewayConfig,
  CodexCliGatewayConfig,
  CodexCliModel,
  OpenClawGatewayConfig,
  OpenClawGatewayPairingStatus,
  OpenClawGatewayTestResult
} from '../../../shared/types/entities.js'
import { AuthService } from '../auth.service.js'
import { GatewayRepository } from '../../../db/repositories/gateway-repo.js'
import { AppSettingsRepository } from '../../../db/repositories/workspace-repo.js'
import { OpenClawGatewayClient, OpenClawGatewayRuntimeRegistry } from './rpc-client.js'
import { createOpenClawDeviceIdentity } from './device-identity.js'
import { OPENCLAW_METHODS, isKnownOpenClawMethod } from './method-catalog.js'
import { ACTIVE_GATEWAY_KEY } from '../app-settings.service.js'
import { codexProcessEnv, resolveClaudeExecutable, resolveCodexExecutable } from '../../utils/codex-cli-resolver.js'

const execFileAsync = promisify(execFile)

type GatewayWithSessions = Gateway & { sessions?: unknown[] }
type SendCommandPayload = {
  actorToken?: string
  gatewayId?: string
  command?: string
  requestId?: string
  payload?: Record<string, unknown>
  commandPayload?: Record<string, unknown>
  awaitResponse?: boolean
  acceptFirstMessage?: boolean
  timeoutMs?: number
}

function maskToken(token: string): string {
  if (!token) return ''
  return '••••••••'
}

function gatewayProvider(input: UpsertGatewayRequest, current?: Gateway): 'codex_cli' | 'claude_cli' {
  const currentProvider = (current?.template as { provider?: unknown } | undefined)?.provider
  return input.provider === 'claude_cli' || currentProvider === 'claude_cli' ? 'claude_cli' : 'codex_cli'
}

function gatewayExecutionMode(inputMode: unknown, currentMode: unknown): 'terminal' | 'exec' {
  return inputMode === 'exec' || inputMode === 'terminal'
    ? inputMode
    : currentMode === 'exec' || currentMode === 'terminal'
      ? currentMode
      : 'terminal'
}

function cliGatewayConfig(input: UpsertGatewayRequest, current?: Gateway): CodexCliGatewayConfig | ClaudeCliGatewayConfig {
  return gatewayProvider(input, current) === 'claude_cli'
    ? claudeCliConfig(input, current)
    : codexCliConfig(input, current)
}

function codexCliConfig(input: UpsertGatewayRequest, current?: Gateway): CodexCliGatewayConfig {
  const currentTemplate = (current?.template ?? {}) as Partial<CodexCliGatewayConfig>
  const codexPath = input.codexPath?.trim() || currentTemplate.codexPath || current?.endpoint || 'codex'
  return {
    provider: 'codex_cli',
    codexPath,
    executionMode: gatewayExecutionMode(input.codexExecutionMode, currentTemplate.executionMode),
    models: currentTemplate.models,
    lastModelRefreshAt: currentTemplate.lastModelRefreshAt,
    lastModelRefreshError: currentTemplate.lastModelRefreshError
  }
}

function claudeCliConfig(input: UpsertGatewayRequest, current?: Gateway): ClaudeCliGatewayConfig {
  const currentTemplate = (current?.template ?? {}) as Partial<ClaudeCliGatewayConfig>
  const claudePath = input.claudePath?.trim() || input.codexPath?.trim() || currentTemplate.claudePath || current?.endpoint || 'claude'
  const apiKeyEnvVar = input.apiKeyEnvVar?.trim() || currentTemplate.apiKeyEnvVar || 'ANTHROPIC_API_KEY'
  return {
    provider: 'claude_cli',
    claudePath,
    executionMode: gatewayExecutionMode(input.claudeExecutionMode ?? input.codexExecutionMode, currentTemplate.executionMode),
    apiKeyEnvVar,
    models: currentTemplate.models,
    lastModelRefreshAt: currentTemplate.lastModelRefreshAt,
    lastModelRefreshError: currentTemplate.lastModelRefreshError,
    lastAuthCheckAt: currentTemplate.lastAuthCheckAt,
    lastAuthCheckError: currentTemplate.lastAuthCheckError
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function modelFromRecord(record: Record<string, unknown>, fallbackSource?: string): CodexCliModel | null {
  const id = asString(record.id) ?? asString(record.model) ?? asString(record.name) ?? asString(record.slug)
  if (!id) return null
  const label = asString(record.label) ?? asString(record.display_name) ?? asString(record.displayName) ?? asString(record.name) ?? id
  const source = asString(record.provider) ?? asString(record.source) ?? asString(record.owned_by) ?? fallbackSource
  const recommended = id === 'gpt-5.5' || id === 'gpt-5.4' || id === 'gpt-5.3-codex-spark' || record.recommended === true
  const supportsReasoning = record.supportsReasoning === true || record.supports_reasoning === true
  const reasoningEfforts = Array.isArray(record.reasoningEfforts)
    ? record.reasoningEfforts.filter((item): item is string => typeof item === 'string')
    : Array.isArray(record.reasoning_efforts)
      ? record.reasoning_efforts.filter((item): item is string => typeof item === 'string')
      : undefined
  return { id, label, ...(source ? { source } : {}), ...(recommended ? { recommended } : {}), ...(supportsReasoning ? { supportsReasoning } : {}), ...(reasoningEfforts?.length ? { reasoningEfforts } : {}) }
}

function collectModelRecords(value: unknown, source?: string): CodexCliModel[] {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap((item) => collectModelRecords(item, source))
  if (typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const direct = modelFromRecord(record, source)
  const models: CodexCliModel[] = direct ? [direct] : []
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'id' || key === 'model' || key === 'name' || key === 'slug') continue
    if (Array.isArray(nested)) models.push(...collectModelRecords(nested, source ?? key))
    else if (nested && typeof nested === 'object' && (key.toLowerCase().includes('model') || key.toLowerCase().includes('catalog'))) {
      models.push(...collectModelRecords(nested, source ?? key))
    }
  }
  return models
}

function normalizeGatewayModels(stdout: string): CodexCliModel[] {
  const parsed = JSON.parse(stdout) as unknown
  const unique = new Map<string, CodexCliModel>()
  for (const model of collectModelRecords(parsed, 'codex')) {
    if (!unique.has(model.id)) unique.set(model.id, model)
  }
  return [...unique.values()].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || a.id.localeCompare(b.id))
}

function pairingStatusFromError(message: string): OpenClawGatewayPairingStatus {
  const lower = message.toLowerCase()
  if (lower.includes('reject') || lower.includes('denied')) return 'rejected'
  if (lower.includes('pair') || lower.includes('approve') || lower.includes('pending') || lower.includes('not allowed')) return 'requested'
  return 'failed'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function connectPayloadFrom(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  return asRecord(record?.connect) ?? record
}

function templateWithSuccessfulHandshake(gateway: Gateway, source?: unknown): OpenClawGatewayConfig {
  const template = { ...((gateway.template ?? {}) as OpenClawGatewayConfig) }
  const connect = connectPayloadFrom(source)
  const auth = asRecord(connect?.auth)
  const deviceToken = typeof auth?.deviceToken === 'string' && auth.deviceToken.trim() ? auth.deviceToken.trim() : undefined
  const scopes = Array.isArray(auth?.scopes) ? auth.scopes.map(String).filter(Boolean) : undefined
  return {
    ...template,
    lastHandshakeAt: Date.now(),
    protocolVersion: String(connect?.protocol ?? template.protocolVersion ?? '3'),
    ...(deviceToken ? { deviceToken } : {}),
    ...(scopes?.length ? { deviceScopes: scopes } : {}),
    pairingStatus: 'paired',
    lastPairingError: undefined
  }
}

export class GatewayService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: GatewayRepository,
    private readonly eventBus: EventEmitter,
    private readonly runtime: OpenClawGatewayRuntimeRegistry,
    private readonly settings: AppSettingsRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Gateway[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const list = await this.repo.listWithSessions(actor.user.organizationId)
    return okResponse(list.map((gateway) => this.maskGateway(gateway)))
  }

  async get(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Gateway>> {
    const gateway = await this.requireGateway(payload?.actorToken, payload?.id)
    if ('ok' in gateway) return gateway
    return okResponse(this.maskGateway(gateway))
  }

  async create(payload: UpsertGatewayRequest): Promise<ServiceResponse<Gateway>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const validation = this.validateUpsert(payload, true)
    if (validation) return validation
    const gateway = await this.repo.create({
      organizationId: actor.user.organizationId,
      name: payload.name!.trim(),
      endpoint: payload.provider === 'claude_cli' ? (payload.claudePath?.trim() || payload.gatewayPath?.trim() || 'claude') : (payload.codexPath?.trim() || payload.gatewayPath?.trim() || 'codex'),
      token: '',
      template: cliGatewayConfig(payload)
    })
    await this.repo.appendHistory(gateway.id, 'gateway.created', { provider: gatewayProvider(payload) })
    return okResponse(this.maskGateway(gateway))
  }

  async update(payload: UpsertGatewayRequest): Promise<ServiceResponse<Gateway>> {
    const current = await this.requireGateway(payload?.actorToken, payload?.id)
    if ('ok' in current) return current
    const validation = this.validateUpsert(payload, false, current)
    if (validation) return validation
    const updated = await this.repo.update(current.id, {
      name: payload.name?.trim(),
      endpoint: gatewayProvider(payload, current) === 'claude_cli'
        ? (payload.claudePath?.trim() || payload.codexPath?.trim() || payload.gatewayPath?.trim() || current.endpoint || 'claude')
        : (payload.codexPath?.trim() || payload.gatewayPath?.trim() || current.endpoint || 'codex'),
      template: cliGatewayConfig(payload, current)
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Gateway not found')
    await this.repo.appendHistory(updated.id, 'gateway.updated', { provider: gatewayProvider(payload, current) })
    return okResponse(this.maskGateway(updated))
  }

  async remove(payload: { actorToken?: string; id?: string }): Promise<ServiceResponse<{ id: string }>> {
    const gateway = await this.requireGateway(payload?.actorToken, payload?.id)
    if ('ok' in gateway) return gateway
    this.runtime.disconnect(gateway.id)
    const activeGatewayId = await this.settings.get<string | null>(gateway.organizationId, ACTIVE_GATEWAY_KEY)
    if (activeGatewayId === gateway.id) await this.settings.set(gateway.organizationId, ACTIVE_GATEWAY_KEY, null)
    await this.repo.remove(gateway.id)
    return okResponse({ id: gateway.id })
  }

  async status(payload: { actorToken?: string; gatewayId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Gateway>> {
    return this.get({ actorToken: payload?.actorToken, id: payload?.gatewayId })
  }

  async sessions(payload: { actorToken?: string; gatewayId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<unknown[]>> {
    const gateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway
    return okResponse(await this.repo.sessions(gateway.id))
  }

  async commands(payload: { actorToken?: string; gatewayId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<GatewayCommand[]>> {
    const gateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway
    return okResponse(await this.repo.commands(gateway.id))
  }

  async commandsHistory(payload: { actorToken?: string; gatewayId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<GatewayHistoryItem[]>> {
    const gateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway
    return okResponse(await this.repo.history(gateway.id))
  }

  async templates(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Array<{ id: string; name: string; sample: string }>>> {
    await this.auth.requireActor(payload?.actorToken)
    return okResponse([
      { id: 'codex_cli', name: 'Codex CLI', sample: 'Local Codex CLI' },
      { id: 'claude_cli', name: 'Claude CLI', sample: 'Local Anthropic Claude CLI' }
    ])
  }

  async gatewayModels(payload: { actorToken?: string; gatewayId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }>> {
    const gateway = await this.requireGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway as ServiceResponse<{ gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }>
    const provider = gatewayProvider({}, gateway)
    const template = cliGatewayConfig({}, gateway)
    try {
      const models = provider === 'claude_cli'
        ? await this.refreshClaudeModels(gateway, template as ClaudeCliGatewayConfig)
        : await this.refreshCodexModels(gateway, template as CodexCliGatewayConfig)
      if (models.length === 0) throw new Error(`${provider === 'claude_cli' ? 'Claude' : 'Codex'} CLI returned no models`)
      const updated = await this.repo.update(gateway.id, {
        template: {
          ...template,
          models,
          lastModelRefreshAt: Date.now(),
          lastModelRefreshError: undefined
        }
      })
      const masked = this.maskGateway(updated ?? gateway)
      await this.repo.appendHistory(gateway.id, `${provider === 'claude_cli' ? 'claude' : 'codex'}.models.refreshed`, { count: models.length })
      return okResponse({ gateway: masked, models, cached: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cached = Array.isArray(template.models) ? template.models : []
      const updated = await this.repo.update(gateway.id, {
        template: {
          ...template,
          lastModelRefreshError: message
        }
      })
      await this.repo.appendHistory(gateway.id, `${provider === 'claude_cli' ? 'claude' : 'codex'}.models.refresh_failed`, { error: message })
      return okResponse({ gateway: this.maskGateway(updated ?? gateway), models: cached, cached: cached.length > 0, error: message })
    }
  }

  private async refreshCodexModels(gateway: Gateway, template: CodexCliGatewayConfig): Promise<CodexCliModel[]> {
    const resolved = await resolveCodexExecutable(template.codexPath || gateway.endpoint || 'codex')
    const { stdout } = await execFileAsync(resolved.command, ['debug', 'models'], { timeout: 20_000, maxBuffer: 1024 * 1024 * 8, env: codexProcessEnv(resolved) })
    const updated = await this.repo.update(gateway.id, { endpoint: resolved.command, template: { ...template, codexPath: resolved.command } })
    void updated
    return normalizeGatewayModels(stdout)
  }

  private async refreshClaudeModels(gateway: Gateway, template: ClaudeCliGatewayConfig): Promise<CodexCliModel[]> {
    const resolved = await resolveClaudeExecutable(template.claudePath || gateway.endpoint || 'claude')
    await execFileAsync(resolved.command, ['--version'], { timeout: 10_000, maxBuffer: 1024 * 64, env: codexProcessEnv(resolved) })
    await this.repo.update(gateway.id, { endpoint: resolved.command, template: { ...template, claudePath: resolved.command } })
    return [
      { id: 'sonnet', label: 'Claude Sonnet', source: 'claude', recommended: true, supportsReasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
      { id: 'opus', label: 'Claude Opus', source: 'claude', supportsReasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] }
    ]
  }

  async connect(payload: { actorToken?: string; gatewayId?: string }): Promise<ServiceResponse<Gateway>> {
    const requestedGateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in requestedGateway) return requestedGateway
    const gateway = await this.ensureDeviceIdentity(requestedGateway)
    await this.repo.setGatewayStatus(gateway.id, 'connecting')
    await this.repo.setSessionState(gateway.id, 'reconnecting', { endpoint: gateway.endpoint }, 1000)
    await this.repo.appendHistory(gateway.id, 'gateway.connect.requested', { provider: 'codex_cli' })
    try {
      await this.runtime.connect(gateway, async (event) => {
        if (event.type === 'connected') {
          await this.repo.update(gateway.id, {
            status: 'online',
            template: templateWithSuccessfulHandshake(gateway, event.payload)
          })
          await this.repo.setSessionState(gateway.id, 'connected', event.payload, 0)
          await this.repo.appendHistory(gateway.id, 'gateway.connected', event.payload)
          this.eventBus.emit(IPC_CHANNELS.events.gatewayStatus, { gatewayId: gateway.id, status: 'online' })
          return
        }
        if (event.type === 'reconnecting') {
          await this.repo.setGatewayStatus(gateway.id, 'connecting')
          await this.repo.setSessionState(gateway.id, 'reconnecting', event.payload, Number(event.payload?.backoffMs ?? 1000))
          await this.repo.appendHistory(gateway.id, 'gateway.reconnecting', event.payload)
          return
        }
        if (event.type === 'disconnected') {
          await this.repo.setGatewayStatus(gateway.id, 'offline')
          await this.repo.setSessionState(gateway.id, 'disconnected', event.payload, 0)
          await this.repo.appendHistory(gateway.id, 'gateway.disconnected', event.payload)
          this.eventBus.emit(IPC_CHANNELS.events.gatewayStatus, { gatewayId: gateway.id, status: 'offline' })
          return
        }
        if (event.type === 'event') {
          await this.repo.appendHistory(gateway.id, event.eventType, event.payload)
          return
        }
        if (event.type === 'error') {
          await this.repo.appendHistory(gateway.id, 'gateway.error', event.payload)
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const pairingStatus = pairingStatusFromError(message)
      await this.repo.setGatewayStatus(gateway.id, 'offline')
      await this.repo.update(gateway.id, {
        template: { ...(gateway.template ?? {}), pairingStatus, lastPairingError: message }
      })
      await this.repo.setSessionState(gateway.id, 'disconnected', { error: message, pairingStatus }, 0)
      await this.repo.appendHistory(gateway.id, pairingStatus === 'requested' ? 'openclaw.pairing.pending' : 'gateway.connect.failed', { error: message, pairingStatus })
      return errorResponse(ErrorCodes.GatewayUnavailable, message || 'OpenClaw gateway connection failed')
    }
    const updated = await this.repo.get(gateway.id)
    return okResponse(this.maskGateway(updated ?? gateway))
  }

  async disconnect(payload: { actorToken?: string; gatewayId?: string }): Promise<ServiceResponse<Gateway>> {
    const gateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway
    this.runtime.disconnect(gateway.id)
    await this.repo.setGatewayStatus(gateway.id, 'offline')
    await this.repo.setSessionState(gateway.id, 'disconnected', { manual: true }, 0)
    await this.repo.appendHistory(gateway.id, 'gateway.disconnect.requested', { provider: 'codex_cli' })
    const updated = await this.repo.get(gateway.id)
    return okResponse(this.maskGateway(updated ?? gateway))
  }

  async pairDevice(payload: { actorToken?: string; gatewayId?: string }): Promise<ServiceResponse<Gateway>> {
    const requestedGateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in requestedGateway) return requestedGateway
    const gateway = await this.ensureDeviceIdentity(requestedGateway)
    await this.repo.appendHistory(gateway.id, 'openclaw.pairing.requested', {
      provider: 'codex_cli',
      deviceId: (gateway.template as OpenClawGatewayConfig | undefined)?.deviceIdentity?.deviceId
    })
    const client = new OpenClawGatewayClient(gateway)
    const result = await client.handshakeStatus()
    if (result.ok) {
      const updated = await this.repo.update(gateway.id, {
        status: 'online',
        template: templateWithSuccessfulHandshake(gateway, result.details)
      })
      await this.repo.setSessionState(gateway.id, 'connected', result.details, 0)
      await this.repo.appendHistory(gateway.id, 'openclaw.pairing.paired', result as unknown as Record<string, unknown>)
      return okResponse(this.maskGateway(updated ?? gateway))
    }

    const message = result.message || String(result.details?.error ?? 'Pairing failed')
    const pairingStatus = pairingStatusFromError(message)
    const updated = await this.repo.update(gateway.id, {
      status: 'offline',
      template: {
        ...(gateway.template ?? {}),
        pairingStatus,
        lastPairingError: message
      }
    })
    await this.repo.setSessionState(gateway.id, 'disconnected', { ...result.details, pairingStatus }, 0)
    await this.repo.appendHistory(gateway.id, pairingStatus === 'requested' ? 'openclaw.pairing.pending' : 'openclaw.pairing.failed', {
      ...result,
      pairingStatus
    } as unknown as Record<string, unknown>)
    return okResponse(this.maskGateway(updated ?? gateway))
  }

  async resetPairing(payload: { actorToken?: string; gatewayId?: string }): Promise<ServiceResponse<Gateway>> {
    const gateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway
    this.runtime.disconnect(gateway.id)
    const template = { ...((gateway.template ?? {}) as OpenClawGatewayConfig) }
    delete template.deviceIdentity
    delete template.deviceToken
    delete template.deviceScopes
    delete template.lastPairingError
    const updated = await this.repo.update(gateway.id, {
      status: 'offline',
      template: { ...template, pairingStatus: 'not_paired' }
    })
    await this.repo.setSessionState(gateway.id, 'disconnected', { resetPairing: true }, 0)
    await this.repo.appendHistory(gateway.id, 'openclaw.pairing.reset', { provider: 'codex_cli' })
    return okResponse(this.maskGateway(updated ?? gateway))
  }

  async testConnection(payload: { actorToken?: string; gatewayId?: string }): Promise<ServiceResponse<OpenClawGatewayTestResult>> {
    const requestedGateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in requestedGateway) return requestedGateway
    const gateway = await this.ensureDeviceIdentity(requestedGateway)
    const client = new OpenClawGatewayClient(gateway)
    const result = await client.handshakeStatus()
    if (result.ok) {
      await this.repo.update(gateway.id, {
        status: 'online',
        template: templateWithSuccessfulHandshake(gateway, result.details)
      })
      await this.repo.setSessionState(gateway.id, 'connected', result.details, 0)
    } else {
      const pairingStatus = pairingStatusFromError(result.message)
      await this.repo.update(gateway.id, {
        template: { ...(gateway.template ?? {}), pairingStatus, lastPairingError: result.message }
      })
      await this.repo.setGatewayStatus(gateway.id, 'offline')
      await this.repo.setSessionState(gateway.id, 'disconnected', { ...result.details, pairingStatus }, 0)
    }
    await this.repo.appendHistory(gateway.id, result.ok ? 'gateway.test.ok' : 'gateway.test.failed', result as unknown as Record<string, unknown>)
    return okResponse(result)
  }

  async testMessage(payload: { actorToken?: string; gatewayId?: string }): Promise<ServiceResponse<OpenClawGatewayTestResult>> {
    const requestedGateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in requestedGateway) return requestedGateway
    const gateway = await this.ensureDeviceIdentity(requestedGateway)
    const client = new OpenClawGatewayClient(gateway)
    const result = await client.testConnection(gateway.id)
    if (result.ok) {
      await this.repo.update(gateway.id, {
        status: 'online',
        template: templateWithSuccessfulHandshake(gateway, result.details)
      })
      await this.repo.setSessionState(gateway.id, 'connected', result.details, 0)
      await this.repo.appendHistory(gateway.id, 'openclaw.test-message.ok', result as unknown as Record<string, unknown>)
    } else {
      const pairingStatus = pairingStatusFromError(result.message)
      await this.repo.update(gateway.id, {
        status: 'offline',
        template: { ...(gateway.template ?? {}), pairingStatus, lastPairingError: result.message }
      })
      await this.repo.setSessionState(gateway.id, 'disconnected', { ...result.details, pairingStatus }, 0)
      await this.repo.appendHistory(gateway.id, pairingStatus === 'requested' ? 'openclaw.pairing.pending' : 'openclaw.test-message.failed', {
        ...result,
        pairingStatus
      } as unknown as Record<string, unknown>)
    }
    return okResponse(result)
  }


  async rpcMethods(payload: { actorToken?: string }): Promise<ServiceResponse<typeof OPENCLAW_METHODS>> {
    await this.auth.requireActor(payload?.actorToken)
    return okResponse(OPENCLAW_METHODS)
  }

  async rpcCall(payload: { actorToken?: string; gatewayId?: string; method?: string; params?: Record<string, unknown>; timeoutMs?: number }): Promise<ServiceResponse<Record<string, unknown>>> {
    const gateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway
    if (!payload.method?.trim()) return errorResponse(ErrorCodes.Validation, 'OpenClaw RPC method required')
    const method = payload.method.trim()
    if (!isKnownOpenClawMethod(method)) return errorResponse(ErrorCodes.Validation, 'Unknown OpenClaw RPC method')
    const startedAt = Date.now()
    const requestId = randomUUID()
    const params = payload.params ?? {}
    const command = await this.repo.queueCommand({ gatewayId: gateway.id, requestId, command: method, payload: params })
    await this.repo.setCommandStatus(command.id, 'sent', { requestId, params, sentAt: startedAt })
    await this.repo.appendHistory(gateway.id, 'openclaw.rpc.sent', { requestId, method, params })
    const activeClient = this.runtime.get(gateway.id)
    const client = activeClient ?? new OpenClawGatewayClient(await this.ensureDeviceIdentity(gateway))
    let shouldDisconnect = false
    try {
      if (!activeClient) {
        await client.connect()
        shouldDisconnect = true
      }
      const result = await client.rpc(method, params, payload.timeoutMs ?? 15000)
      const normalized = { ok: true, method, requestId, durationMs: Date.now() - startedAt, result, raw: result }
      await this.repo.setCommandStatus(command.id, 'completed', normalized)
      await this.repo.appendHistory(gateway.id, 'openclaw.rpc.completed', normalized)
      return okResponse(normalized)
    } catch (error) {
      const normalized = { ok: false, method, requestId, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }
      await this.repo.setCommandStatus(command.id, 'failed', normalized)
      await this.repo.appendHistory(gateway.id, 'openclaw.rpc.failed', normalized)
      return okResponse(normalized)
    } finally {
      if (shouldDisconnect) client.disconnect()
    }
  }

  async chatSend(payload: { actorToken?: string; gatewayId?: string; sessionKey?: string; message?: string; deliver?: boolean }): Promise<ServiceResponse<Record<string, unknown>>> {
    return this.rpcCall({ actorToken: payload.actorToken, gatewayId: payload.gatewayId, method: 'chat.send', params: { sessionKey: payload.sessionKey, message: payload.message, deliver: payload.deliver ?? true, idempotencyKey: randomUUID() } })
  }

  async chatHistory(payload: { actorToken?: string; gatewayId?: string; sessionKey?: string; limit?: number }): Promise<ServiceResponse<Record<string, unknown>>> {
    return this.rpcCall({ actorToken: payload.actorToken, gatewayId: payload.gatewayId, method: 'chat.history', params: { sessionKey: payload.sessionKey, limit: payload.limit ?? 50 } })
  }

  async sessionsPatch(payload: { actorToken?: string; gatewayId?: string; key?: string; label?: string; sessionKey?: string }): Promise<ServiceResponse<Record<string, unknown>>> {
    const key = payload.key ?? payload.sessionKey
    return this.rpcCall({ actorToken: payload.actorToken, gatewayId: payload.gatewayId, method: 'sessions.patch', params: { key, label: payload.label ?? key } })
  }

  async sessionsDelete(payload: { actorToken?: string; gatewayId?: string; sessionKey?: string }): Promise<ServiceResponse<Record<string, unknown>>> {
    return this.rpcCall({ actorToken: payload.actorToken, gatewayId: payload.gatewayId, method: 'sessions.delete', params: { sessionKey: payload.sessionKey } })
  }

  async openClawBoards(payload: { actorToken?: string; gatewayId?: string }) {
    return this.openClawResource(payload, '/boards')
  }

  async openClawAgents(payload: { actorToken?: string; gatewayId?: string }) {
    return this.openClawResource(payload, '/agents')
  }

  async openClawSkills(payload: { actorToken?: string; gatewayId?: string }) {
    return this.openClawResource(payload, '/skills')
  }

  async openClawTags(payload: { actorToken?: string; gatewayId?: string }) {
    return this.openClawResource(payload, '/tags')
  }

  async sendCommand(
    payload: SendCommandPayload,
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<GatewayCommand>> {
    const normalized = this.normalizeSendCommandPayload(payload)
    const gateway = await this.resolveGateway(normalized.actorToken, normalized.gatewayId)
    if ('ok' in gateway) return gateway
    if (!normalized.command) return errorResponse(ErrorCodes.Validation, 'Command required')
    const requestId = normalized.requestId ?? randomUUID()
    const commandPayload = normalized.commandPayload ?? {}
    const command = await this.repo.queueCommand({
      gatewayId: gateway.id,
      requestId,
      command: normalized.command,
      payload: commandPayload
    })
    const client = this.runtime.get(gateway.id)
    if (!client) {
      const failed = await this.repo.setCommandStatus(command.id, 'failed', { error: 'Gateway websocket is not connected' })
      return errorResponse(ErrorCodes.GatewayUnavailable, 'Gateway websocket is not connected', failed)
    }

    if (normalized.awaitResponse) {
      await this.repo.setCommandStatus(command.id, 'sent', { sentAt: Date.now(), requestId })
      await this.repo.appendHistory(gateway.id, 'gateway.command.sent', { requestId, command: normalized.command, payload: commandPayload })
      try {
        const startedAt = Date.now()
        const responsePayload = await client.rpc(normalized.command, commandPayload, normalized.timeoutMs ?? 10000)
        const completed = await this.repo.setCommandStatus(command.id, 'completed', {
          requestId,
          durationMs: Date.now() - startedAt,
          sentPayload: commandPayload,
          response: responsePayload
        })
        await this.repo.appendHistory(gateway.id, 'gateway.command.response', {
          requestId,
          command: normalized.command,
          sentPayload: commandPayload,
          response: responsePayload
        })
        return okResponse(completed)
      } catch (error) {
        const failed = await this.repo.setCommandStatus(command.id, 'failed', {
          requestId,
          sentPayload: commandPayload,
          error: error instanceof Error ? error.message : String(error)
        })
        await this.repo.appendHistory(gateway.id, 'gateway.command.failed', {
          requestId,
          command: normalized.command,
          sentPayload: commandPayload,
          error: error instanceof Error ? error.message : String(error)
        })
        return okResponse(failed)
      }
    }

    await this.repo.setCommandStatus(command.id, 'sent', { sentAt: Date.now(), requestId })
    try {
      const responsePayload = await client.rpc(normalized.command, commandPayload, normalized.timeoutMs ?? 10000)
      const completed = await this.repo.setCommandStatus(command.id, 'completed', { sent: true, requestId, response: responsePayload })
      await this.repo.appendHistory(gateway.id, 'gateway.command.response', { requestId, command: normalized.command, payload: commandPayload, response: responsePayload })
      this.eventBus.emit(IPC_CHANNELS.events.gatewayStatus, {
        type: 'gateway-command-sent',
        gatewayId: gateway.id,
        commandId: command.id,
        requestId
      })
      return okResponse(completed)
    } catch (error) {
      const failed = await this.repo.setCommandStatus(command.id, 'failed', { requestId, error: error instanceof Error ? error.message : String(error) })
      return okResponse(failed)
    }
  }

  async connectAutoConnectGateways(): Promise<void> {
    const gateways = await this.repo.listAutoConnect()
    for (const rawGateway of gateways) {
      const gateway = await this.ensureDeviceIdentity(rawGateway)
      await this.repo.setGatewayStatus(gateway.id, 'connecting')
      await this.repo.appendHistory(gateway.id, 'gateway.autoconnect.requested', { provider: 'codex_cli' })
      await this.runtime.connect(gateway, async (event) => {
        if (event.type === 'connected') {
          await this.repo.update(gateway.id, {
            status: 'online',
            template: templateWithSuccessfulHandshake(gateway, event.payload)
          })
          await this.repo.setSessionState(gateway.id, 'connected', event.payload, 0)
          await this.repo.appendHistory(gateway.id, 'gateway.connected', event.payload)
          return
        }
        if (event.type === 'reconnecting') {
          await this.repo.setGatewayStatus(gateway.id, 'connecting')
          await this.repo.setSessionState(gateway.id, 'reconnecting', event.payload, Number(event.payload?.backoffMs ?? 1000))
          await this.repo.appendHistory(gateway.id, 'gateway.reconnecting', event.payload)
          return
        }
        if (event.type === 'disconnected') {
          await this.repo.setGatewayStatus(gateway.id, 'offline')
          await this.repo.setSessionState(gateway.id, 'disconnected', event.payload, 0)
          await this.repo.appendHistory(gateway.id, 'gateway.disconnected', event.payload)
          return
        }
        if (event.type === 'event') await this.repo.appendHistory(gateway.id, event.eventType, event.payload)
        if (event.type === 'error') await this.repo.appendHistory(gateway.id, 'gateway.error', event.payload)
      }).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error)
        await this.repo.setGatewayStatus(gateway.id, 'offline')
        await this.repo.update(gateway.id, {
          template: { ...(gateway.template ?? {}), pairingStatus: pairingStatusFromError(message), lastPairingError: message }
        })
        await this.repo.appendHistory(gateway.id, 'gateway.autoconnect.failed', {
          error: message
        })
      })
    }
  }

  private async openClawResource(payload: { actorToken?: string; gatewayId?: string }, path: string): Promise<ServiceResponse<unknown[]>> {
    const gateway = await this.resolveGateway(payload?.actorToken, payload?.gatewayId)
    if ('ok' in gateway) return gateway
    await this.repo.appendHistory(gateway.id, `openclaw.ws-only.${path.replace('/', '')}`, { disabled: true })
    return okResponse([])
  }

  private normalizeSendCommandPayload(payload: SendCommandPayload): SendCommandPayload {
    const nested = payload.payload
    const nestedLooksLikeEnvelope =
      nested &&
      typeof nested === 'object' &&
      ('gatewayId' in nested || 'command' in nested || 'commandPayload' in nested || 'awaitResponse' in nested)
    if (!nestedLooksLikeEnvelope) return payload
    const nestedRecord = nested as SendCommandPayload
    return {
      ...payload,
      ...nestedRecord,
      actorToken: payload.actorToken ?? nestedRecord.actorToken,
      commandPayload: nestedRecord.commandPayload ?? payload.commandPayload
    }
  }

  private async requireGateway(actorToken: string | undefined, id: string | undefined): Promise<Gateway | ServiceResponse<never>> {
    if (!id) return errorResponse(ErrorCodes.Validation, 'Gateway id required')
    const actor = await this.auth.requireActor(actorToken)
    const gateway = await this.repo.get(id)
    if (!gateway) return errorResponse(ErrorCodes.NotFound, 'Gateway not found')
    if (gateway.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return gateway
  }

  private async resolveGateway(actorToken: string | undefined, requestedId: string | undefined): Promise<Gateway | ServiceResponse<never>> {
    if (requestedId) return this.requireGateway(actorToken, requestedId)
    const actor = await this.auth.requireActor(actorToken)
    const activeGatewayId = await this.settings.get<string | null>(actor.user.organizationId, ACTIVE_GATEWAY_KEY)
    if (!activeGatewayId) return errorResponse(ErrorCodes.Validation, 'Active gateway required')
    const gateway = await this.repo.get(activeGatewayId)
    if (!gateway || gateway.organizationId !== actor.user.organizationId) {
      await this.settings.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, null)
      return errorResponse(ErrorCodes.NotFound, 'Active gateway not found')
    }
    return gateway
  }

  private validateUpsert(payload: UpsertGatewayRequest, creating: boolean, current?: Gateway): ServiceResponse<never> | null {
    if (creating && !payload.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Gateway name required')
    const codexPath = payload.gatewayPath?.trim() || current?.endpoint || 'codex'
    if (!codexPath.trim()) return errorResponse(ErrorCodes.Validation, 'CLI path required')
    return null
  }

  private async ensureDeviceIdentity(gateway: Gateway): Promise<Gateway> {
    const template = {
      ...((gateway.template ?? {}) as OpenClawGatewayConfig),
      provider: 'codex_cli'
    } as OpenClawGatewayConfig
    if (template.disableDevicePairing || template.authMode === 'control_ui_token') return gateway
    if (template.deviceIdentity?.publicKeyPem && template.deviceIdentity?.privateKeyPem) return gateway
    const updated = await this.repo.update(gateway.id, {
      template: {
        ...template,
        authMode: 'device_pairing',
        disableDevicePairing: false,
        deviceIdentity: createOpenClawDeviceIdentity(),
        pairingStatus: 'not_paired',
        lastPairingError: undefined
      }
    })
    return updated ?? gateway
  }

  private maskGateway<T extends Gateway | GatewayWithSessions>(gateway: T): T {
    const template = {
      provider: 'codex_cli',
      ...((gateway.template ?? {}) as Record<string, unknown>)
    } as Record<string, unknown>
    if ('deviceIdentity' in template) delete template.deviceIdentity
    if ('deviceToken' in template) template.deviceToken = maskToken(String(template.deviceToken ?? ''))
    return {
      ...gateway,
      token: maskToken(gateway.token),
      template
    }
  }
}
