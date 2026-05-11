import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Agent } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { TagRepository } from '../../db/repositories/custom-field-repo.js'
import { ToolRepository } from '../../db/repositories/tool-repo.js'

function withoutOutputFormatId(config: Record<string, unknown>): Record<string, unknown> {
  const { outputFormatId: _outputFormatId, ...rest } = config
  return rest
}

function withoutLegacyAgentConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
  const { outputFormatId: _outputFormatId, reasoningLevel: _reasoningLevel, status: _status, steps: _steps, ...rest } = config
  return rest
}

type AgentWritePayload = {
  actorToken?: string
  id?: string
  name?: string
  config?: Record<string, unknown>
  title?: string
  description?: string
  trainingMarkdown?: string
  tagIds?: string[]
  toolIds?: string[]
}

export class AgentService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: AgentRepository,
    private readonly tags: TagRepository,
    private readonly tools?: ToolRepository
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
    const tagIds = await this.validateTagIds(payload.tagIds, actor.user.organizationId)
    if (!tagIds.ok) return tagIds.response
    const toolIds = await this.validateToolIds(payload.toolIds, actor.user.organizationId)
    if (!toolIds.ok) return toolIds.response
    const config = {
      ...withoutLegacyAgentConfigKeys(withoutOutputFormatId(payload.config ?? {})),
      title: payload.title ?? '',
      description: payload.description ?? '',
      trainingMarkdown: payload.trainingMarkdown ?? ''
    }
    const created = await this.repo.create({
      organizationId: actor.user.organizationId,
      name: payload.name,
      config,
      tagIds: tagIds.value,
      toolIds: toolIds.value
    })
    return okResponse(created)
  }

  async update(payload: AgentWritePayload, _meta?: Record<string, unknown>): Promise<ServiceResponse<Agent>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Agent id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const tagIds = await this.validateTagIds(payload.tagIds, actor.user.organizationId)
    if (!tagIds.ok) return tagIds.response
    const toolIds = await this.validateToolIds(payload.toolIds, actor.user.organizationId)
    if (!toolIds.ok) return toolIds.response
    const config = {
      ...withoutLegacyAgentConfigKeys(withoutOutputFormatId(current.config ?? {})),
      ...withoutLegacyAgentConfigKeys(withoutOutputFormatId(payload.config ?? {})),
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.trainingMarkdown !== undefined ? { trainingMarkdown: payload.trainingMarkdown } : {})
    }
    const updated = await this.repo.update(payload.id, {
      name: payload.name ?? current.name,
      status: current.status,
      config,
      ...(payload.tagIds !== undefined ? { tagIds: tagIds.value } : {}),
      ...(payload.toolIds !== undefined ? { toolIds: toolIds.value } : {})
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

  private async validateTagIds(tagIds: unknown, organizationId: string): Promise<
    { ok: true; value: string[] | undefined } |
    { ok: false; response: ServiceResponse<Agent> }
  > {
    if (tagIds === undefined) return { ok: true, value: undefined }
    if (!Array.isArray(tagIds) || !tagIds.every((tagId) => typeof tagId === 'string')) {
      return { ok: false, response: errorResponse(ErrorCodes.Validation, 'tagIds must be an array of strings') }
    }
    const normalized = Array.from(new Set(tagIds.filter((tagId) => tagId.trim()).map((tagId) => tagId.trim())))
    const allowed = new Set((await this.tags.list(organizationId)).map((tag) => tag.id))
    const invalid = normalized.filter((tagId) => !allowed.has(tagId))
    if (invalid.length > 0) {
      return { ok: false, response: errorResponse(ErrorCodes.Validation, `Invalid agent tag ids: ${invalid.join(', ')}`) }
    }
    return { ok: true, value: normalized }
  }

  private async validateToolIds(toolIds: unknown, organizationId: string): Promise<
    { ok: true; value: string[] | undefined } |
    { ok: false; response: ServiceResponse<Agent> }
  > {
    if (toolIds === undefined) return { ok: true, value: undefined }
    if (!Array.isArray(toolIds) || !toolIds.every((toolId) => typeof toolId === 'string')) {
      return { ok: false, response: errorResponse(ErrorCodes.Validation, 'toolIds must be an array of strings') }
    }
    const normalized = Array.from(new Set(toolIds.filter((toolId) => toolId.trim()).map((toolId) => toolId.trim())))
    if (!this.tools) return { ok: true, value: normalized }
    const allowed = new Set((await this.tools.list(organizationId)).map((tool) => tool.id))
    const invalid = normalized.filter((toolId) => !allowed.has(toolId))
    if (invalid.length > 0) {
      return { ok: false, response: errorResponse(ErrorCodes.Validation, `Invalid agent tool ids: ${invalid.join(', ')}`) }
    }
    return { ok: true, value: normalized }
  }
}
