import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { ErrorCodes } from '@shared/contracts/error-codes'
import { apiBaseUrl, getMeWithAuthApi, loginWithAuthApi, setRefreshToken, setSessionToken, invokeBridge } from './api'

const axiosRequestMock = vi.hoisted(() => vi.fn())

vi.mock('axios', () => {
  class AxiosError extends Error {
    response?: unknown
  }

  return {
    default: {
      create: vi.fn(() => ({
        request: axiosRequestMock
      }))
    },
    AxiosError
  }
})

function stubElectronRenderer(invoke: ReturnType<typeof vi.fn>) {
  const store = new Map<string, string>()
  const sessionStore = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    })
  }
  const sessionStorage = {
    getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      sessionStore.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      sessionStore.delete(key)
    })
  }
  vi.stubGlobal('window', {
    localStorage,
    sessionStorage,
    dispatchEvent: vi.fn()
  })
  vi.stubGlobal('navigator', { userAgent: 'Electron Test' })
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('sessionStorage', sessionStorage)
  vi.stubGlobal('require', vi.fn((name: string) => {
    if (name !== 'electron') throw new Error(`Unexpected module: ${name}`)
    return {
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn()
      }
    }
  }))
}

function stubWebRuntime() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    })
  }
  vi.stubGlobal('window', {
    localStorage,
    location: {
      protocol: 'http:',
      hostname: 'mission-control.internal',
      port: '19219',
      origin: 'http://mission-control.internal:19219'
    },
    dispatchEvent: vi.fn()
  })
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Test Browser' })
  vi.stubGlobal('localStorage', localStorage)
}

describe('renderer API bridge', () => {
  beforeEach(() => {
    axiosRequestMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('targets the same DNS host on the internal API port when opened from Vite dev server', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        hostname: 'mission-control.internal',
        port: '5173',
        origin: 'http://mission-control.internal:5173'
      }
    })

    expect(apiBaseUrl()).toBe('http://mission-control.internal:3000')

    vi.unstubAllGlobals()
  })

  it('uses the current origin when opened through the internal web server', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        hostname: 'mission-control.internal',
        port: '19219',
        origin: 'http://mission-control.internal:19219'
      }
    })

    expect(apiBaseUrl()).toBe('http://mission-control.internal:19219')

    vi.unstubAllGlobals()
  })

  it('uses the Electron desktop API port when opened from a packaged file renderer', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'file:',
        hostname: '',
        port: '',
        origin: 'file://'
      }
    })
    vi.stubGlobal('navigator', { userAgent: 'Electron Test' })

    expect(apiBaseUrl()).toBe('http://127.0.0.1:19219')

    vi.unstubAllGlobals()
  })

  it('uses the Electron runtime API URL when the main process publishes the actual fallback port', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'file:',
        hostname: '',
        port: '',
        origin: 'file://'
      }
    })
    vi.stubGlobal('navigator', { userAgent: 'Electron Test' })
    vi.stubGlobal('process', {
      env: {
        OMC_INTERNAL_API_BASE_URL: 'http://127.0.0.1:19220/'
      }
    })

    expect(apiBaseUrl()).toBe('http://127.0.0.1:19220')

    vi.unstubAllGlobals()
  })

  it('does not fall back to HTTP internal API for renderer health without IPC', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await invokeBridge(IPC_CHANNELS.app.rendererHealth, { path: '/login' })

    expect(response.ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('uses IPC for Electron auth login instead of the web REST endpoint', async () => {
    const fetchMock = vi.fn()
    const invoke = vi.fn(async (channel: string) => ({
      ok: true,
      data: {
        session: { token: 'ipc-access-token' },
        refreshToken: 'ipc-refresh-token',
        user: { id: 'user-1' }
      }
    }))
    vi.stubGlobal('fetch', fetchMock)
    stubElectronRenderer(invoke)

    const response = await loginWithAuthApi({ email: 'pilot@example.com', password: 'changed-password' })

    expect(response.ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.auth.login, expect.objectContaining({
      email: 'pilot@example.com',
      password: 'changed-password'
    }))
    expect(fetchMock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('refreshes Electron auth through IPC before reporting an invalid stored token', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.auth.me && invoke.mock.calls.length === 1) {
        return { ok: false, error: { code: ErrorCodes.Unauthenticated, message: 'Access token is invalid or expired' } }
      }
      if (channel === IPC_CHANNELS.auth.refresh) {
        return {
          ok: true,
          data: {
            session: { token: 'fresh-access-token' },
            refreshToken: 'fresh-refresh-token',
            user: { id: 'user-1' }
          }
        }
      }
      return {
        ok: true,
        data: {
          session: { token: 'fresh-access-token' },
          user: { id: 'user-1' }
        }
      }
    })
    stubElectronRenderer(invoke)
    setRefreshToken('stored-refresh-token')

    const response = await getMeWithAuthApi('stale-access-token')

    expect(response.ok).toBe(true)
    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.auth.me, expect.objectContaining({ actorToken: 'stale-access-token' }))
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.auth.refresh, expect.not.objectContaining({ refreshToken: expect.any(String) }))
    expect(invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.auth.me, expect.objectContaining({ actorToken: 'fresh-access-token' }))

    vi.unstubAllGlobals()
  })

  it('retries authenticated Electron IPC calls once after a single-flight refresh', async () => {
    const invoke = vi.fn(async (channel: string, payload: Record<string, unknown>) => {
      if (channel === IPC_CHANNELS.projects.list && payload.actorToken === 'stale-access-token') {
        return { ok: false, error: { code: ErrorCodes.Unauthenticated, message: 'No active session' } }
      }
      if (channel === IPC_CHANNELS.auth.refresh) {
        return {
          ok: true,
          data: {
            session: { token: 'fresh-access-token' },
            refreshToken: 'fresh-refresh-token',
            user: { id: 'user-1' }
          }
        }
      }
      return { ok: true, data: [{ actorToken: payload.actorToken }] }
    })
    stubElectronRenderer(invoke)

    const [first, second] = await Promise.all([
      invokeBridge(IPC_CHANNELS.projects.list, { actorToken: 'stale-access-token' }),
      invokeBridge(IPC_CHANNELS.projects.list, { actorToken: 'stale-access-token' })
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(invoke.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.auth.refresh)).toHaveLength(1)
    expect(invoke.mock.calls.filter(([channel, payload]) => channel === IPC_CHANNELS.projects.list && payload.actorToken === 'fresh-access-token')).toHaveLength(2)

    vi.unstubAllGlobals()
  })

  it('sends web HTTP calls with the stale access token before refreshing and retries once with the fresh token', async () => {
    stubWebRuntime()
    setSessionToken('stale-access-token')
    setRefreshToken('stored-refresh-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: vi.fn(async () => ({
          ok: false,
          error: { code: ErrorCodes.Unauthenticated, message: 'Access token is invalid or expired' }
        }))
      })
      .mockResolvedValueOnce({
        status: 200,
        json: vi.fn(async () => ({ ok: true, data: [{ id: 'project-1' }] }))
      })
    vi.stubGlobal('fetch', fetchMock)
    axiosRequestMock.mockResolvedValueOnce({
      status: 200,
      data: {
        ok: true,
        data: {
          session: { token: 'fresh-access-token' },
          refreshToken: 'fresh-refresh-token',
          user: { id: 'user-1' }
        }
      }
    })

    const response = await invokeBridge(IPC_CHANNELS.projects.list, { actorToken: 'stale-access-token', workspaceId: 'workspace-1' }, 'request-1')

    expect(response.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(axiosRequestMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer stale-access-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-access-token')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(expect.objectContaining({
      requestId: 'request-1',
      correlationId: 'request-1',
      actorToken: 'fresh-access-token',
      workspaceId: 'workspace-1'
    }))

    vi.unstubAllGlobals()
  })

  it('uses one web refresh request for concurrent unauthenticated HTTP responses', async () => {
    stubWebRuntime()
    setSessionToken('stale-access-token')
    setRefreshToken('stored-refresh-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: vi.fn(async () => ({
          ok: false,
          error: { code: ErrorCodes.Unauthenticated, message: 'No active session' }
        }))
      })
      .mockResolvedValueOnce({
        status: 401,
        json: vi.fn(async () => ({
          ok: false,
          error: { code: ErrorCodes.Unauthenticated, message: 'No active session' }
        }))
      })
      .mockResolvedValue({
        status: 200,
        json: vi.fn(async () => ({ ok: true, data: [{ actorToken: 'fresh-access-token' }] }))
      })
    vi.stubGlobal('fetch', fetchMock)
    axiosRequestMock.mockResolvedValueOnce({
      status: 200,
      data: {
        ok: true,
        data: {
          session: { token: 'fresh-access-token' },
          refreshToken: 'fresh-refresh-token',
          user: { id: 'user-1' }
        }
      }
    })

    const [first, second] = await Promise.all([
      invokeBridge(IPC_CHANNELS.projects.list, { actorToken: 'stale-access-token' }, 'request-1'),
      invokeBridge(IPC_CHANNELS.projects.list, { actorToken: 'stale-access-token' }, 'request-2')
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(axiosRequestMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.slice(2).every(([, init]) => init.headers.Authorization === 'Bearer fresh-access-token')).toBe(true)

    vi.unstubAllGlobals()
  })

  it('tries one extra silent web refresh and does not retry the original request when refresh keeps failing', async () => {
    stubWebRuntime()
    setSessionToken('stale-access-token')
    setRefreshToken('stored-refresh-token')
    const fetchMock = vi.fn(async () => ({
      status: 401,
      json: vi.fn(async () => ({
        ok: false,
        error: { code: ErrorCodes.Unauthenticated, message: 'Access token is invalid or expired' }
      }))
    }))
    vi.stubGlobal('fetch', fetchMock)
    axiosRequestMock
      .mockResolvedValueOnce({
        status: 401,
        data: {
          ok: false,
          error: { code: ErrorCodes.Unauthenticated, message: 'Refresh token is invalid' }
        }
      })
      .mockResolvedValueOnce({
        status: 401,
        data: {
          ok: false,
          error: { code: ErrorCodes.Unauthenticated, message: 'Refresh token is invalid' }
        }
      })

    const response = await invokeBridge(IPC_CHANNELS.projects.list, { actorToken: 'stale-access-token' })

    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe(ErrorCodes.Unauthenticated)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(axiosRequestMock).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })
})
