import { ErrorCodes } from '@shared/contracts/error-codes'
import { BridgeResponse, IPC_CHANNELS, IpcChannel } from '@shared/contracts/ipc'

type BridgeResult<T = unknown> = BridgeResponse<T>

interface BridgeCallAPI {
  invoke: <T = unknown>(channel: IpcChannel | string, payload?: unknown) => Promise<BridgeResult<T>>
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  off: (channel: string, listener: (...args: unknown[]) => void) => void
}

const listenerMap = new Map<string, Map<(...args: unknown[]) => void, (...args: unknown[]) => void>>()

function getIpcRenderer(): BridgeCallAPI | null {
  if (typeof window === 'undefined') return null

  const req = (globalThis as { require?: (name: string) => unknown }).require
  if (typeof req !== 'function') {
    return null
  }

  try {
    const electron = req('electron') as { ipcRenderer?: { invoke?: (...args: unknown[]) => Promise<unknown> } & Record<string, unknown> }
    const ipcRenderer = electron.ipcRenderer
    if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function' || typeof ipcRenderer.on !== 'function' || typeof ipcRenderer.removeListener !== 'function') {
      return null
    }

    return {
      invoke: (channel, payload) => Promise.resolve(ipcRenderer.invoke(channel as string, payload)).then((value) => value as BridgeResult),
      on: (channel, listener) => {
        const wrapped = (...args: unknown[]) => listener(...args)
        const byChannel = listenerMap.get(channel) ?? new Map()
        byChannel.set(listener, wrapped)
        listenerMap.set(channel, byChannel)
        ipcRenderer.on(channel, wrapped)
      },
      off: (channel, listener) => {
        const byChannel = listenerMap.get(channel)
        if (!byChannel) return
        const wrapped = byChannel.get(listener)
        if (!wrapped) return
        ipcRenderer.removeListener(channel, wrapped)
        byChannel.delete(listener)
        if (byChannel.size === 0) {
          listenerMap.delete(channel)
        }
      }
    }
  } catch {
    return null
  }
}

export function isElectronRuntime(): boolean {
  return typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)
}

function nextRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `omc-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
}

async function waitForIpc(timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (getIpcRenderer()) return true
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  return false
}

const SESSION_KEY = 'omc-session-token'
const REFRESH_SESSION_KEY = 'omc-refresh-token'

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_SESSION_KEY)
}

export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token)
}

export function setRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_SESSION_KEY, token)
}

export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(REFRESH_SESSION_KEY)
}

function normalizePayload(payload?: unknown, requestId?: string): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    const id = requestId ?? nextRequestId()
    return { requestId: id, correlationId: id, payload }
  }

  const rawPayload = payload as Record<string, unknown>
  const id = (rawPayload.requestId as string | undefined) ?? requestId ?? nextRequestId()

  return {
    requestId: id,
    correlationId: id,
    ...rawPayload,
    ...(rawPayload.actorToken ? { actorToken: rawPayload.actorToken } : {})
  }
}

function apiBaseUrl(): string {
  const envBase = (import.meta.env.VITE_OMC_API_BASE_URL as string | undefined)?.trim()
  if (envBase) return envBase.replace(/\/$/, '')
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return window.location.origin
  }
  return 'http://127.0.0.1:3000'
}

function authTokenFromPayload(payload?: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const token = (payload as Record<string, unknown>).actorToken
    if (typeof token === 'string' && token.trim()) return token
  }
  return getSessionToken()
}

interface HttpAuthResult {
  user?: unknown
  session?: { token?: string }
  refreshToken?: string
}

function persistAuthTokens(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const auth = data as HttpAuthResult
  if (auth.session?.token) setSessionToken(auth.session.token)
  if (auth.refreshToken) setRefreshToken(auth.refreshToken)
}

async function refreshHttpAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null
  const response = await fetch(`${apiBaseUrl()}/api/internal/${encodeURIComponent(IPC_CHANNELS.auth.refresh)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: { refreshToken } })
  })
  const result = await response.json().catch(() => null) as BridgeResult<HttpAuthResult> | null
  if (!result?.ok || !result.data?.session?.token) {
    clearSessionToken()
    return null
  }
  persistAuthTokens(result.data)
  return result.data.session.token
}

async function invokeHttp<T = unknown>(
  channel: IpcChannel | string,
  payload?: unknown,
  requestId?: string,
  retryRefresh = true
): Promise<BridgeResult<T>> {
  const request = normalizePayload(payload, requestId)
  const token = authTokenFromPayload(payload)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetch(`${apiBaseUrl()}/api/internal/${encodeURIComponent(String(channel))}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request)
    })
    const result = await response.json().catch(() => null) as BridgeResult<T> | null
    if (
      response.status === 401 &&
      retryRefresh &&
      channel !== IPC_CHANNELS.auth.login &&
      channel !== IPC_CHANNELS.auth.refresh
    ) {
      const refreshedToken = await refreshHttpAccessToken()
      if (refreshedToken) {
        const nextPayload = payload && typeof payload === 'object'
          ? { ...(payload as Record<string, unknown>), actorToken: refreshedToken }
          : { actorToken: refreshedToken, payload }
        return invokeHttp<T>(channel, nextPayload, requestId, false)
      }
    }
    if (!result) {
      return errorResult(ErrorCodes.Internal, `HTTP API returned ${response.status}`)
    }
    if (result.ok) persistAuthTokens(result.data)
    return result
  } catch (error) {
    return errorResult(ErrorCodes.GatewayUnavailable, error instanceof Error ? error.message : 'HTTP API unavailable')
  }
}

function errorResult<T = unknown>(code: string, message: string): BridgeResult<T> {
  return { ok: false, error: { code, message } }
}

export async function invokeBridge<T = unknown>(
  channel: IpcChannel | string,
  payload?: unknown,
  requestId?: string
): Promise<BridgeResult<T>> {
  if (isElectronRuntime()) {
    await waitForIpc()
  }
  const bridge = getIpcRenderer()
  if (!bridge) {
    if (!isElectronRuntime()) return invokeHttp<T>(channel, payload, requestId)
    return errorResult(
      ErrorCodes.GatewayUnavailable,
      'Electron IPC bulunamadı. Renderer’da ipcRenderer erişimi yok.'
    )
  }

  try {
    return await bridge.invoke<T>(channel, normalizePayload(payload, requestId))
  } catch (error) {
    return errorResult(ErrorCodes.Internal, error instanceof Error ? error.message : 'IPC invoke failed')
  }
}

export async function loadList<T = unknown>(channel: IpcChannel, token: string | null): Promise<BridgeResult<T>> {
  return invokeBridge<T>(channel, { actorToken: token })
}

export function subscribeToChannel(channel: string, listener: (...args: unknown[]) => void): void {
  const bridge = getIpcRenderer()
  if (!bridge) {
    subscribeToHttpChannel(channel, listener)
    return
  }
  bridge.on(channel, listener)
}

export function unsubscribeFromChannel(channel: string, listener: (...args: unknown[]) => void): void {
  const bridge = getIpcRenderer()
  if (!bridge) {
    unsubscribeFromHttpChannel(channel, listener)
    return
  }
  bridge.off(channel, listener)
}

const httpListeners = new Map<string, Set<(...args: unknown[]) => void>>()
let eventSource: EventSource | null = null

function ensureEventSource(): void {
  if (eventSource || typeof EventSource === 'undefined') return
  const token = getSessionToken()
  if (!token) return
  eventSource = new EventSource(`${apiBaseUrl()}/api/events?accessToken=${encodeURIComponent(token)}`)
  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
  }
  for (const channel of Object.values(IPC_CHANNELS.events)) {
    eventSource.addEventListener(channel, (event) => {
      const parsed = JSON.parse((event as MessageEvent).data || '{}') as { payload?: unknown }
      const listeners = httpListeners.get(channel)
      if (!listeners) return
      for (const listener of listeners) listener(parsed.payload)
    })
  }
}

function subscribeToHttpChannel(channel: string, listener: (...args: unknown[]) => void): void {
  const listeners = httpListeners.get(channel) ?? new Set()
  listeners.add(listener)
  httpListeners.set(channel, listeners)
  ensureEventSource()
}

function unsubscribeFromHttpChannel(channel: string, listener: (...args: unknown[]) => void): void {
  const listeners = httpListeners.get(channel)
  if (!listeners) return
  listeners.delete(listener)
  if (listeners.size === 0) httpListeners.delete(channel)
  if (httpListeners.size === 0 && eventSource) {
    eventSource.close()
    eventSource = null
  }
}
