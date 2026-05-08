import { describe, expect, it, vi } from 'vitest'
import { TaskGroupService } from './task-group.service.js'
import type { Project, TaskGroup } from '../../shared/types/entities.js'

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

function taskGroup(overrides: Partial<TaskGroup> = {}): TaskGroup {
  return {
    id: 'group-1',
    groupId: 'group-1',
    projectId: 'project-1',
    title: 'Release plan',
    orderedTaskIds: [],
    activeTaskId: null,
    groupContextMdPath: '',
    contractedContext: '',
    planningQueueState: { state: 'not_configured' },
    executionQueueState: { state: 'not_configured' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('TaskGroupService', () => {
  it('creates an empty task group scoped to a project with default contract fields', async () => {
    const repo = {
      create: vi.fn(async (input: { projectId: string; title: string }) => taskGroup(input))
    }
    const service = new TaskGroupService(
      { requireActor: vi.fn(async () => ({ user: { organizationId: 'org-1' } })) } as any,
      repo as any,
      { get: vi.fn(async () => project()) } as any,
      { get: vi.fn() } as any
    )

    const response = await service.create({ actorToken: 'token', projectId: 'project-1', title: '  Release plan  ' })

    expect(response.ok).toBe(true)
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', title: 'Release plan' }))
    expect(response.data).toEqual(expect.objectContaining({
      projectId: 'project-1',
      groupId: 'group-1',
      title: 'Release plan',
      orderedTaskIds: [],
      activeTaskId: null,
      groupContextMdPath: expect.any(String),
      contractedContext: expect.stringContaining('projectId: project-1'),
      planningQueueState: expect.objectContaining({ state: 'idle' }),
      executionQueueState: expect.objectContaining({ state: 'idle' })
    }))
  })

  it('rejects creation when the project belongs to another organization', async () => {
    const repo = {
      create: vi.fn()
    }
    const service = new TaskGroupService(
      { requireActor: vi.fn(async () => ({ user: { organizationId: 'org-1' } })) } as any,
      repo as any,
      { get: vi.fn(async () => project({ organizationId: 'org-2' })) } as any,
      { get: vi.fn() } as any
    )

    const response = await service.create({ actorToken: 'token', projectId: 'project-2', title: 'Release plan' })

    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe('ERR_FORBIDDEN')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('lists only task groups for the requested project after access validation', async () => {
    const repo = {
      listByProject: vi.fn(async (projectId: string) => [taskGroup({ projectId })])
    }
    const service = new TaskGroupService(
      { requireActor: vi.fn(async () => ({ user: { organizationId: 'org-1' } })) } as any,
      repo as any,
      { get: vi.fn(async () => project()) } as any,
      { get: vi.fn() } as any
    )

    const response = await service.list({ actorToken: 'token', projectId: 'project-1' })

    expect(response.ok).toBe(true)
    expect(repo.listByProject).toHaveBeenCalledWith('project-1')
    expect(response.data?.[0]?.projectId).toBe('project-1')
  })
})
