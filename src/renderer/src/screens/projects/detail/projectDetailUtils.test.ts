import { describe, expect, it } from 'vitest'
import type { TaskEntity } from '@shared/types/entities'
import type { ProjectStatusColumn } from './status'
import { orderTasksByStatusGroups, reorderTasksForDrop, taskCodexActionChips, taskCodexPlanBadge } from './projectDetailUtils'

function task(id: string, status: string, order: number): TaskEntity {
  return {
    id,
    projectId: 'project-1',
    title: id,
    status,
    payload: { statusOrder: { [status]: order } },
    createdAt: 1_700_000_000_000 + order,
    updatedAt: 1_700_000_000_000 + order
  }
}

const columns: ProjectStatusColumn[] = [
  { key: 'todo', title: 'Todo', status: 'todo', accent: '#999999', category: 'not_started' },
  { key: 'doing', title: 'Doing', status: 'doing', accent: '#3366ff', category: 'active' },
  { key: 'done', title: 'Done', status: 'done', accent: '#22aa66', category: 'done' }
]

describe('project task ordering', () => {
  it('reorders inside a status group before a target task', () => {
    const source = [task('a', 'todo', 0), task('b', 'todo', 1), task('c', 'todo', 2)]
    const result = reorderTasksForDrop(source, 'c', 'todo', 'a', 'before')
    const ordered = orderTasksByStatusGroups(result.tasks, columns)

    expect(ordered.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(result.updates.map((update) => [update.task.id, update.status, update.order])).toEqual([
      ['c', 'todo', 0],
      ['a', 'todo', 1],
      ['b', 'todo', 2]
    ])
  })

  it('moves across statuses after a target task and reindexes affected groups', () => {
    const source = [
      task('a', 'todo', 0),
      task('b', 'todo', 1),
      task('c', 'doing', 0),
      task('d', 'doing', 1)
    ]
    const result = reorderTasksForDrop(source, 'b', 'doing', 'c', 'after')
    const byId = new Map(result.tasks.map((item) => [item.id, item]))
    const ordered = orderTasksByStatusGroups(result.tasks, columns)

    expect(byId.get('b')?.status).toBe('doing')
    expect(ordered.map((item) => item.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(result.updates.map((update) => [update.task.id, update.status, update.order])).toEqual([
      ['c', 'doing', 0],
      ['b', 'doing', 1],
      ['d', 'doing', 2],
      ['a', 'todo', 0]
    ])
  })

  it('orders table rows by status group before per-group order', () => {
    const source = [
      task('done-0', 'done', 0),
      task('todo-1', 'todo', 1),
      task('doing-0', 'doing', 0),
      task('todo-0', 'todo', 0)
    ]

    expect(orderTasksByStatusGroups(source, columns).map((item) => item.id)).toEqual([
      'todo-0',
      'todo-1',
      'doing-0',
      'done-0'
    ])
  })
})

describe('task Codex card metadata', () => {
  it('derives planned and needs-info labels from task payload metadata', () => {
    expect(taskCodexPlanBadge({
      ...task('planned', 'todo', 0),
      payload: { codexPlanState: { state: 'planned', conversationId: 'plan-1' } }
    })).toEqual({ state: 'planned', label: 'Planned', conversationId: 'plan-1' })

    expect(taskCodexPlanBadge({
      ...task('needs-info', 'todo', 0),
      payload: { codexPlanState: { state: 'needs-clarification', conversationId: 'plan-2' } }
    })).toEqual({ state: 'needs-clarification', label: 'Needs info', conversationId: 'plan-2' })
  })

  it('returns latest Plan and Run action chips by source', () => {
    const result = taskCodexActionChips({
      ...task('with-actions', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'p-old', runId: 'run-old', conversationId: 'plan-old', source: 'codex-plan', role: 'system', status: 'completed', body: 'old', createdAt: 1, updatedAt: 1 },
          { id: 'r-new', runId: 'run-new', conversationId: 'run-new', source: 'codex-run', role: 'system', status: 'running', body: 'run', createdAt: 2, updatedAt: 2 },
          { id: 'p-new', runId: 'plan-run', conversationId: 'plan-new', source: 'codex-plan', role: 'system', status: 'completed', body: 'plan', createdAt: 3, updatedAt: 3 }
        ]
      }
    })

    expect(result.map((chip) => [chip.label, chip.conversationId, chip.status])).toEqual([
      ['Plan', 'plan-new', 'completed'],
      ['Run', 'run-new', 'running']
    ])
  })
})
