import type * as Electron from 'electron'
import type { AppContext } from '../services/service-container.js'
import { type ServiceResponse as ResponseShape } from '../../shared/contracts/response.js'
import {
  IPC_CHANNELS,
  IpcChannel,
  RequestEnvelope,
  RouteContract,
  SERVICE_ROUTING,
  ServiceDomain
} from '../../shared/contracts/ipc.js'
import { electronRuntime } from '../utils/electron-runtime.js'
import { dispatchInternalApi } from '../internal-api/dispatcher.js'

type HandlerResult = Promise<ResponseShape>
type RouteContext = {
  requestId?: string
  correlationId?: string
  actorToken?: string
  meta?: Record<string, unknown>
}
type RouteHandler = (payload: unknown, request: RouteContext) => HandlerResult

export function createRouteHandler(handler: RouteHandler) {
  return async (_event: Electron.IpcMainInvokeEvent, request: RequestEnvelope) => {
    return handler(request, {
      requestId: request?.requestId,
      correlationId: request?.correlationId,
      actorToken: request?.actorToken,
      ...(request?.meta && typeof request.meta === 'object' ? request.meta : {})
    })
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

export function registerIpcRoutes(context: AppContext): void {
  const { eventBus, services } = context
  const ipcMain = electronRuntime.ipcMain
  if (!ipcMain) {
    throw new Error('Electron ipcMain API is unavailable in this runtime')
  }

  const routeEntries = Object.entries(SERVICE_ROUTING) as Array<[ServiceDomain, Record<string, RouteContract>]>
  for (const [domain, routes] of routeEntries) {
    for (const route of Object.values(routes)) {
      registerIpcRoute(ipcMain, route.channel, (payload) => dispatchInternalApi(services, {
        channel: route.channel,
        request: payload,
        transport: 'ipc'
      }))
    }
  }

  for (const eventChannel of Object.values(IPC_CHANNELS.events) as IpcChannel[]) {
    eventBus.on(eventChannel, (payload) => {
      forwardToWindows(eventChannel, payload)
    })
  }
}
