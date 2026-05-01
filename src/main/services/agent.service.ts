import { createHash } from 'node:crypto'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Agent, AgentReasoningLevel, AgentStep, Gateway, OpenClawAgentSyncResult, OpenClawGatewayConfig } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { AppSettingsRepository } from '../../db/repositories/workspace-repo.js'
import { OpenClawResourceMappingRepository } from '../../db/repositories/openclaw-resource-mapping-repo.js'
import { OpenClawGatewayClient, OpenClawGatewayRuntimeRegistry } from './gateway/rpc-client.js'
import { ACTIVE_GATEWAY_KEY } from './app-settings.service.js'

function normalizeReasoning(value: unknown): AgentReasoningLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'extra_high' ? value : 'medium'
}

function normalizeSteps(value: unknown): AgentStep[] {
  if (!Array.isArray(value)) return []
  return value.map((raw, index) => {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    return {
      id: typeof item.id === 'string' && item.id ? item.id : `${Date.now()}-${index}`,
      title: typeof item.title === 'string' ? item.title : '',
      description: typeof item.description === 'string' ? item.description : '',
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index
    }
  }).filter((item) => item.title.trim() || item.description.trim() || item.prompt?.trim())
}

function withoutOutputFormatId(config: Record<string, unknown>): Record<string, unknown> {
  const { outputFormatId: _outputFormatId, ...rest } = config
  return rest
}

type AgentWritePayload = {
  actorToken?: string
  id?: string
  name?: string
  status?: Agent['status']
  config?: Record<string, unknown>
  title?: string
  description?: string
  trainingMarkdown?: string
  steps?: AgentStep[]
  reasoningLevel?: AgentReasoningLevel
}

type AgentSyncPayload = {
  actorToken?: string
  id?: string
  gatewayId?: string
}

type AgentSyncAllPayload = {
  actorToken?: string
  gatewayId?: string
}

function markdownCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
}

function agentMarkdown(agent: Agent): string {
  const sections = [
    `# ${agent.name}`,
    [
      '## Agent Details',
      '| Field | Value |',
      '| --- | --- |',
      `| ID | ${markdownCell(agent.id)} |`,
      `| Name | ${markdownCell(agent.name)} |`,
      `| Title | ${markdownCell(agent.title || '-')} |`,
      `| Description | ${markdownCell(agent.description || '-')} |`,
      `| Status | ${markdownCell(agent.status)} |`,
      `| Reasoning level | ${markdownCell(agent.reasoningLevel ?? 'medium')} |`
    ].join('\n')
  ]
  if (agent.trainingMarkdown?.trim()) sections.push(`## Agent Prompt\n${agent.trainingMarkdown.trim()}`)
  const steps = [...(agent.steps ?? [])]
    .filter((step) => step.title?.trim() || step.description?.trim() || step.prompt?.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder)
  if (steps.length) {
    sections.push([
      '## Steps',
      ...steps.map((step, index) => [
        `### Step ${index + 1}: ${step.title || 'Untitled step'}`,
        step.description?.trim() ? step.description.trim() : '',
        step.prompt?.trim() ? `#### Prompt\n${step.prompt.trim()}` : ''
      ].filter(Boolean).join('\n\n'))
    ].join('\n\n'))
  }
  return `${sections.join('\n\n')}\n`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function duplicateAgentError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return ['already', 'exist', 'duplicate', 'conflict'].some((marker) => message.includes(marker))
}

function missingAgentError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return message.includes('not found') || message.includes('unknown agent') || message.includes('no such agent')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function workspacePath(gateway: Gateway, openClawId: string): string {
  const config = (gateway.template ?? {}) as OpenClawGatewayConfig
  const root = typeof config.workspaceRoot === 'string' ? config.workspaceRoot.trim().replace(/\/+$/, '') : ''
  const relative = `agents/${openClawId}`
  return root ? `${root}/${relative}` : relative
}

function relativeWorkspacePath(openClawId: string): string {
  return `agents/${openClawId}`
}

function remoteWorkspacePathError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return message.includes('enoent')
    || message.includes('no such file or directory')
    || message.includes('mkdir')
    || message.includes('workspace')
}

export class AgentService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: AgentRepository,
    private readonly gatewayRepo: GatewayRepository,
    private readonly settings: AppSettingsRepository,
    private readonly mappings: OpenClawResourceMappingRepository,
    private readonly runtime: OpenClawGatewayRuntimeRegistry
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Agent[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(actor.user.organizationId))
  }

  async get(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Agent>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Agent id required')
    const actor = await this.auth.requireActor(payload.actorToken)
    const row = await this.repo.get(payload.id)
    if (!row) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (row.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse(row)
  }

  async create(payload: AgentWritePayload, _meta?: Record<string, unknown>): Promise<ServiceResponse<Agent>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name) return errorResponse(ErrorCodes.Validation, 'Agent name required')
    const config = {
      ...withoutOutputFormatId(payload.config ?? {}),
      title: payload.title ?? '',
      description: payload.description ?? '',
      trainingMarkdown: payload.trainingMarkdown ?? '',
      steps: normalizeSteps(payload.steps),
      reasoningLevel: normalizeReasoning(payload.reasoningLevel)
    }
    const created = await this.repo.create({
      organizationId: actor.user.organizationId,
      name: payload.name,
      status: payload.status ?? 'idle',
      config
    })
    return okResponse(created)
  }

  async update(payload: AgentWritePayload, _meta?: Record<string, unknown>): Promise<ServiceResponse<Agent>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Agent id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const config = {
      ...withoutOutputFormatId(current.config ?? {}),
      ...withoutOutputFormatId(payload.config ?? {}),
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.trainingMarkdown !== undefined ? { trainingMarkdown: payload.trainingMarkdown } : {}),
      ...(payload.steps !== undefined ? { steps: normalizeSteps(payload.steps) } : {}),
      ...(payload.reasoningLevel !== undefined ? { reasoningLevel: normalizeReasoning(payload.reasoningLevel) } : {})
    }
    const updated = await this.repo.update(payload.id, {
      name: payload.name ?? current.name,
      status: payload.status ?? current.status,
      config
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Agent id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.remove(payload.id)
    return okResponse({ ok: true })
  }

  async syncOpenClaw(payload: AgentSyncPayload, _meta?: Record<string, unknown>): Promise<ServiceResponse<OpenClawAgentSyncResult>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Agent id required')
    const agent = await this.repo.get(payload.id)
    if (!agent) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (agent.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const gatewayResult = await this.resolveGateway(actor.user.organizationId, payload.gatewayId)
    if ('ok' in gatewayResult) return gatewayResult
    const result = await this.syncAgentToGateway(agent, gatewayResult)
    return okResponse(result)
  }

  async syncAllOpenClawUnsynced(payload: AgentSyncAllPayload, _meta?: Record<string, unknown>): Promise<ServiceResponse<OpenClawAgentSyncResult[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const gatewayResult = await this.resolveGateway(actor.user.organizationId, payload.gatewayId)
    if ('ok' in gatewayResult) return gatewayResult
    const gateway = gatewayResult
    const agents = await this.repo.list(actor.user.organizationId)
    const results: OpenClawAgentSyncResult[] = []
    for (const agent of agents) {
      const content = agentMarkdown(agent)
      const contentHash = sha256(content)
      results.push(await this.syncAgentToGateway(agent, gateway, content, contentHash))
    }
    return okResponse(results)
  }

  private async resolveGateway(orgId: string, requestedId?: string): Promise<Gateway | ServiceResponse<never>> {
    const gatewayId = requestedId ?? await this.settings.get<string | null>(orgId, ACTIVE_GATEWAY_KEY)
    if (!gatewayId) return errorResponse(ErrorCodes.Validation, 'Active gateway required')
    const gateway = await this.gatewayRepo.get(gatewayId)
    if (!gateway || gateway.organizationId !== orgId) return errorResponse(ErrorCodes.NotFound, 'Active gateway not found')
    return gateway
  }

  private async syncAgentToGateway(agent: Agent, gateway: Gateway, content = agentMarkdown(agent), contentHash = sha256(content)): Promise<OpenClawAgentSyncResult> {
    const openClawId = `omc-agent-${agent.id}`
    const mapping = await this.mappings.ensure({
      organizationId: agent.organizationId,
      gatewayId: gateway.id,
      resourceType: 'agent',
      localId: agent.id,
      openClawId
    })
    const workspace = workspacePath(gateway, openClawId)
    const fallbackWorkspace = relativeWorkspacePath(openClawId)
    const activeClient = this.runtime.get(gateway.id)
    const client = activeClient ?? new OpenClawGatewayClient(gateway)
    let shouldDisconnect = false
    try {
      if (!activeClient) {
        await client.connect()
        shouldDisconnect = true
      }
      try {
        await this.writeAgentToGateway(client, agent, openClawId, workspace, content)
      } catch (error) {
        if (workspace === fallbackWorkspace || !remoteWorkspacePathError(error)) throw error
        await this.gatewayRepo.appendHistory(gateway.id, 'openclaw.agent.sync.workspace-fallback', {
          agentId: agent.id,
          openClawId,
          workspace,
          fallbackWorkspace,
          error: error instanceof Error ? error.message : String(error)
        })
        await this.writeAgentToGateway(client, agent, openClawId, fallbackWorkspace, content)
      }
      await this.mappings.markSynced(mapping.id, contentHash)
      await this.gatewayRepo.appendHistory(gateway.id, 'openclaw.agent.sync.ok', { agentId: agent.id, openClawId, contentHash })
      return { agentId: agent.id, gatewayId: gateway.id, openClawId, status: 'synced', contentHash }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.mappings.markFailed(mapping.id, message)
      await this.gatewayRepo.appendHistory(gateway.id, 'openclaw.agent.sync.failed', { agentId: agent.id, openClawId, error: message })
      return { agentId: agent.id, gatewayId: gateway.id, openClawId, status: 'failed', contentHash, error: message }
    } finally {
      if (shouldDisconnect) client.disconnect()
    }
  }

  private async writeAgentToGateway(
    client: OpenClawGatewayClient,
    agent: Agent,
    openClawId: string,
    workspace: string,
    content: string
  ): Promise<void> {
      let created = false
      try {
        await client.rpc('agents.create', { name: openClawId, workspace }, 15000)
        created = true
      } catch (error) {
        if (!duplicateAgentError(error)) throw error
      }
      if (created) await delay(750)
      let updateDelay = 500
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await client.rpc('agents.update', { agentId: openClawId, name: agent.name, workspace }, 15000)
          break
        } catch (error) {
          const shouldRetry = created && missingAgentError(error) && attempt < 4
          if (!shouldRetry) throw error
          await delay(updateDelay)
          updateDelay = Math.min(updateDelay * 2, 4000)
        }
      }
      await client.rpc('agents.files.set', { agentId: openClawId, name: 'AGENT.md', content }, 15000)
  }
}
