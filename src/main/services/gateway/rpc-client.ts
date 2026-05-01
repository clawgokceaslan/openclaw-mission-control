import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import EventEmitter from 'node:events'
import type { Gateway, OpenClawGatewayConfig, OpenClawGatewayDeviceIdentity, OpenClawGatewayTestResult } from '../../../shared/types/entities.js'
import { OpenClawResponseParser } from './response-parser.js'

type ClientEvent =
  | { type: 'connected'; payload?: Record<string, unknown> }
  | { type: 'disconnected'; payload?: Record<string, unknown> }
  | { type: 'reconnecting'; payload?: Record<string, unknown> }
  | { type: 'event'; eventType: string; payload?: Record<string, unknown> }
  | { type: 'error'; payload?: Record<string, unknown> }

const BACKOFFS = [1000, 2000, 5000, 10000, 30000]
const PROTOCOL_VERSION = 3
const REQUEST_TIMEOUT_MS = 30000
const CONNECT_CHALLENGE_TIMEOUT_MS = 15000
const WS_OPEN = 1
const CONTROL_UI_CLIENT_ID = 'openclaw-control-ui'
const CONTROL_UI_CLIENT_MODE = 'ui'
const DEVICE_CLIENT_ID = 'gateway-client'
const DEVICE_CLIENT_MODE = 'backend'
const OPERATOR_SCOPES = ['operator.read', 'operator.admin', 'operator.approvals', 'operator.pairing']
const HELLO_MESSAGE = 'How are you?'

interface RuntimeWebSocket {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

interface PendingRpc {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

class OpenClawRpcError extends Error {
  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'OpenClawRpcError'
  }
}

function asConfig(gateway: Gateway): OpenClawGatewayConfig {
  const rawIdentity = gateway.template?.deviceIdentity
  const deviceIdentity = rawIdentity && typeof rawIdentity === 'object'
    ? rawIdentity as OpenClawGatewayDeviceIdentity
    : undefined
  return {
    provider: 'openclaw',
    apiBaseUrl: String(gateway.template?.apiBaseUrl ?? ''),
    authMode: String(gateway.template?.authMode ?? 'device_pairing') as OpenClawGatewayConfig['authMode'],
    workspaceRoot: typeof gateway.template?.workspaceRoot === 'string' ? gateway.template.workspaceRoot : undefined,
    allowSelfSignedTls: Boolean(gateway.template?.allowSelfSignedTls),
    disableDevicePairing: gateway.template?.disableDevicePairing === undefined ? false : Boolean(gateway.template.disableDevicePairing),
    autoConnect: Boolean(gateway.template?.autoConnect),
    lastHandshakeAt: typeof gateway.template?.lastHandshakeAt === 'number' ? gateway.template.lastHandshakeAt : undefined,
    protocolVersion: typeof gateway.template?.protocolVersion === 'string' ? gateway.template.protocolVersion : undefined,
    capabilities: Array.isArray(gateway.template?.capabilities) ? gateway.template.capabilities.map(String) : undefined,
    deviceIdentity,
    deviceToken: typeof gateway.template?.deviceToken === 'string' ? gateway.template.deviceToken : undefined,
    deviceScopes: Array.isArray(gateway.template?.deviceScopes) ? gateway.template.deviceScopes.map(String) : undefined,
    pairingStatus: typeof gateway.template?.pairingStatus === 'string' ? gateway.template.pairingStatus as OpenClawGatewayConfig['pairingStatus'] : undefined,
    lastPairingError: typeof gateway.template?.lastPairingError === 'string' ? gateway.template.lastPairingError : undefined
  }
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed }
  } catch {
    return null
  }
}

function normalizeEventType(payload: Record<string, unknown>): string {
  if (payload.type === 'event' && typeof payload.event === 'string') return `openclaw.${payload.event}`
  const rawType = String(payload.type ?? payload.event ?? payload.kind ?? '')
  return rawType ? `openclaw.${rawType}` : 'openclaw.event.unknown'
}

function controlUiOrigin(rawUrl: string): string | undefined {
  const parsed = new URL(rawUrl)
  const scheme = parsed.protocol === 'wss:' || parsed.protocol === 'https:' ? 'https:' : 'http:'
  return `${scheme}//${parsed.host}`
}

function createWebSocket(url: string, allowSelfSignedTls: boolean): RuntimeWebSocket {
  if (allowSelfSignedTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const WebSocketCtor = (globalThis as unknown as { WebSocket: unknown }).WebSocket as new (
    url: string,
    protocols?: string | string[]
  ) => RuntimeWebSocket
  return new WebSocketCtor(url)
}

function base64Url(raw: Buffer): string {
  return raw.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function publicKeyRaw(publicKeyPem: string): Buffer {
  const der = createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' }) as Buffer
  return der.subarray(der.length - 32)
}

function deriveDeviceId(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyRaw(publicKeyPem)).digest('hex')
}

export function createOpenClawDeviceIdentity(): OpenClawGatewayDeviceIdentity {
  const pair = generateKeyPairSync('ed25519')
  const publicKeyPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const privateKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  return {
    deviceId: deriveDeviceId(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    createdAt: Date.now()
  }
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  return base64Url(sign(null, Buffer.from(payload, 'utf8'), privateKeyPem))
}

function buildDeviceAuthPayload(input: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAt: number
  token: string
  nonce?: string
}): string {
  const version = input.nonce ? 'v2' : 'v1'
  const parts = [
    version,
    input.deviceId,
    input.clientId,
    input.clientMode,
    input.role,
    input.scopes.join(','),
    String(input.signedAt),
    input.token
  ]
  if (input.nonce) parts.push(input.nonce)
  return parts.join('|')
}

function buildDeviceConnectPayload(identity: OpenClawGatewayDeviceIdentity, token: string, scopes: string[], nonce?: string): Record<string, unknown> {
  const signedAt = Date.now()
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId: DEVICE_CLIENT_ID,
    clientMode: DEVICE_CLIENT_MODE,
    role: 'operator',
    scopes,
    signedAt,
    token,
    nonce
  })
  const device: Record<string, unknown> = {
    id: identity.deviceId,
    publicKey: base64Url(publicKeyRaw(identity.publicKeyPem)),
    signature: signDevicePayload(identity.privateKeyPem, payload),
    signedAt
  }
  if (nonce) device.nonce = nonce
  return device
}

function connectParams(gateway: Gateway, firstMessage?: Record<string, unknown> | null): Record<string, unknown> {
  const config = asConfig(gateway)
  const sharedToken = (gateway.token ?? '').trim()
  const deviceToken = config.deviceToken?.trim() ?? ''
  const token = sharedToken || deviceToken
  const useControlUi = Boolean(config.disableDevicePairing)
  const noncePayload = firstMessage?.type === 'event' && firstMessage.event === 'connect.challenge' && firstMessage.payload && typeof firstMessage.payload === 'object'
    ? firstMessage.payload as Record<string, unknown>
    : null
  const nonce = typeof noncePayload?.nonce === 'string' && noncePayload.nonce.trim() ? noncePayload.nonce.trim() : undefined
  const params: Record<string, unknown> = {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    role: 'operator',
    scopes: sharedToken ? OPERATOR_SCOPES : config.deviceScopes?.length ? config.deviceScopes : OPERATOR_SCOPES,
    client: {
      id: useControlUi ? CONTROL_UI_CLIENT_ID : DEVICE_CLIENT_ID,
      version: '1.0.0',
      platform: process.platform,
      mode: useControlUi ? CONTROL_UI_CLIENT_MODE : DEVICE_CLIENT_MODE
    }
  }
  if (token) params.auth = { token }
  if (!useControlUi) {
    if (!config.deviceIdentity?.publicKeyPem || !config.deviceIdentity?.privateKeyPem) {
      throw new Error('Gateway device identity is missing. Pair device before connecting.')
    }
    params.device = buildDeviceConnectPayload(config.deviceIdentity, token, params.scopes as string[], nonce)
  }
  return params
}

function gatewayErrorFromPayload(payload: unknown): OpenClawRpcError | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.ok === false && record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>
    const message = error.message
    const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : undefined
    return new OpenClawRpcError(typeof message === 'string' ? message : 'OpenClaw gateway error', details)
  }
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>
    const message = error.message
    const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : undefined
    return new OpenClawRpcError(typeof message === 'string' ? message : 'OpenClaw gateway error', details)
  }
  return null
}

function startupRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof OpenClawRpcError)) return null
  if (error.details?.reason !== 'startup-sidecars') return null
  const retryAfterMs = Number(error.details.retryAfterMs ?? 1000)
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) return 1000
  return Math.min(retryAfterMs, 5000)
}

export class OpenClawGatewayClient extends EventEmitter {
  private ws: RuntimeWebSocket | null = null
  private manualClose = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private backoffIndex = 0
  private pending = new Map<string, PendingRpc>()
  private firstMessageResolver: ((payload: Record<string, unknown> | null) => void) | null = null
  private lastConnectPayload: unknown = null

  constructor(private readonly gateway: Gateway) {
    super()
  }

  get gatewayId(): string {
    return this.gateway.id
  }

  get config(): OpenClawGatewayConfig {
    return asConfig(this.gateway)
  }

  async connect(): Promise<void> {
    this.manualClose = false
    await this.openSocket()
  }

  disconnect(): void {
    this.manualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'manual disconnect')
      this.ws = null
    }
    this.rejectPending(new Error('Gateway websocket disconnected'))
    this.emitClient({ type: 'disconnected', payload: { manual: true } })
  }

  async rpc<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) throw new Error('Gateway websocket is not connected')
    const id = randomUUID()
    const message = { type: 'req', id, method, params: params ?? {} }
    this.emitClient({ type: 'event', eventType: 'openclaw.rpc.sent', payload: { id, method, params: params ?? {} } })
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`OpenClaw RPC ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (payload) => resolve(payload as T),
        reject,
        timer
      })
      try {
        this.ws?.send(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async testConnection(gatewayId?: string, timeoutMs = 10000): Promise<OpenClawGatewayTestResult> {
    const startedAt = Date.now()
    const details: Record<string, unknown> = { prompt: HELLO_MESSAGE }
    const sessionKey = `openmissioncontrol:${gatewayId ?? this.gateway.id}:test`
    try {
      await this.connect()
      details.connect = this.lastConnectPayload
      details.status = await this.rpc('status', {}, timeoutMs)
      details.session = await this.rpc('sessions.patch', { key: sessionKey, label: 'OpenMissionControl Gateway Test' }, timeoutMs)
      const beforeHistory = await this.fetchChatHistory(sessionKey).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
        messages: []
      }))
      details.historyBefore = beforeHistory
      details.chat = await this.rpc(
        'chat.send',
        {
          sessionKey,
          message: HELLO_MESSAGE,
          deliver: true,
          idempotencyKey: randomUUID()
        },
        timeoutMs
      )
      details.aiResponse = await this.waitForAiResponse(sessionKey, beforeHistory, timeoutMs)
      details.aiResponseText = typeof (details.aiResponse as Record<string, unknown>).text === 'string'
        ? (details.aiResponse as Record<string, unknown>).text
        : ''
      this.disconnect()
      return {
        ok: true,
        wsOk: true,
        restOk: true,
        message: 'OpenClaw gateway returned an AI chat response.',
        details: { ...details, durationMs: Date.now() - startedAt }
      }
    } catch (error) {
      this.disconnect()
      return {
        ok: false,
        wsOk: false,
        restOk: true,
        message: error instanceof Error ? error.message : 'OpenClaw gateway websocket RPC failed.',
        details: { ...details, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt }
      }
    }
  }

  async handshakeStatus(timeoutMs = 10000): Promise<OpenClawGatewayTestResult> {
    const startedAt = Date.now()
    const details: Record<string, unknown> = {}
    try {
      await this.connect()
      details.connect = this.lastConnectPayload
      details.status = await this.rpc('status', {}, timeoutMs)
      this.disconnect()
      return {
        ok: true,
        wsOk: true,
        restOk: true,
        message: 'OpenClaw gateway websocket RPC handshake succeeded.',
        details: { ...details, durationMs: Date.now() - startedAt }
      }
    } catch (error) {
      this.disconnect()
      return {
        ok: false,
        wsOk: false,
        restOk: true,
        message: error instanceof Error ? error.message : 'OpenClaw gateway websocket RPC handshake failed.',
        details: { error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt }
      }
    }
  }

  private async openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const config = this.config
      const ws = createWebSocket(this.gateway.endpoint, Boolean(config.allowSelfSignedTls))
      this.ws = ws

      ws.onopen = () => {
        void this.finishOpenHandshake()
          .then((payload) => {
            settled = true
            this.backoffIndex = 0
            this.emitClient({ type: 'connected', payload: { endpoint: this.gateway.endpoint, origin: controlUiOrigin(this.gateway.endpoint), connect: payload } })
            resolve()
          })
          .catch((error) => {
            settled = true
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      }

      ws.onmessage = (event) => this.handleMessage(event.data)

      ws.onerror = () => {
        const error = new Error('OpenClaw websocket connection failed')
        this.emitClient({ type: 'error', payload: { endpoint: this.gateway.endpoint, message: error.message } })
        if (!settled) {
          settled = true
          reject(error)
        }
      }

      ws.onclose = () => {
        this.ws = null
        this.rejectPending(new Error('Gateway websocket closed'))
        this.emitClient({ type: 'disconnected', payload: { manual: this.manualClose } })
        if (!this.manualClose) this.scheduleReconnect()
      }
    })
  }

  private async finishOpenHandshake(): Promise<unknown> {
    const firstMessage = await this.waitFirstMessage(CONNECT_CHALLENGE_TIMEOUT_MS)
    if (firstMessage) {
      this.emitClient({ type: 'event', eventType: 'openclaw.connect.challenge', payload: firstMessage })
    }
    const startedAt = Date.now()
    while (true) {
      try {
        const payload = await this.rpc('connect', connectParams(this.gateway, firstMessage), REQUEST_TIMEOUT_MS)
        this.lastConnectPayload = payload
        this.emitClient({ type: 'event', eventType: 'openclaw.connect.ok', payload: payload && typeof payload === 'object' ? payload as Record<string, unknown> : { payload } })
        return payload
      } catch (error) {
        const retryAfterMs = startupRetryAfterMs(error)
        if (retryAfterMs === null || Date.now() - startedAt + retryAfterMs > REQUEST_TIMEOUT_MS) throw error
        this.emitClient({ type: 'event', eventType: 'openclaw.connect.retry', payload: { reason: 'startup-sidecars', retryAfterMs } })
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
      }
    }
  }

  private async fetchChatHistory(sessionKey: string): Promise<Record<string, unknown>> {
    const history = await this.rpc('chat.history', { sessionKey, limit: 50 }, 10000)
    return history && typeof history === 'object' ? history as Record<string, unknown> : { value: history }
  }

  async waitForAiResponse(
    sessionKey: string,
    beforeHistory: unknown,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    const beforeMessages = this.extractMessages(beforeHistory)
    const beforeCount = beforeMessages.length
    const startedAt = Date.now()
    let lastHistory: Record<string, unknown> | null = null

    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const history = await this.fetchChatHistory(sessionKey)
      lastHistory = history
      const messages = this.extractMessages(history)
      const newMessages = messages.slice(beforeCount)
      const aiMessage = [...newMessages].reverse().find((message) => this.isAiMessage(message))
      if (aiMessage) {
        const response = {
          message: aiMessage,
          messages: newMessages,
          history
        }
        return OpenClawResponseParser.normalize(response) as unknown as Record<string, unknown>
      }
    }

    throw new Error(`OpenClaw did not return an AI chat response within ${timeoutMs}ms${lastHistory ? `; latest history: ${JSON.stringify(lastHistory).slice(0, 500)}` : ''}`)
  }

  private extractMessages(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== 'object') return []
    const record = value as Record<string, unknown>
    const direct = record.messages
    if (Array.isArray(direct)) return direct.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    const history = record.history
    if (Array.isArray(history)) return history.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    const items = record.items
    if (Array.isArray(items)) return items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    return []
  }

  private isAiMessage(message: Record<string, unknown>): boolean {
    const role = String(message.role ?? message.authorRole ?? message.type ?? '').toLowerCase()
    const source = String(message.source ?? message.author ?? message.authorName ?? '').toLowerCase()
    if (role.includes('assistant') || role.includes('agent') || role.includes('ai')) return true
    if (source.includes('assistant') || source.includes('agent') || source.includes('openclaw')) return true
    const content = message.content ?? message.message ?? message.text ?? message.body
    return typeof content === 'string' && content.trim().length > 0 && !role.includes('user')
  }

  private waitFirstMessage(timeoutMs: number): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.firstMessageResolver) {
          this.firstMessageResolver = null
          resolve(null)
        }
      }, timeoutMs)
      this.firstMessageResolver = (payload) => {
        clearTimeout(timer)
        this.firstMessageResolver = null
        resolve(payload)
      }
    })
  }

  private handleMessage(value: unknown): void {
    const raw = typeof value === 'string' ? value : String(value)
    const parsed = parseJson(raw)
    if (!parsed) {
      this.emitClient({ type: 'event', eventType: 'openclaw.raw.unparsed', payload: { raw } })
      return
    }
    if (this.firstMessageResolver) {
      this.firstMessageResolver(parsed)
      return
    }
    const id = typeof parsed.id === 'string' ? parsed.id : ''
    const pending = id ? this.pending.get(id) : undefined
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      const error = gatewayErrorFromPayload(parsed)
      if (error) {
        pending.reject(error)
        return
      }
      if (parsed.type === 'res') {
        pending.resolve(parsed.payload)
        return
      }
      pending.resolve(parsed.result ?? parsed.payload ?? parsed)
      return
    }
    this.emitClient({ type: 'event', eventType: normalizeEventType(parsed), payload: parsed })
  }

  private scheduleReconnect(): void {
    const backoffMs = BACKOFFS[Math.min(this.backoffIndex, BACKOFFS.length - 1)]
    this.backoffIndex += 1
    this.emitClient({ type: 'reconnecting', payload: { backoffMs } })
    this.reconnectTimer = setTimeout(() => {
      void this.openSocket().catch((error) => {
        this.emitClient({ type: 'error', payload: { message: error instanceof Error ? error.message : String(error) } })
      })
    }, backoffMs)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private emitClient(event: ClientEvent): void {
    if (event.type !== 'error') this.emit(event.type, event)
    this.emit('client-event', event)
  }
}

export class OpenClawGatewayRuntimeRegistry {
  private clients = new Map<string, OpenClawGatewayClient>()

  get(gatewayId: string): OpenClawGatewayClient | undefined {
    return this.clients.get(gatewayId)
  }

  async connect(gateway: Gateway, onEvent: (event: ClientEvent) => void | Promise<void>): Promise<OpenClawGatewayClient> {
    this.disconnect(gateway.id)
    const client = new OpenClawGatewayClient(gateway)
    client.on('client-event', (event) => {
      void onEvent(event as ClientEvent)
    })
    this.clients.set(gateway.id, client)
    await client.connect()
    return client
  }

  disconnect(gatewayId: string): void {
    const existing = this.clients.get(gatewayId)
    if (!existing) return
    existing.disconnect()
    this.clients.delete(gatewayId)
  }

  disconnectAll(): void {
    for (const id of this.clients.keys()) this.disconnect(id)
  }
}

export { OpenClawGatewayClient as OpenClawRpcClient }
