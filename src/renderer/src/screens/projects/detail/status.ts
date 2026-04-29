import type { ProjectStatus, TaskEntity } from '@shared/types/entities'
import type { AppSelectOption } from '@renderer/components/select/AppSelect'

export type ProjectStatusColumn = {
  key: string
  title: string
  status: TaskEntity['status']
  accent: string
  category: ProjectStatus['category']
}

export type ProjectViewMode = 'list' | 'table' | 'board'

export const PROJECT_STATUS_COLUMNS: ProjectStatusColumn[] = [
  { key: 'pending', title: 'Not started', status: 'pending', accent: '#8a99b4', category: 'not_started' },
  { key: 'running', title: 'Active', status: 'running', accent: '#2f80ed', category: 'active' },
  { key: 'failed', title: 'Review', status: 'failed', accent: '#8b5cf6', category: 'active' },
  { key: 'completed', title: 'Done', status: 'completed', accent: '#29b764', category: 'done' }
]

export function columnsFromProjectStatuses(statuses: ProjectStatus[]): ProjectStatusColumn[] {
  if (!statuses.length) return PROJECT_STATUS_COLUMNS
  return [...statuses]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((status) => ({
      key: status.id,
      title: status.name,
      status: status.id,
      accent: status.color || '#8a99b4',
      category: status.category
    }))
}

export function statusOptionsFromColumns(columns: ProjectStatusColumn[]): AppSelectOption[] {
  return columns.map((column) => ({
    label: column.title,
    value: column.status,
    color: column.accent
  }))
}

export function resolveProjectStatusColumn(status: TaskEntity['status'], columns: ProjectStatusColumn[] = PROJECT_STATUS_COLUMNS) {
  return columns.find((column) => column.status === status) ?? columns[0] ?? PROJECT_STATUS_COLUMNS[0]
}

export function formatTaskDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}
