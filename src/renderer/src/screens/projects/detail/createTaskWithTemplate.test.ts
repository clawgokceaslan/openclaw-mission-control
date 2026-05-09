import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { TaskEntity, TaskSubtask, TaskTemplate } from '@shared/types/entities'
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

})
