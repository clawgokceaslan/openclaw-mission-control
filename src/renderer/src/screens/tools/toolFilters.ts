import type { AiTool } from '@shared/types/entities'

export type ToolStatusFilter = 'all' | 'active' | 'inactive'
export type ToolTypeFilter = 'all' | 'local_command' | 'function' | 'code' | 'reference'

export interface ToolFilterState {
  query: string
  status: ToolStatusFilter
  toolType: ToolTypeFilter
}

export function toolTypeLabel(value: AiTool['toolType']): string {
  switch (value) {
    case 'local_command':
      return 'Local command'
    case 'function':
      return 'Function'
    case 'code':
      return 'Code'
    case 'reference':
      return 'Reference'
    default:
      return value
  }
}

export function applyToolFilters(tools: AiTool[], filters: ToolFilterState): AiTool[] {
  const needle = filters.query.trim().toLowerCase()
  return tools.filter((tool) => {
    if (filters.status !== 'all' && tool.status !== filters.status) return false
    if (filters.toolType !== 'all' && tool.toolType !== filters.toolType) return false
    if (!needle) return true
    return [
      tool.name,
      tool.slug,
      tool.toolType,
      tool.status,
      tool.descriptionMarkdown,
      tool.functionName,
      tool.commandTemplate,
      tool.prepareCommand,
      tool.workingDirectoryHint,
      tool.executionFlowMarkdown,
      (tool.agents ?? []).map((agent) => agent.name).join(' ')
    ].join(' ').toLowerCase().includes(needle)
  })
}
