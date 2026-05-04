import { describe, expect, it } from 'vitest'
import type { Project, TaskEntity } from '@shared/types/entities'
import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import {
  enqueuePlannerQuestion,
  plannerQuestionItemFromActivity,
  removeAnsweredPlannerQuestions,
  resolvePlannerQuestionConfig
} from './plannerQuestionQueue'

function message(overrides: Partial<TaskActivityMessage>): TaskActivityMessage {
  return {
    id: overrides.id ?? 'message-1',
    runId: overrides.runId ?? 'run-1',
    conversationId: overrides.conversationId ?? 'conversation-1',
    source: overrides.source ?? 'codex-plan',
    role: overrides.role ?? 'assistant',
    status: overrides.status,
    body: overrides.body ?? 'body',
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt
  }
}

describe('planner question queue', () => {
  it('creates a global queue item from planner-question activity metadata', () => {
    const item = plannerQuestionItemFromActivity({
      projectId: 'project-fallback',
      taskId: 'task-fallback',
      message: message({
        id: 'question-1',
        createdAt: 10,
        metadata: {
          codexBlock: 'planner-question',
          projectId: 'project-1',
          taskId: 'task-1',
          taskTitle: 'Plan task',
          conversationId: 'conversation-1',
          gatewayId: 'gateway-1',
          model: 'gpt-5.5',
          language: 'en',
          reasoningEffort: 'high',
          summary: 'Need scope.',
          questions: [{ id: 'scope', question: 'Scope?', options: [{ id: 'a', label: 'A' }] }]
        }
      })
    })

    expect(item).toMatchObject({
      id: 'question-1',
      projectId: 'project-1',
      taskId: 'task-1',
      taskTitle: 'Plan task',
      conversationId: 'conversation-1',
      gatewayId: 'gateway-1',
      model: 'gpt-5.5',
      language: 'en',
      reasoningEffort: 'high'
    })
    expect(item?.prompt.questions[0].question).toBe('Scope?')
  })

  it('deduplicates and orders queued question batches', () => {
    const older = plannerQuestionItemFromActivity({
      projectId: 'project-1',
      taskId: 'task-1',
      message: message({ id: 'older', createdAt: 1, metadata: { codexBlock: 'planner-question', questions: [{ id: 'q', question: 'Older?' }] } })
    })!
    const newer = plannerQuestionItemFromActivity({
      projectId: 'project-1',
      taskId: 'task-1',
      message: message({ id: 'newer', createdAt: 5, metadata: { codexBlock: 'planner-question', questions: [{ id: 'q', question: 'Newer?' }] } })
    })!

    const queue = enqueuePlannerQuestion(enqueuePlannerQuestion(enqueuePlannerQuestion([], newer), older), older)
    expect(queue.map((item) => item.id)).toEqual(['older', 'newer'])
  })

  it('removes queued questions when a clarification answer lands in the same conversation', () => {
    const item = plannerQuestionItemFromActivity({
      projectId: 'project-1',
      taskId: 'task-1',
      message: message({ id: 'question', createdAt: 10, metadata: { codexBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] } })
    })!
    const queue = removeAnsweredPlannerQuestions([item], message({
      id: 'answer',
      role: 'user',
      createdAt: 11,
      metadata: { clarification: true }
    }))

    expect(queue).toEqual([])
  })

  it('falls back to project codex settings for missing question metadata', () => {
    const item = plannerQuestionItemFromActivity({
      projectId: 'project-1',
      taskId: 'task-1',
      message: message({ id: 'question', metadata: { codexBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] } })
    })!
    const project: Project = {
      id: 'project-1',
      organizationId: 'org-1',
      name: 'Project',
      archived: false,
      metrics: { codex: { gatewayId: 'gateway-project', planModel: 'plan-model', language: 'en', planReasoningEffort: 'high' } },
      createdAt: 1,
      updatedAt: 1
    }
    const task: TaskEntity = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Task title',
      status: 'status-1',
      payload: {},
      result: {},
      createdAt: 1,
      updatedAt: 1
    }

    expect(resolvePlannerQuestionConfig({ item, task, project })).toMatchObject({
      gatewayId: 'gateway-project',
      model: 'plan-model',
      language: 'en',
      reasoningEffort: 'high',
      taskTitle: 'Task title'
    })
  })
})
