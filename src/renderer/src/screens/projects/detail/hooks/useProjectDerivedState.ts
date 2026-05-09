import { useCallback, useMemo } from 'react'
import type { Project, TaskEntity, TaskSubtask, Tag, ProjectStatus } from '@shared/types/entities'
import type { ChatConversationSummary, DetailTab, DetailViewMode, TaskActivityMessage } from '../types'
import { columnsFromProjectStatuses } from '../status'
import { orderedTasksForStatus } from '../projectDetailUtils'
import { PROJECT_STATUS_COLUMNS } from '../status'
import { buildChatConversationSummaries, activityMessagesFromTask } from '../chat/chatUtils'

export interface ProjectDerivedStateInput {
  project: Project | null
  tasks: TaskEntity[]
  selectedTaskOverride?: TaskEntity | null
  tags: Tag[]
  projectStatuses: ProjectStatus[]
  selectedTaskId: string | null
  selectedSubtaskId: string | null
  detailTab?: DetailTab
  detailViewMode?: DetailViewMode
  selectedChatConversationId?: string
  isStartingNewChat?: boolean
}

export interface ProjectDerivedState {
  tasks: TaskEntity[]
  hydratedTasks: TaskEntity[]
  selectedTask: TaskEntity | null
  selectedSubtask: TaskSubtask | null
  statusColumns: ReturnType<typeof columnsFromProjectStatuses>
  defaultStatus: ProjectStatus['status']
  completedStatusIds: Set<ProjectStatus['status']>
  tasksByStatus: Record<string, TaskEntity[]>
  chatConversations: ChatConversationSummary[]
  chatConversationsSummary: ChatConversationSummary[]
  chatActivityMessages: TaskActivityMessage[]
  selectedChatConversations: string[]
  selectedChatSummary: ChatConversationSummary | null
  detailTab: DetailTab
  detailViewMode: DetailViewMode
}

export function useProjectDerivedState({
  project,
  tasks,
  selectedTaskOverride = null,
  tags,
  projectStatuses,
  selectedTaskId,
  selectedSubtaskId,
  detailTab = 'subtasks',
  detailViewMode = 'task',
  selectedChatConversationId,
  isStartingNewChat
}: ProjectDerivedStateInput): ProjectDerivedState {
  const normalizedTags = useMemo(() => {
    const map = new Map(tags.map((tag) => [tag.id, tag]))
    return map
  }, [tags])

  const hydrateTask = useCallback((task: TaskEntity) => ({
    ...task,
    tags: (task.tags ?? []).map((taskTag) => {
      const source = normalizedTags.get(taskTag.id)
      return source ? { ...taskTag, ...source } : taskTag
    })
  }), [normalizedTags])

  const hydratedTasks = useMemo(() => tasks.map(hydrateTask), [hydrateTask, tasks])

  const hydratedSelectedTaskOverride = useMemo(() => (
    selectedTaskOverride ? hydrateTask(selectedTaskOverride) : null
  ), [hydrateTask, selectedTaskOverride])

  const statusColumns = useMemo(
    () => columnsFromProjectStatuses(projectStatuses),
    [projectStatuses]
  )

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null
    if (hydratedSelectedTaskOverride?.id === selectedTaskId) return hydratedSelectedTaskOverride
    return hydratedTasks.find((item) => item.id === selectedTaskId) ?? null
  }, [hydratedSelectedTaskOverride, hydratedTasks, selectedTaskId])

  const selectedSubtask = useMemo<TaskSubtask | null>(() => {
    if (!selectedTask || !selectedSubtaskId) return null
    return (selectedTask.subtasks ?? []).find((item) => item.id === selectedSubtaskId) ?? null
  }, [selectedTask, selectedSubtaskId])

  const defaultStatus = useMemo(
    () => statusColumns.find((column) => column.category === 'not_started')?.status ?? statusColumns[0]?.status ?? PROJECT_STATUS_COLUMNS[0].status,
    [statusColumns]
  )

  const completedStatusIds = useMemo(
    () => new Set(statusColumns.filter((column) => column.category === 'done' || column.category === 'closed').map((column) => column.status)),
    [statusColumns]
  )

  const tasksByStatus = useMemo(() => {
    const grouped: Record<ProjectStatus['status'], TaskEntity[]> = {}
    const fallback = defaultStatus
    for (const column of statusColumns) {
      grouped[column.status] = []
    }
    for (const task of hydratedTasks) {
      const nextStatus = grouped[task.status] ? task.status : fallback
      if (!grouped[nextStatus]) grouped[nextStatus] = []
      grouped[nextStatus].push(task)
    }
    Object.keys(grouped).forEach((status) => {
      grouped[status] = orderedTasksForStatus(grouped[status] ?? [])
    })
    return grouped
  }, [defaultStatus, hydratedTasks, statusColumns])

  const chatActivityMessages = useMemo(() => {
    if (!selectedTask) return []
    return activityMessagesFromTask(selectedTask)
  }, [selectedTask])

  const chatConversations = useMemo<ChatConversationSummary[]>(() => {
    return buildChatConversationSummaries(chatActivityMessages)
  }, [chatActivityMessages])

  const chatConversationsSummary = useMemo(() => chatConversations, [chatConversations])

  const selectedChatConversations = useMemo(() => {
    const ids = new Set<string>()
    for (const conversation of chatConversations) {
      if (conversation.status === 'running') ids.add(conversation.id)
    }
    return Array.from(ids)
  }, [chatConversations])

  const selectedChatSummary = useMemo(() => {
    if (isStartingNewChat) return null
    if (!selectedChatConversationId) return null
    return chatConversations.find((conversation) => conversation.id === selectedChatConversationId) ?? null
  }, [chatConversations, isStartingNewChat, selectedChatConversationId])

  return {
    tasks,
    hydratedTasks,
    selectedTask,
    selectedSubtask,
    statusColumns,
    defaultStatus,
    completedStatusIds,
    tasksByStatus,
    chatConversations,
    chatConversationsSummary: chatConversations,
    chatActivityMessages,
    selectedChatConversations,
    selectedChatSummary,
    detailTab,
    detailViewMode
  }
}
