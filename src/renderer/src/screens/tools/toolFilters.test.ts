import { describe, expect, it } from 'vitest'
import type { AiTool } from '@shared/types/entities'
import { applyToolFilters, toolTypeLabel } from './toolFilters'

function tool(patch: Partial<AiTool>): AiTool {
  return {
    id: patch.id ?? 'tool-1',
    organizationId: 'org-1',
    name: patch.name ?? 'List changed files',
    slug: patch.slug ?? 'list-changed-files',
    status: patch.status ?? 'active',
    toolType: patch.toolType ?? 'local_command',
    descriptionMarkdown: patch.descriptionMarkdown ?? 'Inspect git changes.',
    approvalRequired: patch.approvalRequired ?? true,
    timeoutSeconds: patch.timeoutSeconds ?? 120,
    agents: patch.agents ?? [],
    agentIds: patch.agentIds ?? [],
    createdAt: 1,
    updatedAt: 1
  }
}

describe('toolFilters', () => {
  it('filters by query, status, type, and linked agent names', () => {
    const rows = [
      tool({ id: 'tool-1', name: 'List changed files', agents: [{ id: 'agent-1', organizationId: 'org-1', name: 'Engineer', heartbeatAt: 1, createdAt: 1, updatedAt: 1 }] }),
      tool({ id: 'tool-2', name: 'Refund lookup', status: 'inactive', toolType: 'function', descriptionMarkdown: 'Billing operation.' })
    ]

    expect(applyToolFilters(rows, { query: 'engineer', status: 'all', toolType: 'all' }).map((item) => item.id)).toEqual(['tool-1'])
    expect(applyToolFilters(rows, { query: '', status: 'inactive', toolType: 'all' }).map((item) => item.id)).toEqual(['tool-2'])
    expect(applyToolFilters(rows, { query: '', status: 'all', toolType: 'function' }).map((item) => item.id)).toEqual(['tool-2'])
  })

  it('formats tool type labels', () => {
    expect(toolTypeLabel('local_command')).toBe('Local command')
    expect(toolTypeLabel('function')).toBe('Function')
  })
})
