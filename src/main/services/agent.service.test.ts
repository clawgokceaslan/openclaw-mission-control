import { describe, expect, it } from 'vitest'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import type { Agent, Tag } from '../../shared/types/entities.js'
import { AgentService } from './agent.service.js'

const orgId = 'org-1'
const tags: Tag[] = [
  { id: 'tag-1', organizationId: orgId, name: 'research', color: '#0EA5E9' },
  { id: 'tag-2', organizationId: orgId, name: 'codex', color: '#10B981' }
]

function service() {
  const agents = new Map<string, Agent>()
  const auth = {
    requireActor: async () => ({ user: { organizationId: orgId } })
  }
  const repo = {
    list: async () => Array.from(agents.values()),
    get: async (id: string) => agents.get(id),
    create: async (input: Partial<Agent> & { tagIds?: string[] }) => {
      const selectedTags = tags.filter((tag) => input.tagIds?.includes(tag.id))
      const row: Agent = {
        id: `agent-${agents.size + 1}`,
        organizationId: orgId,
        name: input.name ?? '',
        status: input.status,
        heartbeatAt: 1,
        config: input.config,
        title: input.config?.title as string | undefined,
        description: input.config?.description as string | undefined,
        trainingMarkdown: input.config?.trainingMarkdown as string | undefined,
        steps: input.config?.steps as Agent['steps'],
        tags: selectedTags,
        tagIds: selectedTags.map((tag) => tag.id),
        createdAt: 1,
        updatedAt: 1
      }
      agents.set(row.id, row)
      return row
    },
    update: async (id: string, patch: Partial<Agent> & { tagIds?: string[] }) => {
      const current = agents.get(id)
      if (!current) return undefined
      const selectedTags = patch.tagIds === undefined ? current.tags ?? [] : tags.filter((tag) => patch.tagIds?.includes(tag.id))
      const next = {
        ...current,
        ...patch,
        title: patch.config?.title as string | undefined,
        description: patch.config?.description as string | undefined,
        trainingMarkdown: patch.config?.trainingMarkdown as string | undefined,
        steps: patch.config?.steps as Agent['steps'],
        tags: selectedTags,
        tagIds: selectedTags.map((tag) => tag.id),
        updatedAt: 2
      }
      agents.set(id, next)
      return next
    }
  }
  const tagRepo = {
    list: async () => tags
  }
  return { agentService: new AgentService(auth as any, repo as any, tagRepo as any), agents }
}

describe('AgentService', () => {
  it('creates agents with validated tag ids and active prompt fields', async () => {
    const { agentService } = service()

    const response = await agentService.create({
      name: 'Research Agent',
      title: 'Research',
      trainingMarkdown: 'Prompt',
      tagIds: ['tag-1', 'tag-2']
    })

    expect(response.ok).toBe(true)
    expect(response.data?.tags?.map((tag) => tag.id)).toEqual(['tag-1', 'tag-2'])
    expect(response.data?.trainingMarkdown).toBe('Prompt')
  })

  it('preserves tags when tagIds is omitted and clears tags when tagIds is empty', async () => {
    const { agentService } = service()
    const created = await agentService.create({ name: 'Agent', tagIds: ['tag-1'] })

    const preserved = await agentService.update({ id: created.data?.id, title: 'Updated' })
    expect(preserved.data?.tags?.map((tag) => tag.id)).toEqual(['tag-1'])

    const cleared = await agentService.update({ id: created.data?.id, tagIds: [] })
    expect(cleared.data?.tags).toEqual([])
  })

  it('rejects invalid tag ids', async () => {
    const { agentService } = service()

    const response = await agentService.create({ name: 'Agent', tagIds: ['missing-tag'] })

    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe(ErrorCodes.Validation)
    expect(response.error?.message).toContain('Invalid agent tag ids')
  })

  it('does not persist legacy status or reasoningLevel from write payloads', async () => {
    const { agentService } = service()
    const response = await agentService.create({
      name: 'Agent',
      status: 'busy',
      reasoningLevel: 'high'
    } as any)

    expect(response.ok).toBe(true)
    expect(response.data?.config).not.toHaveProperty('reasoningLevel')
    expect(response.data?.status).toBeUndefined()
  })
})
