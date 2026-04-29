import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { TaskTemplate, TaskTemplatePayload } from '../../shared/types/entities.js'
import { TaskTemplateRepository } from '../../db/repositories/task-template-repo.js'
import { AuthService } from './auth.service.js'

function normalizeTemplate(value: unknown): TaskTemplatePayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as TaskTemplatePayload : {}
}

export class TaskTemplateService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: TaskTemplateRepository
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

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task template id required')
    await this.repo.remove(actor.user.organizationId, payload.id)
    return okResponse({ ok: true })
  }
}
