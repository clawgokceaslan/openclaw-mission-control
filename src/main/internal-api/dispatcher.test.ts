import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import { dispatchInternalApi } from './dispatcher.js'

describe('dispatchInternalApi', () => {
  it('normalizes request envelopes and forwards correlation meta', async () => {
    const list = vi.fn(async (_payload, meta) => ({ ok: true, data: { meta } }))
    const services = { projects: { list } } as any

    const response = await dispatchInternalApi(services, {
      channel: IPC_CHANNELS.projects.list,
      transport: 'http',
      actorToken: 'access-token',
      request: {
        requestId: 'req-1',
        correlationId: 'corr-1',
        payload: { page: 1 }
      }
    })

    expect(response.ok).toBe(true)
    expect(list).toHaveBeenCalledWith(
      { page: 1, actorToken: 'access-token' },
      expect.objectContaining({ requestId: 'req-1', correlationId: 'corr-1', transport: 'http' })
    )
    expect(response.meta).toEqual(expect.objectContaining({ requestId: 'req-1', correlationId: 'corr-1', transport: 'http' }))
  })

  it('returns a controlled capability error for Electron-only web calls', async () => {
    const response = await dispatchInternalApi({ workspaces: { pickFolder: vi.fn() } } as any, {
      channel: IPC_CHANNELS.workspaces.pickFolder,
      transport: 'http',
      actorToken: 'access-token',
      request: {}
    })

    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe('ERR_FORBIDDEN')
    expect(response.error?.details).toEqual(expect.objectContaining({ supported: false }))
  })

  it('injects a local desktop session for authenticated IPC calls without renderer login', async () => {
    const list = vi.fn(async (payload) => ({ ok: true, data: payload }))
    const createDesktopSession = vi.fn(async () => ({
      ok: true,
      data: { session: { token: 'desktop-token' }, user: { id: 'user-1' } }
    }))
    const services = { auth: { createDesktopSession }, projects: { list } } as any

    const response = await dispatchInternalApi(services, {
      channel: IPC_CHANNELS.projects.list,
      transport: 'ipc',
      request: { payload: {} }
    })

    expect(response.ok).toBe(true)
    expect(createDesktopSession).toHaveBeenCalled()
    expect(list).toHaveBeenCalledWith(
      { actorToken: 'desktop-token' },
      expect.objectContaining({ transport: 'ipc' })
    )
  })
})
