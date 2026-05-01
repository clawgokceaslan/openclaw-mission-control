import { type CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuBot, LuFilter, LuListChecks, LuListTodo, LuPaperclip, LuPencil, LuPlus, LuSearch, LuSlidersHorizontal, LuSparkles, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, CustomField, OutputFormat, Skill, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskTemplate, TaskTemplatePayload } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { MarkdownDescriptionEditor, prefixDataFormatTokens, type DescriptionDataFormat } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { AttachmentTable, storedAttachmentRows } from '@renderer/components/attachments/AttachmentTable'
import { AttachmentRow, attachmentRowsFromDescription, normalizeAttachments, removeAttachmentFromMarkdown, uploadTaskAttachment } from '@renderer/components/attachments/attachments'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { Stack } from 'react-bootstrap'
import { AgentAssignmentPanel, SkillsAssignmentPanel } from '../projects/detail/AssignmentPanels'
import { TaskDetailModal } from '../projects/detail/TaskDetailModal'
import { TaskDetailContent } from '../projects/detail/TaskDetailContent'
import { PROJECT_STATUS_COLUMNS, resolveProjectStatusColumn } from '../projects/detail/status'
import detailStyles from '../projects/ProjectDetailPage.module.scss'
import styles from './TaskTemplatesPage.module.scss'

type SaveState = 'saved' | 'dirty' | 'saving' | 'failed'
type BuilderTab = 'subtasks' | 'customFields' | 'checklist' | 'attachments' | 'agent' | 'skills'
type DraftSubtask = NonNullable<TaskTemplatePayload['subtasks']>[number] & { uiId: string }
type TextDraftRow = { id: string; title: string }
type CustomFieldDraftRow = { id: string; field: AppSelectOption | null; value: string }
type DataFormatRole = OutputFormat['formatRole']

const SAVE_DELAY_MS = 700
const DEFAULT_DETAIL_RATIO = 0.72
const MIN_DETAIL_WIDTH = 420
const MIN_COMMENTS_WIDTH = 320
const PAGE_SIZE_OPTIONS: AppSelectOption[] = [
  { label: '10 / page', value: '10' },
  { label: '20 / page', value: '20' },
  { label: '50 / page', value: '50' }
]
const TEMPLATE_STATUS_OPTIONS = PROJECT_STATUS_COLUMNS.map((column) => ({
  value: column.status,
  label: column.title,
  color: column.accent
}))

function resizeTitleTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

function defaultTemplate(): TaskTemplatePayload {
  return {
    title: '',
    description: '',
    status: '',
    agentId: null,
    tagIds: [],
    skillIds: [],
    customFieldValues: {},
    checklistItems: [],
    inputFormatId: null,
    outputFormatId: null,
    comments: [],
    attachments: [],
    subtasks: []
  }
}

function createLocalId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeTemplate(value?: TaskTemplatePayload): TaskTemplatePayload {
  return {
    ...defaultTemplate(),
    ...(value ?? {}),
    tagIds: Array.isArray(value?.tagIds) ? value.tagIds : [],
    skillIds: Array.isArray(value?.skillIds) ? value.skillIds : [],
    customFieldValues: value?.customFieldValues && typeof value.customFieldValues === 'object' && !Array.isArray(value.customFieldValues) ? value.customFieldValues : {},
    checklistItems: Array.isArray(value?.checklistItems) ? value.checklistItems : [],
    comments: Array.isArray(value?.comments) ? value.comments : [],
    attachments: normalizeAttachments(value?.attachments),
    subtasks: Array.isArray(value?.subtasks) ? value.subtasks : []
  }
}

function toDraftSubtasks(template: TaskTemplatePayload): DraftSubtask[] {
  return (template.subtasks ?? []).map((subtask) => ({ ...subtask, uiId: createLocalId() }))
}

function stripDraftSubtasks(subtasks: DraftSubtask[]) {
  return subtasks.map(({ uiId: _uiId, ...subtask }) => subtask)
}

function checklistItem(title: string): TaskChecklistItem {
  const now = Date.now()
  return { id: createLocalId(), title, checked: false, createdAt: now, updatedAt: now }
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

function parseCustomFieldValue(field: CustomField, draft: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (field.type === 'boolean') return { ok: true, value: draft === 'true' }
  if (field.type === 'number') {
    if (!draft.trim()) return { ok: true, value: null }
    const numeric = Number(draft)
    return Number.isFinite(numeric) ? { ok: true, value: numeric } : { ok: false, error: 'Enter a valid number.' }
  }
  if (field.type === 'json') {
    if (!draft.trim()) return { ok: true, value: null }
    try {
      return { ok: true, value: JSON.parse(draft) }
    } catch {
      return { ok: false, error: 'Enter valid JSON.' }
    }
  }
  return { ok: true, value: draft }
}

function getSubtaskPayload(subtask: DraftSubtask): Record<string, unknown> {
  return subtask.payload && typeof subtask.payload === 'object' && !Array.isArray(subtask.payload) ? subtask.payload : {}
}

function getSubtaskCustomFields(subtask: DraftSubtask | null): Record<string, unknown> {
  if (!subtask) return {}
  const values = getSubtaskPayload(subtask).customFields
  return values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : {}
}

function getSubtaskDescription(subtask: DraftSubtask | null) {
  if (!subtask) return ''
  const description = getSubtaskPayload(subtask).description
  return typeof description === 'string' ? description : ''
}

function getSubtaskComments(subtask: DraftSubtask | null): TaskComment[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).comments
  if (!Array.isArray(value)) return []
  return value.filter((comment): comment is TaskComment => {
    if (!comment || typeof comment !== 'object') return false
    const candidate = comment as Partial<TaskComment>
    return typeof candidate.id === 'string' && typeof candidate.body === 'string' && typeof candidate.createdAt === 'number'
  }).map((comment) => ({
    id: comment.id,
    authorName: typeof comment.authorName === 'string' && comment.authorName.trim() ? comment.authorName : 'Operator',
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: typeof comment.updatedAt === 'number' ? comment.updatedAt : undefined
  }))
}

function getSubtaskAttachments(subtask: DraftSubtask | null): TaskAttachment[] {
  if (!subtask) return []
  return normalizeAttachments(getSubtaskPayload(subtask).attachments)
}

function getSubtaskAgentId(subtask: DraftSubtask | null) {
  if (!subtask) return undefined
  const payload = getSubtaskPayload(subtask)
  if (typeof payload.agentId === 'string' && payload.agentId) return payload.agentId
  return subtask.agentId ?? undefined
}

function getSubtaskSkillIds(subtask: DraftSubtask | null): string[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).skillIds
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

function getSubtaskTagIds(subtask: DraftSubtask | null): string[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).tagIds
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

function getSubtaskOutputFormatId(subtask: DraftSubtask | null) {
  if (!subtask) return undefined
  const value = getSubtaskPayload(subtask).outputFormatId ?? subtask.outputFormatId
  return typeof value === 'string' && value ? value : undefined
}

function getSubtaskInputFormatId(subtask: DraftSubtask | null) {
  if (!subtask) return undefined
  const value = getSubtaskPayload(subtask).inputFormatId ?? subtask.inputFormatId
  return typeof value === 'string' && value ? value : undefined
}

function clampRatio(value: number) {
  if (Number.isNaN(value)) return DEFAULT_DETAIL_RATIO
  return Math.max(0.45, Math.min(0.82, value))
}

export function TaskTemplatesPage() {
  const { token, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState<TaskTemplate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFilterTags, setSelectedFilterTags] = useState<AppSelectOption[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TaskTemplate | null>(null)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [editing, setEditing] = useState<TaskTemplate | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [templateDraft, setTemplateDraft] = useState<TaskTemplatePayload>(defaultTemplate())
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([])
  const [activeTab, setActiveTab] = useState<BuilderTab>('subtasks')
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null)
  const [checklistDraft, setChecklistDraft] = useState('')
  const [subtaskTitleDraft, setSubtaskTitleDraft] = useState('')
  const [customFieldDraft, setCustomFieldDraft] = useState('')
  const [selectedCustomField, setSelectedCustomField] = useState<AppSelectOption | null>(null)
  const [customFieldError, setCustomFieldError] = useState<string | null>(null)
  const [editingTemplateSubtaskId, setEditingTemplateSubtaskId] = useState<string | null>(null)
  const [templateSubtaskDraft, setTemplateSubtaskDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [subtaskCommentDraft, setSubtaskCommentDraft] = useState('')
  const [editingSubtaskCommentId, setEditingSubtaskCommentId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isAttachmentUploading, setIsAttachmentUploading] = useState(false)
  const [detailRatio, setDetailRatio] = useState(DEFAULT_DETAIL_RATIO)
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const [isSubtaskModalOpen, setIsSubtaskModalOpen] = useState(false)
  const [subtaskRows, setSubtaskRows] = useState<TextDraftRow[]>([{ id: createLocalId(), title: '' }])
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false)
  const [checklistRows, setChecklistRows] = useState<TextDraftRow[]>([{ id: createLocalId(), title: '' }])
  const [isCustomFieldModalOpen, setIsCustomFieldModalOpen] = useState(false)
  const [isCreateCustomFieldOpen, setIsCreateCustomFieldOpen] = useState(false)
  const [customFieldRows, setCustomFieldRows] = useState<CustomFieldDraftRow[]>([{ id: createLocalId(), field: null, value: '' }])
  const [quickFieldName, setQuickFieldName] = useState('')
  const [quickFieldType, setQuickFieldType] = useState<CustomField['type']>('text')
  const [isOutputFormatModalOpen, setIsOutputFormatModalOpen] = useState(false)
  const [isCreateOutputFormatOpen, setIsCreateOutputFormatOpen] = useState(false)
  const [outputFormatDraftOption, setOutputFormatDraftOption] = useState<AppSelectOption | null>(null)
  const [dataFormatRoleDraft, setDataFormatRoleDraft] = useState<DataFormatRole>('output')
  const [dataFormatTarget, setDataFormatTarget] = useState<{ role: DataFormatRole; scope: 'template' | 'subtask' } | null>(null)
  const [quickOutputFormatName, setQuickOutputFormatName] = useState('')
  const [quickOutputFormatDescription, setQuickOutputFormatDescription] = useState('')

  const templateBodyRef = useRef<HTMLDivElement | null>(null)
  const subtaskClickTimerRef = useRef<number | null>(null)
  const nextSubtaskRowFocusRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const editingRef = useRef<TaskTemplate | null>(null)
  const nameRef = useRef('')
  const descriptionRef = useRef('')
  const templateRef = useRef<TaskTemplatePayload>(defaultTemplate())
  const subtasksRef = useRef<DraftSubtask[]>([])

  const refresh = async () => {
    setLoading(true)
    const [templatesResponse, agentsResponse, tagsResponse, skillsResponse, customFieldsResponse, outputFormatsResponse] = await Promise.all([
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token),
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token)
    ])
    setLoading(false)
    if (!templatesResponse.ok) {
      setError(templatesResponse.error?.message ?? 'Unable to load task templates')
      setItems([])
      return
    }
    setItems(Array.isArray(templatesResponse.data) ? templatesResponse.data : [])
    setAgents(Array.isArray(agentsResponse.data) ? agentsResponse.data : [])
    setTags(Array.isArray(tagsResponse.data) ? tagsResponse.data : [])
    setSkills(Array.isArray(skillsResponse.data) ? skillsResponse.data : [])
    setCustomFields(Array.isArray(customFieldsResponse.data) ? customFieldsResponse.data : [])
    setOutputFormats(Array.isArray(outputFormatsResponse.data) ? outputFormatsResponse.data : [])
    setError(!agentsResponse.ok
      ? agentsResponse.error?.message ?? 'Unable to load agents'
      : !tagsResponse.ok
        ? tagsResponse.error?.message ?? 'Unable to load tags'
        : !skillsResponse.ok
          ? skillsResponse.error?.message ?? 'Unable to load skills'
          : !customFieldsResponse.ok
            ? customFieldsResponse.error?.message ?? 'Unable to load custom fields'
            : !outputFormatsResponse.ok
              ? outputFormatsResponse.error?.message ?? 'Unable to load data formats'
              : null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  useEffect(() => {
    editingRef.current = editing
    nameRef.current = nameDraft
    descriptionRef.current = descriptionDraft
    templateRef.current = templateDraft
    subtasksRef.current = draftSubtasks
  }, [editing, nameDraft, descriptionDraft, templateDraft, draftSubtasks])

  useEffect(() => {
    if (!nextSubtaskRowFocusRef.current) return
    const input = document.querySelector<HTMLInputElement>(`[data-template-subtask-row-id="${nextSubtaskRowFocusRef.current}"]`)
    if (!input) return
    input.focus()
    nextSubtaskRowFocusRef.current = null
  }, [subtaskRows])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!editing) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void closeBuilder()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [editing])

  useEffect(() => {
    if (!isResizingSplit) return

    const onMouseMove = (event: MouseEvent) => {
      const body = templateBodyRef.current
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
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizingSplit])

  const tagOptions = useMemo(() => tags.map((tag) => ({ label: tag.name, value: tag.id, color: tag.color })), [tags])
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])
  const agentOptions = useMemo(() => agents.map((agent) => ({ label: agent.name, value: agent.id })), [agents])
  const skillOptions = useMemo(() => skills.map((skill) => ({ label: skill.name, value: skill.id })), [skills])
  const customFieldOptions = useMemo(() => customFields.map((field) => ({ label: field.name, value: field.id })), [customFields])
  const inputFormatOptions = useMemo(() => outputFormats.filter((format) => format.formatRole === 'input').map((format) => ({ label: format.name, value: format.id })), [outputFormats])
  const outputFormatOptions = useMemo(() => outputFormats.filter((format) => format.formatRole !== 'input').map((format) => ({ label: format.name, value: format.id })), [outputFormats])
  const outputFormatById = useMemo(() => new Map(outputFormats.map((format) => [format.id, format])), [outputFormats])
  const selectedSubtask = useMemo(() => draftSubtasks.find((subtask) => subtask.uiId === selectedSubtaskId) ?? null, [draftSubtasks, selectedSubtaskId])
  useEffect(() => {
    setSubtaskCommentDraft('')
    setEditingSubtaskCommentId(null)
  }, [selectedSubtaskId])

  const selectedAgentObject = templateDraft.agentId ? agents.find((agent) => agent.id === templateDraft.agentId) ?? null : null
  const selectedTags = tagOptions.filter((option) => (templateDraft.tagIds ?? []).includes(option.value))
  const selectedSkills = skillOptions.filter((option) => (templateDraft.skillIds ?? []).includes(option.value))
  const selectedSkillObjects = skills.filter((skill) => (templateDraft.skillIds ?? []).includes(skill.id))
  const selectedInputFormat = templateDraft.inputFormatId ? (() => {
    const format = outputFormatById.get(templateDraft.inputFormatId)
    return format ? { label: format.name, value: format.id } : null
  })() : null
  const selectedOutputFormat = templateDraft.outputFormatId ? (() => {
    const format = outputFormatById.get(templateDraft.outputFormatId)
    return format ? { label: format.name, value: format.id } : null
  })() : null
  const selectedSubtaskStatus = selectedSubtask?.status || PROJECT_STATUS_COLUMNS[0].status
  const selectedSubtaskStatusColumn = resolveProjectStatusColumn(selectedSubtaskStatus, PROJECT_STATUS_COLUMNS)
  const selectedSubtaskInputFormat = (() => {
    const id = getSubtaskInputFormatId(selectedSubtask)
    const format = id ? outputFormatById.get(id) : null
    return format ? { label: format.name, value: format.id } : null
  })()
  const selectedSubtaskOutputFormat = (() => {
    const id = getSubtaskOutputFormatId(selectedSubtask)
    const format = id ? outputFormatById.get(id) : null
    return format ? { label: format.name, value: format.id } : null
  })()
  const templateAttachmentRows = useMemo<AttachmentRow[]>(() => [
    ...storedAttachmentRows(normalizeAttachments(templateDraft.attachments)),
    ...attachmentRowsFromDescription(descriptionDraft, 'Description')
  ], [descriptionDraft, templateDraft.attachments])
  const subtaskAttachmentRows = useMemo<AttachmentRow[]>(() => [
    ...storedAttachmentRows(getSubtaskAttachments(selectedSubtask)),
    ...attachmentRowsFromDescription(getSubtaskDescription(selectedSubtask), 'Subtask description')
  ], [selectedSubtask])
  const splitTemplate = `${Math.round(detailRatio * 100)}% 6px minmax(${MIN_COMMENTS_WIDTH}px, 1fr)`
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('tr')
    const filterTagIds = selectedFilterTags.map((tag) => tag.value)
    return [...items]
      .sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt))
      .filter((item) => {
        const searchable = [
          item.name,
          item.description ?? '',
          item.template.title ?? '',
          item.template.description ?? ''
        ].join(' ').toLocaleLowerCase('tr')
        const matchesSearch = !query || searchable.includes(query)
        const itemTagIds = Array.isArray(item.template.tagIds) ? item.template.tagIds : []
        const matchesTags = filterTagIds.length === 0 || filterTagIds.some((tagId) => itemTagIds.includes(tagId) && tagById.has(tagId))
        return matchesSearch && matchesTags
      })
  }, [items, searchQuery, selectedFilterTags, tagById])
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const pagedItems = useMemo(() => filteredItems.slice((page - 1) * pageSize, page * pageSize), [filteredItems, page, pageSize])
  const pageStart = filteredItems.length === 0 ? 0 : ((page - 1) * pageSize) + 1
  const pageEnd = Math.min(filteredItems.length, page * pageSize)
  const hasActiveFilters = Boolean(searchQuery.trim()) || selectedFilterTags.length > 0

  const persistNow = async () => {
    const target = editingRef.current
    if (!target) return true
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!nameRef.current.trim()) {
      setSaveState('failed')
      setSaveError('Template name is required.')
      return false
    }
    if (inFlightRef.current) {
      pendingRef.current = true
      return true
    }
    inFlightRef.current = true
    setSaveState('saving')
    const payload = {
      ...normalizeTemplate(templateRef.current),
      title: nameRef.current.trim(),
      description: descriptionRef.current.trim(),
      subtasks: stripDraftSubtasks(subtasksRef.current)
    }
    const response = await invokeBridge<TaskTemplate>(IPC_CHANNELS.taskTemplates.update, {
      actorToken: token,
      id: target.id,
      name: nameRef.current.trim(),
      description: descriptionRef.current.trim(),
      template: payload
    })
    inFlightRef.current = false
    if (!response.ok || !response.data) {
      setSaveState('failed')
      setSaveError(response.error?.message ?? 'Unable to save task template')
      return false
    }
    setEditing(response.data)
    setItems((current) => current.map((item) => item.id === response.data?.id ? response.data : item))
    setSaveState('saved')
    setSaveError(null)
    if (pendingRef.current) {
      pendingRef.current = false
      return persistNow()
    }
    return true
  }

  const scheduleSave = () => {
    setSaveState('dirty')
    setSaveError(null)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void persistNow()
    }, SAVE_DELAY_MS)
  }

  const patchTemplate = (patch: Partial<TaskTemplatePayload>) => {
    setTemplateDraft((current) => {
      const next = normalizeTemplate({ ...current, ...patch })
      templateRef.current = next
      return next
    })
    scheduleSave()
  }

  const uploadTemplateAttachments = async (files: File[]) => {
    setIsAttachmentUploading(true)
    try {
      const uploaded = await Promise.all(files.map((file) => uploadTaskAttachment(file, token, {
        scope: 'template',
        templateId: editingRef.current?.id
      })))
      const nextAttachments: TaskAttachment[] = [
        ...normalizeAttachments(templateRef.current.attachments),
        ...uploaded
      ]
      patchTemplate({ attachments: nextAttachments })
    } catch (error) {
      setSaveState('failed')
      setSaveError(error instanceof Error ? error.message : 'Unable to upload attachments')
    } finally {
      setIsAttachmentUploading(false)
    }
  }

  const uploadTemplateSubtaskAttachments = async (files: File[]) => {
    if (!selectedSubtask) return
    setIsAttachmentUploading(true)
    try {
      const uploaded = await Promise.all(files.map((file) => uploadTaskAttachment(file, token, {
        scope: 'templateSubtask',
        templateId: editingRef.current?.id,
        templateSubtaskId: selectedSubtask.uiId
      })))
      updateSelectedSubtaskPayload({
        attachments: [...getSubtaskAttachments(selectedSubtask), ...uploaded]
      })
    } catch (error) {
      setSaveState('failed')
      setSaveError(error instanceof Error ? error.message : 'Unable to upload subtask attachments')
    } finally {
      setIsAttachmentUploading(false)
    }
  }

  const removeTemplateSubtaskAttachment = (row: AttachmentRow) => {
    if (!selectedSubtask) return
    if (row.origin === 'stored') {
      updateSelectedSubtaskPayload({
        attachments: getSubtaskAttachments(selectedSubtask).filter((attachment) => attachment.id !== row.id)
      })
      return
    }
    updateSelectedSubtaskPayload({
      description: removeAttachmentFromMarkdown(getSubtaskDescription(selectedSubtask), row.url)
    })
  }

  const removeTemplateAttachment = (row: AttachmentRow) => {
    if (row.origin === 'stored') {
      patchTemplate({
        attachments: normalizeAttachments(templateRef.current.attachments).filter((attachment) => attachment.id !== row.id)
      })
      return
    }
    const nextDescription = removeAttachmentFromMarkdown(descriptionRef.current, row.url)
    setDescriptionDraft(nextDescription)
    descriptionRef.current = nextDescription
    patchTemplate({ description: nextDescription })
  }

  const patchSubtasks = (updater: (current: DraftSubtask[]) => DraftSubtask[]) => {
    setDraftSubtasks((current) => {
      const next = updater(current)
      subtasksRef.current = next
      return next
    })
    scheduleSave()
  }

  const openCreate = () => {
    setCreateName('')
    setCreateDescription('')
    setFormError(null)
    setCreateOpen(true)
  }

  useEffect(() => {
    const state = location.state as { openCreate?: boolean; name?: string } | null
    const searchParams = new URLSearchParams(location.search)
    const shouldOpen = Boolean(state?.openCreate) || searchParams.get('create') === '1'
    if (!shouldOpen) return
    setCreateName(state?.name ?? searchParams.get('name') ?? '')
    setCreateDescription('')
    setFormError(null)
    setCreateOpen(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate])

  const createTemplate = async (event: FormEvent) => {
    event.preventDefault()
    if (!createName.trim()) {
      setFormError('Template name is required.')
      return
    }
    setLoading(true)
    const response = await invokeBridge<TaskTemplate>(IPC_CHANNELS.taskTemplates.create, {
      actorToken: token,
      name: createName.trim(),
      description: createDescription.trim(),
      template: {
        ...defaultTemplate(),
        title: createName.trim(),
        description: createDescription.trim()
      }
    })
    setLoading(false)
    if (!response.ok || !response.data) {
      setFormError(response.error?.message ?? 'Unable to create task template')
      return
    }
    setCreateOpen(false)
    setItems((current) => [response.data as TaskTemplate, ...current])
    openBuilder(response.data)
  }

  const openBuilder = (template: TaskTemplate) => {
    const normalized = normalizeTemplate(template.template)
    let didMigrateFormats = false
    const nextSubtasks = toDraftSubtasks(normalized).map((subtask) => {
      const previousDescription = getSubtaskDescription(subtask)
      const nextSubtaskDescription = prefixDataFormatTokens(
        previousDescription,
        getSubtaskInputFormatId(subtask),
        getSubtaskOutputFormatId(subtask),
        outputFormats
      )
      if (nextSubtaskDescription !== previousDescription) didMigrateFormats = true
      return {
        ...subtask,
        inputFormatId: null,
        outputFormatId: null,
        payload: {
          ...getSubtaskPayload(subtask),
          description: nextSubtaskDescription,
          inputFormatId: '',
          outputFormatId: ''
        }
      }
    })
    const nextName = normalized.title || template.name
    const nextDescription = prefixDataFormatTokens(
      normalized.description ?? template.description ?? '',
      normalized.inputFormatId,
      normalized.outputFormatId,
      outputFormats
    )
    if (nextDescription !== (normalized.description ?? template.description ?? '')) didMigrateFormats = true
    const nextTemplate = {
      ...normalized,
      description: nextDescription,
      inputFormatId: null,
      outputFormatId: null
    }
    editingRef.current = template
    nameRef.current = nextName
    descriptionRef.current = nextDescription
    templateRef.current = nextTemplate
    subtasksRef.current = nextSubtasks
    setEditing(template)
    setNameDraft(nextName)
    setDescriptionDraft(nextDescription)
    setTemplateDraft(nextTemplate)
    setDraftSubtasks(nextSubtasks)
    setActiveTab('subtasks')
    setSelectedSubtaskId(null)
    setChecklistDraft('')
    setSubtaskTitleDraft('')
    setCustomFieldDraft('')
    setSelectedCustomField(null)
    setCustomFieldError(null)
    setCommentDraft('')
    setEditingCommentId(null)
    setSubtaskCommentDraft('')
    setEditingSubtaskCommentId(null)
    setSaveState('saved')
    setSaveError(null)
    if (didMigrateFormats) {
      setSaveState('dirty')
      window.setTimeout(() => void persistNow(), 0)
    }
  }

  useEffect(() => {
    const state = location.state as { openTemplateId?: string; template?: TaskTemplate } | null
    const searchParams = new URLSearchParams(location.search)
    const templateId = state?.openTemplateId ?? searchParams.get('template')
    if (!templateId) return
    const target = state?.template ?? items.find((template) => template.id === templateId)
    if (!target) return
    openBuilder(target)
    navigate(location.pathname, { replace: true, state: null })
  }, [items, location.pathname, location.search, location.state, navigate])

  const closeBuilder = async () => {
    await persistNow()
    setEditing(null)
    setSelectedSubtaskId(null)
    setSubtaskCommentDraft('')
    setEditingSubtaskCommentId(null)
    setSaveState('saved')
    await refresh()
  }

  const deleteTemplate = async () => {
    if (!deleteTarget) return
    setLoading(true)
    const response = await invokeBridge(IPC_CHANNELS.taskTemplates.remove, { actorToken: token, id: deleteTarget.id })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete task template')
      return
    }
    setDeleteTarget(null)
    await refresh()
  }

  const addCustomFieldValue = (isSubtask = false) => {
    const field = customFields.find((item) => item.id === selectedCustomField?.value)
    if (!field) return
    const parsed = parseCustomFieldValue(field, customFieldDraft)
    if (!parsed.ok) {
      setCustomFieldError(parsed.error)
      return
    }
    setCustomFieldError(null)
    if (isSubtask && selectedSubtask) {
      patchSubtasks((current) => current.map((subtask) => {
        if (subtask.uiId !== selectedSubtask.uiId) return subtask
        const payload = getSubtaskPayload(subtask)
        const customFieldsValue = payload.customFields && typeof payload.customFields === 'object' && !Array.isArray(payload.customFields) ? payload.customFields as Record<string, unknown> : {}
        return { ...subtask, payload: { ...payload, customFields: { ...customFieldsValue, [field.id]: parsed.value } } }
      }))
    } else {
      patchTemplate({ customFieldValues: { ...(templateDraft.customFieldValues ?? {}), [field.id]: parsed.value } })
    }
    setSelectedCustomField(null)
    setCustomFieldDraft('')
    if (!isSubtask) setIsCustomFieldModalOpen(false)
  }

  const openCustomFieldModal = () => {
    setSelectedCustomField(null)
    setCustomFieldDraft('')
    setCustomFieldError(null)
    setQuickFieldName('')
    setQuickFieldType('text')
    setCustomFieldRows([{ id: createLocalId(), field: null, value: '' }])
    setIsCreateCustomFieldOpen(false)
    setIsCustomFieldModalOpen(true)
  }

  const createCustomFieldFromModal = async () => {
    const name = quickFieldName.trim()
    if (!name) return
    const response = await invokeBridge<CustomField>(IPC_CHANNELS.customFields.create, {
      actorToken: token,
      name,
      type: quickFieldType
    })
    if (!response.ok || !response.data) {
      setCustomFieldError(response.error?.message ?? 'Unable to create custom field')
      return
    }
    setCustomFields((current) => [...current, response.data as CustomField])
    setCustomFieldRows((current) => {
      const nextOption = { value: response.data.id, label: response.data.name }
      const emptyIndex = current.findIndex((row) => !row.field)
      if (emptyIndex === -1) return [...current, { id: createLocalId(), field: nextOption, value: customFieldValueToDraft(response.data as CustomField, response.data.defaultValue) }]
      return current.map((row, index) => index === emptyIndex ? { ...row, field: nextOption, value: customFieldValueToDraft(response.data as CustomField, response.data.defaultValue) } : row)
    })
    setQuickFieldName('')
    setQuickFieldType('text')
    setIsCreateCustomFieldOpen(false)
  }

  const addCustomFieldRows = () => {
    const nextValues = { ...(templateDraft.customFieldValues ?? {}) }
    const seen = new Set<string>()
    for (const row of customFieldRows) {
      if (!row.field) continue
      if (seen.has(row.field.value)) continue
      const field = customFields.find((item) => item.id === row.field?.value)
      if (!field) continue
      const parsed = parseCustomFieldValue(field, row.value)
      if (!parsed.ok) {
        setCustomFieldError(`${field.name}: ${parsed.error}`)
        return
      }
      seen.add(field.id)
      nextValues[field.id] = parsed.value
    }
    if (seen.size === 0) return
    setCustomFieldError(null)
    patchTemplate({ customFieldValues: nextValues })
    setCustomFieldRows([{ id: createLocalId(), field: null, value: '' }])
    setIsCustomFieldModalOpen(false)
  }

  const openDataFormatModal = (role: DataFormatRole, scope: 'template' | 'subtask') => {
    const selectedOption = scope === 'template'
      ? role === 'input' ? selectedInputFormat : selectedOutputFormat
      : role === 'input' ? selectedSubtaskInputFormat : selectedSubtaskOutputFormat
    setDataFormatTarget({ role, scope })
    setDataFormatRoleDraft(role)
    setOutputFormatDraftOption(selectedOption)
    setQuickOutputFormatName('')
    setQuickOutputFormatDescription('')
    setIsCreateOutputFormatOpen(false)
    setIsOutputFormatModalOpen(true)
  }

  const saveOutputFormatFromModal = () => {
    if (!dataFormatTarget) return
    const key = dataFormatTarget.role === 'input' ? 'inputFormatId' : 'outputFormatId'
    if (dataFormatTarget.scope === 'template') {
      patchTemplate({ [key]: outputFormatDraftOption?.value ?? null })
    } else {
      updateSelectedSubtaskPayload({ [key]: outputFormatDraftOption?.value ?? '' })
    }
    setIsOutputFormatModalOpen(false)
  }

  const createOutputFormatFromModal = async () => {
    const name = quickOutputFormatName.trim()
    if (!name) return
    const response = await invokeBridge<OutputFormat>(IPC_CHANNELS.outputFormats.create, {
      actorToken: token,
      name,
      description: quickOutputFormatDescription.trim(),
      formatRole: dataFormatRoleDraft,
      fields: []
    })
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to create data format')
      return
    }
    setOutputFormats((current) => [...current, response.data as OutputFormat])
    setOutputFormatDraftOption({ value: response.data.id, label: response.data.name })
    setQuickOutputFormatName('')
    setQuickOutputFormatDescription('')
    setIsCreateOutputFormatOpen(false)
  }

  const createDescriptionDataFormat = async (role: DataFormatRole): Promise<DescriptionDataFormat | null> => {
    const name = window.prompt(`New ${role} data format name`)
    if (!name?.trim()) return null
    const response = await invokeBridge<OutputFormat>(IPC_CHANNELS.outputFormats.create, {
      actorToken: token,
      name: name.trim(),
      description: undefined,
      formatRole: role,
      fields: []
    })
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to create data format')
      return null
    }
    setOutputFormats((current) => [response.data as OutputFormat, ...current])
    return response.data
  }

  const removeCustomFieldValue = (fieldId: string, isSubtask = false) => {
    if (isSubtask && selectedSubtask) {
      patchSubtasks((current) => current.map((subtask) => {
        if (subtask.uiId !== selectedSubtask.uiId) return subtask
        const payload = getSubtaskPayload(subtask)
        const values = { ...(payload.customFields as Record<string, unknown> | undefined) }
        delete values[fieldId]
        return { ...subtask, payload: { ...payload, customFields: values } }
      }))
      return
    }
    const values = { ...(templateDraft.customFieldValues ?? {}) }
    delete values[fieldId]
    patchTemplate({ customFieldValues: values })
  }

  const addSubtask = () => {
    const title = subtaskTitleDraft.trim()
    if (!title) return
    const subtask: DraftSubtask = { uiId: createLocalId(), title, status: '', payload: {} }
    patchSubtasks((current) => [...current, subtask])
    setSubtaskTitleDraft('')
    setIsSubtaskModalOpen(false)
  }

  const addSubtaskRows = () => {
    const titles = subtaskRows.map((row) => row.title.trim()).filter(Boolean)
    if (titles.length === 0) return
    patchSubtasks((current) => [
      ...current,
      ...titles.map((title) => ({ uiId: createLocalId(), title, status: '', payload: {} as Record<string, unknown> }))
    ])
    setSubtaskRows([{ id: createLocalId(), title: '' }])
    setIsSubtaskModalOpen(false)
  }

  const openChecklistModal = () => {
    setChecklistRows([{ id: createLocalId(), title: '' }])
    setIsChecklistModalOpen(true)
  }

  const addChecklistRows = () => {
    const titles = checklistRows.map((row) => row.title.trim()).filter(Boolean)
    if (titles.length === 0) return
    patchTemplate({ checklistItems: [...(templateDraft.checklistItems ?? []), ...titles.map((title) => checklistItem(title))] })
    setChecklistRows([{ id: createLocalId(), title: '' }])
    setIsChecklistModalOpen(false)
  }

  const updateSelectedSubtask = (patch: Partial<DraftSubtask>) => {
    if (!selectedSubtask) return
    patchSubtasks((current) => current.map((subtask) => subtask.uiId === selectedSubtask.uiId ? { ...subtask, ...patch } : subtask))
  }

  const scheduleOpenSubtaskDetail = (subtaskId: string) => {
    if (subtaskClickTimerRef.current) window.clearTimeout(subtaskClickTimerRef.current)
    subtaskClickTimerRef.current = window.setTimeout(() => {
      setSelectedSubtaskId(subtaskId)
      subtaskClickTimerRef.current = null
    }, 180)
  }

  const startTemplateSubtaskRename = (subtask: DraftSubtask) => {
    if (subtaskClickTimerRef.current) {
      window.clearTimeout(subtaskClickTimerRef.current)
      subtaskClickTimerRef.current = null
    }
    setEditingTemplateSubtaskId(subtask.uiId)
    setTemplateSubtaskDraft(subtask.title ?? '')
  }

  const saveTemplateSubtaskRename = () => {
    if (!editingTemplateSubtaskId) return
    const title = templateSubtaskDraft.trim()
    if (!title) {
      setEditingTemplateSubtaskId(null)
      setTemplateSubtaskDraft('')
      return
    }
    patchSubtasks((current) => current.map((subtask) => subtask.uiId === editingTemplateSubtaskId ? { ...subtask, title } : subtask))
    setEditingTemplateSubtaskId(null)
    setTemplateSubtaskDraft('')
  }

  const updateSelectedSubtaskPayload = (patch: Record<string, unknown>) => {
    if (!selectedSubtask) return
    patchSubtasks((current) => current.map((subtask) => {
      if (subtask.uiId !== selectedSubtask.uiId) return subtask
      return { ...subtask, payload: { ...getSubtaskPayload(subtask), ...patch } }
    }))
  }

  const renderDataFormatPanel = (scope: 'template' | 'subtask') => {
    const inputValue = scope === 'template' ? selectedInputFormat : selectedSubtaskInputFormat
    const outputValue = scope === 'template' ? selectedOutputFormat : selectedSubtaskOutputFormat
    const updateFormat = (role: DataFormatRole, option: AppSelectOption | null) => {
      const key = role === 'input' ? 'inputFormatId' : 'outputFormatId'
      if (scope === 'template') {
        patchTemplate({ [key]: option?.value ?? null })
      } else {
        updateSelectedSubtaskPayload({ [key]: option?.value ?? '' })
      }
    }

    return (
      <div className={detailStyles.dataFormatPanel}>
        {([
          { role: 'input' as const, title: 'Input data format', value: inputValue, options: inputFormatOptions, description: 'Incoming data shape' },
          { role: 'output' as const, title: 'Output data format', value: outputValue, options: outputFormatOptions, description: 'Expected result shape' }
        ]).map((item) => (
          <div key={item.role} className={detailStyles.dataFormatCard}>
            <div className={detailStyles.dataFormatHeader}>
              <span className={`${detailStyles.dataFormatRoleBadge} ${item.role === 'input' ? detailStyles.inputFormatBadge : detailStyles.outputFormatBadge}`}>
                {item.role === 'input' ? 'Input' : 'Output'}
              </span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.value?.label ?? 'Not set'} · {item.description}</small>
              </div>
            </div>
            <div className={detailStyles.dataFormatControls}>
              <AppSelect
                mode="single"
                variant="borderless"
                value={item.value}
                options={item.options}
                onChange={(option) => !Array.isArray(option) && updateFormat(item.role, option)}
                placeholder={item.role === 'input' ? 'Choose input format...' : 'Choose output format...'}
                isClearable
              />
              <button type="button" onClick={() => openDataFormatModal(item.role, scope)}>
                <LuPlus size={14} />
                New
              </button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const submitComment = () => {
    const body = commentDraft.trim()
    if (!body) return
    const now = Date.now()
    if (editingCommentId) {
      patchTemplate({
        comments: (templateDraft.comments ?? []).map((comment) => (
          comment.id === editingCommentId ? { ...comment, body, updatedAt: now } : comment
        ))
      })
      setEditingCommentId(null)
      setCommentDraft('')
      return
    }
    const comment: TaskComment = {
      id: createLocalId(),
      authorName: user?.name || 'Operator',
      body,
      createdAt: now
    }
    patchTemplate({ comments: [...(templateDraft.comments ?? []), comment] })
    setCommentDraft('')
  }

  const startEditComment = (comment: TaskComment) => {
    setEditingCommentId(comment.id)
    setCommentDraft(comment.body)
  }

  const removeComment = (commentId: string) => {
    patchTemplate({ comments: (templateDraft.comments ?? []).filter((comment) => comment.id !== commentId) })
    if (editingCommentId === commentId) {
      setEditingCommentId(null)
      setCommentDraft('')
    }
  }

  const updateSelectedSubtaskComments = (comments: TaskComment[]) => {
    if (!selectedSubtask) return
    patchSubtasks((current) => current.map((subtask) => {
      if (subtask.uiId !== selectedSubtask.uiId) return subtask
      return { ...subtask, payload: { ...getSubtaskPayload(subtask), comments } }
    }))
  }

  const submitSubtaskComment = () => {
    const body = subtaskCommentDraft.trim()
    if (!selectedSubtask || !body) return
    const now = Date.now()
    const currentComments = getSubtaskComments(selectedSubtask)
    if (editingSubtaskCommentId) {
      updateSelectedSubtaskComments(currentComments.map((comment) => (
        comment.id === editingSubtaskCommentId ? { ...comment, body, updatedAt: now } : comment
      )))
      setEditingSubtaskCommentId(null)
      setSubtaskCommentDraft('')
      return
    }
    updateSelectedSubtaskComments([
      ...currentComments,
      {
        id: createLocalId(),
        authorName: user?.name || 'Operator',
        body,
        createdAt: now
      }
    ])
    setSubtaskCommentDraft('')
  }

  const startEditSubtaskComment = (comment: TaskComment) => {
    setEditingSubtaskCommentId(comment.id)
    setSubtaskCommentDraft(comment.body)
  }

  const removeSubtaskComment = (comment: TaskComment) => {
    if (!selectedSubtask) return
    updateSelectedSubtaskComments(getSubtaskComments(selectedSubtask).filter((item) => item.id !== comment.id))
    if (editingSubtaskCommentId === comment.id) {
      setEditingSubtaskCommentId(null)
      setSubtaskCommentDraft('')
    }
  }

  const cancelEditSubtaskComment = () => {
    setEditingSubtaskCommentId(null)
    setSubtaskCommentDraft('')
  }

  const renderCustomFields = (values: Record<string, unknown>, isSubtask = false) => (
    <>
      <div className={detailStyles.detailSectionHeader}>
        <div>
          <h4>Custom fields</h4>
          <p>{Object.keys(values).length} assigned</p>
        </div>
      </div>
      {!isSubtask ? (
        <div className={detailStyles.tabCtaCard}>
          <div>
            <strong>Add custom field</strong>
            <span>Attach a field value to this template.</span>
          </div>
          <button type="button" className={detailStyles.tabActionButton} onClick={openCustomFieldModal}>
            <LuPlus size={15} />
            Add custom field
          </button>
        </div>
      ) : null}
      <div className={detailStyles.customFieldPanel}>
        {customFieldError ? <p className={detailStyles.customFieldError}>{customFieldError}</p> : null}
        {isSubtask ? (
          <div className={detailStyles.customFieldAddRow}>
            <AppSelect
              mode="single"
              value={selectedCustomField}
              options={customFieldOptions.filter((option) => !Object.prototype.hasOwnProperty.call(values, option.value))}
              onChange={(option) => {
                if (Array.isArray(option)) return
                setSelectedCustomField(option)
                setCustomFieldError(null)
                const field = customFields.find((item) => item.id === option?.value)
                setCustomFieldDraft(field ? customFieldValueToDraft(field, field.defaultValue) : '')
              }}
              placeholder="Add custom field..."
            />
          </div>
        ) : null}
        {isSubtask && selectedCustomField ? (() => {
          const field = customFields.find((item) => item.id === selectedCustomField.value)
          if (!field) return null
          return (
            <div className={detailStyles.customFieldEditor}>
              <div className={detailStyles.customFieldEditorHead}>
                <span>Add field value</span>
                <span className={`${detailStyles.customFieldType} ${detailStyles[`customFieldType_${field.type}`]}`}>{field.type}</span>
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
              <div className={detailStyles.customFieldEditorActions}>
                <button type="button" onClick={() => addCustomFieldValue(isSubtask)}>Save</button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomField(null)
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
        {Object.entries(values).length > 0 ? (
          <div className={detailStyles.customFieldList}>
            {Object.entries(values).map(([fieldId, value]) => {
              const field = customFields.find((item) => item.id === fieldId)
              return (
                <div key={fieldId} className={detailStyles.customFieldRow}>
                  <div className={detailStyles.customFieldInfo}>
                    <div>
                      <span className={detailStyles.customFieldName}>{field?.name ?? 'Missing custom field'}</span>
                      {field?.description ? <p>{field.description}</p> : null}
                    </div>
                    <span className={`${detailStyles.customFieldType} ${field ? detailStyles[`customFieldType_${field.type}`] : ''}`}>{field?.type ?? 'missing'}</span>
                  </div>
                  <pre className={detailStyles.customFieldValue}>{field ? customFieldValueLabel(field, value) : String(value)}</pre>
                  <div className={detailStyles.customFieldActions}>
                    <button type="button" aria-label={`Remove ${field?.name ?? 'custom field'}`} onClick={() => removeCustomFieldValue(fieldId, isSubtask)}>
                      <LuTrash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className={detailStyles.customFieldEmpty}>No custom fields on this {isSubtask ? 'subtask' : 'task'}.</p>
        )}
      </div>
    </>
  )

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Task templates</h1>
          <p>{items.length} templates configured.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openCreate} disabled={loading}>
          <LuPlus size={16} />
          Add template
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableToolbar}>
          <div className={styles.searchFilterShell}>
            <label className={styles.searchBox}>
              <LuSearch size={17} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onInput={() => setPage(1)}
                placeholder="Search by template name or description"
                aria-label="Search task templates"
              />
            </label>
            <div className={styles.filterBox}>
              <span className={styles.filterIcon} aria-hidden="true">
                <LuFilter size={16} />
              </span>
              <div className={styles.tableFilterSelect}>
                <AppSelect
                  mode="multi"
                  options={tagOptions}
                  value={selectedFilterTags}
                  onChange={(value) => {
                    setSelectedFilterTags(Array.isArray(value) ? value : [])
                    setPage(1)
                  }}
                  placeholder="Filter tags"
                />
              </div>
            </div>
          </div>
          <div className={styles.toolbarMeta}>
            <span className={styles.resultCount}>{filteredItems.length} / {items.length}</span>
            {hasActiveFilters ? (
              <button
                type="button"
                className={styles.clearFiltersButton}
                onClick={() => {
                  setSearchQuery('')
                  setSelectedFilterTags([])
                  setPage(1)
                }}
              >
                <LuX size={14} />
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <div className={styles.tableHead}>
          <span>Template</span>
          <span>Description</span>
          <span>Subtasks</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {filteredItems.length > 0 ? pagedItems.map((item) => (
          <div key={item.id} className={styles.tableRow}>
            <span className={styles.nameCell}>{item.name}</span>
            <span className={styles.mutedCell}>{item.description || 'No description.'}</span>
            <span className={styles.mutedCell}>{item.template.subtasks?.length ?? 0}</span>
            <span className={styles.mutedCell}>{new Date(item.updatedAt).toLocaleDateString()}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => openBuilder(item)} aria-label={`Edit ${item.name}`}><LuPencil size={15} /></button>
              <button type="button" className={styles.iconButton} onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.name}`}><LuTrash2 size={15} /></button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading task templates...' : hasActiveFilters ? 'No templates match your filters.' : 'No task templates configured.'}</div>
        )}
        <footer className={styles.tablePagination}>
          <span>{pageStart}-{pageEnd} of {filteredItems.length}</span>
          <div>
            <AppSelect
              mode="single"
              value={PAGE_SIZE_OPTIONS.find((option) => option.value === String(pageSize)) ?? PAGE_SIZE_OPTIONS[1]}
              options={PAGE_SIZE_OPTIONS}
              onChange={(value) => {
                setPageSize(Number(value?.value ?? 20))
                setPage(1)
              }}
            />
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button>
            <span>Page {page} / {totalPages}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Next</button>
          </div>
        </footer>
      </section>

      {createOpen ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setCreateOpen(false)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Create task template">
            <header className={styles.modalHeader}>
              <h2>Create task template</h2>
              <button type="button" className={styles.modalClose} onClick={() => setCreateOpen(false)} aria-label="Close create modal"><LuX size={16} /></button>
            </header>
            <form className={styles.form} onSubmit={createTemplate}>
              {formError ? <p className={styles.formError}>{formError}</p> : null}
              <label>Template name *<input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} required /></label>
              <label>Description<textarea rows={3} value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} /></label>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={loading || !createName.trim()}>Create and edit</button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {editing ? (
        <>
        <TaskDetailModal
          taskId={editing.id}
          onClose={() => void closeBuilder()}
          onOpenActivity={() => undefined}
          onEditTitle={() => undefined}
          onDeleteTask={() => setDeleteTarget(editing)}
          onFilesDrop={(files) => void uploadTemplateAttachments(files)}
        >
          <TaskDetailContent
            bodyRef={templateBodyRef}
            splitTemplate={splitTemplate}
            onResizeStart={() => setIsResizingSplit(true)}
            comments={templateDraft.comments ?? []}
            commentDraft={commentDraft}
            editingCommentId={editingCommentId}
            commentPlaceholder={editingCommentId ? 'Edit template comment...' : 'Write a template comment...'}
            onCommentDraftChange={setCommentDraft}
            onSubmitComment={submitComment}
            onEditComment={startEditComment}
            onRemoveComment={(comment) => removeComment(comment.id)}
            onCancelEditComment={() => {
              setEditingCommentId(null)
              setCommentDraft('')
            }}
          >
            <div className={detailStyles.detailPane}>
              <section className={detailStyles.breadcrumbRow}>
                <button type="button" className={detailStyles.breadcrumbBtn} onClick={() => void closeBuilder()}>
                  Task templates
                </button>
                <span className={detailStyles.breadcrumbSep}>&gt;</span>
                <button type="button" className={detailStyles.breadcrumbBtnActive}>
                  {nameDraft || 'Untitled template'}
                </button>
              </section>

              {saveError ? <p className={styles.builderError}>{saveError}</p> : null}

              <section className={detailStyles.detailTop}>
                <div className={detailStyles.taskTypeRow}>
                  <span className={detailStyles.taskTypePill}>Template</span>
                  <span className={detailStyles.projectContext}>
                    {saveState === 'saving' ? 'Saving...' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'failed' ? 'Failed' : 'Saved'}
                  </span>
                </div>
                <textarea
                  className={detailStyles.titleInput}
                  value={nameDraft}
                  ref={resizeTitleTextarea}
                  rows={1}
                  onInput={(event) => resizeTitleTextarea(event.currentTarget)}
                  onChange={(event) => {
                    setNameDraft(event.target.value)
                    nameRef.current = event.target.value
                    patchTemplate({ title: event.target.value })
                    scheduleSave()
                  }}
                  placeholder="Task title from template"
                />
                <div className={detailStyles.aiHint}>Template description and task body are saved automatically</div>
                <div className={detailStyles.metaGrid}>
                  <div className={detailStyles.metaCell}>
                    <span className={detailStyles.metaLabel}>Status</span>
                    <span className={detailStyles.metaValue}>{templateDraft.status || 'Target project default'}</span>
                  </div>
                </div>

                <div className={detailStyles.topControlGrid}>
                  <div className={`${detailStyles.topControlBlock} ${detailStyles.topControlCard}`}>
                    <span className={detailStyles.metaLabel}>Tags (shared)</span>
                    <p className={detailStyles.topControlSummary}>{selectedTags.length > 0 ? `${selectedTags.length} selected` : 'Empty'}</p>
                    <AppSelect mode="multi" variant="borderless" className={detailStyles.tagInlineSelect} value={selectedTags} options={tagOptions} onChange={(value) => patchTemplate({ tagIds: Array.isArray(value) ? value.map((item) => item.value) : [] })} placeholder="Search tags..." />
                  </div>
                </div>
              </section>

              <section className={detailStyles.drawerSection}>
                <h4>Description</h4>
                <MarkdownDescriptionEditor
                  className={detailStyles.descriptionField}
                  value={descriptionDraft}
                  minHeight={220}
                  onChange={(nextValue) => {
                    setDescriptionDraft(nextValue)
                    descriptionRef.current = nextValue
                    patchTemplate({ description: nextValue })
                  }}
                  onCommit={() => void persistNow()}
                  placeholder="Add template description, instructions, checklists or code..."
                  enableDataFormatCommands
                  dataFormats={outputFormats}
                  onCreateDataFormat={createDescriptionDataFormat}
                />
              </section>

              <section className={detailStyles.drawerSection}>
                <div className={detailStyles.tabRow}>
                      <button type="button" className={activeTab === 'subtasks' ? detailStyles.tabActive : detailStyles.tabBtn} onClick={() => setActiveTab('subtasks')}><LuListTodo size={15} />Subtasks</button>
                      <button type="button" className={activeTab === 'customFields' ? detailStyles.tabActive : detailStyles.tabBtn} onClick={() => setActiveTab('customFields')}><LuSlidersHorizontal size={15} />Custom fields</button>
                      <button type="button" className={activeTab === 'checklist' ? detailStyles.tabActive : detailStyles.tabBtn} onClick={() => setActiveTab('checklist')}><LuListChecks size={15} />Checklist</button>
                      <button type="button" className={activeTab === 'attachments' ? detailStyles.tabActive : detailStyles.tabBtn} onClick={() => setActiveTab('attachments')}><LuPaperclip size={15} />Attachments</button>
                      <button type="button" className={activeTab === 'agent' ? detailStyles.tabActive : detailStyles.tabBtn} onClick={() => setActiveTab('agent')}><LuBot size={15} />Agent</button>
                      <button type="button" className={activeTab === 'skills' ? detailStyles.tabActive : detailStyles.tabBtn} onClick={() => setActiveTab('skills')}><LuSparkles size={15} />Skills</button>
                    </div>
                    {activeTab === 'subtasks' ? (
                      <>
                        <div className={detailStyles.detailSectionHeader}>
                          <div>
                            <h4>Subtasks</h4>
                            <p>{draftSubtasks.length} subtasks</p>
                          </div>
                        </div>
                        <div className={detailStyles.tabCtaCard}>
                          <div>
                            <strong>Add subtask</strong>
                            <span>Create a reusable child task for this template.</span>
                          </div>
                          <button
                            type="button"
                            className={detailStyles.tabActionButton}
                            onClick={() => {
                              setSubtaskTitleDraft('')
                              setSubtaskRows([{ id: createLocalId(), title: '' }])
                              setIsSubtaskModalOpen(true)
                            }}
                          >
                            <LuPlus size={15} />
                            Add subtask
                          </button>
                        </div>
                        <Stack gap={2}>
                          {draftSubtasks.map((subtask) => (
                            <div key={subtask.uiId} className={detailStyles.subtaskRow}>
                              <button type="button" className={detailStyles.subtaskStatusToggle} aria-label="Template subtask status" title="Template subtask status">
                                <span />
                                Default
                              </button>
                              <label>
                                {editingTemplateSubtaskId === subtask.uiId ? (
                                  <input
                                    autoFocus
                                    className={detailStyles.subtaskInlineInput}
                                    value={templateSubtaskDraft}
                                    onChange={(event) => setTemplateSubtaskDraft(event.target.value)}
                                    onBlur={saveTemplateSubtaskRename}
                                    onKeyDown={(event) => {
                                      event.stopPropagation()
                                      if (event.key === 'Enter') {
                                        event.preventDefault()
                                        saveTemplateSubtaskRename()
                                      }
                                      if (event.key === 'Escape') {
                                        setEditingTemplateSubtaskId(null)
                                        setTemplateSubtaskDraft('')
                                      }
                                    }}
                                  />
                                ) : (
                                  <span
                                    className={detailStyles.editableSubtaskTitle}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      scheduleOpenSubtaskDetail(subtask.uiId)
                                    }}
                                    onDoubleClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      startTemplateSubtaskRename(subtask)
                                    }}
                                  >
                                    {subtask.title || 'Untitled subtask'}
                                  </span>
                                )}
                              </label>
                              <button type="button" className={detailStyles.subtaskRemoveBtn} onClick={() => patchSubtasks((current) => current.filter((item) => item.uiId !== subtask.uiId))} aria-label="Remove subtask" title="Remove subtask"><LuTrash2 size={14} /></button>
                            </div>
                          ))}
                          {draftSubtasks.length === 0 ? <p className={detailStyles.customFieldEmpty}>No subtasks in this template.</p> : null}
                        </Stack>
                      </>
                    ) : activeTab === 'customFields' ? renderCustomFields(templateDraft.customFieldValues ?? {}) : activeTab === 'checklist' ? (
                      <>
                        <div className={detailStyles.detailSectionHeader}>
                          <div>
                            <h4>Checklist</h4>
                            <p>
                              {(templateDraft.checklistItems ?? []).filter((item) => item.checked).length} checked /{' '}
                              {(templateDraft.checklistItems ?? []).length} total
                            </p>
                          </div>
                        </div>
                        <div className={detailStyles.checklistPanel}>
                          <div className={detailStyles.checklistProgress}>
                            <span
                              style={{
                                width: `${(templateDraft.checklistItems ?? []).length > 0
                                  ? Math.round((((templateDraft.checklistItems ?? []).filter((item) => item.checked).length) / (templateDraft.checklistItems ?? []).length) * 100)
                                  : 0}%`
                              }}
                            />
                          </div>
                          <div className={detailStyles.tabCtaCard}>
                            <div>
                              <strong>Add checklist item</strong>
                              <span>Add multiple checklist items in one flow.</span>
                            </div>
                            <button type="button" className={detailStyles.tabActionButton} onClick={openChecklistModal}>
                              <LuPlus size={15} />
                              Add checklist item
                            </button>
                          </div>
                          {(templateDraft.checklistItems ?? []).length > 0 ? (
                            <div className={detailStyles.checklistList}>
                              {(templateDraft.checklistItems ?? []).map((item) => (
                                <div key={item.id} className={detailStyles.checklistRow}>
                                  <input type="checkbox" checked={item.checked} onChange={() => patchTemplate({ checklistItems: (templateDraft.checklistItems ?? []).map((entry) => entry.id === item.id ? { ...entry, checked: !entry.checked, updatedAt: Date.now() } : entry) })} />
                                  <span className={item.checked ? detailStyles.checklistItemChecked : detailStyles.checklistItemTitle}>{item.title}</span>
                                  <button type="button" onClick={() => patchTemplate({ checklistItems: (templateDraft.checklistItems ?? []).filter((entry) => entry.id !== item.id) })} aria-label={`Remove ${item.title}`}><LuTrash2 size={14} /></button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className={detailStyles.customFieldEmpty}>No checklist items yet.</p>
                          )}
                        </div>
                      </>
                    ) : activeTab === 'attachments' ? (
                      <>
                        <div className={detailStyles.detailSectionHeader}>
                          <div>
                            <h4>Attachments</h4>
                            <p>{templateAttachmentRows.length} files</p>
                          </div>
                        </div>
                        <AttachmentTable
                          rows={templateAttachmentRows}
                          uploading={isAttachmentUploading}
                          onUpload={(files) => void uploadTemplateAttachments(files)}
                          onRemove={removeTemplateAttachment}
                          onError={(message) => {
                            setSaveState('failed')
                            setSaveError(message)
                          }}
                        />
                      </>
                    ) : activeTab === 'agent' ? (
                      <>
                        <div className={detailStyles.detailSectionHeader}>
                          <div>
                            <h4>Agent</h4>
                            <p>{selectedAgentObject?.name ?? 'Unassigned'}</p>
                          </div>
                        </div>
                        <AgentAssignmentPanel
                          agent={selectedAgentObject}
                          agents={agents}
                          ctaDescription="Choose the default agent for tasks created from this template."
                          onChange={(agentId) => patchTemplate({ agentId })}
                        />
                      </>
                    ) : activeTab === 'skills' ? (
                      <>
                        <div className={detailStyles.detailSectionHeader}>
                          <div>
                            <h4>Skills</h4>
                              <p>{selectedSkills.length} selected</p>
                            </div>
                          </div>
                        <SkillsAssignmentPanel
                          selectedSkills={selectedSkillObjects}
                          skills={skills}
                          source="Template"
                          ctaDescription="Select one or more default skills for this template."
                          onChange={(skillIds) => patchTemplate({ skillIds })}
                        />
                      </>
                    ) : null}
              </section>
            </div>
          </TaskDetailContent>
        </TaskDetailModal>
        {selectedSubtask ? (
          <TaskDetailModal
            taskId={selectedSubtask.uiId}
            title="Subtask detail"
            nested
            hideTaskActions
            onClose={() => {
              setSelectedSubtaskId(null)
              setCustomFieldError(null)
            }}
            onOpenActivity={() => undefined}
            onEditTitle={() => startTemplateSubtaskRename(selectedSubtask)}
            onDeleteTask={() => patchSubtasks((current) => current.filter((item) => item.uiId !== selectedSubtask.uiId))}
            onFilesDrop={(files) => void uploadTemplateSubtaskAttachments(files)}
          >
            <TaskDetailContent
              bodyRef={templateBodyRef}
              splitTemplate={splitTemplate}
              onResizeStart={() => setIsResizingSplit(true)}
              comments={getSubtaskComments(selectedSubtask)}
              commentDraft={subtaskCommentDraft}
              editingCommentId={editingSubtaskCommentId}
              commentPlaceholder={editingSubtaskCommentId ? 'Edit subtask comment...' : 'Write a subtask comment...'}
              onCommentDraftChange={setSubtaskCommentDraft}
              onSubmitComment={submitSubtaskComment}
              onEditComment={startEditSubtaskComment}
              onRemoveComment={removeSubtaskComment}
              onCancelEditComment={cancelEditSubtaskComment}
            >
            <div className={detailStyles.subtaskModalBody}>
              <div className={detailStyles.detailPane}>
                <section className={detailStyles.breadcrumbRow}>
                  <button type="button" className={detailStyles.breadcrumbBtn} onClick={() => setSelectedSubtaskId(null)}>
                    {templateDraft.title || nameDraft}
                  </button>
                  <span className={detailStyles.breadcrumbSep}>&gt;</span>
                  <button type="button" className={detailStyles.breadcrumbBtnActive}>{selectedSubtask.title || 'Subtask detail'}</button>
                </section>
                <section className={detailStyles.detailTop}>
                  <div className={detailStyles.taskTypeRow}>
                    <span className={detailStyles.taskTypePill}>Subtask</span>
                    <span className={detailStyles.projectContext}>in template</span>
                  </div>
                  <textarea
                    className={detailStyles.titleInput}
                    value={selectedSubtask.title ?? ''}
                    ref={resizeTitleTextarea}
                    rows={1}
                    onInput={(event) => resizeTitleTextarea(event.currentTarget)}
                    onChange={(event) => updateSelectedSubtask({ title: event.target.value })}
                  />
                  <div className={detailStyles.topControlGrid}>
                    <div
                      className={`${detailStyles.topControlBlock} ${detailStyles.topControlCard} ${detailStyles.statusControlCard}`}
                      style={{ '--status-accent': selectedSubtaskStatusColumn.accent } as CSSProperties}
                    >
                      <span className={detailStyles.metaLabel}>Status</span>
                      <p className={detailStyles.topControlSummary}>
                        <span className={detailStyles.statusPreviewPill}>
                          <span />
                          {selectedSubtaskStatusColumn.title}
                        </span>
                      </p>
                      <AppSelect
                        mode="single"
                        variant="borderless"
                        className={detailStyles.statusInlineSelect}
                        value={{
                          value: selectedSubtaskStatusColumn.status,
                          label: selectedSubtaskStatusColumn.title,
                          color: selectedSubtaskStatusColumn.accent
                        }}
                        options={TEMPLATE_STATUS_OPTIONS}
                        onChange={(option) => {
                          if (!Array.isArray(option) && option?.value) updateSelectedSubtask({ status: option.value })
                        }}
                      />
                    </div>
                  </div>
                </section>
              </div>
            </div>
            </TaskDetailContent>
          </TaskDetailModal>
        ) : null}
        </>
      ) : null}

      {isSubtaskModalOpen ? (
        <>
          <div className={detailStyles.createTaskBackdrop} onClick={() => setIsSubtaskModalOpen(false)} />
          <section className={`${detailStyles.createTaskModal} ${detailStyles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add subtask">
            <header className={detailStyles.createTaskHeader}>
              <div className={detailStyles.createTaskTabs}><span className={detailStyles.createTaskTabActive}>Subtask</span></div>
              <button type="button" onClick={() => setIsSubtaskModalOpen(false)} aria-label="Close add subtask modal"><LuX size={17} /></button>
            </header>
            <form className={detailStyles.createTaskBody} onSubmit={(event) => {
              event.preventDefault()
              addSubtaskRows()
            }}>
              <div className={detailStyles.multiAddList}>
                {subtaskRows.map((row, index) => (
                  <div key={row.id} className={detailStyles.multiAddRow}>
                    <span>{index + 1}</span>
                    <input
                      autoFocus={index === 0}
                      data-template-subtask-row-id={row.id}
                      value={row.title}
                      onChange={(event) => setSubtaskRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, title: event.target.value } : entry))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          const nextRow = { id: createLocalId(), title: '' }
                          nextSubtaskRowFocusRef.current = nextRow.id
                          setSubtaskRows((current) => [...current, nextRow])
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setIsSubtaskModalOpen(false)
                        }
                      }}
                      placeholder="Subtask name"
                    />
                    <button
                      type="button"
                      onClick={() => setSubtaskRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), title: '' }])}
                      aria-label="Remove subtask row"
                    >
                      <LuTrash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={detailStyles.modalAddRowButton}
                onClick={() => {
                  const nextRow = { id: createLocalId(), title: '' }
                  nextSubtaskRowFocusRef.current = nextRow.id
                  setSubtaskRows((current) => [...current, nextRow])
                }}
              >
                <LuPlus size={15} />
                Add row
              </button>
              <footer className={detailStyles.createTaskFooter}>
                <span>Enter adds another row.</span>
                <button type="submit" disabled={!subtaskRows.some((row) => row.title.trim())}>Save all</button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {isCustomFieldModalOpen ? (
        <>
          <div className={detailStyles.createTaskBackdrop} onClick={() => setIsCustomFieldModalOpen(false)} />
          <section className={`${detailStyles.createTaskModal} ${detailStyles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add custom field">
            <header className={detailStyles.createTaskHeader}>
              <div className={detailStyles.createTaskTabs}><span className={detailStyles.createTaskTabActive}>Custom field</span></div>
              <button type="button" onClick={() => setIsCustomFieldModalOpen(false)} aria-label="Close custom field modal"><LuX size={17} /></button>
            </header>
            <div className={detailStyles.createTaskBody}>
              {customFieldError ? <p className={detailStyles.customFieldError}>{customFieldError}</p> : null}
              <div className={detailStyles.multiAddList}>
                {customFieldRows.map((row, index) => {
                  const field = customFields.find((item) => item.id === row.field?.value)
                  const assignedIds = new Set(Object.keys(templateDraft.customFieldValues ?? {}))
                  const selectedOtherIds = new Set(customFieldRows.filter((entry) => entry.id !== row.id && entry.field).map((entry) => entry.field?.value ?? ''))
                  const rowOptions = customFields
                    .filter((item) => !assignedIds.has(item.id) && !selectedOtherIds.has(item.id))
                    .map((item) => ({ value: item.id, label: item.name }))
                  return (
                    <div key={row.id} className={detailStyles.multiCustomFieldRow}>
                      <span>{index + 1}</span>
                      <div className={detailStyles.multiCustomFieldMain}>
                        <label className={detailStyles.multiCustomFieldControl}>
                          <span>Field</span>
                          <AppSelect
                            mode="single"
                            value={row.field}
                            options={rowOptions}
                            onChange={(option) => {
                              if (Array.isArray(option)) return
                              const nextField = customFields.find((item) => item.id === option?.value)
                              setCustomFieldRows((current) => current.map((entry) => entry.id === row.id
                                ? { ...entry, field: option, value: nextField ? customFieldValueToDraft(nextField, nextField.defaultValue) : '' }
                                : entry))
                              setCustomFieldError(null)
                            }}
                            placeholder="Choose field..."
                          />
                        </label>
                        <label className={detailStyles.multiCustomFieldControl}>
                          <span>
                            Value
                            {field ? <em>{field.type}</em> : null}
                          </span>
                          {field?.type === 'boolean' ? (
                            <select value={row.value || 'false'} onChange={(event) => setCustomFieldRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}>
                              <option value="true">True</option>
                              <option value="false">False</option>
                            </select>
                          ) : (
                            <textarea
                              rows={field?.type === 'json' ? 4 : 1}
                              value={row.value}
                              onChange={(event) => setCustomFieldRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey && field?.type !== 'json') {
                                  event.preventDefault()
                                  setCustomFieldRows((current) => [...current, { id: createLocalId(), field: null, value: '' }])
                                }
                              }}
                              placeholder={field?.type === 'json' ? '{ "value": true }' : 'Value'}
                            />
                          )}
                        </label>
                      </div>
                      <button type="button" onClick={() => setCustomFieldRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), field: null, value: '' }])} aria-label="Remove custom field row">
                        <LuTrash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className={detailStyles.modalInlineActions}>
                <button type="button" className={detailStyles.modalAddRowButton} onClick={() => setCustomFieldRows((current) => [...current, { id: createLocalId(), field: null, value: '' }])}>
                  <LuPlus size={15} />
                  Add row
                </button>
                <button
                  type="button"
                  className={detailStyles.modalAddRowButton}
                  onClick={() => {
                    setQuickFieldName('')
                    setQuickFieldType('text')
                    setIsCreateCustomFieldOpen(true)
                  }}
                >
                  <LuPlus size={15} />
                  Add new custom field
                </button>
              </div>
              <footer className={detailStyles.modalFooterActions}>
                <button type="button" onClick={() => setIsCustomFieldModalOpen(false)}>Cancel</button>
                <button type="button" className={detailStyles.primaryModalAction} onClick={addCustomFieldRows}>Save all</button>
              </footer>
              {isCreateCustomFieldOpen ? (
                <>
                  <div className={detailStyles.nestedCreateBackdrop} onClick={() => setIsCreateCustomFieldOpen(false)} />
                  <section className={detailStyles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new custom field">
                    <header>
                      <h4>Add new custom field</h4>
                      <button type="button" onClick={() => setIsCreateCustomFieldOpen(false)} aria-label="Close custom field create popup"><LuX size={15} /></button>
                    </header>
                    <div className={detailStyles.nestedCreateBody}>
                      <input
                        autoFocus
                        value={quickFieldName}
                        onChange={(event) => setQuickFieldName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void createCustomFieldFromModal()
                          }
                        }}
                        placeholder="Field name"
                      />
                      <select value={quickFieldType} onChange={(event) => setQuickFieldType(event.target.value as CustomField['type'])}>
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="json">JSON</option>
                      </select>
                    </div>
                    <footer>
                      <button type="button" onClick={() => setIsCreateCustomFieldOpen(false)}>Cancel</button>
                      <button type="button" onClick={() => void createCustomFieldFromModal()} disabled={!quickFieldName.trim()}>Create</button>
                    </footer>
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      {isChecklistModalOpen ? (
        <>
          <div className={detailStyles.createTaskBackdrop} onClick={() => setIsChecklistModalOpen(false)} />
          <section className={`${detailStyles.createTaskModal} ${detailStyles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add checklist items">
            <header className={detailStyles.createTaskHeader}>
              <div className={detailStyles.createTaskTabs}><span className={detailStyles.createTaskTabActive}>Checklist</span></div>
              <button type="button" onClick={() => setIsChecklistModalOpen(false)} aria-label="Close checklist modal"><LuX size={17} /></button>
            </header>
            <form className={detailStyles.createTaskBody} onSubmit={(event) => {
              event.preventDefault()
              addChecklistRows()
            }}>
              <div className={detailStyles.multiAddList}>
                {checklistRows.map((row, index) => (
                  <div key={row.id} className={detailStyles.multiAddRow}>
                    <span>{index + 1}</span>
                    <input
                      autoFocus={index === 0}
                      value={row.title}
                      onChange={(event) => setChecklistRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, title: event.target.value } : entry))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          setChecklistRows((current) => [...current, { id: createLocalId(), title: '' }])
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setIsChecklistModalOpen(false)
                        }
                      }}
                      placeholder="Checklist item title"
                    />
                    <button type="button" onClick={() => setChecklistRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), title: '' }])} aria-label="Remove checklist row">
                      <LuTrash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className={detailStyles.modalAddRowButton} onClick={() => setChecklistRows((current) => [...current, { id: createLocalId(), title: '' }])}>
                <LuPlus size={15} />
                Add row
              </button>
              <footer className={detailStyles.createTaskFooter}>
                <span>Enter adds another row.</span>
                <button type="submit" disabled={!checklistRows.some((row) => row.title.trim())}>Save all</button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {isOutputFormatModalOpen ? (
        <>
          <div className={detailStyles.createTaskBackdrop} onClick={() => setIsOutputFormatModalOpen(false)} />
          <section className={`${detailStyles.createTaskModal} ${detailStyles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Set data format">
            <header className={detailStyles.createTaskHeader}>
              <div className={detailStyles.createTaskTabs}><span className={detailStyles.createTaskTabActive}>{dataFormatRoleDraft === 'input' ? 'Input data format' : 'Output data format'}</span></div>
              <button type="button" onClick={() => setIsOutputFormatModalOpen(false)} aria-label="Close data format modal"><LuX size={17} /></button>
            </header>
            <div className={detailStyles.createTaskBody}>
              <div className={detailStyles.modalField}>
                <span>Select data format</span>
                <AppSelect
                  mode="single"
                  value={outputFormatDraftOption}
                  options={dataFormatRoleDraft === 'input' ? inputFormatOptions : outputFormatOptions}
                  onChange={(option) => {
                    if (Array.isArray(option)) return
                    setOutputFormatDraftOption(option)
                  }}
                  placeholder="No data format"
                  isClearable
                />
              </div>
              <div className={detailStyles.modalInlineActions}>
                <button
                  type="button"
                  className={detailStyles.modalAddRowButton}
                  onClick={() => {
                    setQuickOutputFormatName('')
                    setQuickOutputFormatDescription('')
                    setIsCreateOutputFormatOpen(true)
                  }}
                >
                  <LuPlus size={15} />
                  Add new data format
                </button>
              </div>
              <footer className={detailStyles.modalFooterActions}>
                <button type="button" onClick={() => setIsOutputFormatModalOpen(false)}>Cancel</button>
                <button type="button" className={detailStyles.primaryModalAction} onClick={saveOutputFormatFromModal}>Save</button>
              </footer>
              {isCreateOutputFormatOpen ? (
                <>
                  <div className={detailStyles.nestedCreateBackdrop} onClick={() => setIsCreateOutputFormatOpen(false)} />
                  <section className={detailStyles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new data format">
                    <header>
                      <h4>Add new data format</h4>
                      <button type="button" onClick={() => setIsCreateOutputFormatOpen(false)} aria-label="Close data format create popup"><LuX size={15} /></button>
                    </header>
                    <div className={detailStyles.nestedCreateBody}>
                      <input
                        autoFocus
                        value={quickOutputFormatName}
                        onChange={(event) => setQuickOutputFormatName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void createOutputFormatFromModal()
                          }
                        }}
                        placeholder="Format name"
                      />
                      <input value={quickOutputFormatDescription} onChange={(event) => setQuickOutputFormatDescription(event.target.value)} placeholder="Description (optional)" />
                    </div>
                    <footer>
                      <button type="button" onClick={() => setIsCreateOutputFormatOpen(false)}>Cancel</button>
                      <button type="button" onClick={() => void createOutputFormatFromModal()} disabled={!quickOutputFormatName.trim()}>Create</button>
                    </footer>
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteTarget(null)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={`Delete ${deleteTarget.name}`}>
            <header className={styles.modalHeader}>
              <h2>Delete task template</h2>
              <button type="button" className={styles.modalClose} onClick={() => setDeleteTarget(null)} aria-label="Close delete modal"><LuX size={16} /></button>
            </header>
            <div className={styles.form}>
              <p>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button type="button" className={styles.dangerButton} onClick={() => void deleteTemplate()}>Delete</button>
              </footer>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
