import { ErrorCodes } from '@shared/contracts/error-codes'
import { BridgeResponse, IpcChannel } from '@shared/contracts/ipc'

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

function isElectronRuntime(): boolean {
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

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token)
}

export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_KEY)
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

export async function invokeBridge<T = unknown>(
  channel: IpcChannel | string,
  payload?: unknown,
  requestId?: string
): Promise<BridgeResult<T>> {
  await waitForIpc()
  const bridge = getIpcRenderer()
  if (!bridge) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.GatewayUnavailable,
        message: isElectronRuntime()
          ? 'Electron IPC bulunamadı. Renderer’da ipcRenderer erişimi yok.'
          : 'Renderer, Electron içinde çalışmıyor.'
      }
    }
  }

  try {
    return await bridge.invoke<T>(channel, normalizePayload(payload, requestId))
  } catch (error) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.Internal,
        message: error instanceof Error ? error.message : 'IPC invoke failed'
      }
    }
  }
}

export async function loadList<T = unknown>(channel: IpcChannel, token: string | null): Promise<BridgeResult<T>> {
  return invokeBridge<T>(channel, { actorToken: token })
}

export function subscribeToChannel(channel: string, listener: (...args: unknown[]) => void): void {
  const bridge = getIpcRenderer()
  if (!bridge) return
  bridge.on(channel, listener)
}

export function unsubscribeFromChannel(channel: string, listener: (...args: unknown[]) => void): void {
  const bridge = getIpcRenderer()
  if (!bridge) return
  bridge.off(channel, listener)
}
