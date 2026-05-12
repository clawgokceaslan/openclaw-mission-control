import { describe, expect, it } from 'vitest'
import type { Agent } from '@shared/types/entities'
import { buildSingleAgentMarkdown, buildSingleToolMarkdown } from './entityMarkdown'
import { buildAgentMarkdown, buildToolsMarkdown } from '../screens/projects/detail/taskExport'

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

function tool() {
  return {
    id: 'tool-1',
    organizationId: 'org-1',
    name: 'List changed files',
    slug: 'list-changed-files',
    status: 'active' as const,
    toolType: 'local_command' as const,
    descriptionMarkdown: 'Use to inspect changed files.',
    commandTemplate: 'git status --short',
    approvalRequired: true,
    timeoutSeconds: 120,
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

  it('builds TOOL.md as catalog-only documentation', () => {
    const markdown = buildSingleToolMarkdown(tool())

    expect(markdown).toContain('# List changed files')
    expect(markdown).toContain('Catalog-only boundary')
    expect(markdown).toContain('git status --short')
  })

  it('builds Agents.md with active agent settings only', () => {
    const runtimeAgent = { ...agent(), tools: [tool()], toolIds: ['tool-1'] }
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
      agents: [runtimeAgent],
      skills: [],
      tags: [],
      customFields: []
    })

    expect(markdown).toContain('| Tags | research, codex |')
    expect(markdown).toContain('| Tools | List changed files |')
    expect(markdown).toContain('### Agent Prompt')
    expect(markdown).toContain('Always cite the task context.')
    expect(markdown).not.toContain('| Status |')
    expect(markdown).not.toContain('Reasoning level')
    expect(markdown).not.toContain('Execution Steps')
  })

  it('builds Tools.md from effective agent tool links', () => {
    const runtimeAgent = { ...agent(), tools: [tool()], toolIds: ['tool-1'] }
    const markdown = buildToolsMarkdown({
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
      agents: [runtimeAgent],
      skills: [],
      tags: [],
      customFields: []
    })

    expect(markdown).toContain('# Tools')
    expect(markdown).toContain('catalog definitions only')
    expect(markdown).toContain('git status --short')
  })

  it('builds Tools.md from inherited project default agent tools', () => {
    const runtimeAgent = { ...agent(), tools: [tool()], toolIds: ['tool-1'] }
    const markdown = buildToolsMarkdown({
      task: {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Task',
        status: 'active',
        createdAt: 1,
        updatedAt: 1
      },
      project: {
        id: 'project-1',
        organizationId: 'org-1',
        name: 'Project',
        archived: false,
        metrics: { defaultAgentId: 'agent-1' },
        createdAt: 1,
        updatedAt: 1
      },
      projectGroup: null,
      agents: [runtimeAgent],
      skills: [],
      tags: [],
      customFields: []
    })

    expect(markdown).toContain('Project default: Project via agent Research Agent')
    expect(markdown).toContain('git status --short')
  })
})
