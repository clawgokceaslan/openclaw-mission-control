import { describe, expect, it } from 'vitest'
import { AppSettingsService, ALERT_SOUND_SETTINGS_KEY, GATEWAY_LANGUAGE_KEY, DEFAULT_ADD_TASK_PROJECT_KEY, DEFAULT_AGENT_KEY, PLANNER_QUESTION_ATTENTION_KEY } from './app-settings.service.js'
import { ALERT_SOUND_CATEGORIES, ALERT_SOUND_VARIANTS } from '../../shared/utils/alert-sound-settings.js'

function serviceWithAgents(agents: Map<string, any>, store = new Map<string, unknown>(), projects = new Map<string, any>()) {
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
  const projectRepo = {
    get: async (id: string) => projects.get(id),
    list: async (orgId: string) => Array.from(projects.values()).filter((project) => project.organizationId === orgId)
  }
  return new AppSettingsService(auth as any, repo as any, gateways as any, agentRepo as any, projectRepo as any)
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

describe('AppSettingsService default Add Task project', () => {
  it('saves an active organization project as the default Add Task project', async () => {
    const projects = new Map<string, any>([
      ['project-1', { id: 'project-1', organizationId: 'org-1', name: 'Ops', archived: false }]
    ])
    const service = serviceWithAgents(new Map(), new Map(), projects)

    const response = await service.setDefaultAddTaskProject({ projectId: 'project-1' })

    expect(response.ok).toBe(true)
    expect(response.data?.projectId).toBe('project-1')
  })

  it('clears archived default Add Task projects and returns an active fallback', async () => {
    const store = new Map<string, unknown>([[DEFAULT_ADD_TASK_PROJECT_KEY, 'project-archived']])
    const projects = new Map<string, any>([
      ['project-archived', { id: 'project-archived', organizationId: 'org-1', name: 'Old', archived: true }],
      ['project-active', { id: 'project-active', organizationId: 'org-1', name: 'Active', archived: false }]
    ])
    const service = serviceWithAgents(new Map(), store, projects)

    const response = await service.getDefaultAddTaskProject({})

    expect(response.ok).toBe(true)
    expect(response.data?.projectId).toBeNull()
    expect(response.data?.fallbackProject?.id).toBe('project-active')
    expect(response.data?.invalidStoredProjectId).toBe('project-archived')
    expect(store.get(DEFAULT_ADD_TASK_PROJECT_KEY)).toBeNull()
  })
})

describe('AppSettingsService Codex language', () => {
  it('defaults Codex language to Turkish', async () => {
    const service = serviceWithAgents(new Map())

    const response = await service.getGatewayLanguage({})

    expect(response.ok).toBe(true)
    expect(response.data?.language).toBe('tr')
  })

  it('saves normalized Codex language values', async () => {
    const store = new Map<string, unknown>()
    const service = serviceWithAgents(new Map(), store)

    const response = await service.setGatewayLanguage({ language: 'EN' })

    expect(response.ok).toBe(true)
    expect(response.data?.language).toBe('en')
    expect(store.get(GATEWAY_LANGUAGE_KEY)).toBe('en')
  })
})

describe('AppSettingsService planner question attention', () => {
  it('defaults planner questions to focus the app and open the modal', async () => {
    const service = serviceWithAgents(new Map())

    const response = await service.getPlannerQuestionAttention({})

    expect(response.ok).toBe(true)
    expect(response.data?.behavior).toBe('focus-and-modal')
  })

  it('saves normalized planner question attention behavior', async () => {
    const store = new Map<string, unknown>()
    const service = serviceWithAgents(new Map(), store)

    const response = await service.setPlannerQuestionAttention({ behavior: 'modal' })

    expect(response.ok).toBe(true)
    expect(response.data?.behavior).toBe('modal')
    expect(store.get(PLANNER_QUESTION_ATTENTION_KEY)).toBe('modal')
  })

  it('falls back safely for unknown planner question attention behavior', async () => {
    const store = new Map<string, unknown>([[PLANNER_QUESTION_ATTENTION_KEY, 'native-notification']])
    const service = serviceWithAgents(new Map(), store)

    const response = await service.getPlannerQuestionAttention({})

    expect(response.ok).toBe(true)
    expect(response.data?.behavior).toBe('focus-and-modal')
    expect(store.get(PLANNER_QUESTION_ATTENTION_KEY)).toBe('focus-and-modal')
  })
})

describe('AppSettingsService alert sound settings', () => {
  it('defaults alert sound settings for plan and run notifications', async () => {
    const service = serviceWithAgents(new Map())

    const response = await service.getAlertSoundSettings({})

    expect(response.ok).toBe(true)
    expect(response.data?.settings.volume).toBe(0.7)
    expect(response.data?.settings.variants.completed).toBe('completed-bright')
    expect(ALERT_SOUND_CATEGORIES).toHaveLength(4)
    expect(ALERT_SOUND_VARIANTS).toHaveLength(20)
  })

  it('saves normalized alert sound settings and migrates legacy variants per category', async () => {
    const store = new Map<string, unknown>()
    const service = serviceWithAgents(new Map(), store)

    const response = await service.setAlertSoundSettings({
      settings: {
        volume: 1.4,
        variants: {
          success: 'soft',
          error: 'unknown',
          warning: 'pulse',
          completed: 'bright'
        }
      }
    })

    expect(response.ok).toBe(true)
    expect(response.data?.settings.volume).toBe(1)
    expect(response.data?.settings.variants.success).toBe('success-bloom')
    expect(response.data?.settings.variants.error).toBe('error-pulse')
    expect(response.data?.settings.variants.warning).toBe('warning-nudge')
    expect(response.data?.settings.variants.completed).toBe('completed-bright')
    expect(store.get(ALERT_SOUND_SETTINGS_KEY)).toEqual(response.data?.settings)
  })
})
