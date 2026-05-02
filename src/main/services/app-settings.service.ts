import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { Gateway } from '../../shared/types/entities.js'
import { AppSettingsRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { AuthService } from './auth.service.js'

const ACTIVE_GATEWAY_KEY = 'activeGatewayId'

export class AppSettingsService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: AppSettingsRepository,
    private readonly gateways: GatewayRepository
  ) {}

  async getActiveGateway(payload: { actorToken?: string }): Promise<ServiceResponse<{ gatewayId: string | null; gateway?: Gateway | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const gatewayId = await this.repo.get<string | null>(actor.user.organizationId, ACTIVE_GATEWAY_KEY)
    if (!gatewayId) return okResponse({ gatewayId: null, gateway: null })
    const gateway = await this.gateways.get(gatewayId)
    if (!gateway || gateway.organizationId !== actor.user.organizationId) {
      await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, null)
      return okResponse({ gatewayId: null, gateway: null })
    }
    return okResponse({ gatewayId, gateway })
  }

  async setActiveGateway(payload: { actorToken?: string; gatewayId?: string | null }): Promise<ServiceResponse<{ gatewayId: string | null; gateway?: Gateway | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const gatewayId = payload.gatewayId || null
    if (!gatewayId) {
      await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, null)
      return okResponse({ gatewayId: null, gateway: null })
    }
    const gateway = await this.gateways.get(gatewayId)
    if (!gateway) return errorResponse(ErrorCodes.NotFound, 'Gateway not found')
    if (gateway.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, gateway.id)
    return okResponse({ gatewayId: gateway.id, gateway })
  }
}

export { ACTIVE_GATEWAY_KEY }
