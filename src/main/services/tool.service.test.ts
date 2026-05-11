import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import type { AiTool, Agent } from '../../shared/types/entities.js'
import { ToolService } from './tool.service.js'

const orgId = 'org-1'
const agents: Agent[] = [
  { id: 'agent-1', organizationId: orgId, name: 'Engineer', heartbeatAt: 1, createdAt: 1, updatedAt: 1 }
]

function service() {
  const rows = new Map<string, AiTool>()
  const auth = { requireActor: vi.fn(async () => ({ user: { organizationId: orgId } })) }
  const repo = {
    listPage: vi.fn(async () => ({ rows: Array.from(rows.values()), total: rows.size, page: 1, pageSize: 20 })),
    get: vi.fn(async (id: string) => rows.get(id)),
    create: vi.fn(async (organizationId: string, input: Partial<AiTool> & { name: string; agentIds?: string[] }) => {
      const row: AiTool = {
        id: `tool-${rows.size + 1}`,
        organizationId,
        name: input.name,
        slug: input.name.toLowerCase().replace(/\s+/g, '-'),
        status: input.status ?? 'active',
        toolType: input.toolType ?? 'local_command',
        descriptionMarkdown: input.descriptionMarkdown,
        inputSchemaJson: input.inputSchemaJson,
        outputSchemaJson: input.outputSchemaJson,
        approvalRequired: input.approvalRequired ?? true,
        timeoutSeconds: input.timeoutSeconds ?? null,
        agents: agents.filter((agent) => input.agentIds?.includes(agent.id)),
        agentIds: input.agentIds ?? [],
        createdAt: 1,
        updatedAt: 1
      }
      rows.set(row.id, row)
      return row
    }),
    update: vi.fn(async (_organizationId: string, id: string, input: Partial<AiTool> & { agentIds?: string[] }) => {
      const current = rows.get(id)
      if (!current) return undefined
      const next = {
        ...current,
        ...input,
        agents: input.agentIds === undefined ? current.agents : agents.filter((agent) => input.agentIds?.includes(agent.id)),
        agentIds: input.agentIds ?? current.agentIds,
        updatedAt: 2
      }
      rows.set(id, next)
      return next
    }),
    remove: vi.fn(async (_organizationId: string, id: string) => rows.delete(id))
  }
  const agentRepo = { list: vi.fn(async () => agents) }
  return { toolService: new ToolService(auth as any, repo as any, agentRepo as any), repo, rows }
}

describe('ToolService', () => {
  it('creates catalog-only tools with schemas and agent links', async () => {
    const { toolService } = service()

    const response = await toolService.create({
      name: 'List changed files',
      inputSchemaJson: '{"type":"object","properties":{}}',
      outputSchemaJson: { type: 'object', properties: { files: { type: 'array' } } },
      agentIds: ['agent-1']
    })

    expect(response.ok).toBe(true)
    expect(response.data?.inputSchemaJson?.type).toBe('object')
    expect(response.data?.agentIds).toEqual(['agent-1'])
  })

  it('rejects missing names, invalid schemas, invalid agents, and invalid timeouts', async () => {
    const { toolService } = service()

    const missingName = await toolService.create({})
    const badSchema = await toolService.create({ name: 'Bad', inputSchemaJson: '[]' })
    const badAgent = await toolService.create({ name: 'Bad agent', agentIds: ['missing'] })
    const badTimeout = await toolService.create({ name: 'Bad timeout', timeoutSeconds: 0 })

    expect(missingName.error?.code).toBe(ErrorCodes.Validation)
    expect(badSchema.error?.message).toContain('inputSchemaJson')
    expect(badAgent.error?.message).toContain('Invalid tool agent ids')
    expect(badTimeout.error?.message).toContain('timeoutSeconds')
  })

  it('updates and removes tools inside the actor organization', async () => {
    const { toolService } = service()
    const created = await toolService.create({ name: 'Tool' })
    const id = created.data?.id
    if (!id) throw new Error('Expected tool id')

    const updated = await toolService.update({ id, name: 'Updated tool', agentIds: ['agent-1'] })
    const removed = await toolService.remove({ id })

    expect(updated.data?.name).toBe('Updated tool')
    expect(updated.data?.agentIds).toEqual(['agent-1'])
    expect(removed.ok).toBe(true)
  })
})
