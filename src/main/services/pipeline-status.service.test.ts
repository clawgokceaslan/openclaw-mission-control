import { describe, expect, it, vi } from 'vitest'
import { PipelineStatusService } from './run-pipeline.service.js'

function createService(options: { includePipelines?: boolean; includePlanPipelines?: boolean } = {}) {
  const includePipelines = options.includePipelines ?? true
  const includePlanPipelines = options.includePlanPipelines ?? true
  const auth = {
    requireActor: vi.fn().mockResolvedValue({ user: { organizationId: 'org-1' } })
  }
  const runBatch = { id: 'run-1', organizationId: 'org-1', name: 'Run', status: 'running', progress: 20, createdAt: 100, updatedAt: 200 }
  const runGraph = {
    batch: runBatch,
    stages: [],
    items: [{ id: 'item-1', batchId: 'run-1', stageId: 'stage-1', organizationId: 'org-1', taskId: 'task-1', projectId: 'project-1', status: 'running', progress: 40, createdAt: 100, updatedAt: 200 }]
  }
  const runRepo = {
    list: vi.fn().mockResolvedValue(includePipelines ? [runBatch] : []),
    listAll: vi.fn().mockResolvedValue(includePipelines ? [runBatch] : []),
    get: vi.fn().mockResolvedValue(includePipelines ? runGraph : undefined)
  }
  const planBatch = { id: 'plan-1', organizationId: 'org-1', name: 'Plan', status: 'running', createdAt: 100, updatedAt: 200 }
  const planRecord = { id: 'record-1', organizationId: 'org-1', batchId: 'plan-1', sourceDraftName: 'Plan', groupName: 'Stage', taskIds: ['task-1'], status: 'running', progress: 40, createdAt: 100, updatedAt: 200 }
  const planRepo = {
    listBatches: vi.fn().mockResolvedValue(includePlanPipelines ? [planBatch] : []),
    list: vi.fn().mockResolvedValue(includePlanPipelines ? [planRecord] : []),
    listAllBatches: vi.fn().mockResolvedValue(includePlanPipelines ? [planBatch] : []),
    listAll: vi.fn().mockResolvedValue(includePlanPipelines ? [planRecord] : [])
  }
  const projectRepo = {
    list: vi.fn().mockResolvedValue([{ id: 'project-1', organizationId: 'org-1', name: 'Project One' }]),
    listAll: vi.fn().mockResolvedValue([{ id: 'project-1', organizationId: 'org-1', name: 'Project One' }])
  }
  const taskRepo = {
    listAll: vi.fn().mockResolvedValue([
      { id: 'task-1', projectId: 'project-1', title: 'Task One', status: 'active', updatedAt: 123 },
      {
        id: 'task-2',
        projectId: 'project-1',
        title: 'Standalone Task',
        status: 'active',
        updatedAt: Date.now(),
        payload: {
          activityMessages: [
            {
              id: 'activity-1',
              runId: 'standalone-run-1',
              conversationId: 'standalone-run-1',
              source: 'gateway-chat',
              phase: 'FOLLOW UP',
              role: 'thinking',
              status: 'running',
              body: 'Codex is thinking...',
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        }
      }
    ])
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
    expect(response.data?.taskSummaries?.[0]).toEqual({
      id: 'task-1',
      title: 'Task One',
      status: 'active',
      projectId: 'project-1',
      projectName: 'Project One',
      updatedAt: 123
    })
  })

  it('includes summaries in the fixed public status snapshot', async () => {
    const { service } = createService()

    const response = await service.publicSnapshot({})

    expect(response.ok).toBe(true)
    expect(response.data?.scope).toBe('all')
    expect(response.data?.pipelines).toHaveLength(1)
    expect(response.data?.taskSummaries?.[0]).toMatchObject({ id: 'task-1', title: 'Task One', projectName: 'Project One' })
  })

  it('adds standalone task runs to the unified status list', async () => {
    const { service } = createService()

    const response = await service.snapshot({ actorToken: 'token' })

    expect(response.ok).toBe(true)
    expect(response.data?.statusItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'single-task',
        sourceId: 'standalone-run-1',
        taskId: 'task-2',
        title: 'Standalone Task',
        phase: 'follow-up',
        status: 'running'
      }),
      expect.objectContaining({ source: 'plan-pipeline', planBatchId: 'plan-1' }),
      expect.objectContaining({ source: 'run-pipeline', runPipelineId: 'run-1' })
    ]))
  })

  it('keeps standalone task runs visible in fixed public status without plan or run rows', async () => {
    const { service } = createService({ includePipelines: false, includePlanPipelines: false })

    const response = await service.publicSnapshot({})

    expect(response.ok).toBe(true)
    expect(response.data?.pipelines).toHaveLength(0)
    expect(response.data?.planBatches).toHaveLength(0)
    expect(response.data?.statusItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'single-task',
        sourceId: 'standalone-run-1',
        taskId: 'task-2',
        title: 'Standalone Task',
        phase: 'follow-up',
        status: 'running'
      })
    ]))
  })
})
