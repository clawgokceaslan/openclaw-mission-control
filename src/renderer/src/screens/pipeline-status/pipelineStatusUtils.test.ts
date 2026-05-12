import { describe, expect, it } from 'vitest'
import type { PipelineStatusSnapshot } from '@shared/types/entities'
import { changedKeys, pipelineStatusEventText } from './pipelineStatusUtils'

function snapshot(overrides: Partial<PipelineStatusSnapshot>): PipelineStatusSnapshot {
  return {
    generatedAt: 1,
    scope: 'all',
    planBatches: [],
    planRecords: [],
    pipelines: [],
    statusItems: [],
    taskSummaries: [],
    activeTasks: [],
    projectSummaries: [],
    ...overrides
  }
}

describe('pipelineStatusUtils', () => {
  it('marks added, removed, and changed task rows', () => {
    const before = snapshot({
      taskSummaries: [
        { id: 'task-1', title: 'Old', status: 'todo', projectId: 'project-1', updatedAt: 1 },
        { id: 'task-2', title: 'Removed', status: 'todo', projectId: 'project-1', updatedAt: 1 }
      ]
    })
    const after = snapshot({
      taskSummaries: [
        { id: 'task-1', title: 'New', status: 'todo', projectId: 'project-1', updatedAt: 2 },
        { id: 'task-3', title: 'Added', status: 'todo', projectId: 'project-1', updatedAt: 1 }
      ]
    })

    expect(changedKeys(before, after)).toEqual(new Set(['task:task-1', 'task:task-3', 'task:task-2']))
  })

  it('marks standalone active task rows', () => {
    const after = snapshot({
      activeTasks: [
        {
          id: 'task-1',
          title: 'Running',
          status: 'active',
          projectId: 'project-1',
          updatedAt: 1,
          activityPhase: 'run',
          activityStatus: 'running',
          lastActivityAt: 2
        }
      ]
    })

    expect(changedKeys(null, after)).toContain('active-task:task-1')
  })

  it('marks unified status rows', () => {
    const after = snapshot({
      statusItems: [
        {
          id: 'task:task-1:run-1',
          source: 'single-task',
          sourceId: 'run-1',
          title: 'Run task',
          phase: 'run',
          status: 'running',
          updatedAt: 2,
          taskId: 'task-1'
        }
      ]
    })

    expect(changedKeys(null, after)).toContain('status-item:task:task-1:run-1')
  })

  it('formats normalized pipeline status events', () => {
    expect(pipelineStatusEventText({ reason: 'task_updated', action: 'status_changed' })).toEqual({
      label: 'Task update',
      detail: 'Task status changed'
    })
    expect(pipelineStatusEventText({ reason: 'task_activity', phase: 'post-running', action: 'running' })).toEqual({
      label: 'Task activity',
      detail: 'Post-run running'
    })
    expect(pipelineStatusEventText({ reason: 'run_pipeline' })).toEqual({
      label: 'Run pipeline',
      detail: 'Execution status changed'
    })
  })
})
