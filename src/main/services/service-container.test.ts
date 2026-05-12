import EventEmitter from 'node:events'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import type { PipelineStatusUpdateEvent } from '../../shared/types/entities.js'
import { registerPipelineStatusEventBridge } from './service-container.js'

describe('registerPipelineStatusEventBridge', () => {
  it('normalizes task update and activity events for pipeline status listeners', () => {
    const eventBus = new EventEmitter()
    const events: PipelineStatusUpdateEvent[] = []
    registerPipelineStatusEventBridge(eventBus)
    eventBus.on(IPC_CHANNELS.events.pipelineStatusUpdated, (payload) => events.push(payload as PipelineStatusUpdateEvent))

    eventBus.emit(IPC_CHANNELS.events.taskUpdated, { projectId: 'project-1', taskId: 'task-1', action: 'status_changed', updatedAt: 10 })
    eventBus.emit(IPC_CHANNELS.events.taskActivity, {
      projectId: 'project-1',
      taskId: 'task-1',
      updatedAt: 11,
      message: { runId: 'run-1', conversationId: 'conversation-1', phase: 'POST-RUNNING', status: 'running' }
    })

    expect(events).toEqual([
      {
        reason: 'task_updated',
        source: 'task',
        projectId: 'project-1',
        taskId: 'task-1',
        action: 'status_changed',
        updatedAt: 10
      },
      {
        reason: 'task_activity',
        source: 'task-activity',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        runItemId: undefined,
        phase: 'post-running',
        action: 'running',
        status: 'running',
        progressText: undefined,
        error: undefined,
        updatedAt: 11
      }
    ])
  })
})
