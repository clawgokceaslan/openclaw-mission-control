import { describe, expect, it } from 'vitest'
import type { Agent, TaskEntity } from '@shared/types/entities'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { buildProjectAnalyticsModel } from './analytics'

const statuses: ProjectStatusColumn[] = [
  { key: 'todo', title: 'Todo', status: 'todo', accent: '#8a99b4', category: 'not_started' },
  { key: 'doing', title: 'Doing', status: 'doing', accent: '#2f80ed', category: 'active' },
  { key: 'review', title: 'Review', status: 'review', accent: '#8b5cf6', category: 'active' },
  { key: 'done', title: 'Done', status: 'done', accent: '#29b764', category: 'done' }
]

const agents: Agent[] = [
  {
    id: 'agent-1',
    organizationId: 'org',
    name: 'Codex',
    status: 'idle',
    heartbeatAt: 0,
    createdAt: 0,
    updatedAt: 0
  }
]

function task(partial: Partial<TaskEntity>): TaskEntity {
  return {
    id: partial.id ?? 'task',
    projectId: 'project',
    title: partial.title ?? 'Task',
    status: partial.status ?? 'todo',
    createdAt: partial.createdAt ?? 0,
    updatedAt: partial.updatedAt ?? 0,
    ...partial
  }
}

describe('buildProjectAnalyticsModel', () => {
  it('returns stable empty analytics for projects without tasks', () => {
    const model = buildProjectAnalyticsModel([], statuses, agents, Date.UTC(2026, 0, 15))

    expect(model.totalTasks).toBe(0)
    expect(model.completionRate).toBe(0)
    expect(model.statusBuckets).toEqual([])
    expect(model.timeline).toHaveLength(14)
  })

  it('counts status, completion, workload, tags, and review signals', () => {
    const now = Date.UTC(2026, 0, 15)
    const model = buildProjectAnalyticsModel([
      task({ id: 'a', status: 'done', agentId: 'agent-1', tags: [{ id: 'analytics', name: 'analytics', color: '#2f80ed', organizationId: 'org', createdAt: 0, updatedAt: 0 }], updatedAt: now }),
      task({ id: 'b', status: 'review', updatedAt: now }),
      task({ id: 'c', status: 'doing', updatedAt: Date.UTC(2026, 0, 1) })
    ], statuses, agents, now)

    expect(model.totalTasks).toBe(3)
    expect(model.completedTasks).toBe(1)
    expect(model.completionRate).toBe(33.3)
    expect(model.reviewTasks).toBe(1)
    expect(model.staleTasks).toBe(1)
    expect(model.agentBuckets[0]).toMatchObject({ label: 'Unassigned', count: 2 })
    expect(model.tagBuckets[0]).toMatchObject({ label: 'analytics', count: 1 })
  })

  it('classifies subtask due date risk', () => {
    const now = Date.UTC(2026, 0, 15)
    const model = buildProjectAnalyticsModel([
      task({
        id: 'a',
        status: 'doing',
        subtasks: [
          { id: 's1', taskId: 'a', title: 'Late', status: 'doing', sortOrder: 0, dueAt: Date.UTC(2026, 0, 10), createdAt: now, updatedAt: now },
          { id: 's2', taskId: 'a', title: 'Done', status: 'done', sortOrder: 1, dueAt: Date.UTC(2026, 0, 10), createdAt: now, updatedAt: now },
          { id: 's3', taskId: 'a', title: 'Soon', status: 'todo', sortOrder: 2, dueAt: Date.UTC(2026, 0, 18), createdAt: now, updatedAt: now }
        ]
      })
    ], statuses, agents, now)

    expect(model.totalSubtasks).toBe(3)
    expect(model.completedSubtasks).toBe(1)
    expect(model.dueBuckets.find((row) => row.key === 'overdue')?.count).toBe(1)
    expect(model.dueBuckets.find((row) => row.key === 'next_7')?.count).toBe(2)
  })
})
