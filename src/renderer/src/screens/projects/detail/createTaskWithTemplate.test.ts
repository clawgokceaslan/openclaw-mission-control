import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { TaskEntity, TaskGroup, TaskSubtask, TaskTemplate } from '@shared/types/entities'
import { createTaskWithTemplate } from './createTaskWithTemplate'
import { PROJECT_STATUS_COLUMNS } from './status'
import { invokeBridge } from '@renderer/utils/api'

vi.mock('@renderer/utils/api', () => ({
  invokeBridge: vi.fn()
}))

const invokeBridgeMock = vi.mocked(invokeBridge)

describe('createTaskWithTemplate', () => {
  beforeEach(() => {
    invokeBridgeMock.mockReset()
  })

  it('copies template subtask checklist items into created subtask payloads', async () => {
    const task: TaskEntity = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Generated task',
      status: 'pending',
      createdAt: 1,
      updatedAt: 1
    }
    const subtask: TaskSubtask = {
      id: 'subtask-1',
      taskId: task.id,
      title: 'Generated subtask',
      status: 'pending',
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1
    }
    const template: TaskTemplate = {
      id: 'template-1',
      organizationId: 'org-1',
      name: 'Checklist template',
      template: {
        title: 'Template task',
        description: 'Template description',
        subtasks: [
          {
            title: 'Template subtask',
            status: 'pending',
            payload: {
              checklistItems: [
                {
                  id: 'check-1',
                  title: 'Confirm template subtask checklist is copied',
                  checked: false,
                  createdAt: 1,
                  updatedAt: 1
                }
              ]
            }
          }
        ]
      },
      createdAt: 1,
      updatedAt: 1
    }

    invokeBridgeMock.mockImplementation(async (channel: string) => {
      if (channel === IPC_CHANNELS.tasks.create) return { ok: true, data: task }
      if (channel === IPC_CHANNELS.tasks.subtasksCreate) return { ok: true, data: subtask }
      if (channel === IPC_CHANNELS.tasks.subtasksUpdate) return { ok: true, data: subtask }
      return { ok: true, data: [] }
    })

    await createTaskWithTemplate({
      actorToken: 'token',
      input: {
        projectId: 'project-1',
        title: 'Generated task',
        description: 'Generated description',
        status: 'pending',
        tagIds: [],
        templateId: template.id
      },
      templates: [template],
      statusColumns: PROJECT_STATUS_COLUMNS,
      defaultStatus: PROJECT_STATUS_COLUMNS[0].status,
      outputFormats: []
    })

    expect(invokeBridgeMock).toHaveBeenCalledWith(IPC_CHANNELS.tasks.subtasksUpdate, expect.objectContaining({
      id: subtask.id,
      payload: expect.objectContaining({
        checklistItems: [
          expect.objectContaining({
            title: 'Confirm template subtask checklist is copied',
            checked: false
          })
        ]
      })
    }))
  })

  it('appends a created task to the selected task group order', async () => {
    const task: TaskEntity = {
      id: 'task-2',
      projectId: 'project-1',
      title: 'Grouped task',
      status: 'pending',
      createdAt: 1,
      updatedAt: 1
    }
    const taskGroup: TaskGroup = {
      id: 'group-1',
      groupId: 'group-1',
      projectId: 'project-1',
      title: 'Release group',
      orderedTaskIds: ['task-1', 'task-2'],
      activeTaskId: 'task-1',
      groupContextMdPath: '.omc/task-groups/group-1/groupContext.md',
      contractedContext: 'projectId: project-1',
      planningQueueState: { state: 'idle' },
      executionQueueState: { state: 'idle' },
      createdAt: 1,
      updatedAt: 2
    }

    invokeBridgeMock.mockImplementation(async (channel: string) => {
      if (channel === IPC_CHANNELS.tasks.create) return { ok: true, data: task }
      if (channel === IPC_CHANNELS.taskGroups.update) return { ok: true, data: taskGroup }
      return { ok: true, data: [] }
    })

    const result = await createTaskWithTemplate({
      actorToken: 'token',
      input: {
        projectId: 'project-1',
        title: 'Grouped task',
        description: '',
        status: 'pending',
        tagIds: [],
        targetGroupId: 'group-1',
        targetGroupOrderedTaskIds: ['task-1']
      },
      templates: [],
      statusColumns: PROJECT_STATUS_COLUMNS,
      defaultStatus: PROJECT_STATUS_COLUMNS[0].status,
      outputFormats: []
    })

    expect(invokeBridgeMock).toHaveBeenCalledWith(IPC_CHANNELS.taskGroups.update, expect.objectContaining({
      groupId: 'group-1',
      orderedTaskIds: ['task-1', 'task-2'],
      activeTaskId: 'task-1'
    }))
    expect(result.taskGroup?.groupId).toBe('group-1')
  })
})
