import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  LuCheck,
  LuCalendarPlus,
  LuChevronDown,
  LuColumns3,
  LuFlag,
  LuHistory,
  LuMessageSquare,
  LuPencil,
  LuPlus,
  LuSettings2,
  LuSignal,
  LuTrash2,
  LuUserPlus,
  LuX
} from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Agent, CustomField, OutputFormat, Project, ProjectStatus, ProjectStatusCategory, Skill, Tag, TaskChecklistItem, TaskComment, TaskEntity, TaskSubtask, TaskTemplate } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { TagPill } from '@renderer/components/tags/TagPill'
import { Badge, Card, Form, Stack } from 'react-bootstrap'
import { ProjectDetailHeader } from './detail/ProjectDetailHeader'
import { ProjectBoardView } from './detail/ProjectBoardView'
import { ProjectListView } from './detail/ProjectListView'
import { ProjectTableView } from './detail/ProjectTableView'
import { CreateTaskModal } from './detail/CreateTaskModal'
import { AddSubtaskModal } from './detail/AddSubtaskModal'
import { TaskDetailModal } from './detail/TaskDetailModal'
import { PROJECT_STATUS_COLUMNS, columnsFromProjectStatuses, resolveProjectStatusColumn } from './detail/status'
import styles from './ProjectDetailPage.module.scss'

const DETAIL_RATIO_KEY = 'omc:task-modal:detail-ratio'
const DEFAULT_DETAIL_RATIO = 0.7
const MIN_DETAIL_WIDTH = 420
const MIN_COMMENTS_WIDTH = 320

type DetailViewMode = 'task' | 'subtask'
type DetailTab = 'subtasks' | 'customFields' | 'checklist' | 'outputFormat' | 'details'
type ProjectPromptTab = 'context' | 'prompt' | 'output'
type ProjectViewMode = 'list' | 'table' | 'board'

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}

function withTaskMeta(task: TaskEntity): TaskEntity {
  return {
    ...task,
    tags: Array.isArray(task.tags) ? task.tags : [],
    comments: Array.isArray(task.comments) ? task.comments : [],
    skills: Array.isArray(task.skills) ? task.skills : [],
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    checklistItems: Array.isArray(task.checklistItems) ? task.checklistItems : [],
    customFieldValues: task.customFieldValues && typeof task.customFieldValues === 'object' ? task.customFieldValues : {}
  }
}

function getTableOrder(task: TaskEntity) {
  const value = task.payload?.tableOrder
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function customFieldValueToDraft(field: CustomField, value: unknown): string {
  if (field.type === 'boolean') return value === true ? 'true' : value === false ? 'false' : ''
  if (field.type === 'json') {
    if (value === undefined) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  return value == null ? '' : String(value)
}

function customFieldValueLabel(field: CustomField, value: unknown): string {
  if (value === undefined) return 'Empty'
  if (field.type === 'boolean') return value ? 'True' : 'False'
  if (field.type === 'json') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return 'Invalid JSON'
    }
  }
  return String(value)
}

function getSubtaskCustomFieldValues(subtask: TaskSubtask | null): Record<string, unknown> {
  if (!subtask) return {}
  const payload = getSubtaskPayload(subtask)
  const values = payload.customFields
  return values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : {}
}

function getSubtaskPayload(subtask: TaskSubtask): Record<string, unknown> {
  return subtask.payload && typeof subtask.payload === 'object' && !Array.isArray(subtask.payload)
    ? subtask.payload as Record<string, unknown>
    : {}
}

function getSubtaskDescription(subtask: TaskSubtask): string {
  const payload = getSubtaskPayload(subtask)
  return typeof payload.description === 'string' ? payload.description : (subtask.description ?? '')
}

function getSubtaskAgentId(subtask: TaskSubtask | null): string | undefined {
  if (!subtask) return undefined
  const payload = getSubtaskPayload(subtask)
  if (typeof payload.agentId === 'string' && payload.agentId.trim()) return payload.agentId
  if (typeof payload.assigneeId === 'string' && payload.assigneeId.trim()) return payload.assigneeId
  return subtask.assigneeId
}

function getTaskOutputFormatId(task: TaskEntity | null): string | undefined {
  const value = task?.payload?.outputFormatId
  return typeof value === 'string' && value ? value : undefined
}

function getSubtaskOutputFormatId(subtask: TaskSubtask | null): string | undefined {
  if (!subtask) return undefined
  const value = getSubtaskPayload(subtask).outputFormatId
  return typeof value === 'string' && value ? value : undefined
}

function getSubtaskDueAt(subtask: TaskSubtask): number | undefined {
  const payload = getSubtaskPayload(subtask)
  if (typeof payload.dueAt === 'number') return payload.dueAt
  return subtask.dueAt
}

function createLocalId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type TaskHistoryItem = {
  at: number
  patch: string
}

type ThreadEntry = {
  id: string
  at: number
  author: string
  eventType: string
  summary: string
  fields: Array<{ key: string; value: string }>
  evidence: string[]
  next?: string
}

function parseHistoryPatch(item: TaskHistoryItem, index: number): ThreadEntry {
  const baseId = `history-${item.at}-${index}`

  try {
    const parsed = JSON.parse(item.patch) as Record<string, unknown>
    const action = typeof parsed.action === 'string' ? parsed.action : 'updated'
    const status = typeof parsed.status === 'string' ? parsed.status : 'unknown'
    const fields: Array<{ key: string; value: string }> = [
      { key: 'action', value: action },
      { key: 'status', value: status }
    ]
    if (typeof parsed.id === 'string') {
      fields.push({ key: 'id', value: parsed.id })
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (['action', 'status', 'id'].includes(key)) continue
      if (value == null) continue
      fields.push({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })
    }

    return {
      id: baseId,
      at: item.at,
      author: 'System',
      eventType: 'Update',
      summary: `Task ${action}`,
      fields,
      evidence: [`Status changed to ${status}`],
      next: 'Review the latest changes in this task.'
    }
  } catch {
    return {
      id: baseId,
      at: item.at,
      author: 'System',
      eventType: 'Unstructured update',
      summary: 'History event could not be parsed.',
      fields: [],
      evidence: ['Non-JSON patch payload detected.']
    }
  }
}

function asCommentThread(comment: TaskComment): ThreadEntry {
  return {
    id: `comment-${comment.id}`,
    at: comment.createdAt,
    author: comment.authorName || 'Operator',
    eventType: 'Comment added',
    summary: 'Added a comment',
    fields: [],
    evidence: [comment.body]
  }
}

function clampRatio(value: number) {
  if (Number.isNaN(value)) return DEFAULT_DETAIL_RATIO
  return Math.max(0.45, Math.min(0.8, value))
}

function loadInitialRatio() {
  if (typeof window === 'undefined') return DEFAULT_DETAIL_RATIO
  const saved = window.localStorage.getItem(DETAIL_RATIO_KEY)
  if (!saved) return DEFAULT_DETAIL_RATIO
  return clampRatio(Number(saved))
}

export function ProjectDetailPage() {
  const params = useParams<{ projectId?: string }>()
  const projectId = params.projectId
  const { token, user } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([])
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([])
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>([])
  const [viewMode, setViewMode] = useState<ProjectViewMode>('board')
  const [taskTitle, setTaskTitle] = useState('')
  const [listCreateStatus, setListCreateStatus] = useState<TaskEntity['status'] | null>(null)
  const [listCreateTitle, setListCreateTitle] = useState('')
  const [tableCreateActive, setTableCreateActive] = useState(false)
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false)
  const [isStatusEditorOpen, setIsStatusEditorOpen] = useState(false)
  const [isProjectPromptSettingsOpen, setIsProjectPromptSettingsOpen] = useState(false)
  const [projectPromptTab, setProjectPromptTab] = useState<ProjectPromptTab>('context')
  const [projectPromptContext, setProjectPromptContext] = useState('')
  const [projectPromptPrompt, setProjectPromptPrompt] = useState('')
  const [projectPromptOutput, setProjectPromptOutput] = useState('')
  const [projectPromptError, setProjectPromptError] = useState<string | null>(null)
  const [isProjectPromptSaving, setIsProjectPromptSaving] = useState(false)
  const [statusDrafts, setStatusDrafts] = useState<ProjectStatus[]>([])
  const [statusMapping, setStatusMapping] = useState<Record<string, string>>({})
  const [createTaskStatus, setCreateTaskStatus] = useState<TaskEntity['status']>('pending')
  const [collapsedStatuses, setCollapsedStatuses] = useState<TaskEntity['status'][]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(false)
  const [isDescriptionSaving, setIsDescriptionSaving] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTab>('subtasks')
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>('task')
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [subtaskDescriptionDraft, setSubtaskDescriptionDraft] = useState('')
  const [isSubtaskDescriptionSaving, setIsSubtaskDescriptionSaving] = useState(false)
  const [subtaskDueDraft, setSubtaskDueDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [isAddSubtaskOpen, setIsAddSubtaskOpen] = useState(false)
  const [checklistDraft, setChecklistDraft] = useState('')
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null)
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [selectedCustomFieldOption, setSelectedCustomFieldOption] = useState<AppSelectOption | null>(null)
  const [editingCustomFieldId, setEditingCustomFieldId] = useState<string | null>(null)
  const [customFieldDraft, setCustomFieldDraft] = useState('')
  const [customFieldError, setCustomFieldError] = useState<string | null>(null)
  const [pendingDeleteSubtaskId, setPendingDeleteSubtaskId] = useState<string | null>(null)
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<string[]>([])
  const [subtaskStatusMenu, setSubtaskStatusMenu] = useState<{ subtaskId: string; left: number; top: number } | null>(null)
  const [history, setHistory] = useState<TaskHistoryItem[]>([])
  const [localActivityEntries, setLocalActivityEntries] = useState<ThreadEntry[]>([])
  const [detailRatio, setDetailRatio] = useState(loadInitialRatio)
  const [isResizingSplit, setIsResizingSplit] = useState(false)

  const modalBodyRef = useRef<HTMLDivElement | null>(null)
  const activityFeedRef = useRef<HTMLDivElement | null>(null)
  const subtaskStatusMenuRef = useRef<HTMLDivElement | null>(null)
  const keepActivityBottomRef = useRef(true)

  const projectLoadError = projectId ? null : 'Project id not found.'

  const refresh = async () => {
    if (!projectId) return
    const [projectResponse, taskResponse, tagsResponse, skillsResponse, customFieldsResponse, agentsResponse, outputFormatsResponse, taskTemplatesResponse, statusesResponse] = await Promise.all([
      invokeBridge<Project>(IPC_CHANNELS.projects.get, { actorToken: token, id: projectId }),
      invokeBridge<TaskEntity[]>(IPC_CHANNELS.tasks.list, { actorToken: token, projectId }),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token),
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId })
    ])

    if (!projectResponse.ok || !projectResponse.data) {
      setError(projectResponse.error?.message ?? 'Project not found')
      setProject(null)
      return
    }

    setProject(projectResponse.data)
    setTasks(Array.isArray(taskResponse.data) ? taskResponse.data.map(withTaskMeta) : [])
    setTags(Array.isArray(tagsResponse.data) ? tagsResponse.data : [])
    setSkills(Array.isArray(skillsResponse.data) ? skillsResponse.data : [])
    setCustomFields(Array.isArray(customFieldsResponse.data) ? customFieldsResponse.data : [])
    setAgents(Array.isArray(agentsResponse.data) ? agentsResponse.data : [])
    setOutputFormats(Array.isArray(outputFormatsResponse.data) ? outputFormatsResponse.data : [])
    setTaskTemplates(Array.isArray(taskTemplatesResponse.data) ? taskTemplatesResponse.data : [])
    setProjectStatuses(Array.isArray(statusesResponse.data) ? statusesResponse.data : [])
    setError(!taskResponse.ok
      ? taskResponse.error?.message ?? 'Unable to load tasks'
      : !outputFormatsResponse.ok
        ? outputFormatsResponse.error?.message ?? 'Unable to load output formats'
        : !taskTemplatesResponse.ok
          ? taskTemplatesResponse.error?.message ?? 'Unable to load task templates'
          : null)
  }

  useEffect(() => {
    void refresh()
  }, [projectId, token])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DETAIL_RATIO_KEY, String(detailRatio))
  }, [detailRatio])

  const hydratedTasks = useMemo(() => {
    const tagById = new Map(tags.map((tag) => [tag.id, tag]))
    return tasks.map((task) => ({
      ...task,
      tags: (task.tags ?? []).map((taskTag) => {
        const source = tagById.get(taskTag.id)
        return source ? { ...taskTag, ...source } : taskTag
      })
    }))
  }, [tasks, tags])

  const selectedTask = useMemo(
    () => hydratedTasks.find((task) => task.id === selectedTaskId) ?? null,
    [hydratedTasks, selectedTaskId]
  )

  useEffect(() => {
    setTitleDraft(selectedTask?.title ?? '')
    setDescriptionDraft(selectedTask?.description ?? '')
    setCommentDraft('')
    setEditingCommentId(null)
    setIsAddSubtaskOpen(false)
    setChecklistDraft('')
    setEditingSubtaskId(null)
    setSubtaskDraft('')
    setSelectedCustomFieldOption(null)
    setEditingCustomFieldId(null)
    setCustomFieldDraft('')
    setCustomFieldError(null)
    setPendingDeleteSubtaskId(null)
    setSelectedSubtaskIds([])
    setIsTitleEditing(false)
    setIsDescriptionEditing(false)
    setDetailTab('subtasks')
    setDetailViewMode('task')
    setSelectedSubtaskId(null)
    setSubtaskDescriptionDraft('')
    setSubtaskDueDraft('')
    setIsActivityModalOpen(false)
    setLocalActivityEntries([])
    keepActivityBottomRef.current = true
  }, [selectedTask?.id])

  const selectedSubtask = useMemo(
    () => selectedTask?.subtasks?.find((item) => item.id === selectedSubtaskId) ?? null,
    [selectedTask, selectedSubtaskId]
  )

  useEffect(() => {
    if (!selectedSubtask) {
      setSubtaskDescriptionDraft('')
      setSubtaskDueDraft('')
      return
    }
    setSubtaskDescriptionDraft(getSubtaskDescription(selectedSubtask))
    const dueAt = getSubtaskDueAt(selectedSubtask)
    setSubtaskDueDraft(dueAt ? new Date(dueAt).toISOString().slice(0, 10) : '')
  }, [selectedSubtask?.id])

  useEffect(() => {
    if (!selectedTask?.id) {
      setHistory([])
      return
    }

    const loadHistory = async () => {
      const response = await invokeBridge<TaskHistoryItem[]>(IPC_CHANNELS.tasks.history, {
        actorToken: token,
        id: selectedTask.id
      })
      if (!response.ok) {
        setHistory([])
        return
      }
      setHistory(Array.isArray(response.data) ? response.data : [])
    }

    void loadHistory()
  }, [selectedTask?.id, token])

  useEffect(() => {
    if (!selectedTask) return
    const onEsc = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }
      if (event.key === 'Escape') {
        if (isActivityModalOpen) {
          setIsActivityModalOpen(false)
          return
        }
        if (detailViewMode === 'subtask') {
          setDetailViewMode('task')
          setSelectedSubtaskId(null)
          setDetailTab('subtasks')
          return
        }
        setSelectedTaskId(null)
      }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [selectedTask, isActivityModalOpen, detailViewMode])

  useEffect(() => {
    if (!isResizingSplit) return

    const onMouseMove = (event: MouseEvent) => {
      const body = modalBodyRef.current
      if (!body) return
      const bounds = body.getBoundingClientRect()
      const width = bounds.width
      const relativeX = event.clientX - bounds.left
      const minRatio = MIN_DETAIL_WIDTH / width
      const maxRatio = 1 - (MIN_COMMENTS_WIDTH / width)
      const nextRatio = Math.max(minRatio, Math.min(maxRatio, relativeX / width))
      setDetailRatio(clampRatio(nextRatio))
    }

    const onMouseUp = () => {
      setIsResizingSplit(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isResizingSplit])

  useEffect(() => {
    if (!subtaskStatusMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && subtaskStatusMenuRef.current?.contains(target)) return
      setSubtaskStatusMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [subtaskStatusMenu])

  const visibleTasks = useMemo(() => hydratedTasks, [hydratedTasks])
  const statusColumns = useMemo(() => columnsFromProjectStatuses(projectStatuses), [projectStatuses])
  const defaultStatus = useMemo(
    () => statusColumns.find((column) => column.category === 'not_started')?.status ?? statusColumns[0]?.status ?? PROJECT_STATUS_COLUMNS[0].status,
    [statusColumns]
  )
  const completedStatusIds = useMemo(
    () => new Set(statusColumns.filter((column) => column.category === 'done' || column.category === 'closed').map((column) => column.status)),
    [statusColumns]
  )

  const tableTasks = useMemo(() => {
    return visibleTasks
      .map((task, index) => ({ task, index, order: getTableOrder(task) }))
      .sort((a, b) => {
        if (a.order !== null && b.order !== null) return a.order - b.order
        if (a.order !== null) return -1
        if (b.order !== null) return 1
        return a.index - b.index
      })
      .map((item) => item.task)
  }, [visibleTasks])

  const tasksByStatus = useMemo(() => {
    const grouped = statusColumns.reduce<Record<TaskEntity['status'], TaskEntity[]>>((acc, column) => {
      acc[column.status] = []
      return acc
    }, {})
    const fallback = defaultStatus
    for (const task of visibleTasks) {
      const target = grouped[task.status] ? task.status : fallback
      grouped[target] = [...(grouped[target] ?? []), task]
    }
    return grouped
  }, [defaultStatus, statusColumns, visibleTasks])

  const selectedTaskTagOptions: AppSelectOption[] = useMemo(() => {
    if (!selectedTask) return []
    return [...(selectedTask.tags ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((tag) => ({ label: tag.name, value: tag.id, color: tag.color }))
  }, [selectedTask])

  const availableTagOptions: AppSelectOption[] = useMemo(() => {
    return [...tags]
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((tag) => ({ value: tag.id, label: tag.name, color: tag.color }))
  }, [tags])

  const selectedTaskSkillOptions: AppSelectOption[] = useMemo(() => {
    if (!selectedTask) return []
    return [...(selectedTask.skills ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((skill) => ({ label: skill.name, value: skill.id }))
  }, [selectedTask])

  const availableSkillOptions: AppSelectOption[] = useMemo(() => {
    const selectedSkillIds = new Set((selectedTask?.skills ?? []).map((skill) => skill.id))
    return [...skills]
      .filter((skill) => skill.status === 'active' || skill.enabled || selectedSkillIds.has(skill.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((skill) => ({ value: skill.id, label: skill.name }))
  }, [selectedTask, skills])

  const agentOptions: AppSelectOption[] = useMemo(() => {
    return [...agents]
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((agent) => ({ value: agent.id, label: agent.name }))
  }, [agents])

  const outputFormatOptions: AppSelectOption[] = useMemo(() => {
    return [...outputFormats]
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((format) => ({ value: format.id, label: format.name }))
  }, [outputFormats])

  const outputFormatById = useMemo(() => new Map(outputFormats.map((format) => [format.id, format])), [outputFormats])

  const selectedTaskAgentOption: AppSelectOption | null = useMemo(() => {
    if (!selectedTask?.agentId) return null
    const agent = agents.find((item) => item.id === selectedTask.agentId)
    return agent ? { value: agent.id, label: agent.name } : null
  }, [agents, selectedTask])

  const selectedTaskOutputFormatOption: AppSelectOption | null = useMemo(() => {
    const outputFormatId = getTaskOutputFormatId(selectedTask)
    if (!outputFormatId) return null
    const format = outputFormatById.get(outputFormatId)
    return format ? { value: format.id, label: format.name } : null
  }, [outputFormatById, selectedTask])

  const selectedSubtaskAgentOption: AppSelectOption | null = useMemo(() => {
    const agentId = getSubtaskAgentId(selectedSubtask)
    if (!agentId) return null
    const agent = agents.find((item) => item.id === agentId)
    return agent ? { value: agent.id, label: agent.name } : null
  }, [agents, selectedSubtask])

  const selectedSubtaskOutputFormatOption: AppSelectOption | null = useMemo(() => {
    const outputFormatId = getSubtaskOutputFormatId(selectedSubtask)
    if (!outputFormatId) return null
    const format = outputFormatById.get(outputFormatId)
    return format ? { value: format.id, label: format.name } : null
  }, [outputFormatById, selectedSubtask])

  const resolveSubtaskAgentName = (subtask: TaskSubtask) => {
    const agentId = getSubtaskAgentId(subtask)
    if (!agentId) return 'Unassigned'
    return agents.find((item) => item.id === agentId)?.name ?? 'Unassigned'
  }

  const assignedCustomFieldValues = useMemo(() => {
    const values = selectedTask?.customFieldValues ?? {}
    return customFields
      .filter((field) => Object.prototype.hasOwnProperty.call(values, field.id))
      .map((field) => ({ field, value: values[field.id] }))
  }, [customFields, selectedTask])

  const assignedSubtaskCustomFieldValues = useMemo(() => {
    const values = getSubtaskCustomFieldValues(selectedSubtask)
    return customFields
      .filter((field) => Object.prototype.hasOwnProperty.call(values, field.id))
      .map((field) => ({ field, value: values[field.id] }))
  }, [customFields, selectedSubtask])

  const availableCustomFieldOptions: AppSelectOption[] = useMemo(() => {
    const values = selectedTask?.customFieldValues ?? {}
    return customFields
      .filter((field) => !Object.prototype.hasOwnProperty.call(values, field.id))
      .map((field) => ({ value: field.id, label: field.name }))
  }, [customFields, selectedTask])

  const availableSubtaskCustomFieldOptions: AppSelectOption[] = useMemo(() => {
    const values = getSubtaskCustomFieldValues(selectedSubtask)
    return customFields
      .filter((field) => !Object.prototype.hasOwnProperty.call(values, field.id))
      .map((field) => ({ value: field.id, label: field.name }))
  }, [customFields, selectedSubtask])

  const activityEntries = useMemo(() => {
    if (!selectedTask) return []
    const commentEntries = (selectedTask.comments ?? []).map(asCommentThread)
    const historyEntries = history.map((item, index) => parseHistoryPatch(item, index))
    return [...commentEntries, ...historyEntries, ...localActivityEntries].sort((a, b) => a.at - b.at)
  }, [history, localActivityEntries, selectedTask])

  const orderedComments = useMemo(() => {
    if (!selectedTask) return []
    return [...(selectedTask.comments ?? [])].sort((a, b) => a.createdAt - b.createdAt)
  }, [selectedTask])

  useEffect(() => {
    const feed = activityFeedRef.current
    if (!feed || !isActivityModalOpen) return
    if (keepActivityBottomRef.current) {
      feed.scrollTop = feed.scrollHeight
    }
  }, [activityEntries.length, isActivityModalOpen])

  const onActivityScroll = () => {
    const feed = activityFeedRef.current
    if (!feed) return
    const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    keepActivityBottomRef.current = distanceToBottom < 36
  }

  const updateTaskStatus = async (taskId: string, status: TaskEntity['status']) => {
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: taskId,
      status
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to move task')
      return
    }
    await refresh()
  }

  const reorderTableTasks = async (sourceTaskId: string, targetTaskId: string) => {
    if (sourceTaskId === targetTaskId) return
    const sourceIndex = tableTasks.findIndex((task) => task.id === sourceTaskId)
    const targetIndex = tableTasks.findIndex((task) => task.id === targetTaskId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const sourceTask = tableTasks[sourceIndex]
    const nextTasks = tableTasks.filter((task) => task.id !== sourceTaskId)
    const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextTasks.splice(adjustedTargetIndex, 0, sourceTask)

    setTasks((current) => current.map((task) => {
      const nextIndex = nextTasks.findIndex((item) => item.id === task.id)
      return nextIndex >= 0 ? { ...task, payload: { ...(task.payload ?? {}), tableOrder: nextIndex } } : task
    }))

    const responses = await Promise.all(nextTasks.map((task, index) => invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: task.id,
      payload: { tableOrder: index }
    })))
    const failed = responses.find((response) => !response.ok)
    if (failed) {
      setError(failed.error?.message ?? 'Unable to save table order')
      await refresh()
    }
  }

  const onDropColumn = async (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain')
    if (!taskId) return
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.status === status) return
    await updateTaskStatus(taskId, status)
  }

  const handleQuickCreate = async () => {
    if (!projectId || !taskTitle.trim()) return
    setBusy(true)
    const response = await invokeBridge(IPC_CHANNELS.tasks.create, {
      actorToken: token,
      projectId,
      title: taskTitle.trim(),
      status: defaultStatus
    })
    setBusy(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Task create failed')
      return
    }
    setTaskTitle('')
    await refresh()
  }

  const openCreateTask = (status: TaskEntity['status'] = defaultStatus) => {
    setCreateTaskStatus(status)
    setIsCreateTaskOpen(true)
  }

  const handleCreateTask = async (input: { title: string; description: string; status: TaskEntity['status']; tagIds: string[]; agentId?: string | null; templateId?: string | null }) => {
    if (!projectId || !input.title.trim()) return
    setBusy(true)
    const selectedTemplate = input.templateId ? taskTemplates.find((template) => template.id === input.templateId) : null
    const templatePayload = selectedTemplate?.template
    const normalizeTemplateStatus = (value?: string | null) => {
      if (value && statusColumns.some((column) => column.status === value)) return value as TaskEntity['status']
      return defaultStatus
    }
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.create, {
      actorToken: token,
      projectId,
      title: input.title.trim(),
      status: normalizeTemplateStatus(input.status),
      description: input.description,
      agentId: input.agentId ?? null
    })
    if (!response.ok || !response.data) {
      setBusy(false)
      setError(response.error?.message ?? 'Task create failed')
      return
    }
    if (input.tagIds.length > 0) {
      const tagResponse = await invokeBridge<Tag[]>(IPC_CHANNELS.tasks.tagsSet, {
        actorToken: token,
        taskId: response.data.id,
        tagIds: input.tagIds
      })
      if (!tagResponse.ok) {
        setError(tagResponse.error?.message ?? 'Task created, but tags could not be applied')
      }
    }
    if (templatePayload) {
      const payloadPatch: Record<string, unknown> = {}
      if (typeof templatePayload.outputFormatId === 'string' && templatePayload.outputFormatId) {
        payloadPatch.outputFormatId = templatePayload.outputFormatId
      }
      const hasTaskPatch = Object.keys(payloadPatch).length > 0
        || Boolean(templatePayload.customFieldValues && typeof templatePayload.customFieldValues === 'object' && !Array.isArray(templatePayload.customFieldValues))
        || Array.isArray(templatePayload.checklistItems)
      if (hasTaskPatch) {
        const updateResponse = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
          actorToken: token,
          id: response.data.id,
          payload: payloadPatch,
          customFieldValues: templatePayload.customFieldValues,
          checklistItems: templatePayload.checklistItems
        })
        if (!updateResponse.ok) {
          setError(updateResponse.error?.message ?? 'Task created, but template details could not be applied')
        }
      }
      if (Array.isArray(templatePayload.skillIds) && templatePayload.skillIds.length > 0) {
        const skillResponse = await invokeBridge<Skill[]>(IPC_CHANNELS.tasks.skillsSet, {
          actorToken: token,
          taskId: response.data.id,
          skillIds: templatePayload.skillIds
        })
        if (!skillResponse.ok) {
          setError(skillResponse.error?.message ?? 'Task created, but template skills could not be applied')
        }
      }
      if (Array.isArray(templatePayload.subtasks)) {
        for (const templateSubtask of templatePayload.subtasks) {
          const subtaskTitle = templateSubtask.title?.trim()
          if (!subtaskTitle) continue
          const subtaskResponse = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksCreate, {
            actorToken: token,
            taskId: response.data.id,
            title: subtaskTitle,
            status: normalizeTemplateStatus(templateSubtask.status)
          })
          if (!subtaskResponse.ok || !subtaskResponse.data) {
            setError(subtaskResponse.error?.message ?? 'Task created, but a template subtask could not be applied')
            continue
          }
          const subtaskPayload = templateSubtask.payload && typeof templateSubtask.payload === 'object' && !Array.isArray(templateSubtask.payload)
            ? { ...templateSubtask.payload }
            : {}
          if (typeof templateSubtask.agentId === 'string') {
            subtaskPayload.agentId = templateSubtask.agentId
            subtaskPayload.assigneeId = templateSubtask.agentId
          }
          if (typeof templateSubtask.dueAt === 'number') {
            subtaskPayload.dueAt = templateSubtask.dueAt
          }
          if (typeof templateSubtask.outputFormatId === 'string' && templateSubtask.outputFormatId) {
            subtaskPayload.outputFormatId = templateSubtask.outputFormatId
          }
          if (Object.keys(subtaskPayload).length > 0) {
            const subtaskUpdateResponse = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
              actorToken: token,
              id: subtaskResponse.data.id,
              payload: subtaskPayload
            })
            if (!subtaskUpdateResponse.ok) {
              setError(subtaskUpdateResponse.error?.message ?? 'Task created, but template subtask details could not be applied')
            }
          }
        }
      }
    }
    setBusy(false)
    setIsCreateTaskOpen(false)
    await refresh()
  }

  const handleListCreate = async (status: TaskEntity['status']) => {
    if (!projectId || !listCreateTitle.trim()) return
    setBusy(true)
    const response = await invokeBridge(IPC_CHANNELS.tasks.create, {
      actorToken: token,
      projectId,
      title: listCreateTitle.trim(),
      status
    })
    setBusy(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Task create failed')
      return
    }
    setListCreateTitle('')
    setListCreateStatus(null)
    setTableCreateActive(false)
    await refresh()
  }

  const toggleStatusGroup = (status: TaskEntity['status']) => {
    setCollapsedStatuses((prev) => (
      prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status]
    ))
  }

  const resolveColumnByStatus = (status: TaskEntity['status']) => resolveProjectStatusColumn(status, statusColumns)

  const openStatusEditor = () => {
    setStatusDrafts(projectStatuses)
    setStatusMapping({})
    setIsStatusEditorOpen(true)
  }

  const openProjectPromptSettings = () => {
    if (!project) return
    setProjectPromptTab('context')
    setProjectPromptContext(project.generalContext ?? '')
    setProjectPromptPrompt(project.generalPrompt ?? '')
    setProjectPromptOutput(project.defaultOutput ?? '')
    setProjectPromptError(null)
    setIsProjectPromptSettingsOpen(true)
  }

  const saveProjectPromptSettings = async () => {
    if (!project) return
    setIsProjectPromptSaving(true)
    setProjectPromptError(null)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      generalContext: projectPromptContext,
      generalPrompt: projectPromptPrompt,
      defaultOutput: projectPromptOutput
    })
    setIsProjectPromptSaving(false)
    if (!response.ok || !response.data) {
      setProjectPromptError(response.error?.message ?? 'Unable to save project prompt settings')
      return
    }
    setProject(response.data)
    setIsProjectPromptSettingsOpen(false)
  }

  const updateStatusDraft = (id: string, patch: Partial<ProjectStatus>) => {
    setStatusDrafts((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item))
  }

  const addActiveStatus = () => {
    const now = Date.now()
    const id = createLocalId()
    setStatusDrafts((current) => [
      ...current,
      {
        id,
        organizationId: project.organizationId,
        projectId: project.id,
        name: 'New active status',
        category: 'active',
        color: '#5B7CFA',
        sortOrder: current.length,
        isDefault: false,
        createdAt: now,
        updatedAt: now
      }
    ])
  }

  const removeStatusDraft = (status: ProjectStatus) => {
    if (status.category !== 'active') return
    setStatusDrafts((current) => current.filter((item) => item.id !== status.id))
    setStatusMapping((current) => ({ ...current, [status.id]: defaultStatus }))
  }

  const saveProjectStatuses = async () => {
    if (!projectId) return
    const response = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.updateProjectStatuses, {
      actorToken: token,
      projectId,
      items: statusDrafts.map((item, index) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        color: item.color,
        sortOrder: index,
        isDefault: item.category === 'not_started'
      })),
      mapping: statusMapping
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update project statuses')
      return
    }
    setIsStatusEditorOpen(false)
    await refresh()
  }

  const saveDescription = async () => {
    if (!selectedTask) return
    if (descriptionDraft === (selectedTask.description ?? '')) {
      setIsDescriptionEditing(false)
      return
    }
    setIsDescriptionSaving(true)
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      description: descriptionDraft
    })
    setIsDescriptionSaving(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update description')
      setDescriptionDraft(selectedTask.description ?? '')
      return
    }
    setIsDescriptionEditing(false)
    await refresh()
  }

  const setTaskTags = async (nextTagIds: string[]) => {
    if (!selectedTask) return
    const response = await invokeBridge<Tag[]>(IPC_CHANNELS.tasks.tagsSet, {
      actorToken: token,
      taskId: selectedTask.id,
      tagIds: nextTagIds
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update task tags')
      return
    }
    await refresh()
  }

  const setTaskSkills = async (nextSkillIds: string[]) => {
    if (!selectedTask) return
    const response = await invokeBridge<Skill[]>(IPC_CHANNELS.tasks.skillsSet, {
      actorToken: token,
      taskId: selectedTask.id,
      skillIds: nextSkillIds
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update task skills')
      return
    }
    await refresh()
  }

  const setTaskAgent = async (agentId: string | null) => {
    if (!selectedTask) return
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      agentId
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update task agent')
      return
    }
    await refresh()
  }

  const setSubtaskAgent = async (agentId: string | null) => {
    if (!selectedSubtask) return
    const agent = agentId ? agents.find((item) => item.id === agentId) : null
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        agentId: agentId ?? '',
        assigneeId: agentId ?? '',
        assigneeName: agent?.name ?? ''
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask agent')
      return
    }
    await refresh()
  }

  const setTaskOutputFormat = async (outputFormatId: string | null) => {
    if (!selectedTask) return
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      payload: {
        ...(selectedTask.payload ?? {}),
        outputFormatId: outputFormatId ?? ''
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update task output format')
      return
    }
    await refresh()
  }

  const setSubtaskOutputFormat = async (outputFormatId: string | null) => {
    if (!selectedSubtask) return
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        outputFormatId: outputFormatId ?? ''
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask output format')
      return
    }
    await refresh()
  }

  const parseCustomFieldDraft = (field: CustomField): { ok: true; value: unknown } | { ok: false; error: string } => {
    const draft = customFieldDraft.trim()
    if (field.type === 'number') {
      if (!draft) return { ok: false, error: 'Number value is required.' }
      const value = Number(draft)
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'Number value is invalid.' }
    }
    if (field.type === 'boolean') {
      return { ok: true, value: draft === 'true' }
    }
    if (field.type === 'json') {
      if (!draft) return { ok: false, error: 'JSON value is required.' }
      try {
        return { ok: true, value: JSON.parse(draft) }
      } catch {
        return { ok: false, error: 'JSON value is invalid.' }
      }
    }
    return { ok: true, value: customFieldDraft }
  }

  const saveCustomFieldValue = async (field: CustomField) => {
    if (!selectedTask) return
    const parsed = parseCustomFieldDraft(field)
    if (!parsed.ok) {
      setCustomFieldError(parsed.error)
      return
    }
    const isSubtaskContext = detailViewMode === 'subtask' && selectedSubtask
    const knownFieldIds = new Set(customFields.map((item) => item.id))
    const currentValues = isSubtaskContext ? getSubtaskCustomFieldValues(selectedSubtask) : (selectedTask.customFieldValues ?? {})
    const nextValues = {
      ...Object.fromEntries(Object.entries(currentValues).filter(([key]) => knownFieldIds.has(key))),
      [field.id]: parsed.value
    }
    const response = isSubtaskContext
      ? await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
        actorToken: token,
        id: selectedSubtask.id,
        payload: {
          ...getSubtaskPayload(selectedSubtask),
          customFields: nextValues
        }
      })
      : await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
        actorToken: token,
        id: selectedTask.id,
        customFieldValues: nextValues
      })
    if (!response.ok) {
      setCustomFieldError(response.error?.message ?? 'Unable to update custom field')
      return
    }
    setCustomFieldError(null)
    setEditingCustomFieldId(null)
    setSelectedCustomFieldOption(null)
    setCustomFieldDraft('')
    await refresh()
  }

  const removeCustomFieldValue = async (fieldId: string) => {
    if (!selectedTask) return
    const isSubtaskContext = detailViewMode === 'subtask' && selectedSubtask
    const knownFieldIds = new Set(customFields.map((item) => item.id))
    const currentValues = isSubtaskContext ? getSubtaskCustomFieldValues(selectedSubtask) : (selectedTask.customFieldValues ?? {})
    const nextValues = Object.fromEntries(Object.entries(currentValues).filter(([key]) => knownFieldIds.has(key)))
    delete nextValues[fieldId]
    const response = isSubtaskContext
      ? await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
        actorToken: token,
        id: selectedSubtask.id,
        payload: {
          ...getSubtaskPayload(selectedSubtask),
          customFields: nextValues
        }
      })
      : await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
        actorToken: token,
        id: selectedTask.id,
        customFieldValues: nextValues
      })
    if (!response.ok) {
      setCustomFieldError(response.error?.message ?? 'Unable to remove custom field')
      return
    }
    await refresh()
  }

  const createTagAndAttach = async (inputValue: string) => {
    const normalized = inputValue.trim()
    if (!normalized || !selectedTask) return
    const createRes = await invokeBridge<Tag>(IPC_CHANNELS.customFields.tagsCreate, {
      actorToken: token,
      name: normalized
    })
    if (!createRes.ok || !createRes.data) {
      setError(createRes.error?.message ?? 'Unable to create tag')
      return
    }
    const nextIds = Array.from(new Set([...(selectedTask.tags ?? []).map((tag) => tag.id), createRes.data.id]))
    await setTaskTags(nextIds)
  }

  const createSubtask = async (input: {
    title: string
    description: string
    status: TaskSubtask['status']
    agentId?: string | null
    dueAt?: number
  }) => {
    if (!selectedTask || !input.title.trim()) return
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksCreate, {
      actorToken: token,
      taskId: selectedTask.id,
      title: input.title.trim(),
      status: input.status
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to add subtask')
      return
    }
    const created = response.data
    if (created && (input.description || input.agentId || input.dueAt)) {
      const agent = input.agentId ? agents.find((item) => item.id === input.agentId) : null
      const updateResponse = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
        actorToken: token,
        id: created.id,
        payload: {
          description: input.description,
          ...(input.agentId ? { agentId: input.agentId, assigneeId: input.agentId, assigneeName: agent?.name ?? '' } : {}),
          ...(input.dueAt ? { dueAt: input.dueAt } : {})
        }
      })
      if (!updateResponse.ok) {
        setError(updateResponse.error?.message ?? 'Subtask created, but details could not be saved')
      }
    }
    setIsAddSubtaskOpen(false)
    await refresh()
  }

  const saveChecklistItems = async (items: TaskChecklistItem[]) => {
    if (!selectedTask) return
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      checklistItems: items
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update checklist')
      return
    }
    await refresh()
  }

  const addChecklistItem = async () => {
    if (!selectedTask || !checklistDraft.trim()) return
    const now = Date.now()
    await saveChecklistItems([
      ...(selectedTask.checklistItems ?? []),
      {
        id: createLocalId(),
        title: checklistDraft.trim(),
        checked: false,
        createdAt: now,
        updatedAt: now
      }
    ])
    setChecklistDraft('')
  }

  const toggleChecklistItem = async (itemId: string) => {
    if (!selectedTask) return
    const now = Date.now()
    await saveChecklistItems((selectedTask.checklistItems ?? []).map((item) => (
      item.id === itemId ? { ...item, checked: !item.checked, updatedAt: now } : item
    )))
  }

  const removeChecklistItem = async (itemId: string) => {
    if (!selectedTask) return
    await saveChecklistItems((selectedTask.checklistItems ?? []).filter((item) => item.id !== itemId))
  }

  const saveTitle = async () => {
    if (!selectedTask) return
    const normalized = titleDraft.trim()
    if (!normalized) {
      setTitleDraft(selectedTask.title)
      setIsTitleEditing(false)
      return
    }
    if (normalized === selectedTask.title) {
      setIsTitleEditing(false)
      return
    }
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      title: normalized
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update title')
      setTitleDraft(selectedTask.title)
      return
    }
    setIsTitleEditing(false)
    await refresh()
  }

  const saveSubtaskTitle = async () => {
    if (!editingSubtaskId) return
    const current = selectedTask?.subtasks?.find((item) => item.id === editingSubtaskId)
    if (!current) return
    const normalized = subtaskDraft.trim()
    if (!normalized) {
      setEditingSubtaskId(null)
      setSubtaskDraft('')
      return
    }
    if (normalized === current.title) {
      setEditingSubtaskId(null)
      setSubtaskDraft('')
      return
    }
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: current.id,
      title: normalized
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask title')
      return
    }
    setEditingSubtaskId(null)
    setSubtaskDraft('')
    await refresh()
  }

  const saveSubtaskDetail = async () => {
    if (!selectedSubtask) return
    const nextPayload = {
      ...getSubtaskPayload(selectedSubtask),
      description: subtaskDescriptionDraft,
      dueAt: subtaskDueDraft ? new Date(subtaskDueDraft).getTime() : undefined
    }
    setIsSubtaskDescriptionSaving(true)
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      status: selectedSubtask.status,
      payload: nextPayload
    })
    setIsSubtaskDescriptionSaving(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask details')
      return
    }
    await refresh()
  }

  const openSubtaskDetail = (subtaskId: string) => {
    setSelectedSubtaskId(subtaskId)
    setDetailViewMode('subtask')
    setDetailTab('details')
  }

  const removeSubtask = async (subtaskId: string, refreshAfter = true) => {
    const response = await invokeBridge(IPC_CHANNELS.tasks.subtasksRemove, {
      actorToken: token,
      id: subtaskId
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to remove subtask')
      return false
    }
    setSelectedSubtaskIds((prev) => prev.filter((item) => item !== subtaskId))
    if (refreshAfter) {
      await refresh()
    }
    return true
  }

  const updateSubtaskStatus = async (subtask: TaskSubtask, nextStatus: TaskSubtask['status']) => {
    if (subtask.status === nextStatus) return
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: subtask.id,
      status: nextStatus
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask status')
      return
    }
    await refresh()
  }

  const removeSelectedSubtasks = async () => {
    if (selectedSubtaskIds.length === 0) return
    const ids = [...selectedSubtaskIds]
    for (const id of ids) {
      const ok = await removeSubtask(id, false)
      if (!ok) return
    }
    setSelectedSubtaskIds([])
    await refresh()
  }

  const submitComment = async () => {
    if (!selectedTask || !commentDraft.trim()) return

    if (editingCommentId) {
      const response = await invokeBridge<TaskComment[]>(IPC_CHANNELS.tasks.commentUpdate, {
        actorToken: token,
        taskId: selectedTask.id,
        commentId: editingCommentId,
        body: commentDraft.trim()
      })
      if (!response.ok) {
        setError(response.error?.message ?? 'Unable to update comment')
        return
      }
      setLocalActivityEntries((prev) => ([
        ...prev,
        {
          id: `comment-update-${Date.now()}-${editingCommentId}`,
          at: Date.now(),
          author: user?.name || 'Operator',
          eventType: 'Comment updated',
          summary: 'Updated a comment',
          fields: [{ key: 'commentId', value: editingCommentId }],
          evidence: [commentDraft.trim()]
        }
      ]))
      setCommentDraft('')
      setEditingCommentId(null)
      await refresh()
      return
    }

    const response = await invokeBridge<TaskComment[]>(IPC_CHANNELS.tasks.commentAdd, {
      actorToken: token,
      taskId: selectedTask.id,
      body: commentDraft.trim(),
      authorName: user?.name || 'Operator'
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to add comment')
      return
    }
    setLocalActivityEntries((prev) => ([
      ...prev,
      {
        id: `comment-add-${Date.now()}`,
        at: Date.now(),
        author: user?.name || 'Operator',
        eventType: 'Comment added',
        summary: 'Added a comment',
        fields: [],
        evidence: [commentDraft.trim()]
      }
    ]))
    setCommentDraft('')
    await refresh()
  }

  const startEditComment = (comment: TaskComment) => {
    setEditingCommentId(comment.id)
    setCommentDraft(comment.body)
  }

  const cancelEditComment = () => {
    setEditingCommentId(null)
    setCommentDraft('')
  }

  const removeComment = async (comment: TaskComment) => {
    if (!selectedTask) return
    const response = await invokeBridge<TaskComment[]>(IPC_CHANNELS.tasks.commentRemove, {
      actorToken: token,
      taskId: selectedTask.id,
      commentId: comment.id
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to remove comment')
      return
    }
    setLocalActivityEntries((prev) => ([
      ...prev,
      {
        id: `comment-remove-${Date.now()}-${comment.id}`,
        at: Date.now(),
        author: user?.name || 'Operator',
        eventType: 'Comment removed',
        summary: 'Removed a comment',
        fields: [{ key: 'commentId', value: comment.id }],
        evidence: [comment.body]
      }
    ]))
    if (editingCommentId === comment.id) {
      setEditingCommentId(null)
      setCommentDraft('')
    }
    await refresh()
  }

  const deleteSelectedTask = async () => {
    if (!selectedTask) return
    const response = await invokeBridge<{ id: string }>(IPC_CHANNELS.tasks.remove, {
      actorToken: token,
      id: selectedTask.id
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete task')
      return
    }
    setSelectedTaskId(null)
    setSelectedSubtaskId(null)
    setDetailViewMode('task')
    await refresh()
  }

  const splitTemplate = `${Math.round(detailRatio * 100)}% 6px minmax(${MIN_COMMENTS_WIDTH}px, 1fr)`

  if (projectLoadError) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Project</h1>
        <p>{projectLoadError}</p>
      </section>
    )
  }

  if (!project) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Project</h1>
        <p>{error ?? 'Loading...'}</p>
      </section>
    )
  }

  const renderActiveView = () => {
    if (viewMode === 'board') {
      return (
        <ProjectBoardView
          columns={statusColumns}
          tasksByStatus={tasksByStatus}
          agents={agents}
          onDropStatus={(event, status) => void onDropColumn(event, status)}
          onOpenTask={setSelectedTaskId}
          onOpenCreateTask={openCreateTask}
        />
      )
    }
    if (viewMode === 'table') {
      return (
        <ProjectTableView
          columns={statusColumns}
          tasks={tableTasks}
          agents={agents}
          onOpenTask={setSelectedTaskId}
          onOpenCreateTask={() => openCreateTask(defaultStatus)}
          onStatusChange={(taskId, status) => void updateTaskStatus(taskId, status)}
          onReorder={(sourceTaskId, targetTaskId) => void reorderTableTasks(sourceTaskId, targetTaskId)}
        />
      )
    }
    return (
      <ProjectListView
        columns={statusColumns}
        tasksByStatus={tasksByStatus}
        agents={agents}
        collapsedStatuses={collapsedStatuses}
        onToggleStatus={toggleStatusGroup}
        onOpenTask={setSelectedTaskId}
        onOpenCreateTask={openCreateTask}
        onDropStatus={(event, status) => void onDropColumn(event, status)}
      />
    )
  }

  return (
    <section className={styles.page}>
      <ProjectDetailHeader
        project={project}
        taskTitle={taskTitle}
        busy={busy}
        viewMode={viewMode}
        onTaskTitleChange={setTaskTitle}
        onQuickCreate={() => void handleQuickCreate()}
        onOpenCreateTask={() => openCreateTask(defaultStatus)}
        onOpenProjectPrompts={openProjectPromptSettings}
        onOpenStatusSettings={openStatusEditor}
        onViewModeChange={setViewMode}
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      {renderActiveView()}

      <CreateTaskModal
        open={isCreateTaskOpen}
        project={project}
        tags={tags}
        agents={agents}
        templates={taskTemplates}
        statusColumns={statusColumns}
        defaultStatus={createTaskStatus}
        busy={busy}
        onClose={() => setIsCreateTaskOpen(false)}
        onCreate={(input) => void handleCreateTask(input)}
      />

      <AddSubtaskModal
        open={Boolean(selectedTask && isAddSubtaskOpen)}
        projectName={project.name}
        taskTitle={selectedTask?.title ?? ''}
        agents={agents}
        statusColumns={statusColumns}
        defaultStatus={defaultStatus}
        busy={busy}
        onClose={() => setIsAddSubtaskOpen(false)}
        onCreate={(input) => void createSubtask(input)}
      />

      {isProjectPromptSettingsOpen ? (
        <>
          <div className={styles.createTaskBackdrop} onClick={() => setIsProjectPromptSettingsOpen(false)} />
          <section className={`${styles.createTaskModal} ${styles.projectPromptModal}`} role="dialog" aria-modal="true" aria-label="Project prompt settings">
            <header className={styles.createTaskHeader}>
              <div className={styles.projectPromptTabs}>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectPromptTab === 'context' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectPromptTab('context')}
                >
                  Context
                </button>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectPromptTab === 'prompt' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectPromptTab('prompt')}
                >
                  Prompt
                </button>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectPromptTab === 'output' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectPromptTab('output')}
                >
                  Output
                </button>
              </div>
              <button type="button" onClick={() => setIsProjectPromptSettingsOpen(false)} aria-label="Close prompt settings"><LuX size={17} /></button>
            </header>
                <div className={styles.projectPromptBody}>
                  {projectPromptTab === 'context' ? (
                <label className={styles.projectPromptField}>
                  <div className={styles.projectPromptFieldHeader}>
                    <span>General context</span>
                    <span className={styles.projectPromptCounter}>{projectPromptContext.length}/4000</span>
                  </div>
                  <Form.Control
                    as="textarea"
                    rows={10}
                    className={styles.projectPromptTextarea}
                    value={projectPromptContext}
                    onChange={(event) => setProjectPromptContext(event.target.value)}
                    placeholder="Add common project context..."
                    maxLength={4000}
                  />
                  <small className={styles.projectPromptHint}>Shared across all project tasks to keep task generation consistent.</small>
                </label>
              ) : null}
              {projectPromptTab === 'prompt' ? (
                <label className={styles.projectPromptField}>
                  <div className={styles.projectPromptFieldHeader}>
                    <span>General prompt</span>
                    <span className={styles.projectPromptCounter}>{projectPromptPrompt.length}/4000</span>
                  </div>
                  <Form.Control
                    as="textarea"
                    rows={10}
                    className={styles.projectPromptTextarea}
                    value={projectPromptPrompt}
                    onChange={(event) => setProjectPromptPrompt(event.target.value)}
                    placeholder="Set shared instructions for this project..."
                    maxLength={4000}
                  />
                  <small className={styles.projectPromptHint}>Guides how agent should act while planning or drafting in this project.</small>
                </label>
              ) : null}
              {projectPromptTab === 'output' ? (
                <label className={styles.projectPromptField}>
                  <div className={styles.projectPromptFieldHeader}>
                    <span>Default output</span>
                    <span className={styles.projectPromptCounter}>{projectPromptOutput.length}/3000</span>
                  </div>
                  <Form.Control
                    as="textarea"
                    rows={10}
                    className={styles.projectPromptTextarea}
                    value={projectPromptOutput}
                    onChange={(event) => setProjectPromptOutput(event.target.value)}
                    placeholder="Set default output format..."
                    maxLength={3000}
                  />
                  <small className={styles.projectPromptHint}>Default response format that will be suggested for all generated outputs.</small>
                </label>
              ) : null}
            </div>
            {projectPromptError ? <p className={styles.error}>{projectPromptError}</p> : null}
            <footer className={styles.projectPromptFooter}>
              <button type="button" onClick={() => setIsProjectPromptSettingsOpen(false)} disabled={isProjectPromptSaving}>
                Cancel
              </button>
              <button type="button" onClick={() => void saveProjectPromptSettings()} disabled={isProjectPromptSaving}>
                {isProjectPromptSaving ? 'Saving...' : 'Save'}
              </button>
            </footer>
          </section>
        </>
      ) : null}

      {isStatusEditorOpen ? (
        <>
          <div className={styles.createTaskBackdrop} onClick={() => setIsStatusEditorOpen(false)} />
          <section className={styles.createTaskModal} role="dialog" aria-modal="true" aria-label="Project status settings">
            <header className={styles.createTaskHeader}>
              <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Project statuses</span></div>
              <button type="button" onClick={() => setIsStatusEditorOpen(false)} aria-label="Close project status settings"><LuX size={17} /></button>
            </header>
            <div className={styles.createTaskBody}>
              {(['not_started', 'active', 'done', 'closed'] as ProjectStatusCategory[]).map((category) => {
                const rows = statusDrafts.filter((item) => item.category === category)
                return (
                  <div key={category} className={styles.drawerSection}>
                    <h4>{category === 'not_started' ? 'Not started' : category === 'active' ? 'Active' : category === 'done' ? 'Done' : 'Closed'}</h4>
                    <Stack gap={2}>
                      {rows.map((status) => (
                        <div key={status.id} className={styles.subtaskRow}>
                          <input
                            className={styles.subtaskInlineInput}
                            value={status.name}
                            onChange={(event) => updateStatusDraft(status.id, { name: event.target.value })}
                          />
                          <input
                            type="color"
                            value={status.color}
                            onChange={(event) => updateStatusDraft(status.id, { color: event.target.value })}
                            aria-label={`${status.name} color`}
                          />
                          <input
                            className={styles.subtaskInlineInput}
                            value={status.color}
                            onChange={(event) => updateStatusDraft(status.id, { color: event.target.value })}
                          />
                          {category === 'active' ? (
                            <button type="button" className={styles.iconBtn} onClick={() => removeStatusDraft(status)} aria-label={`Remove ${status.name}`}>
                              <LuTrash2 size={15} />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </Stack>
                    {category === 'active' ? (
                      <button type="button" className={styles.subtaskAddButton} onClick={addActiveStatus}>
                        <LuPlus size={15} />
                        Add active status
                      </button>
                    ) : null}
                  </div>
                )
              })}
              {Object.keys(statusMapping).length > 0 ? (
                <div className={styles.drawerSection}>
                  <h4>Status migration mapping</h4>
                  {Object.entries(statusMapping).map(([sourceId, targetId]) => {
                    const source = projectStatuses.find((item) => item.id === sourceId)
                    return (
                      <div key={sourceId} className={styles.subtaskRow}>
                        <span>{source?.name ?? sourceId}</span>
                        <AppSelect
                          mode="single"
                          variant="borderless"
                          value={{
                            value: targetId,
                            label: statusDrafts.find((item) => item.id === targetId)?.name ?? 'Select target'
                          }}
                          options={statusDrafts.map((item) => ({ value: item.id, label: item.name, color: item.color }))}
                          onChange={(option) => {
                            if (!Array.isArray(option) && option?.value) {
                              setStatusMapping((current) => ({ ...current, [sourceId]: option.value }))
                            }
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
            <footer className={styles.createTaskFooter}>
              <span>Removing a status requires mapping old tasks and subtasks to a remaining status.</span>
              <button type="button" onClick={() => void saveProjectStatuses()}>Save statuses</button>
            </footer>
          </section>
        </>
      ) : null}

      {selectedTask ? (
        <>
          <TaskDetailModal
            taskId={selectedTask.id}
            onClose={() => setSelectedTaskId(null)}
            onOpenActivity={() => setIsActivityModalOpen(true)}
            onEditTitle={() => {
              setDetailViewMode('task')
              setSelectedSubtaskId(null)
              setTitleDraft(selectedTask.title)
              setIsTitleEditing(true)
            }}
            onDeleteTask={() => void deleteSelectedTask()}
          >
            <div className={styles.modalBody} ref={modalBodyRef} style={{ gridTemplateColumns: splitTemplate }}>
              <div className={styles.detailPane}>
                <section className={styles.breadcrumbRow}>
                  <button type="button" className={styles.breadcrumbBtn} onClick={() => setSelectedTaskId(null)}>
                    {project.name}
                  </button>
                  <span className={styles.breadcrumbSep}>&gt;</span>
                  <button
                    type="button"
                    className={styles.breadcrumbBtn}
                    onClick={() => {
                      setDetailViewMode('task')
                      setSelectedSubtaskId(null)
                      setDetailTab('subtasks')
                    }}
                  >
                    {selectedTask.title}
                  </button>
                  {detailViewMode === 'subtask' && selectedSubtask ? (
                    <>
                      <span className={styles.breadcrumbSep}>&gt;</span>
                      <button type="button" className={styles.breadcrumbBtnActive}>
                        {selectedSubtask.title}
                      </button>
                    </>
                  ) : null}
                </section>

                <section className={styles.detailTop}>
                  <div className={styles.taskTypeRow}>
                    <span className={styles.taskTypePill}>{detailViewMode === 'subtask' ? 'Subtask' : 'Task'}</span>
                    <span className={styles.projectContext}>in {project.name}</span>
                  </div>
                  {detailViewMode === 'task' ? (
                    !isTitleEditing ? (
                      <h3
                        className={styles.detailTitle}
                        onClick={() => {
                          setTitleDraft(selectedTask.title)
                          setIsTitleEditing(true)
                        }}
                      >
                        {selectedTask.title}
                      </h3>
                    ) : (
                      <input
                        autoFocus
                        className={styles.titleInput}
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={() => void saveTitle()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void saveTitle()
                          }
                          if (event.key === 'Escape') {
                            setTitleDraft(selectedTask.title)
                            setIsTitleEditing(false)
                          }
                        }}
                      />
                    )
                  ) : (
                    <h3 className={styles.detailTitle}>{selectedSubtask?.title ?? 'Subtask detail'}</h3>
                  )}
                  <div className={styles.aiHint}>Add description, write summary or find related tasks</div>
                  <div className={styles.metaGrid}>
                    <div className={styles.metaCell}>
                      <span className={styles.metaLabel}>Status</span>
                      <span className={styles.metaValue}>
                        {resolveColumnByStatus(detailViewMode === 'task' ? selectedTask.status : (selectedSubtask?.status ?? defaultStatus)).title}
                      </span>
                    </div>
                    <div className={styles.metaCell}>
                      <span className={styles.metaLabel}>Agent</span>
                      <div className={styles.metaSelectValue}>
                        <AppSelect
                          mode="single"
                          variant="borderless"
                          value={detailViewMode === 'task' ? selectedTaskAgentOption : selectedSubtaskAgentOption}
                          options={agentOptions}
                          onChange={(option) => {
                            if (detailViewMode === 'task') {
                              void setTaskAgent(option?.value ?? null)
                            } else {
                              void setSubtaskAgent(option?.value ?? null)
                            }
                          }}
                          isClearable
                          placeholder="Select agent"
                        />
                      </div>
                    </div>
                    <div className={styles.metaCell}>
                      <span className={styles.metaLabel}>Output format</span>
                      <span className={styles.metaValue}>
                        {detailViewMode === 'task'
                          ? selectedTaskOutputFormatOption?.label ?? 'No output format'
                          : selectedSubtaskOutputFormatOption?.label ?? 'No output format'}
                      </span>
                    </div>
                    <div className={styles.metaCell}>
                      <span className={styles.metaLabel}>Dates</span>
                      <span className={styles.metaValue}>
                        {detailViewMode === 'task'
                          ? formatDate(selectedTask.updatedAt)
                          : (selectedSubtask && getSubtaskDueAt(selectedSubtask) ? formatDate(getSubtaskDueAt(selectedSubtask) as number) : 'No due date')}
                      </span>
                    </div>
                  </div>

                  <div className={styles.topControlGrid}>
                    <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
                      <span className={styles.metaLabel}>Tags (shared)</span>
                      <p className={styles.topControlSummary}>
                        {selectedTaskTagOptions.length > 0
                          ? `${selectedTaskTagOptions.length} selected`
                          : 'Empty'}
                      </p>
                      <AppSelect
                        mode="multi"
                        creatable
                        variant="borderless"
                        className={styles.tagInlineSelect}
                        value={selectedTaskTagOptions}
                        options={availableTagOptions}
                        onChange={(nextValue) => void setTaskTags(nextValue.map((item) => item.value))}
                        onCreateOption={(value) => void createTagAndAttach(value)}
                        placeholder="Search or add tags..."
                      />
                    </div>
                    <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
                      <span className={styles.metaLabel}>Skills</span>
                      <p className={styles.topControlSummary}>
                        {selectedTaskSkillOptions.length > 0
                          ? `${selectedTaskSkillOptions.length} selected`
                          : 'Empty'}
                      </p>
                      <AppSelect
                        mode="multi"
                        variant="borderless"
                        className={styles.tagInlineSelect}
                        value={selectedTaskSkillOptions}
                        options={availableSkillOptions}
                        onChange={(nextValue) => void setTaskSkills(nextValue.map((item) => item.value))}
                        placeholder="Search skills..."
                      />
                    </div>
                  </div>
                </section>

                <section className={styles.drawerSection}>
                  <h4>Description</h4>
                  <Form.Control
                    as="textarea"
                    rows={6}
                    value={detailViewMode === 'task' ? descriptionDraft : subtaskDescriptionDraft}
                    className={`${styles.descriptionField} ${isDescriptionEditing ? styles.editingField : ''}`}
                    onClick={() => setIsDescriptionEditing(true)}
                    onChange={(event) => {
                      setIsDescriptionEditing(true)
                      if (detailViewMode === 'task') {
                        setDescriptionDraft(event.target.value)
                      } else {
                        setSubtaskDescriptionDraft(event.target.value)
                      }
                    }}
                    onBlur={() => {
                      if (isDescriptionEditing) {
                        if (detailViewMode === 'task') {
                          void saveDescription()
                        } else {
                          void saveSubtaskDetail()
                        }
                      }
                    }}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault()
                        if (detailViewMode === 'task') {
                          void saveDescription()
                        } else {
                          void saveSubtaskDetail()
                        }
                      }
                      if (event.key === 'Escape') {
                        if (detailViewMode === 'task') {
                          setDescriptionDraft(selectedTask.description ?? '')
                        } else if (selectedSubtask) {
                          setSubtaskDescriptionDraft(getSubtaskDescription(selectedSubtask))
                        }
                        setIsDescriptionEditing(false)
                      }
                    }}
                  />
                  <div className={styles.fieldStateRow}>
                    {isDescriptionSaving || isSubtaskDescriptionSaving ? <span className={styles.fieldSaving}>Saving...</span> : null}
                    {isDescriptionEditing && !isDescriptionSaving ? <span className={styles.fieldDirty}>Editing</span> : null}
                  </div>
                </section>

                <section className={styles.drawerSection}>
                  {detailViewMode === 'subtask' && selectedSubtask ? (
                    <>
                      <div className={styles.tabRow}>
                        <button
                          type="button"
                          className={detailTab === 'details' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('details')}
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'customFields' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('customFields')}
                        >
                          Custom fields
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'outputFormat' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('outputFormat')}
                        >
                          Output format
                        </button>
                      </div>
                      {detailTab === 'details' ? (
                        <>
                          <h4>Subtask details</h4>
                          <div className={styles.subtaskDetailGrid}>
                            <div className={styles.subtaskField}>
                              <span className={styles.metaLabel}>Status</span>
                              <AppSelect
                                mode="single"
                                variant="borderless"
                                value={{
                                  value: selectedSubtask.status,
                                  label: resolveColumnByStatus(selectedSubtask.status).title,
                                  color: resolveColumnByStatus(selectedSubtask.status).accent
                                }}
                                options={statusColumns.map((column) => ({ value: column.status, label: column.title, color: column.accent }))}
                                onChange={(option) => {
                                  if (!Array.isArray(option) && option?.value) {
                                    void updateSubtaskStatus(selectedSubtask, option.value as TaskSubtask['status'])
                                  }
                                }}
                              />
                            </div>
                            <div className={styles.subtaskField}>
                              <span className={styles.metaLabel}>Due</span>
                              <Form.Control
                                type="date"
                                value={subtaskDueDraft}
                                onChange={(event) => setSubtaskDueDraft(event.target.value)}
                                onBlur={() => void saveSubtaskDetail()}
                              />
                            </div>
                          </div>
                        </>
                      ) : detailTab === 'customFields' ? (
                      <div className={styles.subtaskCustomFields}>
                        <div className={styles.detailSectionHeader}>
                          <div>
                            <h4>Custom fields</h4>
                            <p>{assignedSubtaskCustomFieldValues.length} assigned</p>
                          </div>
                        </div>
                        <div className={styles.customFieldPanel}>
                          {customFieldError ? <p className={styles.customFieldError}>{customFieldError}</p> : null}
                          <div className={styles.customFieldAddRow}>
                            <AppSelect
                              mode="single"
                              value={selectedCustomFieldOption}
                              options={availableSubtaskCustomFieldOptions}
                              onChange={(option) => {
                                setSelectedCustomFieldOption(option)
                                setEditingCustomFieldId(null)
                                setCustomFieldError(null)
                                const field = customFields.find((item) => item.id === option?.value)
                                setCustomFieldDraft(field ? customFieldValueToDraft(field, field.defaultValue) : '')
                              }}
                              placeholder="Add custom field..."
                            />
                          </div>
                          {selectedCustomFieldOption ? (() => {
                            const field = customFields.find((item) => item.id === selectedCustomFieldOption.value)
                            if (!field) return null
                            return (
                              <div className={styles.customFieldEditor}>
                                <div className={styles.customFieldEditorHead}>
                                  <span>Add field value</span>
                                  <span className={`${styles.customFieldType} ${styles[`customFieldType_${field.type}`]}`}>{field.type}</span>
                                </div>
                                {field.type === 'boolean' ? (
                                  <select value={customFieldDraft || 'false'} onChange={(event) => setCustomFieldDraft(event.target.value)}>
                                    <option value="true">True</option>
                                    <option value="false">False</option>
                                  </select>
                                ) : (
                                  <textarea
                                    rows={field.type === 'json' ? 5 : 2}
                                    value={customFieldDraft}
                                    onChange={(event) => setCustomFieldDraft(event.target.value)}
                                    placeholder={field.type === 'json' ? '{ "value": true }' : 'Value'}
                                  />
                                )}
                                <div className={styles.customFieldEditorActions}>
                                  <button type="button" onClick={() => void saveCustomFieldValue(field)}>Save</button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedCustomFieldOption(null)
                                      setCustomFieldDraft('')
                                      setCustomFieldError(null)
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )
                          })() : null}
                          {assignedSubtaskCustomFieldValues.length > 0 ? (
                            <div className={styles.customFieldList}>
                              {assignedSubtaskCustomFieldValues.map(({ field, value }) => (
                                <div key={field.id} className={styles.customFieldRow}>
                                  <div className={styles.customFieldInfo}>
                                    <div>
                                      <span className={styles.customFieldName}>{field.name}</span>
                                      {field.description ? <p>{field.description}</p> : null}
                                    </div>
                                    <span className={`${styles.customFieldType} ${styles[`customFieldType_${field.type}`]}`}>{field.type}</span>
                                  </div>
                                  {editingCustomFieldId === field.id ? (
                                    <div className={styles.customFieldEditInline}>
                                      {field.type === 'boolean' ? (
                                        <select value={customFieldDraft || 'false'} onChange={(event) => setCustomFieldDraft(event.target.value)}>
                                          <option value="true">True</option>
                                          <option value="false">False</option>
                                        </select>
                                      ) : (
                                        <textarea
                                          rows={field.type === 'json' ? 5 : 2}
                                          value={customFieldDraft}
                                          onChange={(event) => setCustomFieldDraft(event.target.value)}
                                        />
                                      )}
                                      <button type="button" onClick={() => void saveCustomFieldValue(field)}>Save</button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCustomFieldId(null)
                                          setCustomFieldDraft('')
                                          setCustomFieldError(null)
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <pre className={styles.customFieldValue}>{customFieldValueLabel(field, value)}</pre>
                                      <div className={styles.customFieldActions}>
                                        <button
                                          type="button"
                                          aria-label={`Edit ${field.name}`}
                                          onClick={() => {
                                            setEditingCustomFieldId(field.id)
                                            setSelectedCustomFieldOption(null)
                                            setCustomFieldError(null)
                                            setCustomFieldDraft(customFieldValueToDraft(field, value))
                                          }}
                                        >
                                          <LuPencil size={14} />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={`Remove ${field.name}`}
                                          onClick={() => void removeCustomFieldValue(field.id)}
                                        >
                                          <LuTrash2 size={14} />
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className={styles.customFieldEmpty}>No custom fields on this subtask.</p>
                          )}
                        </div>
                      </div>
                      ) : (
                        <div className={styles.customFieldPanel}>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Output format</h4>
                              <p>{selectedSubtaskOutputFormatOption?.label ?? 'No output format'}</p>
                            </div>
                          </div>
                          <div className={styles.customFieldAddRow}>
                            <AppSelect
                              mode="single"
                              value={selectedSubtaskOutputFormatOption}
                              options={outputFormatOptions}
                              onChange={(option) => void setSubtaskOutputFormat(option?.value ?? null)}
                              placeholder="Select output format..."
                              isClearable
                            />
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className={styles.tabRow}>
                        <button
                          type="button"
                          className={detailTab === 'subtasks' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('subtasks')}
                        >
                          Subtasks
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'customFields' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('customFields')}
                        >
                          Custom fields
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'checklist' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('checklist')}
                        >
                          Checklist
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'outputFormat' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('outputFormat')}
                        >
                          Output format
                        </button>
                      </div>
                      {detailTab === 'subtasks' ? (
                        <>
                          <h4>Subtasks</h4>
                          <div className={styles.subtaskToolbar}>
                            <span>{(selectedTask.subtasks ?? []).filter((item) => completedStatusIds.has(item.status)).length} completed</span>
                            <div className={styles.subtaskToolbarActions}>
                              <button type="button" className={styles.subtaskAddButton} onClick={() => setIsAddSubtaskOpen(true)}>
                                <LuPlus size={15} />
                                Add subtask
                              </button>
                              {selectedSubtaskIds.length > 0 ? (
                                <button
                                  type="button"
                                  className={styles.bulkRemoveBtn}
                                  title="Delete selected subtasks"
                                  aria-label="Delete selected subtasks"
                                  onClick={() => void removeSelectedSubtasks()}
                                >
                                  <LuTrash2 size={15} />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <Stack gap={2}>
                            {(selectedTask.subtasks ?? []).map((subtask) => (
                              <div
                                key={subtask.id}
                                className={`${styles.subtaskRow} ${pendingDeleteSubtaskId === subtask.id ? styles.subtaskDeleteArmed : ''}`}
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (event.key === 'Delete' || event.key === 'Backspace') {
                                    event.preventDefault()
                                    if (pendingDeleteSubtaskId === subtask.id) {
                                      void removeSubtask(subtask.id)
                                      setPendingDeleteSubtaskId(null)
                                    } else {
                                      setPendingDeleteSubtaskId(subtask.id)
                                    }
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className={`${styles.subtaskStatusToggle} ${completedStatusIds.has(subtask.status) ? styles.subtaskStatusDone : ''}`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    setSubtaskStatusMenu((current) => current?.subtaskId === subtask.id
                                      ? null
                                      : { subtaskId: subtask.id, left: rect.left, top: rect.bottom + 6 })
                                  }}
                                  aria-haspopup="listbox"
                                  aria-expanded={subtaskStatusMenu?.subtaskId === subtask.id}
                                  aria-label="Change subtask status"
                                  title="Change subtask status"
                                >
                                  <span />
                                  {resolveColumnByStatus(subtask.status).title}
                                  <LuChevronDown size={13} />
                                </button>
                                {subtaskStatusMenu?.subtaskId === subtask.id ? (
                                  <div
                                    ref={subtaskStatusMenuRef}
                                    className={styles.subtaskStatusMenu}
                                    role="listbox"
                                    style={{ left: subtaskStatusMenu.left, top: subtaskStatusMenu.top } as CSSProperties}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    {statusColumns.map((option) => {
                                      const active = option.status === subtask.status
                                      return (
                                        <button
                                          key={option.status}
                                          type="button"
                                          className={styles.subtaskStatusMenuItem}
                                          style={{ '--status-accent': option.accent } as CSSProperties}
                                          role="option"
                                          aria-selected={active}
                                          onClick={() => {
                                            setSubtaskStatusMenu(null)
                                            void updateSubtaskStatus(subtask, option.status)
                                          }}
                                        >
                                          <span className={styles.tableStatusMenuDot} />
                                          <span>{option.title}</span>
                                          {active ? <LuCheck size={14} /> : null}
                                        </button>
                                      )
                                    })}
                                  </div>
                                ) : null}
                                <label>
                                  {editingSubtaskId === subtask.id ? (
                                    <input
                                      autoFocus
                                      className={styles.subtaskInlineInput}
                                      value={subtaskDraft}
                                      onChange={(event) => setSubtaskDraft(event.target.value)}
                                      onBlur={() => void saveSubtaskTitle()}
                                      onKeyDown={(event) => {
                                        event.stopPropagation()
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          void saveSubtaskTitle()
                                        }
                                        if (event.key === 'Escape') {
                                          setEditingSubtaskId(null)
                                          setSubtaskDraft('')
                                        }
                                      }}
                                    />
                                  ) : (
                                    <span
                                      className={styles.editableSubtaskTitle}
                                      onClick={() => {
                                        openSubtaskDetail(subtask.id)
                                      }}
                                    >
                                      {subtask.title}
                                    </span>
                                  )}
                                </label>
                                <span className={styles.subtaskMetaBadge}>{resolveSubtaskAgentName(subtask)}</span>
                                <span className={styles.subtaskMetaBadge}>
                                  {getSubtaskDueAt(subtask) ? formatDate(getSubtaskDueAt(subtask) as number) : 'No due'}
                                </span>
                                <button
                                  type="button"
                                  className={styles.subtaskRemoveBtn}
                                  onClick={() => void removeSubtask(subtask.id)}
                                  aria-label="Remove subtask"
                                  title="Remove subtask"
                                >
                                  <LuTrash2 size={14} />
                                </button>
                                {pendingDeleteSubtaskId === subtask.id ? <span className={styles.deleteHint}>Press Delete again</span> : null}
                              </div>
                            ))}
                          </Stack>
                        </>
                      ) : detailTab === 'customFields' ? (
                        <>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Custom fields</h4>
                              <p>{assignedCustomFieldValues.length} assigned</p>
                            </div>
                          </div>
                          <div className={styles.customFieldPanel}>
                            {customFieldError ? <p className={styles.customFieldError}>{customFieldError}</p> : null}
                            <div className={styles.customFieldAddRow}>
                              <AppSelect
                                mode="single"
                                value={selectedCustomFieldOption}
                                options={availableCustomFieldOptions}
                                onChange={(option) => {
                                  setSelectedCustomFieldOption(option)
                                  setEditingCustomFieldId(null)
                                  setCustomFieldError(null)
                                  const field = customFields.find((item) => item.id === option?.value)
                                  setCustomFieldDraft(field ? customFieldValueToDraft(field, field.defaultValue) : '')
                                }}
                                placeholder="Add custom field..."
                              />
                            </div>
                            {selectedCustomFieldOption ? (() => {
                              const field = customFields.find((item) => item.id === selectedCustomFieldOption.value)
                              if (!field) return null
                              return (
                                <div className={styles.customFieldEditor}>
                                  <div className={styles.customFieldEditorHead}>
                                    <span>Add field value</span>
                                    <span className={`${styles.customFieldType} ${styles[`customFieldType_${field.type}`]}`}>{field.type}</span>
                                  </div>
                                  {field.type === 'boolean' ? (
                                    <select value={customFieldDraft || 'false'} onChange={(event) => setCustomFieldDraft(event.target.value)}>
                                      <option value="true">True</option>
                                      <option value="false">False</option>
                                    </select>
                                  ) : (
                                    <textarea
                                      rows={field.type === 'json' ? 5 : 2}
                                      value={customFieldDraft}
                                      onChange={(event) => setCustomFieldDraft(event.target.value)}
                                      placeholder={field.type === 'json' ? '{ "value": true }' : 'Value'}
                                    />
                                  )}
                                  <div className={styles.customFieldEditorActions}>
                                    <button type="button" onClick={() => void saveCustomFieldValue(field)}>Save</button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedCustomFieldOption(null)
                                        setCustomFieldDraft('')
                                        setCustomFieldError(null)
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )
                            })() : null}
                            {assignedCustomFieldValues.length > 0 ? (
                              <div className={styles.customFieldList}>
                                {assignedCustomFieldValues.map(({ field, value }) => (
                                  <div key={field.id} className={styles.customFieldRow}>
                                    <div className={styles.customFieldInfo}>
                                      <div>
                                        <span className={styles.customFieldName}>{field.name}</span>
                                        {field.description ? <p>{field.description}</p> : null}
                                      </div>
                                      <span className={`${styles.customFieldType} ${styles[`customFieldType_${field.type}`]}`}>{field.type}</span>
                                    </div>
                                    {editingCustomFieldId === field.id ? (
                                      <div className={styles.customFieldEditInline}>
                                        {field.type === 'boolean' ? (
                                          <select value={customFieldDraft || 'false'} onChange={(event) => setCustomFieldDraft(event.target.value)}>
                                            <option value="true">True</option>
                                            <option value="false">False</option>
                                          </select>
                                        ) : (
                                          <textarea
                                            rows={field.type === 'json' ? 5 : 2}
                                            value={customFieldDraft}
                                            onChange={(event) => setCustomFieldDraft(event.target.value)}
                                          />
                                        )}
                                        <button type="button" onClick={() => void saveCustomFieldValue(field)}>Save</button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingCustomFieldId(null)
                                            setCustomFieldDraft('')
                                            setCustomFieldError(null)
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <>
                                        <pre className={styles.customFieldValue}>{customFieldValueLabel(field, value)}</pre>
                                        <div className={styles.customFieldActions}>
                                          <button
                                            type="button"
                                            aria-label={`Edit ${field.name}`}
                                            onClick={() => {
                                              setEditingCustomFieldId(field.id)
                                              setSelectedCustomFieldOption(null)
                                              setCustomFieldError(null)
                                              setCustomFieldDraft(customFieldValueToDraft(field, value))
                                            }}
                                          >
                                            <LuPencil size={14} />
                                          </button>
                                          <button
                                            type="button"
                                            aria-label={`Remove ${field.name}`}
                                            onClick={() => void removeCustomFieldValue(field.id)}
                                          >
                                            <LuTrash2 size={14} />
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className={styles.customFieldEmpty}>No custom fields on this task.</p>
                            )}
                          </div>
                        </>
                      ) : detailTab === 'checklist' ? (
                        <>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Checklist</h4>
                              <p>
                                {(selectedTask.checklistItems ?? []).filter((item) => item.checked).length} checked /{' '}
                                {(selectedTask.checklistItems ?? []).length} total
                              </p>
                            </div>
                          </div>
                          <div className={styles.checklistPanel}>
                            <div className={styles.checklistProgress}>
                              <span
                                style={{
                                  width: `${(selectedTask.checklistItems ?? []).length > 0
                                    ? Math.round((((selectedTask.checklistItems ?? []).filter((item) => item.checked).length) / (selectedTask.checklistItems ?? []).length) * 100)
                                    : 0}%`
                                }}
                              />
                            </div>
                            <div className={styles.checklistAddRow}>
                              <input
                                value={checklistDraft}
                                onChange={(event) => setChecklistDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void addChecklistItem()
                                  }
                                }}
                                placeholder="Add checklist item..."
                              />
                              <button type="button" onClick={() => void addChecklistItem()} disabled={!checklistDraft.trim()} aria-label="Add checklist item">
                                <LuPlus size={15} />
                              </button>
                            </div>
                            {(selectedTask.checklistItems ?? []).length > 0 ? (
                              <div className={styles.checklistList}>
                                {(selectedTask.checklistItems ?? []).map((item) => (
                                  <div key={item.id} className={styles.checklistRow}>
                                    <input type="checkbox" checked={item.checked} onChange={() => void toggleChecklistItem(item.id)} />
                                    <span className={item.checked ? styles.checklistItemChecked : styles.checklistItemTitle}>{item.title}</span>
                                    <button type="button" onClick={() => void removeChecklistItem(item.id)} aria-label={`Remove ${item.title}`}>
                                      <LuTrash2 size={14} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className={styles.customFieldEmpty}>No checklist items yet.</p>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className={styles.customFieldPanel}>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Output format</h4>
                              <p>{selectedTaskOutputFormatOption?.label ?? 'No output format'}</p>
                            </div>
                          </div>
                          <div className={styles.customFieldAddRow}>
                            <AppSelect
                              mode="single"
                              value={selectedTaskOutputFormatOption}
                              options={outputFormatOptions}
                              onChange={(option) => void setTaskOutputFormat(option?.value ?? null)}
                              placeholder="Select output format..."
                              isClearable
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </section>

                <section className={styles.drawerSection}>
                  <h4>Dependencies</h4>
                  <p>No dependencies.</p>
                </section>
              </div>

              <div
                className={styles.splitHandle}
                onMouseDown={() => setIsResizingSplit(true)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize detail and comments panels"
              />

              <aside className={styles.commentsPane}>
                <header className={styles.commentsHeader}>
                  <h4>Comments</h4>
                </header>
                <div className={styles.commentsFeed}>
                  {orderedComments.map((comment) => (
                    <article key={comment.id} className={styles.commentItem}>
                      <div className={styles.commentMeta}>
                        <span>{comment.authorName || 'Operator'}</span>
                        <span>{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>
                      <p>{comment.body}</p>
                      <div className={styles.commentActions}>
                        <button
                          type="button"
                          className={styles.commentIconBtn}
                          onClick={() => startEditComment(comment)}
                          title="Edit comment"
                          aria-label="Edit comment"
                        >
                          <LuPencil size={13} />
                        </button>
                        <button
                          type="button"
                          className={styles.commentIconBtn}
                          onClick={() => void removeComment(comment)}
                          title="Delete comment"
                          aria-label="Delete comment"
                        >
                          <LuTrash2 size={13} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <section className={styles.commentsComposer}>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder={editingCommentId ? 'Edit comment...' : 'Write a comment...'}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void submitComment()
                      }
                      if (event.key === 'Escape') {
                        cancelEditComment()
                      }
                    }}
                  />
                  {editingCommentId ? (
                    <div className={styles.editHint}>Editing comment. Press Esc to cancel.</div>
                  ) : null}
                </section>
              </aside>
            </div>
          </TaskDetailModal>

          {isActivityModalOpen ? (
            <>
              <div className={styles.activityBackdrop} onClick={() => setIsActivityModalOpen(false)} />
              <section className={`${styles.modalShell} ${styles.activityModalShell}`} role="dialog" aria-modal="true" aria-label="Activity logs">
                <header className={styles.modalHeader}>
                  <h2>ACTIVITY LOGS</h2>
                  <div className={styles.modalHeaderActions}>
                    <button type="button" onClick={() => setIsActivityModalOpen(false)} aria-label="Close activity modal">
                      <LuX size={16} />
                    </button>
                  </div>
                </header>
                <div className={styles.activityModalBody}>
                  <div className={styles.activityFeed} ref={activityFeedRef} onScroll={onActivityScroll}>
                    <div className={styles.threadList}>
                      {activityEntries.map((entry) => (
                        <article key={entry.id} className={styles.threadItem}>
                          <div className={styles.threadMeta}>
                            <span>{entry.author}</span>
                            <span>{new Date(entry.at).toLocaleString()}</span>
                          </div>
                          <h5>{entry.eventType}</h5>
                          <p className={styles.threadText}>{entry.summary}</p>
                          {entry.fields.length > 0 ? (
                            <div className={styles.threadFieldList}>
                              {entry.fields.map((field) => (
                                <div key={`${entry.id}-${field.key}`} className={styles.threadFieldRow}>
                                  <span>{field.key}</span>
                                  <span>{field.value}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <p className={styles.threadLabel}>Evidence</p>
                          <ul>
                            {entry.evidence.map((row, index) => <li key={`${entry.id}-${index}`}>{row}</li>)}
                          </ul>
                          {entry.next ? (
                            <>
                              <p className={styles.threadLabel}>Next</p>
                              <p className={styles.threadText}>{entry.next}</p>
                            </>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
