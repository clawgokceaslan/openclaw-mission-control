import { describe, expect, it, vi } from 'vitest'
import { PipelineStatusService } from './run-pipeline.service.js'

function createService() {
  const auth = {
    requireActor: vi.fn().mockResolvedValue({ user: { organizationId: 'org-1' } })
  }
  const runBatch = { id: 'run-1', organizationId: 'org-1', name: 'Run', status: 'running', progress: 20 }
  const runGraph = {
    batch: runBatch,
    stages: [],
    items: [{ id: 'item-1', batchId: 'run-1', stageId: 'stage-1', organizationId: 'org-1', taskId: 'task-1', projectId: 'project-1', status: 'running', progress: 40 }]
  }
  const runRepo = {
    list: vi.fn().mockResolvedValue([runBatch]),
    listAll: vi.fn().mockResolvedValue([runBatch]),
    get: vi.fn().mockResolvedValue(runGraph)
  }
  const planRepo = {
    listBatches: vi.fn().mockResolvedValue([{ id: 'plan-1', organizationId: 'org-1', name: 'Plan', status: 'running' }]),
    list: vi.fn().mockResolvedValue([{ id: 'record-1', organizationId: 'org-1', batchId: 'plan-1', groupName: 'Stage', taskIds: ['task-1'], status: 'running', progress: 40 }]),
    listAllBatches: vi.fn().mockResolvedValue([{ id: 'plan-1', organizationId: 'org-1', name: 'Plan', status: 'running' }]),
    listAll: vi.fn().mockResolvedValue([{ id: 'record-1', organizationId: 'org-1', batchId: 'plan-1', groupName: 'Stage', taskIds: ['task-1'], status: 'running', progress: 40 }])
  }
  const projectRepo = {
    list: vi.fn().mockResolvedValue([{ id: 'project-1', organizationId: 'org-1', name: 'Project One' }])
  }
  const taskRepo = {
    listAll: vi.fn().mockResolvedValue([{ id: 'task-1', projectId: 'project-1', title: 'Task One', status: 'active', updatedAt: 123 }])
  }
  return {
    service: new PipelineStatusService(auth as any, runRepo as any, planRepo as any, projectRepo as any, taskRepo as any),
    runRepo
  }
}

describe('PipelineStatusService', () => {
  it('includes read-only task and project summaries in authenticated snapshots', async () => {
    const { service } = createService()

    const response = await service.snapshot({ actorToken: 'token' })

    expect(response.ok).toBe(true)
    expect(response.data?.projectSummaries).toEqual([{ id: 'project-1', name: 'Project One' }])
    expect(response.data?.taskSummaries).toEqual([{
      id: 'task-1',
      title: 'Task One',
      status: 'active',
      projectId: 'project-1',
      projectName: 'Project One',
      updatedAt: 123
    }])
  })

  it('includes summaries in the fixed public status snapshot', async () => {
    const { service } = createService()

    const response = await service.publicSnapshot({})

    expect(response.ok).toBe(true)
    expect(response.data?.scope).toBe('all')
    expect(response.data?.pipelines).toHaveLength(1)
    expect(response.data?.taskSummaries?.[0]).toMatchObject({ id: 'task-1', title: 'Task One', projectName: 'Project One' })
  })
})
