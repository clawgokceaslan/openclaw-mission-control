import type { Agent, ProjectStatus, TaskEntity, TaskSubtask } from '@shared/types/entities'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'

export interface AnalyticsBucket {
  key: string
  label: string
  count: number
  color: string
  category?: ProjectStatus['category']
  percent: number
}

export interface AnalyticsTimelinePoint {
  label: string
  created: number
  updated: number
  completed: number
}

export interface ProjectAnalyticsModel {
  totalTasks: number
  completedTasks: number
  activeTasks: number
  reviewTasks: number
  completionRate: number
  staleTasks: number
  totalSubtasks: number
  completedSubtasks: number
  statusBuckets: AnalyticsBucket[]
  categoryBuckets: AnalyticsBucket[]
  agentBuckets: AnalyticsBucket[]
  tagBuckets: AnalyticsBucket[]
  subtaskStatusBuckets: AnalyticsBucket[]
  timeline: AnalyticsTimelinePoint[]
  dueBuckets: AnalyticsBucket[]
}

const FALLBACK_COLORS = ['#2f80ed', '#29b764', '#ff8a3d', '#8b5cf6', '#d94b5f', '#0ea5e9', '#facc15']

function percent(count: number, total: number) {
  if (total <= 0) return 0
  return Math.round((count / total) * 1000) / 10
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function shortDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isDoneCategory(category?: ProjectStatus['category']) {
  return category === 'done' || category === 'closed'
}

function columnForStatus(status: string, statusColumns: ProjectStatusColumn[]) {
  return statusColumns.find((column) => column.status === status)
}

function bucketRows(
  entries: Array<{ key: string; label: string; color?: string; category?: ProjectStatus['category'] }>,
  total: number
): AnalyticsBucket[] {
  const counts = new Map<string, AnalyticsBucket>()
  entries.forEach((entry, index) => {
    const current = counts.get(entry.key)
    if (current) {
      current.count += 1
      current.percent = percent(current.count, total)
      return
    }
    counts.set(entry.key, {
      key: entry.key,
      label: entry.label,
      color: entry.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
      category: entry.category,
      count: 1,
      percent: percent(1, total)
    })
  })
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function taskTimestamp(task: TaskEntity, key: 'createdAt' | 'updatedAt') {
  const value = task[key]
  return Number.isFinite(value) ? value : Date.now()
}

function subtaskDueAt(subtask: TaskSubtask) {
  return Number.isFinite(subtask.dueAt) ? Number(subtask.dueAt) : null
}

export function buildProjectAnalyticsModel(
  tasks: TaskEntity[],
  statusColumns: ProjectStatusColumn[],
  agents: Agent[],
  now = Date.now()
): ProjectAnalyticsModel {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((task) => isDoneCategory(columnForStatus(task.status, statusColumns)?.category)).length
  const activeTasks = tasks.filter((task) => columnForStatus(task.status, statusColumns)?.category === 'active').length
  const reviewTasks = tasks.filter((task) => {
    const column = columnForStatus(task.status, statusColumns)
    return /review|failed|blocked/i.test(`${column?.title ?? ''} ${task.status}`)
  }).length
  const staleBoundary = now - 7 * 24 * 60 * 60 * 1000
  const staleTasks = tasks.filter((task) => {
    const column = columnForStatus(task.status, statusColumns)
    return !isDoneCategory(column?.category) && taskTimestamp(task, 'updatedAt') < staleBoundary
  }).length

  const statusBuckets = bucketRows(
    tasks.map((task) => {
      const column = columnForStatus(task.status, statusColumns)
      return {
        key: task.status || 'unknown',
        label: column?.title ?? (task.status || 'Unknown'),
        color: column?.accent,
        category: column?.category
      }
    }),
    totalTasks
  )

  const categoryMeta: Record<ProjectStatus['category'], { label: string; color: string }> = {
    not_started: { label: 'Not started', color: '#8a99b4' },
    active: { label: 'Active', color: '#2f80ed' },
    done: { label: 'Done', color: '#29b764' },
    closed: { label: 'Closed', color: '#64748b' }
  }
  const categoryBuckets = bucketRows(
    tasks.map((task) => {
      const category = columnForStatus(task.status, statusColumns)?.category ?? 'not_started'
      return {
        key: category,
        label: categoryMeta[category].label,
        color: categoryMeta[category].color,
        category
      }
    }),
    totalTasks
  )

  const agentById = new Map(agents.map((agent) => [agent.id, agent.name]))
  const agentBuckets = bucketRows(
    tasks.map((task) => ({
      key: task.agentId || 'unassigned',
      label: task.agentId ? agentById.get(task.agentId) ?? 'Unknown agent' : 'Unassigned'
    })),
    totalTasks
  ).slice(0, 8)

  const tags = tasks.flatMap((task) => task.tags ?? [])
  const tagBuckets = bucketRows(
    tags.map((tag) => ({
      key: tag.id,
      label: tag.name,
      color: tag.color
    })),
    Math.max(tags.length, 1)
  ).slice(0, 8)

  const subtasks = tasks.flatMap((task) => task.subtasks ?? [])
  const totalSubtasks = subtasks.length
  const completedSubtasks = subtasks.filter((subtask) => isDoneCategory(columnForStatus(subtask.status, statusColumns)?.category)).length
  const subtaskStatusBuckets = bucketRows(
    subtasks.map((subtask) => {
      const column = columnForStatus(subtask.status, statusColumns)
      return {
        key: subtask.status || 'unknown',
        label: column?.title ?? (subtask.status || 'Unknown'),
        color: column?.accent,
        category: column?.category
      }
    }),
    totalSubtasks
  )

  const days = Array.from({ length: 14 }, (_, index) => {
    const timestamp = startOfDay(now - (13 - index) * 24 * 60 * 60 * 1000)
    return { timestamp, label: shortDate(timestamp), created: 0, updated: 0, completed: 0 }
  })
  const dayIndex = new Map(days.map((day, index) => [day.timestamp, index]))
  tasks.forEach((task) => {
    const createdIndex = dayIndex.get(startOfDay(taskTimestamp(task, 'createdAt')))
    if (createdIndex !== undefined) days[createdIndex].created += 1
    const updatedIndex = dayIndex.get(startOfDay(taskTimestamp(task, 'updatedAt')))
    if (updatedIndex !== undefined) days[updatedIndex].updated += 1
    if (isDoneCategory(columnForStatus(task.status, statusColumns)?.category) && updatedIndex !== undefined) {
      days[updatedIndex].completed += 1
    }
  })

  const dueEntries = subtasks.map((subtask) => {
    const dueAt = subtaskDueAt(subtask)
    if (!dueAt) return { key: 'no_due', label: 'No due date', color: '#8a99b4' }
    if (dueAt < now && !isDoneCategory(columnForStatus(subtask.status, statusColumns)?.category)) {
      return { key: 'overdue', label: 'Overdue', color: '#d94b5f' }
    }
    if (dueAt <= now + 7 * 24 * 60 * 60 * 1000) return { key: 'next_7', label: 'Next 7 days', color: '#ff8a3d' }
    return { key: 'later', label: 'Later', color: '#29b764' }
  })

  return {
    totalTasks,
    completedTasks,
    activeTasks,
    reviewTasks,
    completionRate: percent(completedTasks, totalTasks),
    staleTasks,
    totalSubtasks,
    completedSubtasks,
    statusBuckets,
    categoryBuckets,
    agentBuckets,
    tagBuckets,
    subtaskStatusBuckets,
    timeline: days,
    dueBuckets: bucketRows(dueEntries, Math.max(dueEntries.length, 1))
  }
}
