import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { TaskJsonImportResult, TaskTemplate, TaskTemplatePayload } from '../../shared/types/entities.js'
import type { ImportTaskTemplateJsonRequest } from '../../shared/contracts/ipc.js'
import { TaskTemplateRepository } from '../../db/repositories/task-template-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { CustomFieldRepository, TagRepository } from '../../db/repositories/custom-field-repo.js'
import { SkillRepository } from '../../db/repositories/skill-repo.js'
import { AuthService } from './auth.service.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'

function normalizeTemplate(value: unknown): TaskTemplatePayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as TaskTemplatePayload : {}
}

export class TaskTemplateService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: TaskTemplateRepository,
    private readonly agents: AgentRepository,
    private readonly tags: TagRepository,
    private readonly skills: SkillRepository,
    private readonly customFields: CustomFieldRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskTemplate[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(actor.user.organizationId))
  }

  async create(payload: { actorToken?: string; name?: string; description?: string; template?: TaskTemplatePayload }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskTemplate>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Task template name required')
    return okResponse(await this.repo.create(actor.user.organizationId, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      template: normalizeTemplate(payload.template)
    }))
  }

  async update(payload: { actorToken?: string; id?: string; name?: string; description?: string; template?: TaskTemplatePayload }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskTemplate>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task template id required')
    if (!payload.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Task template name required')
    const updated = await this.repo.update(actor.user.organizationId, payload.id, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      template: normalizeTemplate(payload.template)
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task template not found')
    return okResponse(updated)
  }

  async importJson(payload: ImportTaskTemplateJsonRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskJsonImportResult>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    let normalized
    try {
      const normalizer = new TaskJsonImportNormalizer(actor.user.organizationId, this.agents, this.tags, this.skills, this.customFields)
      normalized = await normalizer.normalize(payload.json)
      const templatePayload = normalizer.toTemplatePayload(normalized)
      if (payload.id) {
        const current = await this.repo.get(actor.user.organizationId, payload.id)
        if (!current) return errorResponse(ErrorCodes.NotFound, 'Task template not found')
        templatePayload.agentId = current.template.agentId ?? null
        templatePayload.skillIds = Array.isArray(current.template.skillIds) ? current.template.skillIds : []
        const updated = await this.repo.update(actor.user.organizationId, payload.id, {
          name: normalized.title,
          description: normalized.description || undefined,
          template: templatePayload
        })
        if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task template not found')
        return okResponse({ template: updated, warnings: normalized.warnings })
      }
      const created = await this.repo.create(actor.user.organizationId, {
        name: normalized.title,
        description: normalized.description || undefined,
        template: templatePayload
      })
      return okResponse({ template: created, warnings: normalized.warnings })
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Invalid import JSON')
    }
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task template id required')
    await this.repo.remove(actor.user.organizationId, payload.id)
    return okResponse({ ok: true })
  }
}
