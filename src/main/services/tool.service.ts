import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, type ServiceResponse } from '../../shared/contracts/response.js'
import type { CreateToolRequest, ListToolsPageRequest, PaginatedResponse, RemoveToolRequest, UpdateToolRequest } from '../../shared/contracts/ipc.js'
import type { AiTool } from '../../shared/types/entities.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { ToolRepository } from '../../db/repositories/tool-repo.js'
import { AuthService } from './auth.service.js'

const TOOL_TYPES = new Set(['local_command', 'function', 'code', 'reference'])
const TOOL_STATUSES = new Set(['active', 'inactive'])

export class ToolService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: ToolRepository,
    private readonly agents: AgentRepository
  ) {}

  async listPage(payload: ListToolsPageRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<PaginatedResponse<AiTool>>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.listPage(actor.user.organizationId, {
      page: payload?.page ?? 1,
      pageSize: payload?.pageSize ?? 20,
      query: payload?.query,
      status: this.normalizeStatus(payload?.status),
      toolType: this.normalizeToolType(payload?.toolType)
    }))
  }

  async get(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<AiTool>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Tool id required')
    const row = await this.repo.get(payload.id)
    if (!row) return errorResponse(ErrorCodes.NotFound, 'Tool not found')
    if (row.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse(row)
  }

  async create(payload: CreateToolRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<AiTool>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const normalized = await this.normalizeWritePayload(payload, actor.user.organizationId, false)
    if (!normalized.ok) return normalized
    return okResponse(await this.repo.create(actor.user.organizationId, normalized.data))
  }

  async update(payload: UpdateToolRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<AiTool>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Tool id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Tool not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const normalized = await this.normalizeWritePayload(payload, actor.user.organizationId, true)
    if (!normalized.ok) return normalized
    const updated = await this.repo.update(actor.user.organizationId, payload.id, normalized.data)
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Tool not found')
    return okResponse(updated)
  }

  async remove(payload: RemoveToolRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Tool id required')
    const removed = await this.repo.remove(actor.user.organizationId, payload.id)
    if (!removed) return errorResponse(ErrorCodes.NotFound, 'Tool not found')
    return okResponse({ ok: true })
  }

  private async normalizeWritePayload(payload: CreateToolRequest | UpdateToolRequest, organizationId: string, partial: boolean): Promise<
    { ok: true; data: Parameters<ToolRepository['create']>[1] | Parameters<ToolRepository['update']>[2] } |
    ServiceResponse<AiTool>
  > {
    if (!partial && !payload.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Tool name required')
    if (payload.name !== undefined && !payload.name.trim()) return errorResponse(ErrorCodes.Validation, 'Tool name required')
    const inputSchemaJson = this.normalizeSchema(payload.inputSchemaJson, 'inputSchemaJson')
    if (!inputSchemaJson.ok) return inputSchemaJson
    const outputSchemaJson = this.normalizeSchema(payload.outputSchemaJson, 'outputSchemaJson')
    if (!outputSchemaJson.ok) return outputSchemaJson
    const agentIds = await this.validateAgentIds(payload.agentIds, organizationId)
    if (!agentIds.ok) return agentIds
    const timeoutSeconds = this.normalizeTimeout(payload.timeoutSeconds)
    if (!timeoutSeconds.ok) return timeoutSeconds
    return {
      ok: true,
      data: {
        ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
        ...(payload.status !== undefined ? { status: this.normalizeStatus(payload.status) } : {}),
        ...(payload.toolType !== undefined ? { toolType: this.normalizeToolType(payload.toolType) } : {}),
        ...(payload.descriptionMarkdown !== undefined ? { descriptionMarkdown: payload.descriptionMarkdown } : {}),
        ...(payload.codeLanguage !== undefined ? { codeLanguage: payload.codeLanguage } : {}),
        ...(payload.codeBody !== undefined ? { codeBody: payload.codeBody } : {}),
        ...(payload.functionName !== undefined ? { functionName: payload.functionName } : {}),
        ...(payload.commandTemplate !== undefined ? { commandTemplate: payload.commandTemplate } : {}),
        ...(payload.prepareCommand !== undefined ? { prepareCommand: payload.prepareCommand } : {}),
        ...(payload.workingDirectoryHint !== undefined ? { workingDirectoryHint: payload.workingDirectoryHint } : {}),
        ...(payload.inputSchemaJson !== undefined ? { inputSchemaJson: inputSchemaJson.value } : {}),
        ...(payload.outputSchemaJson !== undefined ? { outputSchemaJson: outputSchemaJson.value } : {}),
        ...(payload.executionFlowMarkdown !== undefined ? { executionFlowMarkdown: payload.executionFlowMarkdown } : {}),
        ...(payload.approvalRequired !== undefined ? { approvalRequired: Boolean(payload.approvalRequired) } : {}),
        ...(payload.timeoutSeconds !== undefined ? { timeoutSeconds: timeoutSeconds.value } : {}),
        ...(payload.agentIds !== undefined ? { agentIds: agentIds.value } : {})
      }
    }
  }

  private normalizeStatus(value: unknown): 'active' | 'inactive' | undefined {
    return typeof value === 'string' && TOOL_STATUSES.has(value) ? value as 'active' | 'inactive' : undefined
  }

  private normalizeToolType(value: unknown): 'local_command' | 'function' | 'code' | 'reference' | undefined {
    return typeof value === 'string' && TOOL_TYPES.has(value) ? value as 'local_command' | 'function' | 'code' | 'reference' : undefined
  }

  private normalizeSchema(value: unknown, field: string): { ok: true; value?: Record<string, unknown> } | ServiceResponse<AiTool> {
    if (value === undefined || value === null || value === '') return { ok: true, value: undefined }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return this.normalizeSchema(parsed, field)
      } catch {
        return errorResponse(ErrorCodes.Validation, `${field} must be a valid JSON object`)
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return errorResponse(ErrorCodes.Validation, `${field} must be a valid JSON object`)
    }
    return { ok: true, value: value as Record<string, unknown> }
  }

  private normalizeTimeout(value: unknown): { ok: true; value?: number | null } | ServiceResponse<AiTool> {
    if (value === undefined) return { ok: true, value: undefined }
    if (value === null || value === '') return { ok: true, value: null }
    const normalized = Number(value)
    if (!Number.isInteger(normalized) || normalized < 1 || normalized > 3600) {
      return errorResponse(ErrorCodes.Validation, 'timeoutSeconds must be an integer from 1 to 3600')
    }
    return { ok: true, value: normalized }
  }

  private async validateAgentIds(agentIds: unknown, organizationId: string): Promise<
    { ok: true; value: string[] | undefined } |
    ServiceResponse<AiTool>
  > {
    if (agentIds === undefined) return { ok: true, value: undefined }
    if (!Array.isArray(agentIds) || !agentIds.every((agentId) => typeof agentId === 'string')) {
      return errorResponse(ErrorCodes.Validation, 'agentIds must be an array of strings')
    }
    const normalized = Array.from(new Set(agentIds.filter((agentId) => agentId.trim()).map((agentId) => agentId.trim())))
    const allowed = new Set((await this.agents.list(organizationId)).map((agent) => agent.id))
    const invalid = normalized.filter((agentId) => !allowed.has(agentId))
    if (invalid.length > 0) return errorResponse(ErrorCodes.Validation, `Invalid tool agent ids: ${invalid.join(', ')}`)
    return { ok: true, value: normalized }
  }
}
