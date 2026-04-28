import { AppError } from '../../shared/errors/index.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Project } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'

export class ProjectService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: ProjectRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Project[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const rows = await this.repo.list(actor.user.organizationId)
    return okResponse(rows)
  }

  async get(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Project>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const actor = await this.auth.requireActor(payload.actorToken)
    const row = await this.repo.get(payload.id)
    if (!row) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (row.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse(row)
  }

  async create(
    payload: { actorToken?: string; name?: string; description?: string },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<Project>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Project name required')
    const created = await this.repo.create({
      organizationId: actor.user.organizationId,
      name: payload.name.trim(),
      description: payload.description,
      archived: false
    })
    return okResponse(created)
  }

  async update(payload: { actorToken?: string; id?: string; name?: string; description?: string; archived?: boolean }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Project>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const updated = await this.repo.update(payload.id, payload)
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.remove(payload.id)
    return okResponse({ ok: true })
  }
}
