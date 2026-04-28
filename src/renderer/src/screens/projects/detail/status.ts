import type { TaskEntity } from '@shared/types/entities'
import type { AppSelectOption } from '@renderer/components/select/AppSelect'

export type ProjectStatusColumn = {
  key: 'inbox' | 'inProgress' | 'review' | 'done'
  title: string
  status: TaskEntity['status']
  accent: string
}

export type ProjectViewMode = 'list' | 'table' | 'board'

export const PROJECT_STATUS_COLUMNS: ProjectStatusColumn[] = [
  { key: 'inbox', title: 'Inbox', status: 'pending', accent: '#8a99b4' },
  { key: 'inProgress', title: 'In Progress', status: 'running', accent: '#a45ded' },
  { key: 'review', title: 'Review', status: 'failed', accent: '#6d76f0' },
  { key: 'done', title: 'Done', status: 'completed', accent: '#29b764' }
]

export const PROJECT_STATUS_OPTIONS: AppSelectOption[] = PROJECT_STATUS_COLUMNS.map((column) => ({
  label: column.title,
  value: column.status
}))

export function resolveProjectStatusColumn(status: TaskEntity['status']) {
  return PROJECT_STATUS_COLUMNS.find((column) => column.status === status) ?? PROJECT_STATUS_COLUMNS[0]
}

export function formatTaskDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}
