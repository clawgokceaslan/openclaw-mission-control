import { describe, expect, it } from 'vitest'
import { AppSettingsService, CODEX_LANGUAGE_KEY, DEFAULT_AGENT_KEY } from './app-settings.service.js'

function serviceWithAgents(agents: Map<string, any>, store = new Map<string, unknown>()) {
  const auth = {
    requireActor: async () => ({ user: { organizationId: 'org-1' } })
  }
  const repo = {
    get: async (_orgId: string, key: string) => store.get(key),
    set: async (_orgId: string, key: string, value: unknown) => {
      store.set(key, value)
    }
  }
  const gateways = {
    get: async () => undefined
  }
  const agentRepo = {
    get: async (id: string) => agents.get(id)
  }
  return new AppSettingsService(auth as any, repo as any, gateways as any, agentRepo as any)
}

describe('AppSettingsService default agent', () => {
  it('saves a default agent after organization validation', async () => {
    const agents = new Map<string, any>([
      ['agent-1', { id: 'agent-1', organizationId: 'org-1', name: 'Planner' }]
    ])
    const service = serviceWithAgents(agents)

    const response = await service.setDefaultAgent({ agentId: 'agent-1' })

    expect(response.ok).toBe(true)
    expect(response.data?.agentId).toBe('agent-1')
  })

  it('clears missing or inaccessible default agents when read', async () => {
    const store = new Map<string, unknown>([[DEFAULT_AGENT_KEY, 'agent-2']])
    const service = serviceWithAgents(new Map(), store)

    const response = await service.getDefaultAgent({})

    expect(response.ok).toBe(true)
    expect(response.data?.agentId).toBeNull()
    expect(store.get(DEFAULT_AGENT_KEY)).toBeNull()
  })
})

describe('AppSettingsService Codex language', () => {
  it('defaults Codex language to Turkish', async () => {
    const service = serviceWithAgents(new Map())

    const response = await service.getCodexLanguage({})

    expect(response.ok).toBe(true)
    expect(response.data?.language).toBe('tr')
  })

  it('saves normalized Codex language values', async () => {
    const store = new Map<string, unknown>()
    const service = serviceWithAgents(new Map(), store)

    const response = await service.setCodexLanguage({ language: 'EN' })

    expect(response.ok).toBe(true)
    expect(response.data?.language).toBe('en')
    expect(store.get(CODEX_LANGUAGE_KEY)).toBe('en')
  })
})
