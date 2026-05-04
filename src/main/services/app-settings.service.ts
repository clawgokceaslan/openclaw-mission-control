import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { Agent, Gateway } from '../../shared/types/entities.js'
import { AppSettingsRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { AuthService } from './auth.service.js'

const ACTIVE_GATEWAY_KEY = 'activeGatewayId'
const DEFAULT_AGENT_KEY = 'defaultAgentId'

export class AppSettingsService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: AppSettingsRepository,
    private readonly gateways: GatewayRepository,
    private readonly agents: AgentRepository
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

  async getDefaultAgent(payload: { actorToken?: string }): Promise<ServiceResponse<{ agentId: string | null; agent?: Agent | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const agentId = await this.repo.get<string | null>(actor.user.organizationId, DEFAULT_AGENT_KEY)
    if (!agentId) return okResponse({ agentId: null, agent: null })
    const agent = await this.agents.get(agentId)
    if (!agent || agent.organizationId !== actor.user.organizationId) {
      await this.repo.set(actor.user.organizationId, DEFAULT_AGENT_KEY, null)
      return okResponse({ agentId: null, agent: null })
    }
    return okResponse({ agentId, agent })
  }

  async setDefaultAgent(payload: { actorToken?: string; agentId?: string | null }): Promise<ServiceResponse<{ agentId: string | null; agent?: Agent | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const agentId = payload.agentId || null
    if (!agentId) {
      await this.repo.set(actor.user.organizationId, DEFAULT_AGENT_KEY, null)
      return okResponse({ agentId: null, agent: null })
    }
    const agent = await this.agents.get(agentId)
    if (!agent) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (agent.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.set(actor.user.organizationId, DEFAULT_AGENT_KEY, agent.id)
    return okResponse({ agentId: agent.id, agent })
  }
}

export { ACTIVE_GATEWAY_KEY, DEFAULT_AGENT_KEY }
