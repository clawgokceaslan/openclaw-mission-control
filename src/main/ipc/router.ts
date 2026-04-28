import type * as Electron from 'electron'
import type { AppContext, AppServices } from '../services/service-container.js'
import { AppError } from '../../shared/errors/index.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import {
  ServiceResponse as ResponseShape,
  errorResponse,
  wrapResponseMeta
} from '../../shared/contracts/response.js'
import {
  IPC_CHANNELS,
  IpcChannel,
  RequestEnvelope,
  RouteContract,
  SERVICE_ROUTING,
  ServiceDomain
} from '../../shared/contracts/ipc.js'
import { electronRuntime } from '../utils/electron-runtime.js'

type HandlerResult = Promise<ResponseShape>
type RouteContext = {
  requestId?: string
  correlationId?: string
  actorToken?: string
  meta?: Record<string, unknown>
}
type RouteHandler = (payload: unknown, request: RouteContext) => HandlerResult
type IpcServiceMethod = (payload: unknown, meta?: Record<string, unknown>) => HandlerResult
type ServiceMethodMap = Record<string, IpcServiceMethod>

function normalizeRequest(rawRequest: unknown): RequestEnvelope {
  if (!rawRequest || typeof rawRequest !== 'object') return {}

  const request = rawRequest as Record<string, unknown>
  const body = request.payload === undefined ? request : request.payload

  return {
    ...(request as RequestEnvelope),
    payload: body
  }
}

function injectActorToken(payload: unknown, actorToken: string | undefined): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return actorToken ? { actorToken } : {}
  }

  return { ...(payload as Record<string, unknown>), ...(actorToken ? { actorToken } : {}) }
}

function enrichMeta(baseMeta: unknown, request: RequestEnvelope): Record<string, unknown> | undefined {
  const requestMeta = {
    requestId: request.requestId,
    correlationId: request.correlationId
  }
  const additions = {
    ...requestMeta,
    ...(request.meta && typeof request.meta === 'object' ? request.meta : {})
  }

  return wrapResponseMeta(
    baseMeta && typeof baseMeta === 'object' ? (baseMeta as Record<string, unknown>) : undefined,
    additions
  )
}

function wrapResponse(result: ResponseShape, request: RequestEnvelope): ResponseShape {
  return {
    ...result,
    meta: enrichMeta(result.meta, request)
  }
}

export function createRouteHandler(handler: RouteHandler) {
  return async (_event: Electron.IpcMainInvokeEvent, request: RequestEnvelope) => {
    const normalized = normalizeRequest(request)
    const actorToken = normalized.actorToken
    const payload = injectActorToken(normalized.payload, actorToken)

    try {
      const response = await handler(payload, {
        requestId: normalized.requestId,
        correlationId: normalized.correlationId,
        ...(normalized.meta && typeof normalized.meta === 'object' ? normalized.meta : {})
      })
      return wrapResponse(response, normalized)
    } catch (error) {
      if (error instanceof AppError) {
        return errorResponse(error.code, error.message, error.details)
      }
      return errorResponse(ErrorCodes.Internal, error instanceof Error ? error.message : 'Unknown error')
    }
  }
}

export function registerIpcRoute(ipcMain: Electron.IpcMain, channel: string, handler: RouteHandler): void {
  ipcMain.handle(channel, createRouteHandler(handler))
}

function forwardToWindows(channel: IpcChannel, payload: unknown): void {
  const BrowserWindow = electronRuntime.BrowserWindow
  if (!BrowserWindow) return

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function getServiceMethod<TDomain extends ServiceDomain>(services: AppServices, domain: TDomain, method: string): IpcServiceMethod {
  const service = services[domain] as unknown as Record<string, IpcServiceMethod>
  const methodCandidate = service[method]
  if (typeof methodCandidate !== 'function') {
    throw new Error(`IPC service method not found: ${String(domain)}.${method}`)
  }
  const bound = methodCandidate.bind(service)
  return bound as IpcServiceMethod
}

export function registerIpcRoutes(context: AppContext): void {
  const { eventBus, services } = context
  const ipcMain = electronRuntime.ipcMain
  if (!ipcMain) {
    throw new Error('Electron ipcMain API is unavailable in this runtime')
  }

  const routeEntries = Object.entries(SERVICE_ROUTING) as Array<[ServiceDomain, Record<string, RouteContract>]>
  for (const [domain, routes] of routeEntries) {
    for (const route of Object.values(routes)) {
      const handler = getServiceMethod(services, domain, route.method)
      if (typeof handler !== 'function') {
        throw new Error(`IPC route handler is missing: ${route.domain}:${route.method} -> ${route.channel}`)
      }

      registerIpcRoute(ipcMain, route.channel, (payload, request) => handler(payload, request?.meta))
    }
  }

  for (const eventChannel of Object.values(IPC_CHANNELS.events) as IpcChannel[]) {
    eventBus.on(eventChannel, (payload) => {
      forwardToWindows(eventChannel, payload)
    })
  }
}
