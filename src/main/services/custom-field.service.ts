import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { CustomField, Tag } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { CustomFieldRepository, TagRepository } from '../../db/repositories/custom-field-repo.js'

export class CustomFieldService {
  constructor(
    private readonly auth: AuthService,
    private readonly fieldRepo: CustomFieldRepository,
    private readonly tagRepo: TagRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<CustomField[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.fieldRepo.list(actor.user.organizationId))
  }

  async create(payload: { actorToken?: string; name?: string; type?: CustomField['type']; config?: Record<string, unknown>; description?: string; defaultValue?: unknown }, _meta?: Record<string, unknown>): Promise<ServiceResponse<CustomField>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name || !payload?.type) return errorResponse(ErrorCodes.Validation, 'Name and type required')
    const config = {
      description: payload.description ?? '',
      ...(Object.prototype.hasOwnProperty.call(payload, 'defaultValue') ? { defaultValue: payload.defaultValue } : {})
    }
    return okResponse(
      await this.fieldRepo.create({
        organizationId: actor.user.organizationId,
        name: payload.name,
        type: payload.type,
        config,
        description: payload.description,
        defaultValue: payload.defaultValue
      })
    )
  }

  async update(payload: {
    actorToken?: string
    id?: string
    name?: string
    type?: CustomField['type']
    description?: string
    defaultValue?: unknown
  }, _meta?: Record<string, unknown>): Promise<ServiceResponse<CustomField>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id || !payload?.name || !payload?.type) return errorResponse(ErrorCodes.Validation, 'Field id, name and type required')
    const updated = await this.fieldRepo.update({
      id: payload.id,
      organizationId: actor.user.organizationId,
      name: payload.name,
      type: payload.type,
      description: payload.description,
      ...(Object.prototype.hasOwnProperty.call(payload, 'defaultValue') ? { defaultValue: payload.defaultValue } : {})
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Custom field not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ removed: boolean }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Field id required')
    const removed = await this.fieldRepo.remove({
      id: payload.id,
      organizationId: actor.user.organizationId
    })
    if (!removed) return errorResponse(ErrorCodes.NotFound, 'Custom field not found')
    return okResponse({ removed: true })
  }

  async tagsList(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Tag[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.tagRepo.list(actor.user.organizationId))
  }

  async tagsCreate(payload: { actorToken?: string; name?: string; color?: string; description?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Tag>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name) return errorResponse(ErrorCodes.Validation, 'Tag name required')
    return okResponse(
      await this.tagRepo.create({
        organizationId: actor.user.organizationId,
        name: payload.name,
        color: payload.color,
        description: payload.description
      })
    )
  }

  async tagsUpdate(payload: {
    actorToken?: string
    id?: string
    name?: string
    color?: string
    description?: string
  }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Tag>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id || !payload?.name) return errorResponse(ErrorCodes.Validation, 'Tag id and name required')
    const updated = await this.tagRepo.update({
      id: payload.id,
      organizationId: actor.user.organizationId,
      name: payload.name,
      color: payload.color,
      description: payload.description
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Tag not found')
    return okResponse(updated)
  }

  async tagsRemove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ removed: boolean }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Tag id required')
    const removed = await this.tagRepo.remove({
      id: payload.id,
      organizationId: actor.user.organizationId
    })
    if (!removed) return errorResponse(ErrorCodes.NotFound, 'Tag not found')
    return okResponse({ removed: true })
  }
}
