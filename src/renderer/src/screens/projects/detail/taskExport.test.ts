import { describe, expect, it } from 'vitest'
import type { TaskChecklistItem, TaskEntity, TaskSubtask } from '@shared/types/entities'
import { buildTaskMarkdown } from './taskExport'

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
    expect(markdown).toContain('1. Read Project Inputs, Task Details, Agents.md, Skills.md, and attachments if present.')
    expect(markdown).toContain('2. Execute 1 actionable subtask in Subtasks Index order.')
    expect(markdown).not.toContain('```text')
    expect(markdown).toContain('Subtasks are the authoritative execution plan for this task.')
    expect(markdown).toContain('Optional checklist: 2')
    expect(markdown).not.toContain('complete each subtask checklist before moving on')
    expect(markdown.indexOf('### Checklist')).toBeLessThan(markdown.indexOf('### Comments'))
  })
})
