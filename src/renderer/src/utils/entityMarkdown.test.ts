import { describe, expect, it } from 'vitest'
import type { Agent } from '@shared/types/entities'
import { buildSingleAgentMarkdown } from './entityMarkdown'
import { buildAgentMarkdown } from '../screens/projects/detail/taskExport'

function agent(): Agent {
  return {
    id: 'agent-1',
    organizationId: 'org-1',
    name: 'Research Agent',
    title: 'Research specialist',
    description: 'Finds relevant context.',
    heartbeatAt: 1,
    trainingMarkdown: 'Always cite the task context.',
    tags: [
      { id: 'tag-1', organizationId: 'org-1', name: 'research', color: '#0EA5E9' },
      { id: 'tag-2', organizationId: 'org-1', name: 'codex', color: '#10B981' }
    ],
    config: {
      title: 'Research specialist',
      trainingMarkdown: 'Always cite the task context.',
      executionMode: 'exec'
    },
    createdAt: 1,
    updatedAt: 2
  }
}

describe('agent markdown builders', () => {
  it('builds AGENT.md with tags and prompt without step sections', () => {
    const markdown = buildSingleAgentMarkdown(agent())

    expect(markdown).toContain('| Tags | research, codex |')
    expect(markdown).toContain('## Agent Prompt')
    expect(markdown).toContain('Always cite the task context.')
    expect(markdown).toContain('"executionMode": "exec"')
    expect(markdown).not.toContain('| Status |')
    expect(markdown).not.toContain('Reasoning level')
    expect(markdown).not.toContain('### Step')
  })

  it('builds Agents.md with active agent settings only', () => {
    const markdown = buildAgentMarkdown({
      task: {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Task',
        status: 'active',
        agentId: 'agent-1',
        createdAt: 1,
        updatedAt: 1
      },
      project: null,
      projectGroup: null,
      agents: [agent()],
      skills: [],
      tags: [],
      customFields: []
    })

    expect(markdown).toContain('| Tags | research, codex |')
    expect(markdown).toContain('### Agent Prompt')
    expect(markdown).toContain('Always cite the task context.')
    expect(markdown).not.toContain('| Status |')
    expect(markdown).not.toContain('Reasoning level')
    expect(markdown).not.toContain('Execution Steps')
  })
})
