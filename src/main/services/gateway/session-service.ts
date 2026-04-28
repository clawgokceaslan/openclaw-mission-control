import { randomUUID } from 'node:crypto'
import type { OpenClawRpcClient } from './rpc-client.js'

export class OpenClawSessionService {
  constructor(private readonly client: OpenClawRpcClient) {}

  list(params: Record<string, unknown> = {}) {
    return this.client.rpc('sessions.list', params)
  }

  preview(sessionKey: string, params: Record<string, unknown> = {}) {
    return this.client.rpc('sessions.preview', { sessionKey, ...params })
  }

  patch(sessionKey: string, label?: string, params: Record<string, unknown> = {}) {
    return this.client.rpc('sessions.patch', { key: sessionKey, label: label ?? sessionKey, ...params })
  }

  reset(sessionKey: string) {
    return this.client.rpc('sessions.reset', { sessionKey })
  }

  delete(sessionKey: string) {
    return this.client.rpc('sessions.delete', { sessionKey })
  }

  compact(sessionKey: string) {
    return this.client.rpc('sessions.compact', { sessionKey })
  }

  static testSessionKey(gatewayId: string): string {
    return `openmissioncontrol:${gatewayId}:test`
  }

  static idempotencyKey(): string {
    return randomUUID()
  }
}
