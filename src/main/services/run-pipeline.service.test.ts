import EventEmitter from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import type { RunPipelineGraph, RunPipelineItem } from '../../shared/types/entities.js'
import { RunPipelineService } from './run-pipeline.service.js'

function graph(overrides: Partial<RunPipelineGraph> = {}): RunPipelineGraph {
  const item: RunPipelineItem = {
    id: 'item-1',
    batchId: 'batch-1',
    stageId: 'stage-1',
    organizationId: 'org-1',
    taskId: 'task-1',
    projectId: 'project-1',
    itemOrder: 0,
    attempt: 1,
    taskGatewayRunId: 'run-1',
    status: 'running',
    progress: 10,
    createdAt: 1,
    updatedAt: 1
  }
  return {
    batch: {
      id: 'batch-1',
      organizationId: 'org-1',
      name: 'Run batch',
      status: 'running',
      progress: 10,
      currentStageId: 'stage-1',
      currentItemId: 'item-1',
      failurePolicy: 'stop_on_failure',
      projectIds: ['project-1'],
      createdAt: 1,
      updatedAt: 1
    },
    stages: [{
      id: 'stage-1',
      batchId: 'batch-1',
      organizationId: 'org-1',
      name: 'Stage',
      stageOrder: 0,
      status: 'running',
      progress: 10,
      createdAt: 1,
      updatedAt: 1
    }],
    items: [item],
    ...overrides
  }
}

function serviceWithRepo(repoOverrides: Record<string, unknown> = {}) {
  const eventBus = new EventEmitter()
  const repo = {
    get: vi.fn(async () => graph()),
    setBatchState: vi.fn(async () => undefined),
    setStageState: vi.fn(async () => undefined),
    setItemState: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    getByGatewayRunId: vi.fn(async () => null),
    ...repoOverrides
  }
  const tasks = {
    stopGatewayConversation: vi.fn(async () => ({ ok: true, data: { stopped: 1 } }))
  }
  const service = new RunPipelineService(
    { requireActor: vi.fn(async () => ({ user: { organizationId: 'org-1', name: 'Ada', email: 'ada@example.com' } })) } as never,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    tasks as never,
    eventBus
  )
  return { service, repo, tasks, eventBus }
}

describe('RunPipelineService pause/cancel gateway lifecycle', () => {
  it('stops the active task gateway run when pausing', async () => {
    const { service, repo, tasks } = serviceWithRepo()

    const result = await service.pause({ actorToken: 'token-1', id: 'batch-1' })

    expect(result.ok).toBe(true)
    expect(repo.setBatchState).toHaveBeenCalledWith('org-1', 'batch-1', { status: 'paused' })
    expect(repo.setItemState).toHaveBeenCalledWith('org-1', 'item-1', {
      status: 'queued',
      progress: 0,
      taskGatewayRunId: null,
      lastError: 'Paused by user',
      startedAt: null,
      completedAt: null
    })
    expect(tasks.stopGatewayConversation).toHaveBeenCalledWith({ actorToken: 'token-1', taskId: 'task-1', conversationId: 'run-1' })
  })

  it('stops the active task gateway run when cancelling', async () => {
    const { service, tasks } = serviceWithRepo()

    const result = await service.cancel({ actorToken: 'token-1', id: 'batch-1' })

    expect(result.ok).toBe(true)
    expect(tasks.stopGatewayConversation).toHaveBeenCalledWith({ actorToken: 'token-1', taskId: 'task-1', conversationId: 'run-1' })
  })

  it('ignores late task completion events while the batch is paused', async () => {
    const pausedGraph = graph({ batch: { ...graph().batch, status: 'paused' } })
    const { repo, eventBus } = serviceWithRepo({
      getByGatewayRunId: vi.fn(async () => pausedGraph.items[0]),
      get: vi.fn(async () => pausedGraph)
    })

    eventBus.emit(IPC_CHANNELS.events.taskActivity, { message: { runId: 'run-1', status: 'completed' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(repo.setItemState).not.toHaveBeenCalled()
  })
})
