import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import type { TaskChecklistItem, TaskEntity, TaskSubtask } from '@shared/types/entities'
import { buildAgentMarkdown, buildProjectWorkspaceExportTaskPayload, buildSelectedTaskFile, buildSkillsMarkdown, buildTaskImportJson, buildTaskJson, buildTaskMarkdown, buildTaskToon, buildTaskZipArchive, buildToolsMarkdown, parseTaskToon } from './taskExport'

function checklist(title: string): TaskChecklistItem {
  return { id: `check-${title}`, title, checked: false, createdAt: 1, updatedAt: 1 }
}

function subtask(): TaskSubtask {
  return {
    id: 'subtask-1',
    taskId: 'task-1',
    title: 'Update planner quality gate',
    status: 'active',
    sortOrder: 0,
    payload: {
      description: '## Objective\nReject weak planner JSON.\n\n## Task context\nPlanning writes task JSON.\n\n## Exact work\nAdd validation.\n\n## Files/areas\nsrc/main/services/task.service.ts\n\n## Done when\nWeak JSON is rejected.',
      checklistItems: [
        checklist('Reject planner JSON when a subtask checklist is missing'),
        checklist('Confirm the OMC CLI validate command reports the first quality issue')
      ],
      comments: [
        { id: 'comment-1', authorName: 'Operator', body: 'Keep checklist before comments in Task.md.', createdAt: 1 }
      ]
    },
    createdAt: 1,
    updatedAt: 1
  }
}

function task(): TaskEntity {
  return {
    id: 'task-1',
    projectId: 'project-1',
    title: 'Planner task export',
    status: 'active',
    description: 'Task context.',
    subtasks: [subtask()],
    checklistItems: [],
    createdAt: 1,
    updatedAt: 1
  }
}

describe('buildTaskMarkdown', () => {
  it('presents subtasks as the primary execution plan with optional checklist counts', () => {
    const markdown = buildTaskMarkdown({
      task: task(),
      project: null,
      projectGroup: null,
      agents: [],
      skills: [],
      tags: [],
      customFields: [],
      projectStatuses: []
    })

    expect(markdown).toContain('## Subtasks as Primary Execution Plan')
    expect(markdown).toContain('1. Read Task Details, Acceptance Criteria, Subtasks, Comments, Checklist, and attachments first.')
    expect(markdown).toContain('2. Execute 1 actionable subtask in Subtasks Index order.')
    expect(markdown.indexOf('## Task Details')).toBeLessThan(markdown.indexOf('## Project Instructions'))
    expect(markdown).not.toContain('```text')
    expect(markdown).toContain('Subtasks are the authoritative execution plan for this task.')
    expect(markdown).toContain('Optional checklist: 2')
    expect(markdown).not.toContain('complete each subtask checklist before moving on')
    expect(markdown.indexOf('### Checklist')).toBeLessThan(markdown.indexOf('### Comments'))
  })

  it('exports deterministic JSON and parseable TOON from the same task contract', () => {
    const context = {
      task: task(),
      project: {
        id: 'project-1',
        organizationId: 'org-1',
        name: 'Mission project',
        archived: false,
        metrics: { gateway: { promptShape: 'toon' } },
        createdAt: 1,
        updatedAt: 1
      },
      projectGroup: null,
      agents: [],
      skills: [],
      tags: [],
      customFields: [],
      projectStatuses: []
    }
    const json = buildTaskJson(context)
    const toon = buildTaskToon(context)
    const parsedJson = JSON.parse(json)
    const parsedToon = parseTaskToon(toon) as { task?: { title?: string }; subtasks?: unknown[] }

    expect(parsedJson.format).toBe('open_mission_control_task')
    expect(parsedJson.task.title).toBe('Planner task export')
    expect(parsedJson.references.agents).toEqual([])
    expect(parsedToon.task?.title).toBe('Planner task export')
    expect(parsedToon.subtasks).toHaveLength(1)
  })

  it('selects the gateway prompt shape as the primary task file for payloads', () => {
    const payload = buildProjectWorkspaceExportTaskPayload({
      task: task(),
      project: {
        id: 'project-1',
        organizationId: 'org-1',
        name: 'Mission project',
        archived: false,
        metrics: { gateway: { promptShape: 'json' } },
        createdAt: 1,
        updatedAt: 1
      },
      projectGroup: null,
      agents: [],
      skills: [],
      tags: [],
      customFields: [],
      projectStatuses: []
    })

    expect(payload.taskFileName).toBe('Task.json')
    expect(payload.taskJson).toContain('"format": "open_mission_control_task"')
    expect(payload.taskToon).toContain('format: "open_mission_control_task"')
  })

  it('selects one normal task download file and falls back invalid shapes to Markdown', () => {
    const jsonFile = buildSelectedTaskFile({
      task: task(),
      project: {
        id: 'project-1',
        organizationId: 'org-1',
        name: 'Mission project',
        archived: false,
        metrics: { gateway: { promptShape: 'json' } },
        createdAt: 1,
        updatedAt: 1
      },
      projectGroup: null,
      agents: [],
      skills: [],
      tags: [],
      customFields: [],
      projectStatuses: []
    })
    const fallbackFile = buildSelectedTaskFile({
      task: task(),
      project: {
        id: 'project-1',
        organizationId: 'org-1',
        name: 'Mission project',
        archived: false,
        metrics: { gateway: { promptShape: 'yaml' } },
        createdAt: 1,
        updatedAt: 1
      },
      projectGroup: null,
      agents: [],
      skills: [],
      tags: [],
      customFields: [],
      projectStatuses: []
    })

    expect(jsonFile.taskFileName).toBe('Task.json')
    expect(jsonFile.contentType).toBe('application/json;charset=utf-8')
    expect(JSON.parse(jsonFile.taskFileContent).task.title).toBe('Planner task export')
    expect(fallbackFile.taskFileName).toBe('Task.md')
    expect(fallbackFile.taskFileContent).toContain('Planner task export')
  })

  it('zips only the selected task file and attachments without Agents or Skills files', async () => {
    const zipTask = {
      ...task(),
      agentId: 'agent-1',
      skills: [{ id: 'skill-1', organizationId: 'org-1', name: 'Runtime Skill', slug: 'runtime-skill', category: 'runtime', version: '1.0.0', enabled: true, status: 'active', createdAt: 1, updatedAt: 1 }],
      payload: {
        attachments: [{ id: 'attachment-1', taskId: 'task-1', name: 'brief.txt', url: 'https://example.com/brief.txt', createdAt: 1 }]
      }
    } as TaskEntity
    const { archive } = await buildTaskZipArchive({
      task: zipTask,
      project: {
        id: 'project-1',
        organizationId: 'org-1',
        name: 'Mission project',
        archived: false,
        metrics: { gateway: { promptShape: 'toon' } },
        createdAt: 1,
        updatedAt: 1
      },
      projectGroup: null,
      agents: [{ id: 'agent-1', organizationId: 'org-1', name: 'Runtime Agent', title: 'Agent', description: 'Runs tasks', prompt: 'Do work', tags: [], createdAt: 1, updatedAt: 1 }] as any,
      skills: zipTask.skills as any,
      tags: [],
      customFields: [],
      projectStatuses: []
    })
    const files = unzipSync(archive)
    const names = Object.keys(files).sort()

    expect(names).toEqual(['Task.toon'])
    expect(strFromU8(files['Task.toon'])).toContain('format: "open_mission_control_task"')
    expect(strFromU8(files['Task.toon'])).toContain('brief.txt')
    expect(names).not.toContain('Agents.md')
    expect(names).not.toContain('Skills.md')
    expect(names).not.toContain('Task.md')
    expect(names).not.toContain('Task.json')
  })

  it('exports task JSON in the task import contract without runtime activity', () => {
    const importJson = buildTaskImportJson({
      task: {
        ...task(),
        tags: [{ id: 'tag-1', organizationId: 'org-1', name: 'frontend', color: '#fff' }],
        customFieldValues: { field_1: 'High' },
        payload: {
          agenticInputs: { acceptanceCriteria: 'Must import cleanly.' },
          activityMessages: [{ id: 'activity-1', runId: 'run-1', source: 'gateway-run', role: 'system', status: 'running', body: 'debug', createdAt: 1 }],
          debugSnapshot: { raw: true }
        }
      },
      project: null,
      projectGroup: null,
      agents: [],
      skills: [],
      tags: [{ id: 'tag-1', organizationId: 'org-1', name: 'frontend', color: '#fff' }],
      customFields: [{ id: 'field_1', organizationId: 'org-1', name: 'Priority', type: 'text' }],
      projectStatuses: []
    })

    const parsed = JSON.parse(importJson)
    expect(parsed.title).toBe('Planner task export')
    expect(parsed.acceptanceCriteria).toBe('Must import cleanly.')
    expect(parsed.tags).toEqual(['frontend'])
    expect(parsed.customFields).toEqual([{ name: 'Priority', type: 'text', value: 'High' }])
    expect(parsed.format).toBeUndefined()
    expect(importJson).not.toContain('activityMessages')
    expect(importJson).not.toContain('debugSnapshot')
  })

  it('exports project-default effective skills and inherited agent tools', () => {
    const runtimeTool = {
      id: 'tool-1',
      organizationId: 'org-1',
      name: 'List changed files',
      slug: 'list-changed-files',
      status: 'active' as const,
      toolType: 'local_command' as const,
      descriptionMarkdown: 'Inspect changed files.',
      commandTemplate: 'git status --short',
      approvalRequired: true,
      createdAt: 1,
      updatedAt: 1
    }
    const context = {
      task: { ...task(), agentId: null, skills: [] },
      project: {
        id: 'project-1',
        organizationId: 'org-1',
        name: 'Mission project',
        archived: false,
        metrics: { defaultAgentId: 'agent-1', defaultSkillIds: ['skill-1'] },
        createdAt: 1,
        updatedAt: 1
      },
      projectGroup: null,
      agents: [{ id: 'agent-1', organizationId: 'org-1', name: 'Runtime Agent', title: 'Agent', heartbeatAt: 1, tools: [runtimeTool], createdAt: 1, updatedAt: 1 }],
      skills: [{ id: 'skill-1', organizationId: 'org-1', name: 'Runtime Skill', slug: 'runtime-skill', category: 'runtime', version: '1.0.0', enabled: true, status: 'active' as const, descriptionMarkdown: 'Use runtime flow.', updatedAt: 1 }],
      tags: [],
      customFields: [],
      projectStatuses: []
    }

    expect(buildAgentMarkdown(context)).toContain('Project default: Mission project')
    expect(buildAgentMarkdown(context)).toContain('| Tools | List changed files |')
    expect(buildSkillsMarkdown(context)).toContain('Runtime Skill')
    expect(buildSkillsMarkdown(context)).toContain('Project default: Mission project')
    expect(buildToolsMarkdown(context)).toContain('git status --short')
    expect(buildToolsMarkdown(context)).toContain('Project default: Mission project via agent Runtime Agent')
  })
})
