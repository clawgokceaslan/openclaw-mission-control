import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import EventEmitter from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { ProjectStatus, TaskChecklistItem, TaskEntity } from '../../shared/types/entities.js'
import type { NormalizedTaskJsonImport, NormalizedImportedSubtask } from './task-json-import.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'
import { appendCodexNextChatHandoff, codexChatPrompt, codexOutputChanges, codexWorkspaceChanges, initialCodexPrompt, initialPlannerPrompt, normalizePlannerQuestionPayload, omcCliInstructions, plannerJsonGuidance, postRunContinuationPrompt, shouldStartPostRunPrompt, summarizeRunningConversation, TaskService, validatePlannerTaskJsonQuality, writeTaskSnapshotToExportWorkspace } from './task.service.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'

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

  it('serializes chat prompts as structured JSON and Toon when requested', () => {
    const jsonPrompt = codexChatPrompt({
      task: taskWithComments(),
      message: 'Continue.',
      transcript: [{ role: 'assistant', body: 'Earlier work', id: 'm1', runId: 'r1', source: 'codex-chat', createdAt: 1 }],
      mode: 'chat',
      promptShape: 'json'
    })
    const parsed = JSON.parse(jsonPrompt)

    expect(parsed.shape).toBe('json')
    expect(parsed.family).toBe('chat')
    expect(parsed.sections.find((section: { name: string }) => section.name === 'recent_chat_transcript').value).toEqual([
      { role: 'assistant', body: 'Earlier work', source: 'codex-chat', createdAt: 1 }
    ])
    expect(codexChatPrompt({
      task: taskWithComments(),
      message: 'Continue.',
      transcript: [],
      mode: 'chat',
      promptShape: 'toon'
    })).toContain('family: chat')
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

  it('accepts title and description subtasks without checklist items', () => {
    const issues = validatePlannerTaskJsonQuality(plannedTask({
      subtasks: [plannedSubtask({ checklistItems: [] })]
    }))

    expect(issues).toEqual([])
  })

  it('rejects subtasks without description', () => {
    const issues = validatePlannerTaskJsonQuality(plannedTask({
      subtasks: [plannedSubtask({ description: '', checklistItems: [] })]
    }))

    expect(issues).toContain('subtasks[0].description is required.')
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

  it('rejects generic checklist items when provided', () => {
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

  it('documents pragmatic title and description subtask planning in direct planner prompts', () => {
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
    expect(prompt).toContain('Non-negotiable planner rules')
    expect(prompt).toContain('Use task description for the general goal')
    expect(prompt).toContain('Use task comments for important flows')
    expect(prompt).toContain('Subtasks must be ordered')
    expect(prompt).toContain('Use the Title + Description subtask shape')
    expect(prompt).toContain('Checklist items are optional')
    expect(prompt).toContain('make the final subtask a concrete verification and acceptance step')
    expect(prompt).toContain('No generic test tasks')
    expect(prompt).toContain('Clarification mode: DIRECT')
    expect(prompt).toContain('Do not ask clarification questions')
    expect(prompt).toContain('After the update succeeds, run: node .omc/runs/run/omc-task-client.mjs finish')
    expect(prompt).not.toContain('Clarification mode: ASK FIRST')
    expect(instructions).toContain('refactor the entire subtasks array')
    expect(instructions).toContain('Planning granularity is balanced')
    expect(instructions).toContain('at most 12 subtasks')
    expect(instructions).toContain('Non-negotiable planner rules')
    expect(instructions).toContain('Title + Description subtask shape')
    expect(instructions).toContain('Checklist items are optional')
    expect(instructions).toContain('No generic test tasks')
    expect(instructions).toContain('Clarification mode: DIRECT')
    expect(instructions).toContain('Do not ask clarification questions')
  })

  it('hard-controls ask-first planner prompts before task JSON updates', () => {
    const prompt = initialPlannerPrompt('project-1', 'task-1', '.omc/runs/run/omc-task-client.mjs', '.omc/runs/run/context.json', '.omc/runs/run/planned-task.json', { clarificationMode: 'ask-first' })
    const instructions = omcCliInstructions({
      mode: 'plan',
      projectId: 'project-1',
      taskId: 'task-1',
      runId: 'run',
      clarificationMode: 'ask-first',
      helperRelativePath: '.omc/runs/run/omc-task-client.mjs',
      contextRelativePath: '.omc/runs/run/context.json',
      plannedTaskRelativePath: '.omc/runs/run/planned-task.json',
      runtimeWorkspacePath: '/workspace'
    })

    expect(prompt).toContain('Clarification mode: ASK FIRST')
    expect(prompt).toContain('This run must pause for user clarification before updating the task')
    expect(prompt).toContain('node .omc/runs/run/omc-task-client.mjs ask .omc/runs/run/questions.json')
    expect(prompt).toContain('do not write planned-task.json, do not validate, do not update the task')
    expect(prompt).toContain('user input is not needed')
    expect(prompt).not.toContain('After the update succeeds, run: node .omc/runs/run/omc-task-client.mjs finish')
    expect(instructions).toContain('Clarification mode: ASK FIRST')
    expect(instructions).toContain('run `node .omc/runs/run/omc-task-client.mjs ask .omc/runs/run/questions.json`')
    expect(instructions).toContain('do not write planned-task.json, do not validate, do not update the task')
    expect(instructions).toContain('user input is not needed')
  })

  it('exposes balanced subtask policy in planner context guidance', () => {
    const guidance = plannerJsonGuidance()

    expect(guidance.planningPolicy.granularity).toBe('balanced')
    expect(guidance.planningPolicy.clarificationMode).toContain('ask-first')
    expect(guidance.planningPolicy.overrideProjectGuide).toContain('override')
    expect(guidance.planningPolicy.subtaskCount).toContain('3-8 subtasks')
    expect(guidance.subtaskPolicy.join('\n')).toContain('cohesive implementation areas')
    expect(guidance.subtaskPolicy.join('\n')).toContain('Title + Description shape')
    expect(guidance.subtaskPolicy.join('\n')).toContain('Checklist items are optional')
    expect(guidance.subtaskPolicy.join('\n')).toContain('final subtask')
    expect(guidance.plannedSubtaskTemplate).not.toHaveProperty('checklist')
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

  it('keeps Markdown as the default and serializes plan and run prompts as valid JSON or Toon', () => {
    const markdown = initialPlannerPrompt('project-1', 'task-1', 'helper.mjs', 'context.json', 'planned-task.json')
    const jsonPlanner = initialPlannerPrompt('project-1', 'task-1', 'helper.mjs', 'context.json', 'planned-task.json', { promptShape: 'json' })
    const jsonRun = initialCodexPrompt('/export', '/runtime', 'project-1', 'task-1', '.omc/runs/run/OMC_CLI.md', { promptShape: 'json' })
    const toonRun = initialCodexPrompt('/export', '/runtime', 'project-1', 'task-1', '.omc/runs/run/OMC_CLI.md', { promptShape: 'toon' })

    expect(markdown).toContain('You are planning an Open Mission Control task inside Codex TUI.')
    expect(markdown.trim().startsWith('{')).toBe(false)
    expect(JSON.parse(jsonPlanner).family).toBe('plan')
    expect(JSON.parse(jsonRun).family).toBe('run')
    expect(toonRun).toContain('shape: toon')
    expect(toonRun).toContain('family: run')
  })

  it('serializes post-run prompts as structured JSON', () => {
    const prompt = postRunContinuationPrompt({
      language: 'en',
      promptShape: 'json',
      projectPrompt: {
        generalContext: '',
        generalPrompt: '',
        planGuide: '',
        defaultOutput: '',
        rules: '',
        postRunPrompt: 'Clean up generated artifacts.'
      },
      primaryFinalMessage: 'Done.',
      primaryChanges: { hasChanges: false, body: '', truncated: false, metadata: {} }
    })

    const parsed = JSON.parse(prompt)
    expect(parsed.family).toBe('post_run')
    expect(parsed.sections.find((section: { name: string }) => section.name === 'post_run_prompt').value).toBe('Clean up generated artifacts.')
  })
})

describe('task JSON update tag preservation', () => {
  function createImportJsonService(tagsValue: unknown) {
    const eventBus = new EventEmitter()
    let currentTagIds = ['tag-keep']
    let task: TaskEntity = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Original title',
      status: 'status-active',
      payload: { description: 'Original description' },
      result: {},
      createdAt: 1,
      updatedAt: 1
    }
    const updates: Array<Partial<TaskEntity>> = []
    const setTaskTagsCalls: string[][] = []
    const service = Object.create(TaskService.prototype) as any
    service.auth = { requireActor: async () => ({ user: { organizationId: 'org-1' } }) }
    service.projects = { get: async () => ({ id: 'project-1', organizationId: 'org-1' }) }
    service.repo = {
      get: async () => task,
      update: async (_id: string, patch: Partial<TaskEntity>) => {
        updates.push(patch)
        task = { ...task, ...patch, updatedAt: 2 }
        return task
      }
    }
    service.statuses = {
      ensureProjectDefaults: async () => [
        { id: 'status-active', organizationId: 'org-1', projectId: 'project-1', name: 'Active', category: 'active', color: '#2F80ED', sortOrder: 0, isDefault: true, createdAt: 1, updatedAt: 1 }
      ]
    }
    service.agents = {}
    service.tags = {
      list: async () => [
        { id: 'tag-keep', organizationId: 'org-1', name: 'keep', color: '#0EA5E9' },
        { id: 'tag-new', organizationId: 'org-1', name: 'new', color: '#10B981' }
      ],
      create: async (input: any) => ({ id: `tag-${input.name}`, ...input })
    }
    service.skills = {}
    service.customFields = { list: async () => [], create: async (input: any) => ({ id: 'field-1', ...input }) }
    service.taskTagRepo = {
      setTaskTags: async (_taskId: string, tagIds: string[]) => {
        setTaskTagsCalls.push(tagIds)
        currentTagIds = tagIds
      },
      listByTaskIds: async (ids: string[]) => Object.fromEntries(ids.map((id) => [
        id,
        currentTagIds.map((tagId) => tagId === 'tag-new'
          ? { id: 'tag-new', organizationId: 'org-1', name: 'new', color: '#10B981' }
          : { id: 'tag-keep', organizationId: 'org-1', name: 'keep', color: '#0EA5E9' })
      ]))
    }
    service.taskSkillRepo = { listByTaskIds: async () => ({}) }
    service.subtaskRepo = {
      removeByTask: async () => undefined,
      listByTaskIds: async () => ({})
    }
    service.eventBus = eventBus

    return {
      service,
      updates,
      setTaskTagsCalls,
      json: {
        title: 'Updated title',
        description: 'Updated description',
        status: 'Active',
        ...(tagsValue === Symbol.for('omit-tags') ? {} : { tags: tagsValue }),
        subtasks: []
      }
    }
  }

  it.each([
    ['omitted', Symbol.for('omit-tags')],
    ['null', null],
    ['empty', []]
  ])('preserves existing parent task tags when update tags are %s', async (_label, tagsValue) => {
    const { service, updates, setTaskTagsCalls, json } = createImportJsonService(tagsValue)

    const response = await service.importJson({ actorToken: 'actor', taskId: 'task-1', json })

    expect(response.ok).toBe(true)
    expect(setTaskTagsCalls).toEqual([])
    expect(response.data?.task?.tags?.map((tag: any) => tag.id)).toEqual(['tag-keep'])
    expect(updates[0]).toMatchObject({
      title: 'Updated title',
      status: 'status-active'
    })
    expect((updates[0].payload as Record<string, unknown>).description).toBe('Updated description')
  })

  it('replaces parent task tags when update provides a non-empty tag list', async () => {
    const { service, setTaskTagsCalls, json } = createImportJsonService(['new'])

    const response = await service.importJson({ actorToken: 'actor', taskId: 'task-1', json })

    expect(response.ok).toBe(true)
    expect(setTaskTagsCalls).toEqual([['tag-new']])
    expect(response.data?.task?.tags?.map((tag: any) => tag.id)).toEqual(['tag-new'])
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

describe('codex activity persistence', () => {
  it('stores planner question activity with global modal metadata', async () => {
    const service = Object.create(TaskService.prototype) as any
    let capturedMessages: any[] = []
    service.pausedPlannerRunIds = new Set<string>()
    service.ensureTaskAccess = async () => ({
      ok: true,
      data: {
        task: { id: 'task-1', projectId: 'project-1', title: 'Question Task' },
        actorOrgId: 'org-1'
      }
    })
    service.setTaskCodexPlanState = async () => undefined
    service.appendTaskActivityMessages = async (_taskId: string, messages: any[]) => {
      capturedMessages = messages
      return messages
    }

    const response = await service.appendPlannerQuestionActivity({
      actorToken: 'token',
      projectId: 'project-1',
      taskId: 'task-1',
      runId: 'run-1',
      conversationId: 'conversation-1',
      gatewayId: 'gateway-1',
      model: 'gpt-5.5',
      language: 'en',
      reasoningEffort: 'high'
    }, {
      summary: 'Need scope.',
      questions: [{ id: 'scope', question: 'Scope?', options: [] }]
    })

    expect(response.ok).toBe(true)
    expect(capturedMessages[0].metadata).toMatchObject({
      codexBlock: 'planner-question',
      projectId: 'project-1',
      taskId: 'task-1',
      taskTitle: 'Question Task',
      conversationId: 'conversation-1',
      gatewayId: 'gateway-1',
      model: 'gpt-5.5',
      language: 'en',
      reasoningEffort: 'high'
    })
  })

  it('advances planned tasks from first workflow status to second status only', async () => {
    const eventBus = new EventEmitter()
    const taskUpdatedEvents: unknown[] = []
    eventBus.on(IPC_CHANNELS.events.taskUpdated, (payload) => taskUpdatedEvents.push(payload))
    const statuses: ProjectStatus[] = [
      { id: 'status-1', organizationId: 'org-1', projectId: 'project-1', name: 'Backlog', category: 'not_started', color: '#8A99B4', sortOrder: 0, isDefault: true, createdAt: 1, updatedAt: 1 },
      { id: 'status-2', organizationId: 'org-1', projectId: 'project-1', name: 'Doing', category: 'active', color: '#2F80ED', sortOrder: 1, isDefault: false, createdAt: 2, updatedAt: 2 }
    ]
    let task: TaskEntity = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Task',
      status: 'status-1',
      payload: {},
      result: {},
      createdAt: 1,
      updatedAt: 1
    }
    const updates: Array<Partial<TaskEntity>> = []
    const service = Object.create(TaskService.prototype) as any
    service.eventBus = eventBus
    service.statuses = { ensureProjectDefaults: async () => statuses }
    service.repo = {
      get: async () => task,
      list: async () => [task],
      update: async (_id: string, patch: Partial<TaskEntity>) => {
        updates.push(patch)
        task = { ...task, ...patch }
        return task
      }
    }

    await service.advanceTaskFromFirstStatusAfterPlanning('task-1', 'org-1')
    await service.advanceTaskFromFirstStatusAfterPlanning('task-1', 'org-1')

    expect(updates).toHaveLength(1)
    expect(task.status).toBe('status-2')
    expect(taskUpdatedEvents).toHaveLength(1)
    expect((taskUpdatedEvents[0] as { action: string }).action).toBe('plan_status_advanced')
  })

  it('batch appends activity messages with one repo update and per-message activity events', async () => {
    const eventBus = new EventEmitter()
    const activityEvents: unknown[] = []
    const taskUpdatedEvents: unknown[] = []
    eventBus.on(IPC_CHANNELS.events.taskActivity, (payload) => activityEvents.push(payload))
    eventBus.on(IPC_CHANNELS.events.taskUpdated, (payload) => taskUpdatedEvents.push(payload))

    let task: TaskEntity = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Task',
      status: 'active',
      payload: {
        activityMessages: Array.from({ length: 299 }, (_, index) => ({
          id: `old-${index}`,
          runId: 'run-1',
          source: 'codex-run',
          role: 'assistant',
          body: `old ${index}`,
          createdAt: index + 1
        }))
      },
      result: {},
      createdAt: 1,
      updatedAt: 1
    }
    const updates: Array<Partial<TaskEntity>> = []
    const service = Object.create(TaskService.prototype) as TaskService & {
      repo: { get: (id: string) => Promise<TaskEntity | undefined>; update: (id: string, patch: Partial<TaskEntity>) => Promise<TaskEntity> }
      eventBus: EventEmitter
      appendTaskActivityMessages: (taskId: string, messages: unknown[], options?: { emitTaskUpdatedAction?: string }) => Promise<unknown[]>
    }
    service.repo = {
      get: async () => task,
      update: async (_id, patch) => {
        updates.push(patch)
        task = { ...task, ...patch }
        return task
      }
    }
    service.eventBus = eventBus

    await service.appendTaskActivityMessages('task-1', [
      { runId: 'run-1', source: 'codex-run', role: 'assistant', status: 'completed', body: 'new 1' },
      { runId: 'run-1', source: 'codex-run', role: 'system', status: 'completed', body: 'done', metadata: { codexBlock: 'run-complete' } }
    ])

    const messages = task.payload?.activityMessages as Array<{ id: string; body: string }>
    expect(updates).toHaveLength(1)
    expect(messages).toHaveLength(300)
    expect(messages[0].id).toBe('old-1')
    expect(messages.at(-1)?.body).toBe('done')
    expect(activityEvents).toHaveLength(2)
    expect(taskUpdatedEvents).toHaveLength(0)

    await service.appendTaskActivityMessages('task-1', [
      { runId: 'run-1', source: 'codex-run', role: 'system', status: 'completed', body: 'terminal' }
    ], { emitTaskUpdatedAction: 'activity_complete' })

    expect(updates).toHaveLength(2)
    expect(taskUpdatedEvents).toHaveLength(1)
    expect((taskUpdatedEvents[0] as { action: string }).action).toBe('activity_complete')
  })
})

describe('codex run snapshot export', () => {
  it('writes markdown and file attachments without requiring a zip archive', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'omc-run-snapshot-'))
    const attachmentPath = join(workspace, 'source.txt')
    const exportPath = join(workspace, 'export')
    await writeFile(attachmentPath, 'attachment body', 'utf8')

    try {
      const result = await writeTaskSnapshotToExportWorkspace(exportPath, {
        taskMarkdown: '# Task\nRun it.',
        agentMarkdown: '# Agents',
        skillsMarkdown: '# Skills',
        attachments: [{
          name: 'source.txt',
          exportName: 'copied.txt',
          url: pathToFileURL(attachmentPath).toString(),
          ownerId: 'task-1'
        }]
      })

      expect(await readFile(join(exportPath, 'Task.md'), 'utf8')).toContain('Run it.')
      expect(await readFile(join(exportPath, 'Agents.md'), 'utf8')).toContain('Agents')
      expect(await readFile(join(exportPath, 'Skills.md'), 'utf8')).toContain('Skills')
      expect(await readFile(join(exportPath, 'attachments', 'copied.txt'), 'utf8')).toBe('attachment body')
      expect(result.writtenFiles).toEqual(['Task.md', 'Agents.md', 'Skills.md', 'attachments/copied.txt'])
      expect(result.skippedFiles).toEqual([])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe('running Codex conversations', () => {
  it('filters out settled conversations and keeps active plan/run/chat/steer rows', () => {
    const now = 1_700_000_000_000
    const task = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Task',
      status: 'active',
      payload: {
        activityMessages: [
          { id: 'plan-live', runId: 'plan-run', source: 'codex-plan', role: 'thinking', status: 'running', body: 'Planning', createdAt: now - 60_000 },
          { id: 'plan-done', runId: 'plan-run', source: 'codex-plan', role: 'system', status: 'completed', body: 'Done', createdAt: now - 30_000, metadata: { codexBlock: 'run-complete' } },
          { id: 'run-live', runId: 'run-run', source: 'codex-run', role: 'thinking', status: 'running', body: 'Running task', createdAt: now - 20_000 },
          { id: 'steer-live', runId: 'steer-run', conversationId: 'steer-run', source: 'codex-chat', role: 'thinking', status: 'running', body: 'Steering', createdAt: now - 15_000, metadata: { mode: 'steer' } },
          { id: 'chat-live', runId: 'chat-run', conversationId: 'chat-run', source: 'codex-chat', role: 'thinking', status: 'running', body: 'Chatting', createdAt: now - 10_000 },
          { id: 'chat-done', runId: 'chat-run', conversationId: 'chat-run', source: 'codex-chat', role: 'system', status: 'completed', body: 'Finished', createdAt: now - 5_000, metadata: { codexBlock: 'run-complete' } }
        ]
      },
      createdAt: 1,
      updatedAt: 1
    } as TaskEntity

    const rows = summarizeRunningConversation(task, { id: 'project-1', name: 'Project One', description: 'Desc' }, task.payload.activityMessages as any[], now)

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.codexConversationId)).toEqual(['steer-run', 'run-run'])
    expect(rows[0].conversationType).toBe('steer')
    expect(rows[1].conversationType).toBe('run')
    expect(rows[0].liveStatus).toBe('running')
  })

  it('classifies active post-run conversations from post-run metadata and status flow', () => {
    const now = 1_700_000_000_000
    const task = {
      id: 'task-2',
      projectId: 'project-1',
      title: 'Post-run Task',
      status: 'active',
      payload: {
        activityMessages: [
          {
            id: 'run-done',
            runId: 'run-main',
            source: 'codex-run',
            role: 'system',
            status: 'completed',
            body: 'Run completed',
            createdAt: now - 60_000,
            metadata: { codexBlock: 'run-complete' }
          },
          {
            id: 'post-run-start',
            runId: 'run-post',
            conversationId: 'run-main',
            source: 'codex-run',
            role: 'system',
            status: 'running',
            body: 'Starting post-run prompt',
            createdAt: now - 45_000,
            metadata: { codexBlock: 'post-run-start', parentRunId: 'run-main' }
          },
          {
            id: 'post-run-prompt',
            runId: 'run-post',
            conversationId: 'run-main',
            source: 'codex-run',
            role: 'assistant',
            status: 'running',
            body: 'Review and validate all changes',
            createdAt: now - 40_000,
            metadata: { codexBlock: 'post-run-prompt', parentRunId: 'run-main' }
          }
        ]
      },
      createdAt: 1,
      updatedAt: 1
    } as TaskEntity

    const rows = summarizeRunningConversation(task, { id: 'project-1', name: 'Project One', description: 'Desc' }, task.payload.activityMessages as any[], now)

    expect(rows).toHaveLength(1)
    expect(rows[0].codexConversationId).toBe('run-main')
    expect(rows[0].conversationType).toBe('post-run')
    expect(rows[0].liveStatus).toBe('running')
    expect(rows[0].latestActivitySummary).toBe('Review and validate all changes')
  })

  it('paginates live conversation rows from listRunningCodex', async () => {
    const eventBus = new EventEmitter()
    const service = Object.create(TaskService.prototype) as TaskService & {
      auth: { requireActor: (token?: string) => Promise<{ user: { organizationId: string } }> }
      repo: { listRunningCodex: (orgId: string) => Promise<Array<{ task: TaskEntity; project: { id: string; name: string; description?: string } }>> }
    }
    const now = 1_700_000_000_000
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)

    const task: TaskEntity = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Task',
      status: 'active',
      payload: {
        activityMessages: [
          { id: 'run-live', runId: 'run-run', source: 'codex-run', role: 'thinking', status: 'running', body: 'Working', createdAt: now - 25_000 }
        ]
      },
      createdAt: 1,
      updatedAt: 1
    }
    const planTask: TaskEntity = {
      id: 'task-2',
      projectId: 'project-1',
      title: 'Plan Task',
      status: 'active',
      payload: {
        activityMessages: [
          { id: 'plan-live', runId: 'plan-run', source: 'codex-plan', role: 'thinking', status: 'running', body: 'Planning', createdAt: now - 20_000 }
        ]
      },
      createdAt: 1,
      updatedAt: 1
    }

    service.auth = {
      requireActor: async () => ({ user: { organizationId: 'org-1' } })
    } as any
    service.repo = {
      listRunningCodex: async () => ([
        { task, project: { id: 'project-1', name: 'Project One' } },
        { task: planTask, project: { id: 'project-1', name: 'Project One' } }
      ])
    }
    service.eventBus = eventBus

    try {
      const response = await service.listRunningCodex({ actorToken: 'token', page: 1, pageSize: 12 })

      expect(response.ok).toBe(true)
      expect(response.data?.total).toBe(2)
      expect(response.data?.counts).toEqual({ all: 2, planning: 1, running: 1, postRunning: 0 })
      expect(response.data?.rows).toHaveLength(2)
      const runningRow = response.data?.rows.find((row) => row.codexConversationId === 'run-run')
      expect(runningRow?.latestActivitySummary).toBe('Working')

      const planningResponse = await service.listRunningCodex({ actorToken: 'token', page: 1, pageSize: 12, group: 'planning' })

      expect(planningResponse.ok).toBe(true)
      expect(planningResponse.data?.group).toBe('planning')
      expect(planningResponse.data?.total).toBe(1)
      expect(planningResponse.data?.rows[0].codexConversationId).toBe('plan-run')
      expect(planningResponse.data?.counts).toEqual({ all: 2, planning: 1, running: 1, postRunning: 0 })
    } finally {
      dateNowSpy.mockRestore()
    }
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

describe('Codex next-chat handoff summary', () => {
  const task = {
    id: 'task-1',
    title: 'Context handoff',
    status: 'active',
    description: 'Append a compact context summary to the final Codex response.',
    projectId: 'project-1',
    createdAt: 1,
    updatedAt: 1
  } as TaskEntity

  const changes = codexOutputChanges([
    '*** Begin Patch',
    '*** Update File: src/main/services/task.service.ts',
    '@@',
    '-old',
    '+new',
    '*** End Patch'
  ].join('\n'), '')

  it('defaults to compact Markdown with stable fields and one handoff block', () => {
    const first = appendCodexNextChatHandoff({
      task,
      finalMessage: 'Implemented the formatter and ran npm test for task.service.',
      changes
    })
    const second = appendCodexNextChatHandoff({
      task,
      finalMessage: first,
      changes
    })

    expect(second.match(/NEXT_CHAT_HANDOFF/g)).toHaveLength(1)
    expect(second).toContain('task: task-1 | Context handoff | active')
    expect(second).toContain('goal: Append a compact context summary to the final Codex response.')
    expect(second).toContain('completed_work:')
    expect(second).toContain('changed_areas: src/main/services/task.service.ts')
    expect(second).toContain('verification:')
  })

  it('renders a parseable JSON handoff payload', () => {
    const message = appendCodexNextChatHandoff({
      task,
      finalMessage: 'Added JSON output. Verification not run.',
      changes,
      promptShape: 'json'
    })
    const payload = JSON.parse(message.split('NEXT_CHAT_HANDOFF_JSON\n')[1])

    expect(payload.schema).toBe('open_mission_control_next_chat_handoff')
    expect(payload.version).toBe(1)
    expect(payload.task).toEqual({ id: 'task-1', title: 'Context handoff', status: 'active' })
    expect(Object.keys(payload)).toEqual([
      'schema',
      'version',
      'task',
      'goal',
      'completed_work',
      'decisions',
      'changed_areas',
      'verification',
      'blockers',
      'next_steps'
    ])
  })

  it('renders TOON with stable parseable field labels and falls back from unknown shapes', () => {
    const toon = appendCodexNextChatHandoff({
      task,
      finalMessage: 'Updated TOON support and verified compactness.',
      changes,
      promptShape: 'toon'
    })
    const fallback = appendCodexNextChatHandoff({
      task,
      finalMessage: 'Done.',
      changes,
      promptShape: 'xml' as any
    })

    expect(toon).toContain('NEXT_CHAT_HANDOFF\nschema: open_mission_control_next_chat_handoff')
    expect(toon).toContain('task: {"id":"task-1","title":"Context handoff","status":"active"}')
    expect(toon).toContain('completed_work[]:')
    expect(toon).toContain('next_steps[]:')
    expect(fallback).toContain('NEXT_CHAT_HANDOFF\nschema: open_mission_control_next_chat_handoff')
    expect(fallback).not.toContain('NEXT_CHAT_HANDOFF_JSON')
  })
})
