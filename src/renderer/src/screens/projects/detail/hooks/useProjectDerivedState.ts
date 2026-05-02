import { useMemo } from 'react'
import type { Project, TaskEntity, TaskSubtask, ProjectStatus } from '@shared/types/entities'
import type { ChatConversationSummary, DetailTab, DetailViewMode, TableColumnConfig } from '../types'
import { columnsFromProjectStatuses } from '../status'
import { getTaskNewestTime, normalizeTableColumns } from '../projectDetailUtils'

export interface ProjectDerivedStateInput {
  project: Project | null
  tasks: TaskEntity[]
  projectStatuses: ProjectStatus[]
  selectedTaskId: string | null
  selectedSubtaskId: string | null
  customFields: { id: string }[]
  detailTab?: DetailTab
  detailViewMode?: DetailViewMode
}

export interface ProjectDerivedState {
  selectedTask: TaskEntity | null
  selectedSubtask: TaskSubtask | null
  statusColumns: ReturnType<typeof columnsFromProjectStatuses>
  tableTasks: TaskEntity[]
  tasksByStatus: Record<string, TaskEntity[]>
  tableColumns: TableColumnConfig[]
  chatConversations: ChatConversationSummary[]
  conversationMessages: []
  detailTab: DetailTab
  detailViewMode: DetailViewMode
}

export function useProjectDerivedState({
  project,
  tasks,
  projectStatuses,
  selectedTaskId,
  selectedSubtaskId,
  customFields,
  detailTab = 'subtasks',
  detailViewMode = 'task'
}: ProjectDerivedStateInput): ProjectDerivedState {
  const statusColumns = useMemo(
    () => columnsFromProjectStatuses(projectStatuses),
    [projectStatuses]
  )

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null
    return tasks.find((item) => item.id === selectedTaskId) ?? null
  }, [tasks, selectedTaskId])

  const selectedSubtask = useMemo<TaskSubtask | null>(() => {
    if (!selectedTask || !selectedSubtaskId) return null
    return (selectedTask.subtasks ?? []).find((item) => item.id === selectedSubtaskId) ?? null
  }, [selectedTask, selectedSubtaskId])

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, TaskEntity[]> = {}
    for (const task of tasks) {
      const status = task.status
      if (!grouped[status]) grouped[status] = []
      grouped[status].push(task)
    }
    return grouped
  }, [tasks])

  const tableTasks = useMemo(() => {
    return [...tasks].sort((left, right) => {
      const leftOrder = getTaskNewestTime(left)
      const rightOrder = getTaskNewestTime(right)
      return rightOrder - leftOrder
    })
  }, [tasks])

  const tableColumns = useMemo<TableColumnConfig[]>(() => {
    if (!project) return []
    return normalizeTableColumns(project, customFields as Array<{ id: string; name?: string }>)
  }, [project, customFields])

  const chatConversations = useMemo<ChatConversationSummary[]>(() => {
    const payload = selectedTask?.payload
    const candidates = payload && typeof payload === 'object' ? (payload as { chatConversations?: ChatConversationSummary[] }) : undefined
    return Array.isArray(candidates?.chatConversations) ? candidates.chatConversations : []
  }, [selectedTask])

  return {
    selectedTask,
    selectedSubtask,
    statusColumns,
    tableTasks,
    tasksByStatus,
    tableColumns,
    chatConversations,
    conversationMessages: [],
    detailTab,
    detailViewMode
  }
}
