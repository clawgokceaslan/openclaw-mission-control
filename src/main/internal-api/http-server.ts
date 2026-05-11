import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { basename, join, normalize } from 'node:path'
import { URL } from 'node:url'
import type { AppContext } from '../services/service-container.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, type ServiceResponse } from '../../shared/contracts/response.js'
import { IPC_CHANNELS, type WebServerLanAddress, type WebServerStatusState } from '../../shared/contracts/ipc.js'
import {
  dispatchInternalApi,
  findRouteByChannel,
  INTERNAL_API_CAPABILITIES,
  listInternalApiRoutes
} from './dispatcher.js'

export interface InternalHttpServerConfig {
  preferredPort: number
  host: string
  staticRoot?: string
  devRendererUrl?: string
  managementActions?: {
    restartApp?: (openDatabaseSettings: boolean) => void
  }
}

export interface InternalHttpServerHandle {
  server: Server
  port: number
  url: string
  close: () => Promise<void>
}

let webServerStatus: WebServerStatusState = {
  status: 'stopped',
  host: '0.0.0.0',
  preferredPort: 0,
  actualPort: null,
  url: null,
  localUrl: null,
  lanAddresses: [],
  lanReachable: false,
  lastError: null,
  updatedAt: Date.now()
}

export function getLanIpv4Addresses(): string[] {
  const values = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        values.add(entry.address)
      }
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isAllInterfacesHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '0.0.0.0' || normalized === '::'
}

export function createWebServerStatusState(input: {
  status: WebServerStatusState['status']
  host: string
  preferredPort: number
  actualPort?: number | null
  lastError?: string | null
}): WebServerStatusState {
  const actualPort = input.actualPort ?? null
  const host = input.host || '127.0.0.1'
  const lanReachable = Boolean(actualPort && !isLoopbackHost(host))
  const localUrl = actualPort ? `http://localhost:${actualPort}` : null
  const activeHost = isAllInterfacesHost(host) ? '127.0.0.1' : host
  const url = actualPort ? `http://${activeHost}:${actualPort}` : null
  const lanAddresses: WebServerLanAddress[] = getLanIpv4Addresses().map((address) => ({
    address,
    url: lanReachable ? `http://${address}:${actualPort}` : null
  }))

  return {
    status: input.status,
    host,
    preferredPort: input.preferredPort,
    actualPort,
    url,
    localUrl,
    lanAddresses,
    lanReachable,
    lastError: input.lastError ?? null,
    updatedAt: Date.now()
  }
}

export function getInternalHttpServerStatus(): WebServerStatusState {
  return {
    ...webServerStatus,
    lanAddresses: webServerStatus.lanAddresses.map((address) => ({ ...address }))
  }
}

export function recordInternalHttpServerStartupError(config: InternalHttpServerConfig, error: unknown): void {
  webServerStatus = createWebServerStatusState({
    status: 'error',
    host: config.host,
    preferredPort: config.preferredPort,
    actualPort: null,
    lastError: error instanceof Error ? error.message : String(error)
  })
}

const eventChannels = new Set<string>(Object.values(IPC_CHANNELS.events))
const publicPipelineStatusEventChannels = [
  IPC_CHANNELS.events.planPipelineUpdated,
  IPC_CHANNELS.events.runPipelineUpdated
]
const authRestRoutes = new Map<string, { channel: string; requiresAuth: boolean; readBody: boolean }>([
  ['/api/auth/login', { channel: IPC_CHANNELS.auth.login, requiresAuth: false, readBody: true }],
  ['/api/auth/refresh', { channel: IPC_CHANNELS.auth.refresh, requiresAuth: false, readBody: true }],
  ['/api/auth/me', { channel: IPC_CHANNELS.auth.me, requiresAuth: true, readBody: false }],
  ['/api/auth/logout', { channel: IPC_CHANNELS.auth.logout, requiresAuth: true, readBody: false }]
])

function sendCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-Id,X-Correlation-Id')
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  sendCorsHeaders(response)
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function serveActiveProfileAvatar(context: AppContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const avatar = await context.services.auth.getActiveAvatarFile()
  if (!avatar) {
    response.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(JSON.stringify(errorResponse(ErrorCodes.NotFound, 'Active profile avatar not found')))
    return
  }

  const requestEtag = requestHeader(request, 'if-none-match')
  if (requestEtag === avatar.etag) {
    response.writeHead(304, {
      ETag: avatar.etag,
      'Cache-Control': 'private, max-age=60'
    })
    response.end()
    return
  }

  response.writeHead(200, {
    'Content-Type': avatar.mimeType,
    'Content-Length': avatar.size,
    'Cache-Control': 'private, max-age=60',
    ETag: avatar.etag,
    'Last-Modified': new Date(avatar.mtimeMs).toUTCString(),
    'X-Content-Type-Options': 'nosniff'
  })
  if (request.method === 'HEAD') {
    response.end()
    avatar.stream.destroy()
    return
  }
  avatar.stream.pipe(response)
}

function statusForResult(result: ServiceResponse): number {
  if (result.ok) return 200
  switch (result.error?.code) {
    case ErrorCodes.Unauthenticated:
      return 401
    case ErrorCodes.Forbidden:
      return 403
    case ErrorCodes.NotFound:
      return 404
    case ErrorCodes.Validation:
      return 400
    case ErrorCodes.RateLimited:
      return 429
    default:
      return 500
  }
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('error', reject)
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({ payload: raw })
      }
    })
  })
}

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (!header || Array.isArray(header)) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]
}

function requestHeader(request: IncomingMessage, key: string): string | undefined {
  const value = request.headers[key.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function requestClientSource(request: IncomingMessage): string {
  const forwardedFor = requestHeader(request, 'x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = requestHeader(request, 'x-real-ip')?.trim()
  const remoteAddress = request.socket.remoteAddress?.trim()
  return `http:${forwardedFor || realIp || remoteAddress || 'unknown'}`
}

function withRequestMeta(body: unknown, request: IncomingMessage): unknown {
  const meta = { clientSource: requestClientSource(request) }
  if (body && typeof body === 'object' && 'payload' in body) {
    const envelope = body as Record<string, unknown>
    return {
      ...envelope,
      meta: {
        ...(envelope.meta && typeof envelope.meta === 'object' ? envelope.meta : {}),
        ...meta
      }
    }
  }
  return { payload: body, meta }
}

function contentType(pathname: string): string {
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.webmanifest')) return 'application/manifest+json; charset=utf-8'
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8'
  if (pathname.endsWith('.ico')) return 'image/x-icon'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.woff2')) return 'font/woff2'
  return 'text/html; charset=utf-8'
}

async function proxyDevRenderer(devRendererUrl: string, request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<void> {
  const target = new URL(requestUrl.pathname + requestUrl.search, devRendererUrl)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (key === 'host' || key === 'connection' || value === undefined) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  const proxied = await fetch(target, {
    method: request.method,
    headers
  })
  response.writeHead(proxied.status, Object.fromEntries(proxied.headers.entries()))
  response.end(Buffer.from(await proxied.arrayBuffer()))
}

function serveStatic(staticRoot: string, requestUrl: URL, response: ServerResponse): boolean {
  const pathname = decodeURIComponent(requestUrl.pathname)
  const normalizedPath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '')
  const assetPathIndex = normalizedPath.indexOf('/assets/')
  const iconPathIndex = normalizedPath.indexOf('/icons/')
  const publicFileNames = new Set([
    'apple-touch-icon.png',
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'site.webmanifest'
  ])
  const candidates = [
    join(staticRoot, normalizedPath === '/' ? 'index.html' : normalizedPath),
    ...(assetPathIndex >= 0 ? [join(staticRoot, normalizedPath.slice(assetPathIndex + 1))] : []),
    ...(iconPathIndex >= 0 ? [join(staticRoot, normalizedPath.slice(iconPathIndex + 1))] : []),
    ...(publicFileNames.has(basename(normalizedPath)) ? [join(staticRoot, basename(normalizedPath))] : [])
  ]
  const filePath = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? join(staticRoot, 'index.html')
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false

  response.writeHead(200, { 'Content-Type': contentType(filePath) })
  createReadStream(filePath).pipe(response)
  return true
}

async function authenticateHttpRequest(context: AppContext, request: IncomingMessage, routeRequiresAuth: boolean, requestUrl?: URL): Promise<string | undefined | ServiceResponse> {
  const token = bearerToken(request) ?? requestUrl?.searchParams.get('accessToken') ?? undefined
  if (!routeRequiresAuth) return token
  if (!token) return errorResponse(ErrorCodes.Unauthenticated, 'Access token required')
  const actor = await context.services.auth.getSessionActor(token)
  if (!actor) return errorResponse(ErrorCodes.Unauthenticated, 'Access token is invalid or expired')
  return token
}

async function handleInternalCall(context: AppContext, config: InternalHttpServerConfig, request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<void> {
  const encodedChannel = requestUrl.pathname.slice('/api/internal/'.length)
  const channel = decodeURIComponent(encodedChannel)
  if (channel === IPC_CHANNELS.app.restart || channel === IPC_CHANNELS.app.restartToDatabaseSettings) {
    const auth = await authenticateHttpRequest(context, request, true)
    if (auth && typeof auth === 'object' && 'ok' in auth && !auth.ok) {
      sendJson(response, statusForResult(auth), auth)
      return
    }

    const restartApp = config.managementActions?.restartApp
    if (!restartApp) {
      sendJson(response, 403, errorResponse(ErrorCodes.Forbidden, 'App restart is unavailable from this runtime', {
        capability: 'electron-restart',
        channel,
        supported: false
      }))
      return
    }

    restartApp(channel === IPC_CHANNELS.app.restartToDatabaseSettings)
    sendJson(response, 200, okResponse({ restarting: true }))
    return
  }

  const route = findRouteByChannel(channel)
  if (!route) {
    sendJson(response, 404, errorResponse(ErrorCodes.NotFound, `Internal API route not found: ${channel}`))
    return
  }

  const auth = await authenticateHttpRequest(context, request, route.requiresAuth)
  if (auth && typeof auth === 'object' && 'ok' in auth && !auth.ok) {
    sendJson(response, statusForResult(auth), auth)
    return
  }

  const body = await readBody(request)
  const result = await dispatchInternalApi(context.services, {
    channel,
    request: withRequestMeta(body, request),
    transport: 'http',
    actorToken: typeof auth === 'string' ? auth : undefined
  })
  sendJson(response, statusForResult(result), result)
}

async function handleAuthRestCall(context: AppContext, request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<void> {
  const route = authRestRoutes.get(requestUrl.pathname)
  if (!route) {
    sendJson(response, 404, errorResponse(ErrorCodes.NotFound, 'Auth route not found'))
    return
  }

  const auth = await authenticateHttpRequest(context, request, route.requiresAuth, requestUrl)
  if (auth && typeof auth === 'object' && 'ok' in auth && !auth.ok) {
    sendJson(response, statusForResult(auth), auth)
    return
  }

  const body = route.readBody ? await readBody(request) : {}
  const result = await dispatchInternalApi(context.services, {
    channel: route.channel,
    request: {
      requestId: requestHeader(request, 'x-request-id'),
      correlationId: requestHeader(request, 'x-correlation-id'),
      meta: { clientSource: requestClientSource(request) },
      payload: body
    },
    transport: 'http',
    actorToken: typeof auth === 'string' ? auth : undefined
  })
  sendJson(response, statusForResult(result), result)
}

function writeSse(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

async function handleEvents(context: AppContext, request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<void> {
  const auth = await authenticateHttpRequest(context, request, true, requestUrl)
  if (auth && typeof auth === 'object' && 'ok' in auth && !auth.ok) {
    sendJson(response, statusForResult(auth), auth)
    return
  }

  sendCorsHeaders(response)
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })
  writeSse(response, 'ready', { at: Date.now() })

  const listeners: Array<[string, (payload: unknown) => void]> = []
  for (const channel of eventChannels) {
    const listener = (payload: unknown) => writeSse(response, channel, { payload, eventAt: Date.now() })
    context.eventBus.on(channel, listener)
    listeners.push([channel, listener])
  }
  const heartbeat = setInterval(() => writeSse(response, 'heartbeat', { at: Date.now() }), 25000)

  request.on('close', () => {
    clearInterval(heartbeat)
    for (const [channel, listener] of listeners) context.eventBus.off(channel, listener)
  })
}

function handlePublicPipelineStatusEvents(context: AppContext, request: IncomingMessage, response: ServerResponse): void {
  sendCorsHeaders(response)
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })
  writeSse(response, 'ready', { at: Date.now() })

  const listeners: Array<[string, (payload: unknown) => void]> = []
  for (const channel of publicPipelineStatusEventChannels) {
    const listener = (payload: unknown) => writeSse(response, channel, { payload, eventAt: Date.now() })
    context.eventBus.on(channel, listener)
    listeners.push([channel, listener])
  }
  const heartbeat = setInterval(() => writeSse(response, 'heartbeat', { at: Date.now() }), 25000)

  request.on('close', () => {
    clearInterval(heartbeat)
    for (const [channel, listener] of listeners) context.eventBus.off(channel, listener)
  })
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      if (error.code === 'EADDRINUSE') resolve(-1)
      else reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function startInternalHttpServer(context: AppContext, config: InternalHttpServerConfig): Promise<InternalHttpServerHandle> {
  let selectedServer: Server | undefined
  let selectedPort = config.preferredPort
  webServerStatus = createWebServerStatusState({
    status: 'starting',
    host: config.host,
    preferredPort: config.preferredPort
  })

  for (let port = config.preferredPort; port < config.preferredPort + 20; port += 1) {
    const server = createServer((request, response) => {
      void (async () => {
        sendCorsHeaders(response)
        if (request.method === 'OPTIONS') {
          response.writeHead(204)
          response.end()
          return
        }

        const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `localhost:${port}`}`)
        if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
          sendJson(response, 200, okResponse({ ok: true, port, routes: listInternalApiRoutes().length }))
          return
        }
        if (request.method === 'GET' && requestUrl.pathname === '/api/capabilities') {
          sendJson(response, 200, okResponse(INTERNAL_API_CAPABILITIES))
          return
        }
        if ((request.method === 'GET' || request.method === 'HEAD') && requestUrl.pathname === '/api/profile/avatar') {
          await serveActiveProfileAvatar(context, request, response)
          return
        }
        if (request.method === 'GET' && requestUrl.pathname === '/api/public/pipeline-status') {
          const result = await context.services.pipelineStatus.publicSnapshot({})
          sendJson(response, statusForResult(result), result)
          return
        }
        if (request.method === 'GET' && requestUrl.pathname === '/api/public/pipeline-status/events') {
          handlePublicPipelineStatusEvents(context, request, response)
          return
        }
        if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/public/pipeline-status/')) {
          const token = decodeURIComponent(requestUrl.pathname.slice('/api/public/pipeline-status/'.length))
          const result = await context.services.pipelineStatus.publicSnapshot({ token })
          sendJson(response, statusForResult(result), result)
          return
        }
        if (request.method === 'GET' && requestUrl.pathname === '/api/events') {
          await handleEvents(context, request, response, requestUrl)
          return
        }
        if (
          ((request.method === 'GET' && requestUrl.pathname === '/api/auth/me') ||
            (request.method === 'POST' && authRestRoutes.has(requestUrl.pathname)))
        ) {
          await handleAuthRestCall(context, request, response, requestUrl)
          return
        }
        if (request.method === 'POST' && requestUrl.pathname.startsWith('/api/internal/')) {
          await handleInternalCall(context, config, request, response, requestUrl)
          return
        }
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (config.devRendererUrl) {
            await proxyDevRenderer(config.devRendererUrl, request, response, requestUrl)
            return
          }
          if (config.staticRoot && serveStatic(config.staticRoot, requestUrl, response)) return
        }
        sendJson(response, 404, errorResponse(ErrorCodes.NotFound, 'Route not found'))
      })().catch((error) => {
        sendJson(response, 500, errorResponse(ErrorCodes.Internal, error instanceof Error ? error.message : 'HTTP API failed'))
      })
    })

    const actualPort = await listen(server, config.host, port)
    if (actualPort >= 0) {
      selectedServer = server
      selectedPort = actualPort
      break
    }
  }

  if (!selectedServer) {
    const error = new Error(`No available Open Mission Control web port from ${config.preferredPort}`)
    recordInternalHttpServerStartupError(config, error)
    throw error
  }

  webServerStatus = createWebServerStatusState({
    status: 'running',
    host: config.host,
    preferredPort: config.preferredPort,
    actualPort: selectedPort
  })

  return {
    server: selectedServer,
    port: selectedPort,
    url: createWebServerStatusState({
      status: 'running',
      host: config.host,
      preferredPort: config.preferredPort,
      actualPort: selectedPort
    }).url ?? `http://localhost:${selectedPort}`,
    close: () => new Promise((resolve, reject) => selectedServer?.close((error) => {
      if (error) {
        reject(error)
        return
      }
      webServerStatus = createWebServerStatusState({
        status: 'stopped',
        host: config.host,
        preferredPort: config.preferredPort
      })
      resolve()
    }))
  }
}
