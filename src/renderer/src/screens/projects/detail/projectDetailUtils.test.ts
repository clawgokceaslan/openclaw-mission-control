import { describe, expect, it } from 'vitest'
import type { TaskEntity } from '@shared/types/entities'
import { latestTaskGatewayConversation, nextStatusTopOrder, orderedTasksForStatus, projectGatewaySettings, reorderTasksForDrop, taskGatewayActionChips, taskGatewayActiveTone, taskGatewayLatestSurfaceStatus, taskGatewayPlanBadge, taskGatewaySurfaceStatuses } from './projectDetailUtils'

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

describe('project task ordering', () => {
  it('reorders inside a status group before a target task', () => {
    const source = [task('a', 'todo', 0), task('b', 'todo', 1), task('c', 'todo', 2)]
    const result = reorderTasksForDrop(source, 'c', 'todo', 'a', 'before')

    expect(result.updates.map((update) => [update.task.id, update.status, update.order])).toEqual([
      ['c', 'todo', 0],
      ['a', 'todo', 1],
      ['b', 'todo', 2]
    ])
  })

  it('moves across statuses to the top and reindexes affected groups', () => {
    const source = [
      task('a', 'todo', 0),
      task('b', 'todo', 1),
      task('c', 'doing', 0),
      task('d', 'doing', 1)
    ]
    const result = reorderTasksForDrop(source, 'b', 'doing', 'c', 'after')
    const byId = new Map(result.tasks.map((item) => [item.id, item]))

    expect(byId.get('b')?.status).toBe('doing')
    expect(result.updates.map((update) => [update.task.id, update.status, update.order])).toEqual([
      ['b', 'doing', 0],
      ['c', 'doing', 1],
      ['d', 'doing', 2],
      ['a', 'todo', 0]
    ])
  })

  it('orders newest rows first when no manual status order exists', () => {
    const older = { ...task('older', 'todo', 0), payload: {}, createdAt: 10, updatedAt: 10 }
    const newer = { ...task('newer', 'todo', 1), payload: {}, createdAt: 20, updatedAt: 20 }

    expect(orderedTasksForStatus([older, newer]).map((item) => item.id)).toEqual(['newer', 'older'])
  })

  it('generates a top order before the current first task', () => {
    expect(nextStatusTopOrder([task('a', 'todo', 0), task('b', 'todo', 1)], 'todo')).toBe(-1)
    expect(nextStatusTopOrder([], 'todo')).toBe(0)
  })
})

describe('project Codex settings', () => {
  it('defaults missing and invalid prompt shape values to Markdown', () => {
    expect(projectGatewaySettings(null).promptShape).toBe('markdown')
    expect(projectGatewaySettings({
      id: 'project-1',
      organizationId: 'org-1',
      name: 'Project',
      archived: false,
      metrics: { gateway: { promptShape: 'xml' } },
      createdAt: 1,
      updatedAt: 1
    }).promptShape).toBe('markdown')
  })

  it('reads saved prompt shape values', () => {
    expect(projectGatewaySettings({
      id: 'project-1',
      organizationId: 'org-1',
      name: 'Project',
      archived: false,
      metrics: { gateway: { promptShape: 'toon' } },
      createdAt: 1,
      updatedAt: 1
    }).promptShape).toBe('toon')
  })
})

describe('task Codex card metadata', () => {
  it('derives planned and needs-info labels from task payload metadata', () => {
    expect(taskGatewayPlanBadge({
      ...task('planned', 'todo', 0),
      payload: { gatewayPlanState: { state: 'planned', conversationId: 'plan-1' } }
    })).toEqual({ state: 'planned', label: 'Planned', conversationId: 'plan-1' })

    expect(taskGatewayPlanBadge({
      ...task('needs-info', 'todo', 0),
      payload: { gatewayPlanState: { state: 'needs-clarification', conversationId: 'plan-2' } }
    })).toEqual({ state: 'needs-clarification', label: 'Needs Input', conversationId: 'plan-2' })
  })

  it('shows not planned when no plan metadata or plan conversation exists', () => {
    expect(taskGatewaySurfaceStatuses(task('no-plan', 'todo', 0)).map((status) => [status.label, status.tone, status.active])).toEqual([
      ['Not Planned', 'neutral', undefined]
    ])
    expect(taskGatewayActiveTone(task('no-plan', 'todo', 0))).toBeNull()
    expect(taskGatewayLatestSurfaceStatus(task('no-plan', 'todo', 0))).toBeNull()
  })

  it('builds card surface statuses for planned, running, post-running and follow-up states', () => {
    const now = 10_000
    const result = taskGatewaySurfaceStatuses({
      ...task('with-surface-statuses', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'plan-1' },
        activityMessages: [
          { id: 'run', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'system', status: 'running', body: 'run', createdAt: 9_000, updatedAt: 9_500 },
          { id: 'chat', runId: 'chat-1', conversationId: 'chat-1', source: 'gateway-chat', role: 'assistant', status: 'completed', body: 'chat', createdAt: 7_000, updatedAt: 7_500 }
        ]
      }
    }, now)

    expect(result.map((status) => [status.label, status.tone, status.active, status.iconOnly])).toEqual([
      ['Planned', 'planned', undefined, true],
      ['Working', 'working', true, undefined],
      ['Followed Up', 'completed', undefined, undefined]
    ])
    expect(taskGatewayActiveTone({
      ...task('active-run', 'todo', 0),
      payload: { activityMessages: [{ id: 'run', runId: 'run-1', source: 'gateway-run', role: 'system', status: 'running', body: 'run', createdAt: 9_500 }] }
    }, now)).toBe('working')
  })

  it('returns the latest chat lifecycle status for kanban cards without task status fallback', () => {
    const now = 10_000
    const result = taskGatewayLatestSurfaceStatus({
      ...task('kanban-chat-status', 'done', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'plan-1' },
        activityMessages: [
          { id: 'plan', runId: 'plan-1', conversationId: 'plan-1', source: 'gateway-plan', role: 'system', status: 'completed', body: 'planned', createdAt: 8_000, updatedAt: 8_100, metadata: { gatewayBlock: 'run-complete' } },
          { id: 'run', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'thinking', status: 'running', body: 'working', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    }, now)

    expect(result).toMatchObject({ statusKey: 'working', label: 'Working', tone: 'working', active: true })
  })

  it('uses completed status labels for finished run, post-run and follow-up phases', () => {
    const result = taskGatewaySurfaceStatuses({
      ...task('completed-phases', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'plan-1' },
        activityMessages: [
          { id: 'run', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'system', phase: 'RUN', status: 'completed', body: 'run', createdAt: 1, updatedAt: 1 },
          { id: 'post', runId: 'post-1', conversationId: 'post-1', source: 'gateway-run', role: 'system', phase: 'POST-RUNNING', status: 'completed', body: 'post', createdAt: 2, updatedAt: 2 },
          { id: 'follow', runId: 'follow-1', conversationId: 'follow-1', source: 'gateway-chat', role: 'assistant', phase: 'FOLLOW UP', status: 'completed', body: 'follow', createdAt: 3, updatedAt: 3 }
        ]
      }
    }, 10_000)

    expect(result.map((status) => [status.statusKey, status.label, status.tone])).toEqual([
      ['planned', 'Planned', 'planned'],
      ['work-completed', 'Work Completed', 'completed'],
      ['post-run-completed', 'Post Run Completed', 'completed'],
      ['followed-up', 'Followed Up', 'completed']
    ])
  })

  it('does not mark completed chats as active for card border animation', () => {
    const now = 10_000
    const completedTask = {
      ...task('completed-chats', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'needs-clarification', conversationId: 'plan-1' },
        activityMessages: [
          { id: 'plan', runId: 'plan-1', conversationId: 'plan-1', source: 'gateway-plan', role: 'system', status: 'completed', body: 'plan', createdAt: 7_000, updatedAt: 7_500 },
          { id: 'run', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'system', status: 'completed', body: 'run', createdAt: 8_000, updatedAt: 8_500 },
          { id: 'chat', runId: 'chat-1', conversationId: 'chat-1', source: 'gateway-chat', role: 'assistant', status: 'completed', body: 'chat', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    } satisfies TaskEntity

    expect(taskGatewaySurfaceStatuses(completedTask, now).some((status) => status.active)).toBe(false)
    expect(taskGatewayActiveTone(completedTask, now)).toBeNull()
  })

  it('keeps task card animation active while replanning an already planned task', () => {
    const now = 10_000
    const result = taskGatewaySurfaceStatuses({
      ...task('replanning', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'old-plan' },
        activityMessages: [
          { id: 'plan-active', runId: 'plan-active', conversationId: 'plan-active', source: 'gateway-plan', role: 'thinking', status: 'running', body: 'planning', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    }, now)

    expect(result[0]).toMatchObject({ label: 'Planning', tone: 'planning', active: true, conversationId: 'plan-active' })
    expect(taskGatewayActiveTone({
      ...task('replanning', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'old-plan' },
        activityMessages: [
          { id: 'plan-active', runId: 'plan-active', conversationId: 'plan-active', source: 'gateway-plan', role: 'thinking', status: 'running', body: 'planning', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    }, now)).toBe('planning')
  })

  it('moves Planning to Planned when a terminal plan message is newer than the active message', () => {
    const now = 10_000
    const planTransitionTask = {
      ...task('plan-transition', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'plan-1' },
        activityMessages: [
          { id: 'plan-running', runId: 'plan-1', conversationId: 'plan-1', source: 'gateway-plan', role: 'thinking', status: 'running', body: 'planning', createdAt: 9_000, updatedAt: 9_500 },
          { id: 'plan-complete', runId: 'plan-1', conversationId: 'plan-1', source: 'gateway-plan', role: 'system', status: 'completed', body: 'planned', createdAt: 9_600, updatedAt: 9_600, metadata: { gatewayBlock: 'run-complete' } }
        ]
      }
    } satisfies TaskEntity

    expect(taskGatewaySurfaceStatuses(planTransitionTask, now).map((status) => [status.statusKey, status.label, status.active])).toEqual([
      ['planned', 'Planned', undefined]
    ])
    expect(taskGatewayActiveTone(planTransitionTask, now)).toBeNull()
  })

  it('keeps Planning active when a new replanning message is newer than the previous terminal message', () => {
    const now = 10_000
    const result = taskGatewaySurfaceStatuses({
      ...task('plan-restarted', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'old-plan' },
        activityMessages: [
          { id: 'old-complete', runId: 'old-plan', conversationId: 'old-plan', source: 'gateway-plan', role: 'system', status: 'completed', body: 'planned', createdAt: 8_500, updatedAt: 8_500, metadata: { gatewayBlock: 'run-complete' } },
          { id: 'new-running', runId: 'new-plan', conversationId: 'new-plan', source: 'gateway-plan', role: 'thinking', status: 'running', body: 'planning again', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    }, now)

    expect(result[0]).toMatchObject({ statusKey: 'planning', label: 'Planning', active: true, conversationId: 'new-plan' })
    expect(taskGatewayActiveTone({
      ...task('plan-restarted', 'todo', 0),
      payload: {
        gatewayPlanState: { state: 'planned', conversationId: 'old-plan' },
        activityMessages: [
          { id: 'old-complete', runId: 'old-plan', conversationId: 'old-plan', source: 'gateway-plan', role: 'system', status: 'completed', body: 'planned', createdAt: 8_500, updatedAt: 8_500, metadata: { gatewayBlock: 'run-complete' } },
          { id: 'new-running', runId: 'new-plan', conversationId: 'new-plan', source: 'gateway-plan', role: 'thinking', status: 'running', body: 'planning again', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    }, now)).toBe('planning')
  })

  it('moves active run, post-run and follow-up statuses to completed when terminal messages are newer', () => {
    const now = 10_000
    const result = taskGatewaySurfaceStatuses({
      ...task('phase-transitions', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'run-active', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'thinking', phase: 'RUN', status: 'running', body: 'working', createdAt: 9_000, updatedAt: 9_100 },
          { id: 'run-done', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'system', phase: 'RUN', status: 'completed', body: 'done', createdAt: 9_200, updatedAt: 9_200, metadata: { gatewayBlock: 'run-complete' } },
          { id: 'post-active', runId: 'post-1', conversationId: 'post-1', source: 'gateway-run', role: 'thinking', phase: 'POST-RUNNING', status: 'running', body: 'post', createdAt: 9_300, updatedAt: 9_400 },
          { id: 'post-done', runId: 'post-1', conversationId: 'post-1', source: 'gateway-run', role: 'system', phase: 'POST-RUNNING', status: 'completed', body: 'post done', createdAt: 9_500, updatedAt: 9_500, metadata: { gatewayBlock: 'run-complete' } },
          { id: 'follow-active', runId: 'follow-1', conversationId: 'follow-1', source: 'gateway-chat', role: 'thinking', phase: 'FOLLOW UP', status: 'running', body: 'follow', createdAt: 9_600, updatedAt: 9_700 },
          { id: 'follow-done', runId: 'follow-1', conversationId: 'follow-1', source: 'gateway-chat', role: 'system', phase: 'FOLLOW UP', status: 'completed', body: 'follow done', createdAt: 9_800, updatedAt: 9_800, metadata: { gatewayBlock: 'run-complete' } }
        ]
      }
    }, now)

    expect(result.map((status) => [status.statusKey, status.label, status.active])).toEqual([
      ['not-planned', 'Not Planned', undefined],
      ['work-completed', 'Work Completed', undefined],
      ['post-run-completed', 'Post Run Completed', undefined],
      ['followed-up', 'Followed Up', undefined]
    ])
    expect(taskGatewayActiveTone({
      ...task('phase-transitions', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'run-active', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'thinking', phase: 'RUN', status: 'running', body: 'working', createdAt: 9_000, updatedAt: 9_100 },
          { id: 'run-done', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'system', phase: 'RUN', status: 'completed', body: 'done', createdAt: 9_200, updatedAt: 9_200, metadata: { gatewayBlock: 'run-complete' } },
          { id: 'post-active', runId: 'post-1', conversationId: 'post-1', source: 'gateway-run', role: 'thinking', phase: 'POST-RUNNING', status: 'running', body: 'post', createdAt: 9_300, updatedAt: 9_400 },
          { id: 'post-done', runId: 'post-1', conversationId: 'post-1', source: 'gateway-run', role: 'system', phase: 'POST-RUNNING', status: 'completed', body: 'post done', createdAt: 9_500, updatedAt: 9_500, metadata: { gatewayBlock: 'run-complete' } },
          { id: 'follow-active', runId: 'follow-1', conversationId: 'follow-1', source: 'gateway-chat', role: 'thinking', phase: 'FOLLOW UP', status: 'running', body: 'follow', createdAt: 9_600, updatedAt: 9_700 },
          { id: 'follow-done', runId: 'follow-1', conversationId: 'follow-1', source: 'gateway-chat', role: 'system', phase: 'FOLLOW UP', status: 'completed', body: 'follow done', createdAt: 9_800, updatedAt: 9_800, metadata: { gatewayBlock: 'run-complete' } }
        ]
      }
    }, now)).toBeNull()
  })

  it('prefers active follow-up messages when a completed user message has the same timestamp', () => {
    const now = 10_000
    const activeTask = {
      ...task('follow-up-running', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'chat-user', runId: 'chat-1', conversationId: 'chat-1', source: 'gateway-chat', role: 'user', status: 'completed', body: 'follow up', createdAt: 9_000, updatedAt: 9_500 },
          { id: 'chat-thinking', runId: 'chat-1', conversationId: 'chat-1', source: 'gateway-chat', role: 'thinking', status: 'running', body: 'thinking', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    } satisfies TaskEntity

    expect(taskGatewaySurfaceStatuses(activeTask, now).find((status) => status.statusKey === 'following-up')).toMatchObject({
      label: 'Following Up',
      tone: 'following-up',
      active: true
    })
    expect(taskGatewayActiveTone(activeTask, now)).toBe('following-up')
  })

  it('shows failed status without enabling active card borders', () => {
    const failedTask = {
      ...task('failed-run', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'run-active', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'thinking', phase: 'RUN', status: 'running', body: 'working', createdAt: 9_000, updatedAt: 9_100 },
          { id: 'run-failed', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'error', phase: 'RUN', status: 'failed', body: 'failed', createdAt: 9_000, updatedAt: 9_500 }
        ]
      }
    } satisfies TaskEntity

    expect(taskGatewaySurfaceStatuses(failedTask, 10_000).map((status) => [status.statusKey, status.label, status.active])).toEqual([
      ['not-planned', 'Not Planned', undefined],
      ['failed', 'Running Failed', undefined]
    ])
    expect(taskGatewayActiveTone(failedTask, 10_000)).toBeNull()
  })

  it('does not show legacy command failures as failed task card badges', () => {
    const commandFailedTask = {
      ...task('legacy-command-failed', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'run-active', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'thinking', phase: 'RUN', status: 'running', body: 'working', createdAt: 9_000, updatedAt: 9_100, metadata: { codexBlock: 'thinking', runStatus: 'running' } },
          { id: 'command-failed', runId: 'run-1', conversationId: 'run-1', source: 'gateway-run', role: 'tool', phase: 'RUN', status: 'failed', body: 'command failed', createdAt: 9_000, updatedAt: 9_500, metadata: { codexBlock: 'command', command: 'npm test', runStatus: 'running' } }
        ]
      }
    } satisfies TaskEntity

    expect(taskGatewayLatestSurfaceStatus(commandFailedTask, 10_000)).toMatchObject({
      statusKey: 'working',
      label: 'Working',
      tone: 'working',
      active: true
    })
  })

  it('returns latest phase action chips', () => {
    const result = taskGatewayActionChips({
      ...task('with-actions', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'p-old', runId: 'run-old', conversationId: 'plan-old', source: 'gateway-plan', role: 'system', status: 'completed', body: 'old', createdAt: 1, updatedAt: 1 },
          { id: 'r-new', runId: 'run-new', conversationId: 'run-new', source: 'gateway-run', role: 'system', status: 'running', body: 'run', createdAt: 2, updatedAt: 2 },
          { id: 'p-new', runId: 'plan-run', conversationId: 'plan-new', source: 'gateway-plan', role: 'system', status: 'completed', body: 'plan', createdAt: 3, updatedAt: 3 }
        ]
      }
    })

    expect(result.map((chip) => [chip.label, chip.conversationId, chip.status])).toEqual([
      ['Plan', 'plan-new', 'completed'],
      ['Run', 'run-new', 'running']
    ])
  })

  it('finds the latest Plan conversation by updatedAt before createdAt', () => {
    const result = latestTaskGatewayConversation({
      ...task('with-plan-chat', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'p-created-newer', runId: 'run-created-newer', conversationId: 'plan-created-newer', source: 'gateway-plan', role: 'system', status: 'completed', body: 'created newer', createdAt: 20 },
          { id: 'r-latest', runId: 'run-latest', conversationId: 'run-latest', source: 'gateway-run', role: 'system', status: 'completed', body: 'run', createdAt: 25, updatedAt: 25 },
          { id: 'p-updated-newer', runId: 'plan-run-latest', conversationId: 'plan-updated-newer', source: 'gateway-plan', role: 'assistant', status: 'completed', body: 'updated newer', createdAt: 10, updatedAt: 30 }
        ]
      }
    }, 'gateway-plan')

    expect(result).toEqual({ source: 'gateway-plan', phase: 'PLAN', conversationId: 'plan-updated-newer', at: 30 })
  })

  it('finds the latest Run conversation and falls back to runId', () => {
    const result = latestTaskGatewayConversation({
      ...task('with-run-chat', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'r-old', runId: 'run-old', conversationId: 'run-old-conversation', source: 'gateway-run', role: 'system', status: 'completed', body: 'old', createdAt: 1, updatedAt: 1 },
          { id: 'p-newer', runId: 'plan-newer', conversationId: 'plan-newer', source: 'gateway-plan', role: 'system', status: 'completed', body: 'plan', createdAt: 20, updatedAt: 20 },
          { id: 'r-fallback', runId: 'run-fallback', source: 'gateway-run', role: 'system', status: 'running', body: 'fallback', createdAt: 2, updatedAt: 30 }
        ]
      }
    }, 'gateway-run')

    expect(result).toEqual({ source: 'gateway-run', phase: 'RUN', conversationId: 'run-fallback', at: 30 })
  })

  it('returns null when no same-type conversation exists', () => {
    const result = latestTaskGatewayConversation({
      ...task('without-plan-chat', 'todo', 0),
      payload: {
        activityMessages: [
          { id: 'r-only', runId: 'run-only', conversationId: 'run-only', source: 'gateway-run', role: 'system', status: 'completed', body: 'run', createdAt: 1, updatedAt: 1 }
        ]
      }
    }, 'gateway-plan')

    expect(result).toBeNull()
  })
})
