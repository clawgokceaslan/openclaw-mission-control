import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { TaskChecklistItem, TaskEntity } from '../../shared/types/entities.js'
import type { NormalizedTaskJsonImport, NormalizedImportedSubtask } from './task-json-import.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'
import { codexChatPrompt, codexOutputChanges, codexWorkspaceChanges, initialCodexPrompt, initialPlannerPrompt, normalizePlannerQuestionPayload, omcCliInstructions, plannerJsonGuidance, shouldStartPostRunPrompt, TaskService, validatePlannerTaskJsonQuality } from './task.service.js'

const execFileAsync = promisify(execFile)

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

  it('prioritizes selected language, project instructions, and effective agent before task context', () => {
    const prompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Continue.',
      transcript: [],
      language: 'en',
      context: {
        project: {
          generalPrompt: 'Always prefer the compact operational UI.',
          planGuide: 'Split work into precise subtasks.',
          rules: 'Do not change unrelated files.'
        },
        effectiveAgent: { id: 'agent-1', name: 'Frontend Agent', inherited: true },
        currentTaskJson: { title: 'Context task' }
      },
      mode: 'chat'
    })

    expect(prompt).toContain('Selected Codex language: English.')
    expect(prompt).toContain('High-priority Project Instructions:')
    expect(prompt).toContain('Effective agent: name=Frontend Agent')
    expect(prompt.indexOf('Selected Codex language: English.')).toBeLessThan(prompt.indexOf('User follow-up:'))
    expect(prompt.indexOf('High-priority Project Instructions:')).toBeLessThan(prompt.indexOf('Current task context JSON:'))
    expect(prompt.indexOf('Effective agent:')).toBeLessThan(prompt.indexOf('Current task context JSON:'))
  })

  it('places selected language before task context', () => {
    const prompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Continue.',
      transcript: [],
      language: 'en',
      context: { currentTaskJson: { title: 'Context task' } },
      mode: 'chat'
    })

    expect(prompt).toContain('Selected Codex language: English.')
    expect(prompt.indexOf('Selected Codex language: English.')).toBeLessThan(prompt.indexOf('Current task context JSON:'))
  })

  it('routes project instructions strictly for chat and /plan chat modes', () => {
    const context = {
      project: {
        generalContext: 'General context should be chat-only.',
        generalPrompt: 'General prompt should be chat-only.',
        planGuide: 'Plan guide should be plan-only.',
        defaultOutput: 'Default output should be chat-only.',
        rules: 'Rules should be chat-only.',
        postRunPrompt: 'Post-run should never be chat prompt context.'
      }
    }
    const chatPrompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Continue.',
      transcript: [],
      context,
      mode: 'chat'
    })
    const planPrompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Plan it.',
      transcript: [],
      context,
      mode: 'plan'
    })

    expect(chatPrompt).toContain('General context should be chat-only.')
    expect(chatPrompt).toContain('Rules should be chat-only.')
    expect(chatPrompt).not.toContain('Plan guide should be plan-only.')
    expect(chatPrompt).not.toContain('Post-run should never be chat prompt context.')
    expect(planPrompt).toContain('Plan guide should be plan-only.')
    expect(planPrompt).not.toContain('General context should be chat-only.')
    expect(planPrompt).not.toContain('Rules should be chat-only.')
    expect(planPrompt).not.toContain('Post-run should never be chat prompt context.')
  })
})

function checklist(title: string, checked = false): TaskChecklistItem {
  return { id: `check-${title}`, title, checked, createdAt: 1, updatedAt: 1 }
}

function plannedSubtask(overrides: Partial<NormalizedImportedSubtask> = {}): NormalizedImportedSubtask {
  return {
    title: 'Update planner prompt instructions for balanced subtask planning',
    description: 'Make the planner produce implementation-ready subtasks without forcing micro-level decomposition that bloats context.',
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

  it('documents full subtask rewrite and balanced decomposition in planner prompts', () => {
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
    expect(prompt).toContain('Use balanced decomposition')
    expect(prompt).toContain('3-8 subtasks for typical tasks')
    expect(prompt).toContain('Do not split every file, UI state, edge case, or verification command')
    expect(prompt).toContain('No generic test tasks')
    expect(prompt).toContain('node .omc/runs/run/omc-task-client.mjs ask .omc/runs/run/questions.json')
    expect(instructions).toContain('refactor the entire subtasks array')
    expect(instructions).toContain('Planning granularity is balanced')
    expect(instructions).toContain('at most 12 subtasks')
    expect(instructions).toContain('No generic test tasks')
    expect(instructions).toContain('Ask user clarification questions')
  })

  it('exposes balanced subtask policy in planner context guidance', () => {
    const guidance = plannerJsonGuidance()

    expect(guidance.planningPolicy.granularity).toBe('balanced')
    expect(guidance.planningPolicy.subtaskCount).toContain('3-8 subtasks')
    expect(guidance.subtaskPolicy.join('\n')).toContain('cohesive implementation areas')
    expect(guidance.subtaskPolicy.join('\n')).toContain('Do not create a separate subtask for every file')
  })

  it('routes project instructions strictly between planner and run prompts', () => {
    const projectPrompt = {
      generalContext: 'General context for run.',
      generalPrompt: 'General prompt for run.',
      planGuide: 'Planner-only guide.',
      defaultOutput: 'Default output for run.',
      rules: 'Rules for run.',
      postRunPrompt: 'Post-run prompt text.'
    }
    const plannerPrompt = initialPlannerPrompt('project-1', 'task-1', 'helper.mjs', 'context.json', 'planned-task.json', { projectPrompt })
    const runPrompt = initialCodexPrompt('/export', '/runtime', 'project-1', 'task-1', '.omc/runs/run/OMC_CLI.md', { projectPrompt })

    expect(plannerPrompt).toContain('Planner-only guide.')
    expect(plannerPrompt).not.toContain('General context for run.')
    expect(plannerPrompt).not.toContain('Rules for run.')
    expect(plannerPrompt).not.toContain('Post-run prompt text.')
    expect(runPrompt).toContain('General context for run.')
    expect(runPrompt).toContain('General prompt for run.')
    expect(runPrompt).toContain('Planner-only guide.')
    expect(runPrompt).toContain('Default output for run.')
    expect(runPrompt).toContain('Rules for run.')
    expect(runPrompt).not.toContain('Post-run prompt text.')
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

  it('accepts multiple-choice planner question options', () => {
    const response = normalizePlannerQuestionPayload({
      summary: 'Need scope before planning.',
      questions: [
        {
          id: 'scope',
          question: 'Which scope should be planned?',
          options: [
            { id: 'chat', label: 'Chat only', description: 'Only chat surfaces.' },
            'All screens'
          ]
        }
      ]
    })

    expect(response.ok).toBe(true)
    expect(response.data?.questions[0].options).toEqual([
      { id: 'chat', label: 'Chat only', description: 'Only chat surfaces.' },
      { id: 'option-2', label: 'All screens' }
    ])
  })

  it('rejects empty multiple-choice options', () => {
    const response = normalizePlannerQuestionPayload({
      summary: 'Need input.',
      questions: [{ id: 'scope', question: 'Scope?', options: [] }]
    })

    expect(response.ok).toBe(false)
    expect(response.error?.message).toContain('options')
  })

  it('rejects empty planner questions', () => {
    const response = normalizePlannerQuestionPayload({ summary: 'Need input.', questions: [] })

    expect(response.ok).toBe(false)
    expect(response.error?.message).toContain('at least one question')
  })
})

describe('codex workspace changes', () => {
  it('counts untracked text files from actual file contents', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'omc-change-counter-'))
    try {
      await execFileAsync('git', ['init'], { cwd: workspace })
      await writeFile(join(workspace, 'created.txt'), 'one\ntwo\nthree\n', 'utf8')

      const changes = await codexWorkspaceChanges(workspace)

      expect(changes.metadata?.changeFiles).toBe(1)
      expect(changes.metadata?.changeInsertions).toBe(3)
      expect(changes.metadata?.changeDeletions).toBe(0)
      expect(changes.body).toContain('created.txt (+3)')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe('codex output changes', () => {
  it('extracts file changes from apply_patch markers without git inspection', () => {
    const changes = codexOutputChanges([
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const value = 1',
      '*** Update File: src/existing.ts',
      '@@',
      '-old',
      '+new',
      '*** Delete File: src/old.ts',
      '*** End Patch'
    ].join('\n'), '')

    expect(changes.hasChanges).toBe(true)
    expect(changes.metadata.changeSource).toBe('codex-output')
    expect(changes.metadata.changeFiles).toBe(3)
    expect(changes.body).toContain('Created src/new.ts')
    expect(changes.body).toContain('Edited src/existing.ts')
    expect(changes.body).toContain('Deleted src/old.ts')
  })

  it('extracts file changes from unified diffs and assistant summaries', () => {
    const changes = codexOutputChanges([
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new'
    ].join('\n'), 'Created `src/b.ts` and updated src/c.ts.')

    expect(changes.hasChanges).toBe(true)
    expect(changes.metadata.changeFiles).toBe(3)
    expect(changes.body).toContain('Edited src/a.ts')
    expect(changes.body).toContain('Created src/b.ts')
    expect(changes.body).toContain('Edited src/c.ts')
  })

  it('omits the change card when Codex output has no file markers', () => {
    const changes = codexOutputChanges('{"type":"turn.completed"}', 'No files changed.')

    expect(changes.hasChanges).toBe(false)
    expect(changes.metadata.changeSource).toBe('codex-output')
    expect(changes.metadata.changeFiles).toBe(0)
  })
})

describe('post-run prompt gate', () => {
  it('starts only for successful exec runs with a configured post-run prompt', () => {
    expect(shouldStartPostRunPrompt(0, 'exec', 'Review final output.')).toBe(true)
    expect(shouldStartPostRunPrompt(1, 'exec', 'Review final output.')).toBe(false)
    expect(shouldStartPostRunPrompt(0, 'terminal', 'Review final output.')).toBe(false)
    expect(shouldStartPostRunPrompt(0, 'exec', '')).toBe(false)
  })
})
