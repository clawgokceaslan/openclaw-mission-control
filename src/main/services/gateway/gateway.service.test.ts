import EventEmitter from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayService } from './gateway.service.js'

function createService(gateway: any) {
  const auth = {
    requireActor: vi.fn(async () => ({ user: { organizationId: 'org-1' } }))
  }
  let current = gateway
  const repo = {
    get: vi.fn(async (id: string) => current.id === id ? current : undefined),
    update: vi.fn(async (_id: string, input: any) => {
      current = { ...current, ...input }
      return current
    }),
    appendHistory: vi.fn(async () => undefined)
  }
  const settings = {
    get: vi.fn(),
    set: vi.fn()
  }
  const runtime = {
    disconnect: vi.fn(),
    connect: vi.fn(),
    get: vi.fn()
  }
  return { service: new GatewayService(auth as any, repo as any, new EventEmitter(), runtime as any, settings as any), repo }
}

describe('GatewayService OpenAI-compatible models', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers models from a /v1/models-compatible endpoint', async () => {
    const { service, repo } = createService({
      id: 'gw-1',
      organizationId: 'org-1',
      name: 'LocalAI',
      endpoint: 'http://localhost:8080/v1',
      token: 'secret',
      status: 'offline',
      template: { provider: 'openai_compatible', apiBaseUrl: 'http://localhost:8080/v1', defaultModel: 'manual-model' }
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'llama-3.1', owned_by: 'localai' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await service.gatewayModels({ actorToken: 'token', gatewayId: 'gw-1' })

    expect(response.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' })
    }))
    expect(response.data?.models).toEqual([expect.objectContaining({ id: 'llama-3.1', source: 'localai' })])
    expect(repo.update).toHaveBeenCalledWith('gw-1', expect.objectContaining({
      template: expect.objectContaining({ lastModelDiscoveryStatus: 'ok' })
    }))
    expect(response.data?.gateway.token).toBe('••••••••')
  })

  it('falls back to the configured default model when discovery fails', async () => {
    const { service } = createService({
      id: 'gw-1',
      organizationId: 'org-1',
      name: 'vLLM',
      endpoint: 'http://localhost:8000/v1',
      token: '',
      status: 'offline',
      template: { provider: 'openai_compatible', apiBaseUrl: 'http://localhost:8000/v1', defaultModel: 'Qwen/Qwen2.5' }
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    const response = await service.gatewayModels({ actorToken: 'token', gatewayId: 'gw-1' })

    expect(response.ok).toBe(true)
    expect(response.data?.models).toEqual([expect.objectContaining({ id: 'Qwen/Qwen2.5', source: 'manual' })])
    expect(response.data?.cached).toBe(false)
    expect(response.data?.error).toContain('HTTP 500')
  })
})
