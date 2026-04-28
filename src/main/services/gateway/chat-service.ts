import { OPENCLAW_TEST_MESSAGE } from './method-catalog.js'
import { OpenClawResponseParser } from './response-parser.js'
import { OpenClawSessionService } from './session-service.js'
import type { OpenClawRpcClient } from './rpc-client.js'

export class OpenClawChatService {
  constructor(private readonly client: OpenClawRpcClient) {}

  send(sessionKey: string, message: string, params: Record<string, unknown> = {}) {
    return this.client.rpc('chat.send', { sessionKey, message, deliver: true, idempotencyKey: OpenClawSessionService.idempotencyKey(), ...params })
  }

  history(sessionKey: string, limit = 50) {
    return this.client.rpc('chat.history', { sessionKey, limit })
  }

  abort(sessionKey: string) {
    return this.client.rpc('chat.abort', { sessionKey })
  }

  async sendTestMessage(gatewayId: string, timeoutMs = 10000) {
    const sessionKey = OpenClawSessionService.testSessionKey(gatewayId)
    const sessions = new OpenClawSessionService(this.client)
    const beforeHistory = await this.history(sessionKey).catch(() => ({ messages: [] }))
    await sessions.patch(sessionKey, 'OpenMissionControl Gateway Test')
    const sent = await this.send(sessionKey, OPENCLAW_TEST_MESSAGE)
    const response = await this.client.waitForAiResponse(sessionKey, beforeHistory, timeoutMs)
    const normalized = OpenClawResponseParser.normalize(response)
    return { prompt: OPENCLAW_TEST_MESSAGE, sessionKey, sent, aiResponse: normalized, aiResponseText: normalized.text, raw: response }
  }
}
