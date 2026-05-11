import EventEmitter from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import { PlanPipelineService } from './plan-pipeline.service.js'

function createService() {
  const auth = {
    requireActor: vi.fn().mockResolvedValue({
      user: {
        organizationId: 'org-1',
        name: 'Ada',
        email: 'ada@example.com'
      }
    })
  }
  const repo = {
    list: vi.fn().mockResolvedValue([]),
    createMany: vi.fn(async (inputs) => inputs.map((input: any, index: number) => ({
      id: `pipeline-${index + 1}`,
      ...input,
      createdAt: 1,
      updatedAt: 1
    }))),
    updateState: vi.fn()
  }
  const projectRepo = {
    list: vi.fn().mockResolvedValue([
      { id: 'project-1', organizationId: 'org-1', name: 'Project 1' }
    ])
  }
  const taskRepo = {
    list: vi.fn().mockResolvedValue([
      { id: 'task-1', projectId: 'project-1', title: 'Task 1' },
      { id: 'task-2', projectId: 'project-1', title: 'Task 2' }
    ])
  }

  const eventBus = new EventEmitter()
  return {
    service: new PlanPipelineService(auth as any, repo as any, projectRepo as any, taskRepo as any, eventBus),
    eventBus,
    repo
  }
}

describe('PlanPipelineService', () => {
  it('creates one persistent pipeline record for each non-empty group', async () => {
    const { service, repo } = createService()

    const response = await service.createFromGroups({
      actorToken: 'token',
      sourceDraftName: 'Release plan',
      projectIds: ['project-1'],
      runMode: 'questioned',
      groups: [
        { name: 'Hazırlık', taskIds: ['task-1'] },
        { name: 'Yayın', taskIds: ['task-2'] }
      ]
    })

    expect(response.ok).toBe(true)
    expect(repo.createMany).toHaveBeenCalledTimes(1)
    expect(repo.createMany.mock.calls[0][0]).toMatchObject([
      { sourceDraftName: 'Release plan', groupName: 'Hazırlık', groupOrder: 1, taskIds: ['task-1'] },
      { sourceDraftName: 'Release plan', groupName: 'Yayın', groupOrder: 2, taskIds: ['task-2'] }
    ])
  })

  it('rejects duplicate task assignment across groups before persistence', async () => {
    const { service, repo } = createService()

    const response = await service.createFromGroups({
      actorToken: 'token',
      sourceDraftName: 'Release plan',
      projectIds: ['project-1'],
      groups: [
        { name: 'Hazırlık', taskIds: ['task-1'] },
        { name: 'Yayın', taskIds: ['task-1'] }
      ]
    })

    expect(response.ok).toBe(false)
    expect(response.error?.message).toContain('Bir task yalnızca tek grupta yer alabilir')
    expect(repo.createMany).not.toHaveBeenCalled()
  })

  it('emits a plan pipeline update event after creating records', async () => {
    const { service, eventBus } = createService()
    const listener = vi.fn()
    eventBus.on(IPC_CHANNELS.events.planPipelineUpdated, listener)

    const response = await service.createFromGroups({
      actorToken: 'token',
      sourceDraftName: 'Release plan',
      projectIds: ['project-1'],
      groups: [{ name: 'Hazırlık', taskIds: ['task-1'] }]
    })

    expect(response.ok).toBe(true)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      recordIds: ['pipeline-1'],
      updatedAt: expect.any(Number)
    }))
  })
})
