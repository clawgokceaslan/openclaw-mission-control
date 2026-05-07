import { describe, expect, it } from 'vitest'
import type { Project, TaskEntity } from '@shared/types/entities'
import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import {
  enqueuePlannerQuestion,
  plannerQuestionItemFromActivity,
  removeAnsweredPlannerQuestions,
  resolvePlannerQuestionConfig,
  unansweredPlannerQuestionsFromTasks
} from './plannerQuestionQueue'

function message(overrides: Partial<TaskActivityMessage>): TaskActivityMessage {
  return {
    id: overrides.id ?? 'message-1',
    runId: overrides.runId ?? 'run-1',
    conversationId: overrides.conversationId ?? 'conversation-1',
    source: overrides.source ?? 'gateway-plan',
    role: overrides.role ?? 'assistant',
    status: overrides.status,
    body: overrides.body ?? 'body',
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt
  }
}

function task(overrides: Partial<TaskEntity> & { messages?: TaskActivityMessage[] }): TaskEntity {
  return {
    id: overrides.id ?? 'task-1',
    projectId: overrides.projectId ?? 'project-1',
    title: overrides.title ?? 'Task',
    status: overrides.status ?? 'status-1',
    payload: {
      ...(overrides.payload ?? {}),
      activityMessages: overrides.messages ?? (overrides.payload?.activityMessages as TaskActivityMessage[] | undefined) ?? []
    },
    result: overrides.result ?? {},
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1
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
          gatewayBlock: 'planner-question',
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
      message: message({ id: 'older', createdAt: 1, metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Older?' }] } })
    })!
    const newer = plannerQuestionItemFromActivity({
      projectId: 'project-1',
      taskId: 'task-1',
      message: message({ id: 'newer', createdAt: 5, metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Newer?' }] } })
    })!

    const queue = enqueuePlannerQuestion(enqueuePlannerQuestion(enqueuePlannerQuestion([], newer), older), older)
    expect(queue.map((item) => item.id)).toEqual(['older', 'newer'])
  })

  it('removes queued questions when a clarification answer lands in the same conversation', () => {
    const item = plannerQuestionItemFromActivity({
      projectId: 'project-1',
      taskId: 'task-1',
      message: message({ id: 'question', createdAt: 10, metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] } })
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
      message: message({ id: 'question', metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] } })
    })!
    const project: Project = {
      id: 'project-1',
      organizationId: 'org-1',
      name: 'Project',
      archived: false,
      metrics: { gateway: { gatewayId: 'gateway-project', planModel: 'plan-model', language: 'en', planReasoningEffort: 'high' } },
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

  it('bootstraps unanswered planner questions across tasks', () => {
    const items = unansweredPlannerQuestionsFromTasks([
      task({
        id: 'task-a',
        projectId: 'project-a',
        title: 'Task A',
        messages: [
          message({
            id: 'question-a',
            conversationId: 'conversation-a',
            createdAt: 20,
            metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'A?' }] }
          })
        ]
      }),
      task({
        id: 'task-b',
        projectId: 'project-b',
        title: 'Task B',
        messages: [
          message({
            id: 'question-b',
            conversationId: 'conversation-b',
            createdAt: 10,
            metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'B?' }] }
          })
        ]
      })
    ])

    expect(items.map((item) => item.id)).toEqual(['question-b', 'question-a'])
    expect(items.map((item) => item.taskTitle)).toEqual(['Task B', 'Task A'])
  })

  it('excludes planner questions that already have later clarification answers', () => {
    const items = unansweredPlannerQuestionsFromTasks([
      task({
        messages: [
          message({
            id: 'question',
            conversationId: 'conversation-answered',
            createdAt: 10,
            metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] }
          }),
          message({
            id: 'answer',
            conversationId: 'conversation-answered',
            role: 'user',
            createdAt: 11,
            metadata: { clarification: true }
          })
        ]
      })
    ])

    expect(items).toEqual([])
  })

  it('deduplicates bootstrap and live planner question items by message id', () => {
    const bootstrapped = unansweredPlannerQuestionsFromTasks([
      task({
        messages: [
          message({
            id: 'question',
            createdAt: 10,
            metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] }
          })
        ]
      })
    ])
    const live = plannerQuestionItemFromActivity({
      projectId: 'project-1',
      taskId: 'task-1',
      message: message({ id: 'question', createdAt: 10, metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] } })
    })!

    expect(enqueuePlannerQuestion(bootstrapped, live)).toHaveLength(1)
  })

  it('derives warning state when queued question metadata lacks required model config', () => {
    const items = unansweredPlannerQuestionsFromTasks([
      task({
        messages: [
          message({
            id: 'question',
            metadata: { gatewayBlock: 'planner-question', questions: [{ id: 'q', question: 'Question?' }] }
          })
        ]
      })
    ])

    expect(items.some((item) => !item.gatewayId || !item.model)).toBe(true)
  })
})
