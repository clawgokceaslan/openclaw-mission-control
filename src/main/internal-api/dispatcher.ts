import type { AppServices } from '../services/service-container.js'
import { AppError } from '../../shared/errors/index.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import {
  errorResponse,
  type ServiceResponse,
  wrapResponseMeta
} from '../../shared/contracts/response.js'
import {
  type IpcChannel,
  type RequestEnvelope,
  type RouteContract,
  SERVICE_ROUTING,
  type ServiceDomain
} from '../../shared/contracts/ipc.js'

export type InternalApiTransport = 'ipc' | 'http'

export interface InternalDispatchRequest {
  channel: IpcChannel | string
  request?: unknown
  transport: InternalApiTransport
  actorToken?: string
}

type ServiceMethod = (payload: unknown, meta?: Record<string, unknown>) => Promise<ServiceResponse>

const envelopeKeys = new Set(['requestId', 'correlationId', 'actorToken', 'meta', 'payload'])
const httpUnsupportedChannels = new Set<string>([
  'workspaces:pick-folder',
  'app-settings:pick-database-folder',
  'app-settings:pick-database-file',
  'app-settings:reveal-database-location'
])

export const INTERNAL_API_CAPABILITIES = {
  transport: {
    ipc: true,
    http: true,
    sse: true
  },
  electron: {
    filePicker: false,
    shell: false,
    restart: false,
    localFileAccess: false
  }
} as const

export function normalizeInternalRequest(rawRequest: unknown): RequestEnvelope {
  if (!rawRequest || typeof rawRequest !== 'object') return {}
  const request = rawRequest as Record<string, unknown>
  const isPlainEnvelope = request.payload !== undefined && Object.keys(request).every((key) => envelopeKeys.has(key))
  const body = isPlainEnvelope ? request.payload : request

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

function enrichMeta(baseMeta: unknown, request: RequestEnvelope, transport: InternalApiTransport): Record<string, unknown> | undefined {
  return wrapResponseMeta(
    baseMeta && typeof baseMeta === 'object' ? (baseMeta as Record<string, unknown>) : undefined,
    {
      requestId: request.requestId,
      correlationId: request.correlationId,
      transport
    }
  )
}

function wrapResponse(result: ServiceResponse, request: RequestEnvelope, transport: InternalApiTransport): ServiceResponse {
  return {
    ...result,
    meta: enrichMeta(result.meta, request, transport)
  }
}

function routeEntries(): Array<[ServiceDomain, Record<string, RouteContract>]> {
  return Object.entries(SERVICE_ROUTING) as Array<[ServiceDomain, Record<string, RouteContract>]>
}

export function findRouteByChannel(channel: string): RouteContract | undefined {
  for (const [, routes] of routeEntries()) {
    for (const route of Object.values(routes)) {
      if (route.channel === channel) return route
    }
  }
  return undefined
}

export function getServiceMethod(services: AppServices, route: RouteContract): ServiceMethod {
  const service = services[route.domain] as unknown as Record<string, ServiceMethod>
  const methodCandidate = service[route.method]
  if (typeof methodCandidate !== 'function') {
    throw new Error(`Internal API service method not found: ${String(route.domain)}.${route.method}`)
  }
  return methodCandidate.bind(service) as ServiceMethod
}

export async function dispatchInternalApi(services: AppServices, input: InternalDispatchRequest): Promise<ServiceResponse> {
  const route = findRouteByChannel(input.channel)
  if (!route) {
    return errorResponse(ErrorCodes.NotFound, `Internal API route not found: ${input.channel}`)
  }

  if (input.transport === 'http' && httpUnsupportedChannels.has(route.channel)) {
    return errorResponse(ErrorCodes.Forbidden, 'This Electron-only capability is unavailable from the web transport', {
      capability: 'electron-local-runtime',
      channel: route.channel,
      supported: false
    })
  }

  const normalized = normalizeInternalRequest(input.request)
  const actorToken = input.actorToken ?? normalized.actorToken
  const payload = injectActorToken(normalized.payload, actorToken)
  const meta = {
    requestId: normalized.requestId,
    correlationId: normalized.correlationId,
    transport: input.transport,
    ...(normalized.meta && typeof normalized.meta === 'object' ? normalized.meta : {})
  }

  try {
    const response = await getServiceMethod(services, route)(payload, meta)
    return wrapResponse(response, normalized, input.transport)
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.code, error.message, error.details)
    }
    return errorResponse(ErrorCodes.Internal, error instanceof Error ? error.message : 'Unknown error')
  }
}

export function listInternalApiRoutes(): RouteContract[] {
  return routeEntries().flatMap(([, routes]) => Object.values(routes))
}
