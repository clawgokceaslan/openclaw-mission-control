import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Webhook } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { WebhookRepository } from '../../db/repositories/webhook-repo.js'

export class WebhookService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: WebhookRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Webhook[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(actor.user.organizationId))
  }

  async create(payload: { actorToken?: string; url?: string; eventTypes?: string[]; active?: boolean; secret?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Webhook>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.url) return errorResponse(ErrorCodes.Validation, 'Webhook url required')
    const created = await this.repo.create({
      organizationId: actor.user.organizationId,
      url: payload.url,
      active: payload.active ?? true,
      secret: payload.secret,
      eventTypes: payload.eventTypes ?? [],
      failureCount: 0
    })
    return okResponse(created)
  }

  async update(payload: { actorToken?: string; id?: string; url?: string; active?: boolean; secret?: string; eventTypes?: string[] }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Webhook>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Webhook id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Webhook not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const updated = await this.repo.update(payload.id, payload)
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Webhook not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Webhook id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Webhook not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.remove(payload.id)
    return okResponse({ ok: true })
  }
}
