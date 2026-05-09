import EventEmitter from 'node:events'
import { request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import { createWebServerStatusState, getInternalHttpServerStatus, startInternalHttpServer } from './http-server.js'

function createContext() {
  const eventBus = new EventEmitter()
  return {
    eventBus,
    services: {
      auth: {
        getSessionActor: async (token?: string) => token === 'access-token'
          ? { session: { token }, user: { id: 'user-1' } }
          : undefined,
        login: async (payload: { email?: string; password?: string }) => payload.email === 'owner@mission.local' && payload.password === 'changeme'
          ? { ok: true, data: { session: { token: 'access-token' }, refreshToken: 'refresh-token', user: { id: 'user-1' } } }
          : { ok: false, error: { code: 'ERR_UNAUTHENTICATED', message: 'Invalid credentials' } },
        refresh: async (payload: { refreshToken?: string }) => payload.refreshToken === 'refresh-token'
          ? { ok: true, data: { session: { token: 'access-token' }, refreshToken: 'next-refresh-token', user: { id: 'user-1' } } }
          : { ok: false, error: { code: 'ERR_UNAUTHENTICATED', message: 'Refresh token is invalid' } },
        me: async (payload: { actorToken?: string }) => payload.actorToken === 'access-token'
          ? { ok: true, data: { session: { token: payload.actorToken }, user: { id: 'user-1' } } }
          : { ok: false, error: { code: 'ERR_UNAUTHENTICATED', message: 'No active session' } },
        logout: async (payload: { actorToken?: string }) => ({ ok: true, data: { ok: true, actorToken: payload.actorToken } })
      },
      projects: {
        list: async (payload: { actorToken?: string }) => ({ ok: true, data: [{ id: 'project-1', actorToken: payload.actorToken }] })
      }
    }
  } as any
}

function requestJson(options: {
  port: number
  path: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: any }> {
  return new Promise((resolve, reject) => {
    const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body)
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: options.port,
      path: options.path,
      method: options.method ?? 'GET',
      headers: {
        ...(rawBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody).toString() } : {}),
        ...options.headers
      }
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: text ? JSON.parse(text) : null
        })
      })
    })
    request.on('error', reject)
    if (rawBody) request.write(rawBody)
    request.end()
  })
}

describe('startInternalHttpServer', () => {
  it('marks localhost-bound LAN addresses as not externally reachable', () => {
    const status = createWebServerStatusState({
      status: 'running',
      host: '127.0.0.1',
      preferredPort: 3000,
      actualPort: 3000
    })

    expect(status.lanReachable).toBe(false)
    expect(status.localUrl).toBe('http://localhost:3000')
    expect(status.lanAddresses.every((entry) => entry.url === null)).toBe(true)
  })

  it('marks all-interface hosts as LAN reachable when a port is active', () => {
    const status = createWebServerStatusState({
      status: 'running',
      host: '0.0.0.0',
      preferredPort: 3000,
      actualPort: 3001
    })

    expect(status.lanReachable).toBe(true)
    expect(status.url).toBe('http://127.0.0.1:3001')
    expect(status.localUrl).toBe('http://localhost:3001')
  })

  it('accepts public health requests on all interfaces with a custom Host and Origin', async () => {
    const server = await startInternalHttpServer(createContext(), { preferredPort: 30180, host: '0.0.0.0' })
    try {
      const response = await requestJson({
        port: server.port,
        path: '/api/health',
        headers: {
          Host: `mission-control.internal:${server.port}`,
          Origin: 'http://mission-control.internal'
        }
      })

      expect(response.statusCode).toBe(200)
      expect(response.body.ok).toBe(true)
      expect(response.body.data?.ok).toBe(true)
      expect(response.headers['access-control-allow-origin']).toBe('*')
      expect(response.headers['access-control-allow-private-network']).toBe('true')
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`)
      expect(getInternalHttpServerStatus()).toMatchObject({
        status: 'running',
        host: '0.0.0.0',
        actualPort: server.port,
        localUrl: `http://localhost:${server.port}`,
        url: `http://127.0.0.1:${server.port}`,
        lanReachable: true
      })
    } finally {
      await server.close()
    }
  })

  it('keeps protected routes authenticated while accepting custom Host and Origin', async () => {
    const server = await startInternalHttpServer(createContext(), { preferredPort: 30200, host: '0.0.0.0' })
    try {
      const response = await requestJson({
        port: server.port,
        path: `/api/internal/${encodeURIComponent(IPC_CHANNELS.projects.list)}`,
        method: 'POST',
        headers: {
          Host: `ops-dns.internal:${server.port}`,
          Origin: 'http://ops-dns.internal'
        },
        body: { payload: {} }
      })

      expect(response.statusCode).toBe(401)
      expect(response.body.ok).toBe(false)
      expect(response.body.error?.code).toBe('ERR_UNAUTHENTICATED')
      expect(response.headers['access-control-allow-origin']).toBe('*')
    } finally {
      await server.close()
    }
  })

  it('serves protected internal API calls through the shared dispatcher', async () => {
    const server = await startInternalHttpServer(createContext(), { preferredPort: 30100, host: '127.0.0.1' })
    try {
      const response = await fetch(`${server.url}/api/internal/${encodeURIComponent(IPC_CHANNELS.projects.list)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer access-token'
        },
        body: JSON.stringify({ payload: {} })
      })
      const json = await response.json() as { ok: boolean; data?: Array<{ actorToken?: string }> }

      expect(response.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.data?.[0]?.actorToken).toBe('access-token')
      expect(getInternalHttpServerStatus()).toMatchObject({
        status: 'running',
        host: '127.0.0.1',
        preferredPort: 30100,
        actualPort: server.port,
        localUrl: `http://localhost:${server.port}`,
        lanReachable: false
      })
    } finally {
      await server.close()
    }
  })

  it('rejects protected calls without an access token', async () => {
    const server = await startInternalHttpServer(createContext(), { preferredPort: 30120, host: '127.0.0.1' })
    try {
      const response = await fetch(`${server.url}/api/internal/${encodeURIComponent(IPC_CHANNELS.projects.list)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: {} })
      })
      const json = await response.json() as { ok: boolean; error?: { code?: string } }

      expect(response.status).toBe(401)
      expect(json.ok).toBe(false)
      expect(json.error?.code).toBe('ERR_UNAUTHENTICATED')
    } finally {
      await server.close()
    }
  })

  it('runs the injected app restart action from the authenticated web API', async () => {
    const restartApp = vi.fn()
    const server = await startInternalHttpServer(createContext(), {
      preferredPort: 30130,
      host: '127.0.0.1',
      managementActions: { restartApp }
    })
    try {
      const response = await fetch(`${server.url}/api/internal/${encodeURIComponent(IPC_CHANNELS.app.restart)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer access-token'
        },
        body: JSON.stringify({ payload: {} })
      })
      const json = await response.json() as { ok: boolean; data?: { restarting?: boolean } }

      expect(response.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.data?.restarting).toBe(true)
      expect(restartApp).toHaveBeenCalledWith(false)
    } finally {
      await server.close()
    }
  })

  it('serves auth login and refresh through REST endpoints with direct JSON bodies', async () => {
    const server = await startInternalHttpServer(createContext(), { preferredPort: 30140, host: '127.0.0.1' })
    try {
      const loginResponse = await fetch(`${server.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@mission.local', password: 'changeme' })
      })
      const loginJson = await loginResponse.json() as { ok: boolean; data?: { session?: { token?: string }; refreshToken?: string } }
      expect(loginResponse.status).toBe(200)
      expect(loginJson.data?.session?.token).toBe('access-token')
      expect(loginJson.data?.refreshToken).toBe('refresh-token')

      const refreshResponse = await fetch(`${server.url}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: loginJson.data?.refreshToken })
      })
      const refreshJson = await refreshResponse.json() as { ok: boolean; data?: { refreshToken?: string } }
      expect(refreshResponse.status).toBe(200)
      expect(refreshJson.ok).toBe(true)
      expect(refreshJson.data?.refreshToken).toBe('next-refresh-token')
    } finally {
      await server.close()
    }
  })

  it('serves auth me and logout through REST endpoints with bearer auth', async () => {
    const server = await startInternalHttpServer(createContext(), { preferredPort: 30160, host: '127.0.0.1' })
    try {
      const meResponse = await fetch(`${server.url}/api/auth/me`, {
        method: 'GET',
        headers: { Authorization: 'Bearer access-token' }
      })
      const meJson = await meResponse.json() as { ok: boolean; data?: { user?: { id?: string } } }
      expect(meResponse.status).toBe(200)
      expect(meJson.data?.user?.id).toBe('user-1')

      const logoutResponse = await fetch(`${server.url}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: 'Bearer access-token' }
      })
      const logoutJson = await logoutResponse.json() as { ok: boolean; data?: { actorToken?: string } }
      expect(logoutResponse.status).toBe(200)
      expect(logoutJson.data?.actorToken).toBe('access-token')
    } finally {
      await server.close()
    }
  })
})
