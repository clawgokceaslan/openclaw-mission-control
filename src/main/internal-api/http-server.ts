import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { URL } from 'node:url'
import type { AppContext } from '../services/service-container.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, type ServiceResponse } from '../../shared/contracts/response.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
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
}

export interface InternalHttpServerHandle {
  server: Server
  port: number
  url: string
  close: () => Promise<void>
}

const eventChannels = new Set<string>(Object.values(IPC_CHANNELS.events))

function sendCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-Id,X-Correlation-Id')
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  sendCorsHeaders(response)
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
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

function contentType(pathname: string): string {
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
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
  const candidate = join(staticRoot, normalizedPath === '/' ? 'index.html' : normalizedPath)
  const filePath = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(staticRoot, 'index.html')
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

async function handleInternalCall(context: AppContext, request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<void> {
  const encodedChannel = requestUrl.pathname.slice('/api/internal/'.length)
  const channel = decodeURIComponent(encodedChannel)
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
    request: body,
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

  for (let port = config.preferredPort; port < config.preferredPort + 20; port += 1) {
    const server = createServer((request, response) => {
      void (async () => {
        sendCorsHeaders(response)
        if (request.method === 'OPTIONS') {
          response.writeHead(204)
          response.end()
          return
        }

        const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `${config.host}:${port}`}`)
        if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
          sendJson(response, 200, okResponse({ ok: true, port, routes: listInternalApiRoutes().length }))
          return
        }
        if (request.method === 'GET' && requestUrl.pathname === '/api/capabilities') {
          sendJson(response, 200, okResponse(INTERNAL_API_CAPABILITIES))
          return
        }
        if (request.method === 'GET' && requestUrl.pathname === '/api/events') {
          await handleEvents(context, request, response, requestUrl)
          return
        }
        if (request.method === 'POST' && requestUrl.pathname.startsWith('/api/internal/')) {
          await handleInternalCall(context, request, response, requestUrl)
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
    throw new Error(`No available Open Mission Control web port from ${config.preferredPort}`)
  }

  return {
    server: selectedServer,
    port: selectedPort,
    url: `http://${config.host}:${selectedPort}`,
    close: () => new Promise((resolve, reject) => selectedServer?.close((error) => error ? reject(error) : resolve()))
  }
}
