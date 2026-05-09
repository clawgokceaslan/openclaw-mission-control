import EventEmitter from 'node:events'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import { startInternalHttpServer } from './http-server.js'

function createContext() {
  const eventBus = new EventEmitter()
  return {
    eventBus,
    services: {
      auth: {
        getSessionActor: async (token?: string) => token === 'access-token'
          ? { session: { token }, user: { id: 'user-1' } }
          : undefined
      },
      projects: {
        list: async (payload: { actorToken?: string }) => ({ ok: true, data: [{ id: 'project-1', actorToken: payload.actorToken }] })
      }
    }
  } as any
}

describe('startInternalHttpServer', () => {
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
})
