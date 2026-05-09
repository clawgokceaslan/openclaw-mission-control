import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { ErrorCodes } from '@shared/contracts/error-codes'
import { apiBaseUrl, getMeWithAuthApi, loginWithAuthApi, setRefreshToken, invokeBridge } from './api'

function stubElectronRenderer(invoke: ReturnType<typeof vi.fn>) {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { userAgent: 'Electron Test' })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    })
  })
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

describe('renderer API bridge', () => {
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

    const response = await loginWithAuthApi({ email: 'owner@mission.local', password: 'changeme' })

    expect(response.ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.auth.login, expect.objectContaining({
      email: 'owner@mission.local',
      password: 'changeme'
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
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.auth.refresh, expect.objectContaining({ refreshToken: 'stored-refresh-token' }))
    expect(invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.auth.me, expect.objectContaining({ actorToken: 'fresh-access-token' }))

    vi.unstubAllGlobals()
  })
})
