import type { GatewayRepository } from '../../../db/repositories/gateway-repo.js'

export class OpenClawHistoryMapper {
  constructor(private readonly repo: GatewayRepository) {}

  event(gatewayId: string, eventType: string, payload?: Record<string, unknown>) {
    return this.repo.appendHistory(gatewayId, eventType, payload)
  }

  commandSent(gatewayId: string, payload: Record<string, unknown>) {
    return this.repo.appendHistory(gatewayId, 'openclaw.rpc.sent', payload)
  }

  commandCompleted(gatewayId: string, payload: Record<string, unknown>) {
    return this.repo.appendHistory(gatewayId, 'openclaw.rpc.completed', payload)
  }

  commandFailed(gatewayId: string, payload: Record<string, unknown>) {
    return this.repo.appendHistory(gatewayId, 'openclaw.rpc.failed', payload)
  }
}
