import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Agent, AgentReasoningLevel, AgentStep } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'

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
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index
    }
  }).filter((item) => item.title.trim() || item.description.trim())
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
  trainingMarkdown?: string
  steps?: AgentStep[]
  reasoningLevel?: AgentReasoningLevel
}

export class AgentService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: AgentRepository
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
}
