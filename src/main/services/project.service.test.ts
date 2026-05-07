import { describe, expect, it, vi } from 'vitest'
import { ProjectService } from './project.service.js'
import type { Project } from '../../shared/types/entities.js'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    organizationId: 'org-1',
    name: 'Project',
    archived: false,
    metrics: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('ProjectService Codex settings', () => {
  it('normalizes prompt shape and preserves existing Codex settings on partial saves', async () => {
    const current = project({
      metrics: {
        gateway: {
          gatewayId: 'gateway-1',
          runtimeWorkspaceId: 'workspace-1',
          planModel: 'gpt-plan',
          runModel: 'gpt-run',
          language: 'en',
          planReasoningEffort: 'high',
          runReasoningEffort: 'medium'
        }
      }
    })
    const repo = {
      get: vi.fn(async () => current),
      update: vi.fn(async (_id: string, patch: Partial<Project>) => project({ ...current, ...patch }))
    }
    const service = new ProjectService(
      { requireActor: vi.fn(async () => ({ user: { organizationId: 'org-1' } })) } as any,
      repo as any,
      { get: vi.fn(async () => ({ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace', rootPath: '/tmp' })) } as any,
      { get: vi.fn(async () => ({ id: 'gateway-1', organizationId: 'org-1' })) } as any,
      {} as any,
      {} as any
    )

    const response = await service.update({ actorToken: 'token', id: 'project-1', gateway: { promptShape: 'TOON' as any } })

    expect(response.ok).toBe(true)
    expect(repo.update).toHaveBeenCalledWith('project-1', expect.objectContaining({
      metrics: expect.objectContaining({
        gateway: expect.objectContaining({
          gatewayId: 'gateway-1',
          runtimeWorkspaceId: 'workspace-1',
          planModel: 'gpt-plan',
          runModel: 'gpt-run',
          language: 'en',
          promptShape: 'toon',
          planReasoningEffort: 'high',
          runReasoningEffort: 'medium'
        })
      })
    }))
  })

  it('falls back invalid prompt shape values to Markdown', async () => {
    const repo = {
      get: vi.fn(async () => project()),
      update: vi.fn(async (_id: string, patch: Partial<Project>) => project(patch))
    }
    const service = new ProjectService(
      { requireActor: vi.fn(async () => ({ user: { organizationId: 'org-1' } })) } as any,
      repo as any,
      { get: vi.fn() } as any,
      { get: vi.fn() } as any,
      {} as any,
      {} as any
    )

    await service.update({ actorToken: 'token', id: 'project-1', gateway: { promptShape: 'yaml' as any } })

    expect(repo.update).toHaveBeenCalledWith('project-1', expect.objectContaining({
      metrics: expect.objectContaining({
        gateway: expect.objectContaining({ promptShape: 'markdown' })
      })
    }))
  })
})
