import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { CreateSkillRequest, ListSkillsPageRequest, PaginatedResponse, RemoveSkillRequest, UpdateSkillRequest } from '../../shared/contracts/ipc.js'
import { Pack, Skill } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { SkillRepository, PackRepository } from '../../db/repositories/skill-repo.js'

export class SkillService {
  constructor(
    private readonly auth: AuthService,
    private readonly skillRepo: SkillRepository,
    private readonly packRepo: PackRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Skill[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.skillRepo.list(actor.user.organizationId))
  }

  async listPage(payload: ListSkillsPageRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<PaginatedResponse<Skill>>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.skillRepo.listPage(actor.user.organizationId, {
      page: payload?.page ?? 1,
      pageSize: payload?.pageSize ?? 20,
      query: payload?.query,
      category: payload?.category,
      enabled: payload?.enabled,
      status: payload?.status
    }))
  }

  async create(payload: CreateSkillRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Skill>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.title?.trim()) return errorResponse(ErrorCodes.Validation, 'Skill title required')
    return okResponse(await this.skillRepo.create(actor.user.organizationId, {
      title: payload.title,
      descriptionMarkdown: payload.descriptionMarkdown,
      status: payload.status ?? 'active'
    }))
  }

  async update(payload: UpdateSkillRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Skill>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Skill id required')
    if (typeof payload.title === 'string' && !payload.title.trim()) return errorResponse(ErrorCodes.Validation, 'Skill title required')
    const updated = await this.skillRepo.update(actor.user.organizationId, payload.id, {
      title: payload.title,
      descriptionMarkdown: payload.descriptionMarkdown,
      status: payload.status
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Skill not found')
    return okResponse(updated)
  }

  async remove(payload: RemoveSkillRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Skill id required')
    const removed = await this.skillRepo.remove(actor.user.organizationId, payload.id)
    if (!removed) return errorResponse(ErrorCodes.NotFound, 'Skill not found')
    return okResponse({ ok: true })
  }

  async listPacks(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Pack[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.packRepo.list(actor.user.organizationId))
  }

}
