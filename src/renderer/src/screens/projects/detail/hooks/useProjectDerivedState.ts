import { useMemo } from 'react'
import type { Project, TaskEntity, TaskSubtask, Tag, ProjectStatus } from '@shared/types/entities'
import type { ChatConversationSummary, DetailTab, DetailViewMode, TableColumnConfig, TaskActivityMessage } from '../types'
import { columnsFromProjectStatuses } from '../status'
import { getLegacyTableOrder, getStatusOrder, getTaskNewestTime, normalizeTableColumns } from '../projectDetailUtils'
import { PROJECT_STATUS_COLUMNS } from '../status'
import { CHAT_RUNNING_ACTIVITY_STALE_MS, activityMessagesFromTask, conversationIdOf, isFreshRunningMessage, isRunCompleteMessage, messageTimeOf } from '../chat/chatUtils'

export interface ProjectDerivedStateInput {
  project: Project | null
  tasks: TaskEntity[]
  tags: Tag[]
  projectStatuses: ProjectStatus[]
  selectedTaskId: string | null
  selectedSubtaskId: string | null
  customFields: { id: string; name?: string }[]
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
  tableTasks: TaskEntity[]
  tasksByStatus: Record<string, TaskEntity[]>
  tableColumns: TableColumnConfig[]
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
  tags,
  projectStatuses,
  selectedTaskId,
  selectedSubtaskId,
  customFields,
  detailTab = 'subtasks',
  detailViewMode = 'task',
  selectedChatConversationId,
  isStartingNewChat
}: ProjectDerivedStateInput): ProjectDerivedState {
  const normalizedTags = useMemo(() => {
    const map = new Map(tags.map((tag) => [tag.id, tag]))
    return map
  }, [tags])

  const hydratedTasks = useMemo(() => tasks.map((task) => ({
    ...task,
    tags: (task.tags ?? []).map((taskTag) => {
      const source = normalizedTags.get(taskTag.id)
      return source ? { ...taskTag, ...source } : taskTag
    })
  })), [normalizedTags, tasks])

  const statusColumns = useMemo(
    () => columnsFromProjectStatuses(projectStatuses),
    [projectStatuses]
  )

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null
    return hydratedTasks.find((item) => item.id === selectedTaskId) ?? null
  }, [hydratedTasks, selectedTaskId])

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

  const orderedTasksForStatus = (rows: TaskEntity[]) => {
    const newestFirstIndex = new Map(
      [...rows]
        .sort((a, b) => getTaskNewestTime(b) - getTaskNewestTime(a))
        .map((task, index) => [task.id, index])
    )
    return rows
      .map((task, index) => ({
        task,
        index,
        order: getStatusOrder(task, task.status) ?? getLegacyTableOrder(task) ?? newestFirstIndex.get(task.id) ?? index
      }))
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map((item) => item.task)
  }

  const tasksByStatus = useMemo(() => {
    const grouped: Record<ProjectStatus['status'], TaskEntity[]> = {}
    const fallback = defaultStatus
    for (const column of statusColumns) {
      grouped[column.status] = []
    }
    for (const task of hydratedTasks) {
      const nextStatus = grouped[task.status] ? task.status : fallback
      if (!grouped[nextStatus]) grouped[nextStatus] = []
      grouped[nextStatus] = [...grouped[nextStatus], task]
    }
    Object.keys(grouped).forEach((status) => {
      grouped[status] = orderedTasksForStatus(grouped[status] ?? [])
    })
    return grouped
  }, [defaultStatus, hydratedTasks, statusColumns])

  const tableTasks = useMemo(() => {
    return [...hydratedTasks]
      .map((task, index) => ({ task, index, order: getStatusOrder(task, task.status), legacyOrder: getLegacyTableOrder(task), newest: getTaskNewestTime(task) }))
      .sort((a, b) => {
        if (a.order !== null && b.order !== null) return a.order - b.order
        if (a.order !== null) return -1
        if (b.order !== null) return 1
        if (a.legacyOrder !== null && b.legacyOrder !== null) return a.legacyOrder - b.legacyOrder
        if (a.legacyOrder !== null) return -1
        if (b.legacyOrder !== null) return 1
        if (a.newest !== b.newest) return b.newest - a.newest
        return a.index - b.index
      })
      .map((item) => item.task)
  }, [hydratedTasks])

  const chatActivityMessages = useMemo(() => {
    if (!selectedTask) return []
    return activityMessagesFromTask(selectedTask)
  }, [selectedTask])

  const chatConversations = useMemo<ChatConversationSummary[]>(() => {
    const now = Date.now()
    type ConversationState = {
      id: string
      count: number
      title: string
      source: TaskActivityMessage['source']
      latestAt: number
      latestStatus: ChatConversationSummary['status']
      model: string | undefined
      latestRunningAt: number
      completedStatus: { status: 'completed' | 'failed'; at: number } | null
    }
    const grouped = new Map<string, ConversationState>()

    for (const message of chatActivityMessages) {
      const id = conversationIdOf(message)
      if (!id) continue
      const at = messageTimeOf(message)
      const current = grouped.get(id)
      const nextTitle = message.source === 'codex-plan' ? 'Plan' : message.source === 'codex-run' ? 'Run' : 'Follow-up'
      const messageModel = typeof message.metadata?.model === 'string' ? message.metadata.model : undefined

      if (!current) {
        const status = message.status ?? 'event'
        grouped.set(id, {
          id,
          title: nextTitle,
          count: 1,
          source: message.source,
          latestAt: at,
          latestStatus: status,
          model: messageModel,
          latestRunningAt: isFreshRunningMessage(message, now) ? at : -Infinity,
          completedStatus: isRunCompleteMessage(message)
            ? {
              status: message.role === 'error' || message.status === 'failed' ? 'failed' : 'completed',
              at
            }
            : null
        })
        continue
      }

      const nextStatus = message.status ?? 'event'
      current.count += 1
      if (at > current.latestAt) {
        current.title = nextTitle
        current.source = message.source
        current.latestAt = at
        current.latestStatus = nextStatus
        current.model = messageModel ?? current.model
      }
      if (messageModel && !current.model) current.model = messageModel
      if (isFreshRunningMessage(message, now)) {
        current.latestRunningAt = Math.max(current.latestRunningAt, at)
      }
      if (isRunCompleteMessage(message)) {
        const completed = message.role === 'error' || message.status === 'failed' ? 'failed' : 'completed'
        if (!current.completedStatus || at >= current.completedStatus.at) {
          current.completedStatus = { status: completed, at }
        }
      }
    }

    const deducedConversations = Array.from(grouped.values()).map<ChatConversationSummary>((entry) => {
      let nextStatus: ChatConversationSummary['status'] = entry.latestStatus
      if (entry.latestRunningAt > -Infinity) {
        if (!entry.completedStatus || entry.latestRunningAt > entry.completedStatus.at) {
          nextStatus = 'running'
        } else {
          nextStatus = entry.completedStatus.status
        }
      } else if (nextStatus === 'running' && now - entry.latestAt > CHAT_RUNNING_ACTIVITY_STALE_MS) {
        nextStatus = entry.completedStatus?.status ?? 'completed'
      }

      return {
        id: entry.id,
        title: entry.title,
        count: entry.count,
        status: nextStatus,
        at: entry.latestAt,
        source: entry.source,
        model: entry.model
      }
    })

    return deducedConversations.sort((a, b) => b.at - a.at)
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

  const tableColumns = useMemo<TableColumnConfig[]>(() => {
    if (!project) return []
    return normalizeTableColumns(project, customFields as Array<{ id: string; name?: string }>)
  }, [project, customFields])

  return {
    tasks,
    hydratedTasks,
    selectedTask,
    selectedSubtask,
    statusColumns,
    defaultStatus,
    completedStatusIds,
    tableTasks,
    tasksByStatus,
    tableColumns,
    chatConversations,
    chatConversationsSummary: chatConversations,
    chatActivityMessages,
    selectedChatConversations,
    selectedChatSummary,
    detailTab,
    detailViewMode
  }
}
