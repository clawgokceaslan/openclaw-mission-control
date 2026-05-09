import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from './api'

describe('renderer API bridge', () => {
  it('does not fall back to HTTP internal API for renderer health without IPC', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await invokeBridge(IPC_CHANNELS.app.rendererHealth, { path: '/login' })

    expect(response.ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
