import { describe, expect, it } from 'vitest'
import type { TaskChecklistItem, TaskEntity } from '../../shared/types/entities.js'
import type { NormalizedTaskJsonImport, NormalizedImportedSubtask } from './task-json-import.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'
import { codexChatPrompt, initialPlannerPrompt, normalizePlannerQuestionPayload, omcCliInstructions, TaskService, validatePlannerTaskJsonQuality } from './task.service.js'

function taskWithComments(): TaskEntity {
  return {
    id: 'task-1',
    projectId: 'project-1',
    title: 'Prompt Priority Task',
    status: 'active',
    description: 'Task details should support the prompt.',
    comments: [
      {
        id: 'comment-1',
        authorName: 'Ada',
        body: 'Main comment matters.',
        createdAt: 1_700_000_000_000
      }
    ],
    subtasks: [
      {
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Subtask A',
        status: 'active',
        sortOrder: 0,
        payload: {
          comments: [
            {
              id: 'sub-comment-1',
              authorName: 'Linus',
              body: 'Subtask comment matters too.',
              createdAt: 1_700_000_100_000
            }
          ]
        },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000
      }
    ],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  }
}

describe('codexChatPrompt', () => {
  it('puts follow-up input before comments and task context', () => {
    const prompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Do this exact follow-up first.',
      transcript: [],
      context: { task: { comments: ['context still includes task comments'] } },
      mode: 'chat'
    })

    expect(prompt).toContain('Primary instruction is the user follow-up prompt; use task details as supporting context.')
    expect(prompt.indexOf('User follow-up:\nDo this exact follow-up first.')).toBeLessThan(prompt.indexOf('Important task comments:'))
    expect(prompt.indexOf('Important task comments:')).toBeLessThan(prompt.indexOf('Current task context JSON:'))
  })

  it('renders task and subtask comments in separate equal-weight sections', () => {
    const prompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Continue.',
      transcript: [],
      mode: 'chat'
    })

    expect(prompt).toContain('Important task comments:')
    expect(prompt).toContain('Task comments:\n- Ada, 2023-11-14T22:13:20.000Z: Main comment matters.')
    expect(prompt).toContain('Subtask comments:\nSubtask: Subtask A\n- Linus, 2023-11-14T22:15:00.000Z: Subtask comment matters too.')
    expect(prompt.toLowerCase()).not.toContain('latest')
    expect(prompt.toLowerCase()).not.toContain('override')
  })

  it('reads comments from current task context when available', () => {
    const task = { ...taskWithComments(), comments: [], subtasks: [] }
    const prompt = codexChatPrompt({
      task,
      message: 'Continue.',
      transcript: [],
      context: {
        currentTaskJson: {
          comments: [{ authorName: 'Grace', body: 'Context task comment.', createdAt: 1_700_000_200_000 }],
          subtasks: [
            {
              title: 'Context Subtask',
              comments: [{ authorName: 'Margaret', body: 'Context subtask comment.', createdAt: 1_700_000_300_000 }]
            }
          ]
        }
      },
      mode: 'chat'
    })

    expect(prompt).toContain('Task comments:\n- Grace, 2023-11-14T22:16:40.000Z: Context task comment.')
    expect(prompt).toContain('Subtask comments:\nSubtask: Context Subtask\n- Margaret, 2023-11-14T22:18:20.000Z: Context subtask comment.')
  })

  it('keeps steer mode and includes comments as high-signal guidance', () => {
    const prompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Change direction.',
      transcript: [{ role: 'assistant', body: 'Earlier work', id: 'm1', runId: 'r1', source: 'codex-chat', createdAt: 1 }],
      mode: 'steer'
    })

    expect(prompt).toContain('Treat the user steer instruction and task comments as high-signal guidance')
    expect(prompt).toContain('User steer instruction:\nChange direction.')
    expect(prompt).toContain('Important task comments:')
    expect(prompt.indexOf('User steer instruction:')).toBeLessThan(prompt.indexOf('Important task comments:'))
    expect(prompt.indexOf('Important task comments:')).toBeLessThan(prompt.indexOf('Recent chat transcript:'))
  })

  it('omits the comments section when the task has no comments', () => {
    const task = { ...taskWithComments(), comments: [], subtasks: [] }
    const prompt = codexChatPrompt({
      task,
      message: 'Continue.',
      transcript: [],
      mode: 'chat'
    })

    expect(prompt).not.toContain('Important task comments:')
  })
})

function checklist(title: string, checked = false): TaskChecklistItem {
  return { id: `check-${title}`, title, checked, createdAt: 1, updatedAt: 1 }
}

function plannedSubtask(overrides: Partial<NormalizedImportedSubtask> = {}): NormalizedImportedSubtask {
  return {
    title: 'Update planner prompt instructions for full subtask rewrite',
    description: [
      '## Objective',
      'Make the planner produce implementation-ready subtasks.',
      '',
      '## Task context',
      'The planning run updates task JSON through the OMC helper.',
      '',
      '## Exact work',
      'Add explicit prompt rules for rewriting every subtask with detailed descriptions.',
      '',
      '## Files/areas',
      'src/main/services/task.service.ts',
      '',
      '## Done when',
      'Planner prompts include full subtask rewrite and extreme decomposition rules.'
    ].join('\n'),
    status: 'active',
    agentId: null,
    assigneeName: '',
    tagIds: [],
    skillIds: [],
    customFieldValues: {},
    checklistItems: [checklist('Confirm the planner prompt includes the exact full rewrite instruction')],
    comments: [],
    ...overrides
  }
}

function plannedTask(overrides: Partial<NormalizedTaskJsonImport> = {}): NormalizedTaskJsonImport {
  return {
    title: 'Refactor planner output',
    description: 'Detailed task description for the planner refactor.',
    status: 'active',
    agentId: null,
    tagIds: [],
    skillIds: [],
    customFieldValues: {},
    checklistItems: [],
    agenticInputs: {
      acceptanceCriteria: '- Planner rejects weak JSON.\n- Task.md makes subtasks primary.'
    },
    comments: [],
    subtasks: [plannedSubtask()],
    warnings: [],
    ...overrides
  }
}

describe('planner quality gate', () => {
  it('accepts detailed planner JSON', () => {
    expect(validatePlannerTaskJsonQuality(plannedTask())).toEqual([])
  })

  it('rejects subtasks without description or checklist', () => {
    const issues = validatePlannerTaskJsonQuality(plannedTask({
      subtasks: [plannedSubtask({ description: '', checklistItems: [] })]
    }))

    expect(issues).toContain('subtasks[0].description is required.')
    expect(issues).toContain('subtasks[0].checklist must include concrete unchecked items.')
  })

  it('rejects missing root description, acceptance criteria, and subtasks', () => {
    const issues = validatePlannerTaskJsonQuality(plannedTask({
      description: '',
      agenticInputs: {},
      subtasks: []
    }))

    expect(issues).toContain('Task description is required for planner updates.')
    expect(issues).toContain('agenticInputs.acceptanceCriteria is required for planner updates.')
    expect(issues).toContain('At least one planned subtask is required.')
  })

  it('rejects generic checklist items', () => {
    const issues = validatePlannerTaskJsonQuality(plannedTask({
      subtasks: [plannedSubtask({ checklistItems: [checklist('Test yap'), checklist('Run tests'), checklist('Fix bugs'), checklist('Implement feature')] })]
    }))

    expect(issues).toContain('subtasks[0].checklist[0].title is too generic.')
    expect(issues).toContain('subtasks[0].checklist[1].title is too generic.')
    expect(issues).toContain('subtasks[0].checklist[2].title is too generic.')
    expect(issues).toContain('subtasks[0].checklist[3].title is too generic.')
  })

  it('blocks planner update when validation fails', async () => {
    let imported = false
    const service = Object.create(TaskService.prototype) as TaskService & {
      importJson: () => Promise<unknown>
      plannerValidateJson: () => Promise<unknown>
    }
    service.plannerValidateJson = async () => ({ ok: false, error: { code: 'validation', message: 'Planner JSON quality check failed' } })
    service.importJson = async () => {
      imported = true
      return { ok: true }
    }

    const response = await service.plannerUpdateFromJson({ taskId: 'task-1', json: {} })

    expect(response.ok).toBe(false)
    expect(imported).toBe(false)
  })

  it('normalizes planner/import subtask checklists into subtask payload', async () => {
    const normalizer = new TaskJsonImportNormalizer(
      'org-1',
      {} as never,
      { list: async () => [], create: async (input: any) => ({ id: 'tag-1', ...input }) } as never,
      {} as never,
      { list: async () => [], create: async (input: any) => ({ id: 'field-1', ...input }) } as never
    )

    const normalized = await normalizer.normalize({
      title: 'Detailed planned task',
      description: 'Task description.',
      subtasks: [
        {
          title: 'Implement subtask checklist UI',
          description: 'Detailed subtask description.',
          checklist: [
            { title: 'Wire template subtask checklist handlers to payload.checklistItems' }
          ]
        }
      ]
    })
    const templatePayload = normalizer.toTemplatePayload(normalized)
    const checklistItems = templatePayload.subtasks?.[0]?.payload?.checklistItems

    expect(normalized.subtasks[0].checklistItems[0].title).toBe('Wire template subtask checklist handlers to payload.checklistItems')
    expect(Array.isArray(checklistItems)).toBe(true)
    expect((checklistItems as TaskChecklistItem[])[0].checked).toBe(false)
  })

  it('documents full subtask rewrite and extreme decomposition in planner prompts', () => {
    const prompt = initialPlannerPrompt('project-1', 'task-1', '.omc/runs/run/omc-task-client.mjs', '.omc/runs/run/context.json', '.omc/runs/run/planned-task.json')
    const instructions = omcCliInstructions({
      mode: 'plan',
      projectId: 'project-1',
      taskId: 'task-1',
      runId: 'run',
      helperRelativePath: '.omc/runs/run/omc-task-client.mjs',
      contextRelativePath: '.omc/runs/run/context.json',
      plannedTaskRelativePath: '.omc/runs/run/planned-task.json',
      runtimeWorkspacePath: '/workspace'
    })

    expect(prompt).toContain('Refactor the entire subtasks array')
    expect(prompt).toContain('Use extreme decomposition')
    expect(prompt).toContain('No generic test tasks')
    expect(prompt).toContain('node .omc/runs/run/omc-task-client.mjs ask .omc/runs/run/questions.json')
    expect(instructions).toContain('refactor the entire subtasks array')
    expect(instructions).toContain('Planning granularity is extreme')
    expect(instructions).toContain('No generic test tasks')
    expect(instructions).toContain('Ask user clarification questions')
  })
})

describe('planner question payload', () => {
  it('accepts concrete AI-generated planner questions', () => {
    const response = normalizePlannerQuestionPayload({
      summary: 'Need scope before planning.',
      questions: [
        { id: 'scope', question: 'Which chat screens should be covered?', why: 'This changes the implementation surface.' }
      ]
    })

    expect(response.ok).toBe(true)
    expect(response.data?.questions).toEqual([
      { id: 'scope', question: 'Which chat screens should be covered?', why: 'This changes the implementation surface.' }
    ])
  })

  it('rejects empty planner questions', () => {
    const response = normalizePlannerQuestionPayload({ summary: 'Need input.', questions: [] })

    expect(response.ok).toBe(false)
    expect(response.error?.message).toContain('at least one question')
  })
})
