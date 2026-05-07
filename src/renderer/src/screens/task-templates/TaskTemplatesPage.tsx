import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuFilter, LuPencil, LuPlus, LuSearch, LuTrash2, LuUpload, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import type { Agent, CodexCliGatewayConfig, CodexCliModel, CustomField, Gateway, OutputFormat, Project, ProjectStatus, Skill, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskJsonImportResult, TaskTemplate, TaskTemplatePayload } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { LoadingState } from '@renderer/components/loading'
import { prefixDataFormatTokens, type DescriptionDataFormat } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { storedAttachmentRows } from '@renderer/components/attachments/AttachmentTable'
import { AttachmentRow, attachmentRowsFromDescription, normalizeAttachments, removeAttachmentFromMarkdown, uploadTaskAttachment } from '@renderer/components/attachments/attachments'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { TaskJsonImportPopup } from '@renderer/popups/TaskJsonImport'
import { CreateTaskPopup } from '@renderer/popups/CreateTask'
import {
  TaskTemplateDetailPopup,
  type TaskTemplateBuilderTab as BuilderTab,
  type TaskTemplateCustomFieldDraftRow as CustomFieldDraftRow,
  type TaskTemplateDataFormatRole as DataFormatRole,
  type TaskTemplateDraftSubtask as DraftSubtask,
  type TaskTemplateSaveState as SaveState,
  type TaskTemplateSubtaskDetailTab as TemplateSubtaskDetailTab,
  type TaskTemplateTextDraftRow as TextDraftRow
} from '@renderer/popups/TaskTemplateDetailPopup'
import { parseTaskJsonImportPreview } from '../projects/detail/taskJsonImport'
import { PROJECT_STATUS_COLUMNS, columnsFromProjectStatuses } from '../projects/detail/status'
import styles from './TaskTemplatesPage.module.scss'
import { createTaskWithTemplate, type CreateTaskInput } from '../projects/detail/createTaskWithTemplate'

type GatewayModelsResponse = { gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }

const SAVE_DELAY_MS = 700
const DESCRIPTION_AUTOSAVE_DELAY_MS = 5000
const DEFAULT_DETAIL_RATIO = 0.72
const MIN_DETAIL_WIDTH = 420
const MIN_COMMENTS_WIDTH = 320
const PAGE_SIZE_OPTIONS: AppSelectOption[] = [
  { label: '10 / page', value: '10' },
  { label: '20 / page', value: '20' },
  { label: '50 / page', value: '50' }
]
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
    gateway: value?.gateway && typeof value.gateway === 'object' && !Array.isArray(value.gateway) ? value.gateway : undefined,
    subtasks: Array.isArray(value?.subtasks) ? value.subtasks : []
  }
}

function gatewayModelsFromGateways(gateways: Gateway[]): CodexCliModel[] {
  const byId = new Map<string, CodexCliModel>()
  for (const gateway of gateways) {
    const template = gateway.template && typeof gateway.template === 'object' && !Array.isArray(gateway.template)
      ? gateway.template as Partial<CodexCliGatewayConfig>
      : {}
    for (const model of template.models ?? []) {
      if (!byId.has(model.id)) byId.set(model.id, model)
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function codexConfigOf(gateway?: Gateway | null): CodexCliGatewayConfig {
  const template = gateway?.template && typeof gateway.template === 'object' && !Array.isArray(gateway.template)
    ? gateway.template as Partial<CodexCliGatewayConfig>
    : {}
  return {
    provider: 'codex_cli',
    codexPath: typeof template.codexPath === 'string' ? template.codexPath : gateway?.endpoint ?? 'codex',
    executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal',
    models: Array.isArray(template.models) ? template.models : [],
    lastModelRefreshAt: typeof template.lastModelRefreshAt === 'number' ? template.lastModelRefreshAt : undefined,
    lastModelRefreshError: typeof template.lastModelRefreshError === 'string' ? template.lastModelRefreshError : undefined
  }
}

function codexOverride(gatewayId?: string | null, model?: string | null): TaskTemplatePayload['gateway'] | undefined {
  const next: NonNullable<TaskTemplatePayload['gateway']> = {}
  if (gatewayId) next.gatewayId = gatewayId
  if (model) next.model = model
  return Object.keys(next).length > 0 ? next : undefined
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

function getSubtaskChecklistItems(subtask: DraftSubtask | null): TaskChecklistItem[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).checklistItems
  return Array.isArray(value)
    ? value.filter((item): item is TaskChecklistItem => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<TaskChecklistItem>
      return typeof candidate.id === 'string' && typeof candidate.title === 'string'
    })
    : []
}

function getSubtaskAgentId(subtask: DraftSubtask | null): string | undefined {
  if (!subtask) return undefined
  const payload = getSubtaskPayload(subtask)
  if (typeof payload.agentId === 'string' && payload.agentId.trim()) return payload.agentId
  if (typeof payload.assigneeId === 'string' && payload.assigneeId.trim()) return payload.assigneeId
  if (typeof subtask.agentId === 'string' && subtask.agentId.trim()) return subtask.agentId
  return undefined
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
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
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
  const [createImportJson, setCreateImportJson] = useState<string | null>(null)
  const [editing, setEditing] = useState<TaskTemplate | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [templateDraft, setTemplateDraft] = useState<TaskTemplatePayload>(defaultTemplate())
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([])
  const [selectedSubtaskDescriptionDraft, setSelectedSubtaskDescriptionDraft] = useState('')
  const [isSelectedSubtaskDescriptionDirty, setIsSelectedSubtaskDescriptionDirty] = useState(false)
  const [activeTab, setActiveTab] = useState<BuilderTab>('subtasks')
  const [subtaskDetailTab, setSubtaskDetailTab] = useState<TemplateSubtaskDetailTab>('agent')
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null)
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
  const [checklistTarget, setChecklistTarget] = useState<'template' | 'subtask'>('template')
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
  const [isJsonImportOpen, setIsJsonImportOpen] = useState(false)
  const [jsonImportTarget, setJsonImportTarget] = useState<'create' | 'edit'>('create')
  const [isJsonImporting, setIsJsonImporting] = useState(false)
  const [gatewayModelLoading, setGatewayModelLoading] = useState(false)
  const [gatewayModelError, setGatewayModelError] = useState<string | null>(null)
  const [isApplyTemplateOpen, setIsApplyTemplateOpen] = useState(false)
  const [applyTemplate, setApplyTemplate] = useState<TaskTemplate | null>(null)
  const [applyProjectId, setApplyProjectId] = useState('')
  const [applyStatusColumns, setApplyStatusColumns] = useState(PROJECT_STATUS_COLUMNS)
  const [isApplyTemplateLoading, setIsApplyTemplateLoading] = useState(false)
  const [applyTemplateError, setApplyTemplateError] = useState<string | null>(null)

  const templateBodyRef = useRef<HTMLDivElement | null>(null)
  const subtaskClickTimerRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const descriptionTimerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const editingRef = useRef<TaskTemplate | null>(null)
  const nameRef = useRef('')
  const descriptionRef = useRef('')
  const selectedSubtaskDescriptionRef = useRef('')
  const selectedSubtaskDescriptionSavedRef = useRef('')
  const templateRef = useRef<TaskTemplatePayload>(defaultTemplate())
  const subtasksRef = useRef<DraftSubtask[]>([])
  const lastGatewayModelRefreshRef = useRef<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    const [templatesResponse, agentsResponse, gatewaysResponse, tagsResponse, skillsResponse, customFieldsResponse, outputFormatsResponse, projectsResponse] = await Promise.all([
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token),
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token),
      loadList<Project>(IPC_CHANNELS.projects.list, token)
    ])
    setLoading(false)
    if (!templatesResponse.ok) {
      setError(templatesResponse.error?.message ?? 'Unable to load task templates')
      setItems([])
      return
    }
    setItems(Array.isArray(templatesResponse.data) ? templatesResponse.data : [])
    setAgents(Array.isArray(agentsResponse.data) ? agentsResponse.data : [])
    setGateways(Array.isArray(gatewaysResponse.data) ? gatewaysResponse.data : [])
    setTags(Array.isArray(tagsResponse.data) ? tagsResponse.data : [])
    setSkills(Array.isArray(skillsResponse.data) ? skillsResponse.data : [])
    setCustomFields(Array.isArray(customFieldsResponse.data) ? customFieldsResponse.data : [])
    setOutputFormats(Array.isArray(outputFormatsResponse.data) ? outputFormatsResponse.data : [])
    setProjects(Array.isArray(projectsResponse.data) ? projectsResponse.data : [])
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
              : !projectsResponse.ok
                ? projectsResponse.error?.message ?? 'Unable to load projects'
                : null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const refreshGatewayModels = async (gatewayId: string) => {
    if (!gatewayId) return
    setGatewayModelLoading(true)
    setGatewayModelError(null)
    const response = await invokeBridge<GatewayModelsResponse>(IPC_CHANNELS.gateways.gatewayModels, {
      actorToken: token,
      gatewayId
    })
    setGatewayModelLoading(false)
    if (!response.ok || !response.data) {
      setGatewayModelError(response.error?.message ?? 'Unable to load Codex models')
      return
    }
    setGateways((current) => current.map((gateway) => gateway.id === response.data!.gateway.id ? response.data!.gateway : gateway))
    if (response.data.error) setGatewayModelError(response.data.error)
    lastGatewayModelRefreshRef.current = gatewayId
  }

  useEffect(() => {
    editingRef.current = editing
    nameRef.current = nameDraft
    descriptionRef.current = descriptionDraft
    templateRef.current = templateDraft
    subtasksRef.current = draftSubtasks
  }, [editing, nameDraft, descriptionDraft, templateDraft, draftSubtasks])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      if (descriptionTimerRef.current) window.clearTimeout(descriptionTimerRef.current)
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
  const customFieldOptions = useMemo(() => customFields.map((field) => ({ label: field.name, value: field.id })), [customFields])
  const inputFormatOptions = useMemo(() => outputFormats.filter((format) => format.formatRole === 'input').map((format) => ({ label: format.name, value: format.id })), [outputFormats])
  const outputFormatOptions = useMemo(() => outputFormats.filter((format) => format.formatRole !== 'input').map((format) => ({ label: format.name, value: format.id })), [outputFormats])
  const outputFormatById = useMemo(() => new Map(outputFormats.map((format) => [format.id, format])), [outputFormats])
  const gatewayModelOptions = useMemo(() => gatewayModelsFromGateways(gateways), [gateways])
  const gatewayOptions = useMemo<AppSelectOption[]>(() => gateways.map((gateway) => ({ label: gateway.name, value: gateway.id })), [gateways])
  const templateGatewayId = templateDraft.gateway?.gatewayId ?? ''
  const templateGatewayModel = templateDraft.gateway?.model ?? ''
  const selectedTemplateGateway = templateGatewayId ? gateways.find((gateway) => gateway.id === templateGatewayId) ?? null : null
  const templateGatewayModelOptions = useMemo<CodexCliModel[]>(() => {
    if (!selectedTemplateGateway) return gatewayModelOptions
    return codexConfigOf(selectedTemplateGateway).models ?? []
  }, [gatewayModelOptions, selectedTemplateGateway])
  const templateGatewayOptions = gatewayOptions
  const selectedTemplateGatewayOption = templateGatewayId ? templateGatewayOptions.find((option) => option.value === templateGatewayId) ?? null : null
  const templateModelOptions = useMemo<AppSelectOption[]>(() => templateGatewayModelOptions.map((model) => ({ label: model.label || model.id, value: model.id })), [templateGatewayModelOptions])
  const selectedTemplateModelOption = templateModelOptions.find((option) => option.value === templateGatewayModel) ?? null
  const selectedSubtask = useMemo(() => draftSubtasks.find((subtask) => subtask.uiId === selectedSubtaskId) ?? null, [draftSubtasks, selectedSubtaskId])
  useEffect(() => {
    if (!editing || activeTab !== 'model' || !templateGatewayId) return
    const shouldRefresh = lastGatewayModelRefreshRef.current !== templateGatewayId || templateGatewayModelOptions.length === 0
    if (shouldRefresh && !gatewayModelLoading) void refreshGatewayModels(templateGatewayId)
  }, [editing, activeTab, templateGatewayId, templateGatewayModelOptions.length, gatewayModelLoading])
  useEffect(() => {
    setSubtaskCommentDraft('')
    setEditingSubtaskCommentId(null)
  }, [selectedSubtaskId])

  useEffect(() => {
    const nextDescription = getSubtaskDescription(selectedSubtask)
    selectedSubtaskDescriptionRef.current = nextDescription
    selectedSubtaskDescriptionSavedRef.current = nextDescription
    setSelectedSubtaskDescriptionDraft(nextDescription)
    setIsSelectedSubtaskDescriptionDirty(false)
  }, [selectedSubtaskId])

  useEffect(() => {
    if (!isApplyTemplateOpen) return
    if (!applyProjectId) {
      setApplyStatusColumns(PROJECT_STATUS_COLUMNS)
      return
    }
    let cancelled = false
    void (async () => {
      const response = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, {
        actorToken: token,
        projectId: applyProjectId
      })
      if (cancelled) return
      setApplyStatusColumns(response.ok && Array.isArray(response.data) ? columnsFromProjectStatuses(response.data) : PROJECT_STATUS_COLUMNS)
    })()
    return () => {
      cancelled = true
    }
  }, [applyProjectId, isApplyTemplateOpen, token])

  const selectedTags = tagOptions.filter((option) => (templateDraft.tagIds ?? []).includes(option.value))
  const selectedSkillObjects = skills.filter((skill) => (templateDraft.skillIds ?? []).includes(skill.id))
  const selectedInputFormat = templateDraft.inputFormatId ? (() => {
    const format = outputFormatById.get(templateDraft.inputFormatId)
    return format ? { label: format.name, value: format.id } : null
  })() : null
  const selectedOutputFormat = templateDraft.outputFormatId ? (() => {
    const format = outputFormatById.get(templateDraft.outputFormatId)
    return format ? { label: format.name, value: format.id } : null
  })() : null
  const selectedSubtaskTags = tagOptions.filter((option) => getSubtaskTagIds(selectedSubtask).includes(option.value))
  const selectedSubtaskSkillObjects = (() => {
    const skillIds = new Set(getSubtaskSkillIds(selectedSubtask))
    return skills.filter((skill) => skillIds.has(skill.id))
  })()
  const selectedSubtaskAgent = (() => {
    const agentId = getSubtaskAgentId(selectedSubtask)
    return agentId ? agents.find((agent) => agent.id === agentId) ?? null : null
  })()
  const selectedSubtaskChecklistItems = getSubtaskChecklistItems(selectedSubtask)
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
  const templateAttachmentRows = useMemo<AttachmentRow[]>(() => {
    const templateOwner = { ownerType: 'template' as const, ownerId: editing?.id ?? 'draft-template', ownerTitle: nameDraft }
    return [
      ...storedAttachmentRows(normalizeAttachments(templateDraft.attachments), 'Template attachments', templateOwner),
      ...attachmentRowsFromDescription(descriptionDraft, 'Template description', templateOwner),
      ...draftSubtasks.flatMap((subtask) => {
        const owner = { ownerType: 'templateSubtask' as const, ownerId: subtask.uiId, ownerTitle: subtask.title }
        return [
          ...storedAttachmentRows(getSubtaskAttachments(subtask), `Subtask: ${subtask.title}`, owner),
          ...attachmentRowsFromDescription(getSubtaskDescription(subtask), `Subtask description: ${subtask.title}`, owner)
        ]
      })
    ]
  }, [descriptionDraft, draftSubtasks, editing?.id, nameDraft, templateDraft.attachments])
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
    if (descriptionTimerRef.current) {
      window.clearTimeout(descriptionTimerRef.current)
      descriptionTimerRef.current = null
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
    const requestSubtaskDescriptionDraft = selectedSubtaskDescriptionRef.current
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
    selectedSubtaskDescriptionSavedRef.current = requestSubtaskDescriptionDraft
    if (selectedSubtaskDescriptionRef.current === requestSubtaskDescriptionDraft) {
      setIsSelectedSubtaskDescriptionDirty(false)
    }
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

  const scheduleDescriptionSave = () => {
    setSaveState('dirty')
    setSaveError(null)
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (descriptionTimerRef.current) window.clearTimeout(descriptionTimerRef.current)
    descriptionTimerRef.current = window.setTimeout(() => {
      void persistNow()
    }, DESCRIPTION_AUTOSAVE_DELAY_MS)
  }

  const patchTemplate = (patch: Partial<TaskTemplatePayload>, options?: { schedule?: boolean }) => {
    setTemplateDraft((current) => {
      const next = normalizeTemplate({ ...current, ...patch })
      templateRef.current = next
      return next
    })
    if (options?.schedule !== false) scheduleSave()
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
    if (row.ownerType === 'templateSubtask' && row.ownerId) {
      const targetSubtask = subtasksRef.current.find((subtask) => subtask.uiId === row.ownerId)
      if (!targetSubtask) return
      patchSubtasks((current) => current.map((subtask) => {
        if (subtask.uiId !== row.ownerId) return subtask
        const payload = getSubtaskPayload(subtask)
        if (row.origin === 'stored') {
          return {
            ...subtask,
            payload: {
              ...payload,
              attachments: getSubtaskAttachments(subtask).filter((attachment) => attachment.id !== row.id)
            }
          }
        }
        return {
          ...subtask,
          payload: {
            ...payload,
            description: removeAttachmentFromMarkdown(getSubtaskDescription(subtask), row.url)
          }
        }
      }))
      return
    }
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

  const patchSubtasks = (updater: (current: DraftSubtask[]) => DraftSubtask[], options?: { schedule?: boolean }) => {
    setDraftSubtasks((current) => {
      const next = updater(current)
      subtasksRef.current = next
      return next
    })
    if (options?.schedule !== false) scheduleSave()
  }

  const openCreate = () => {
    setCreateName('')
    setCreateDescription('')
    setCreateImportJson(null)
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
    setCreateImportJson(null)
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
    if (createImportJson?.trim()) {
      const response = await invokeBridge<TaskJsonImportResult>(IPC_CHANNELS.taskTemplates.importJson, {
        actorToken: token,
        json: createImportJson
      })
      setLoading(false)
      if (!response.ok || !response.data?.template) {
        setFormError(response.error?.message ?? 'Unable to import task template JSON')
        return
      }
      setCreateOpen(false)
      setCreateImportJson(null)
      if (response.data.warnings.length > 0) setError(response.data.warnings.join(' '))
      setItems((current) => [response.data?.template as TaskTemplate, ...current])
      openBuilder(response.data.template)
      return
    }
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

  const importTemplateJson = async (jsonText: string) => {
    if (jsonImportTarget === 'create') {
      const preview = parseTaskJsonImportPreview(jsonText)
      setCreateName(preview.title)
      setCreateDescription(preview.description)
      setCreateImportJson(jsonText)
      setIsJsonImportOpen(false)
      return
    }
    if (!editingRef.current) return
    setIsJsonImporting(true)
    const response = await invokeBridge<TaskJsonImportResult>(IPC_CHANNELS.taskTemplates.importJson, {
      actorToken: token,
      id: editingRef.current.id,
      json: jsonText
    })
    setIsJsonImporting(false)
    if (!response.ok || !response.data?.template) {
      setSaveState('failed')
      setSaveError(response.error?.message ?? 'Unable to import task template JSON')
      return
    }
    setIsJsonImportOpen(false)
    setSaveError(response.data.warnings.length > 0 ? response.data.warnings.join(' ') : null)
    setItems((current) => current.map((item) => item.id === response.data?.template?.id ? response.data.template : item))
    openBuilder(response.data.template)
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
    setSubtaskDetailTab('agent')
    setSelectedSubtaskId(null)
    selectedSubtaskDescriptionRef.current = ''
    selectedSubtaskDescriptionSavedRef.current = ''
    setSelectedSubtaskDescriptionDraft('')
    setIsSelectedSubtaskDescriptionDirty(false)
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
    setSelectedSubtaskDescriptionDraft('')
    setIsSelectedSubtaskDescriptionDirty(false)
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

  const openApplyTemplate = (template: TaskTemplate) => {
    if (projects.length === 0) {
      setError('No projects found to apply this template.')
      return
    }
    setApplyTemplate(template)
    setApplyProjectId(projects[0]?.id ?? '')
    setApplyStatusColumns(PROJECT_STATUS_COLUMNS)
    setApplyTemplateError(null)
    setIsApplyTemplateOpen(true)
  }

  const handleApplyTemplate = async (input: CreateTaskInput) => {
    if (!input.projectId?.trim()) {
      setApplyTemplateError('Please choose a project.')
      return
    }
    if (!input.templateId?.trim()) {
      setApplyTemplateError('Please choose a template.')
      return
    }
    setIsApplyTemplateLoading(true)
    setApplyTemplateError(null)
    try {
      const result = await createTaskWithTemplate({
        actorToken: token,
        userName: user?.name,
        input,
        templates: items,
        statusColumns: applyStatusColumns,
        defaultStatus: applyStatusColumns[0]?.status ?? PROJECT_STATUS_COLUMNS[0].status,
        outputFormats
      })
      if (result.warnings.length > 0) {
        setError(result.warnings.join(' '))
      }
      setApplyTemplateError(null)
      setIsApplyTemplateOpen(false)
      setApplyTemplate(null)
      setApplyProjectId('')
      setApplyStatusColumns(PROJECT_STATUS_COLUMNS)
      navigate(`${APP_ROUTES.PROJECTS}/${input.projectId}`, {
        state: {
          openTaskId: result.task.id
        }
      })
    } catch (applyError) {
      setApplyTemplateError(applyError instanceof Error ? applyError.message : 'Unable to apply template')
    } finally {
      setIsApplyTemplateLoading(false)
    }
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
    setChecklistTarget('template')
    setChecklistRows([{ id: createLocalId(), title: '' }])
    setIsChecklistModalOpen(true)
  }

  const openSubtaskChecklistModal = () => {
    setChecklistTarget('subtask')
    setChecklistRows([{ id: createLocalId(), title: '' }])
    setIsChecklistModalOpen(true)
  }

  const addChecklistRows = () => {
    const titles = checklistRows.map((row) => row.title.trim()).filter(Boolean)
    if (titles.length === 0) return
    if (checklistTarget === 'subtask' && selectedSubtask) {
      updateSelectedSubtaskPayload({
        checklistItems: [
          ...getSubtaskChecklistItems(selectedSubtask),
          ...titles.map((title) => checklistItem(title))
        ]
      })
    } else {
      patchTemplate({ checklistItems: [...(templateDraft.checklistItems ?? []), ...titles.map((title) => checklistItem(title))] })
    }
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
      setSubtaskDetailTab('agent')
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

  const updateSelectedSubtaskPayload = (patch: Record<string, unknown>, options?: { schedule?: boolean }) => {
    if (!selectedSubtask) return
    patchSubtasks((current) => current.map((subtask) => {
      if (subtask.uiId !== selectedSubtask.uiId) return subtask
      return { ...subtask, payload: { ...getSubtaskPayload(subtask), ...patch } }
    }), options)
  }

  const updateSelectedSubtaskDescription = (nextValue: string) => {
    selectedSubtaskDescriptionRef.current = nextValue
    setSelectedSubtaskDescriptionDraft(nextValue)
    setIsSelectedSubtaskDescriptionDirty(nextValue !== selectedSubtaskDescriptionSavedRef.current)
    updateSelectedSubtaskPayload({ description: nextValue, inputFormatId: '', outputFormatId: '' }, { schedule: false })
    scheduleDescriptionSave()
  }

  const resetSelectedTemplateSubtaskDescription = () => {
    if (descriptionTimerRef.current) {
      window.clearTimeout(descriptionTimerRef.current)
      descriptionTimerRef.current = null
    }
    const nextValue = selectedSubtaskDescriptionSavedRef.current
    selectedSubtaskDescriptionRef.current = nextValue
    setSelectedSubtaskDescriptionDraft(nextValue)
    setIsSelectedSubtaskDescriptionDirty(false)
    updateSelectedSubtaskPayload({ description: nextValue, inputFormatId: '', outputFormatId: '' }, { schedule: false })
  }

  const setTemplateSubtaskAgent = (agentId: string | null) => {
    const agent = agentId ? agents.find((item) => item.id === agentId) : null
    updateSelectedSubtaskPayload({
      agentId: agentId ?? '',
      assigneeId: agentId ?? '',
      assigneeName: agent?.name ?? ''
    })
  }

  const toggleTemplateSubtaskChecklistItem = (itemId: string) => {
    if (!selectedSubtask) return
    const now = Date.now()
    updateSelectedSubtaskPayload({
      checklistItems: getSubtaskChecklistItems(selectedSubtask).map((item) => (
        item.id === itemId ? { ...item, checked: !item.checked, updatedAt: now } : item
      ))
    })
  }

  const removeTemplateSubtaskChecklistItem = (itemId: string) => {
    if (!selectedSubtask) return
    updateSelectedSubtaskPayload({
      checklistItems: getSubtaskChecklistItems(selectedSubtask).filter((item) => item.id !== itemId)
    })
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
        {loading && filteredItems.length === 0 ? (
          <LoadingState variant="skeleton" rows={5} columns={5} messageIndex={2} />
        ) : filteredItems.length > 0 ? pagedItems.map((item) => (
          <div key={item.id} className={styles.tableRow}>
            <span className={styles.nameCell}>{item.name}</span>
            <span className={styles.mutedCell}>{item.description || 'No description.'}</span>
            <span className={styles.mutedCell}>{item.template.subtasks?.length ?? 0}</span>
            <span className={styles.mutedCell}>{new Date(item.updatedAt).toLocaleDateString()}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => openBuilder(item)} aria-label={`Edit ${item.name}`}><LuPencil size={15} /></button>
              <button type="button" className={styles.iconButton} onClick={() => openApplyTemplate(item)} aria-label={`Apply ${item.name} to project`}><LuUpload size={15} /></button>
              <button type="button" className={styles.iconButton} onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.name}`}><LuTrash2 size={15} /></button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{hasActiveFilters ? 'No templates match your filters.' : 'No task templates configured.'}</div>
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
              <div className={styles.createTaskHeaderActions}>
                <button
                  type="button"
                  onClick={() => {
                    setJsonImportTarget('create')
                    setIsJsonImportOpen(true)
                  }}
                >
                  <LuUpload size={15} />
                  Import JSON
                </button>
                <button type="button" className={styles.modalClose} onClick={() => setCreateOpen(false)} aria-label="Close create modal"><LuX size={16} /></button>
              </div>
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
        <TaskTemplateDetailPopup
          template={editing}
          nameDraft={nameDraft}
          descriptionDraft={descriptionDraft}
          selectedSubtaskDescriptionDraft={selectedSubtaskDescriptionDraft}
          isSelectedSubtaskDescriptionDirty={isSelectedSubtaskDescriptionDirty}
          templateDraft={templateDraft}
          draftSubtasks={draftSubtasks}
          selectedSubtask={selectedSubtask}
          saveState={saveState}
          saveError={saveError}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          subtaskDetailTab={subtaskDetailTab}
          setSubtaskDetailTab={setSubtaskDetailTab}
          bodyRef={templateBodyRef}
          splitTemplate={splitTemplate}
          onResizeStart={() => setIsResizingSplit(true)}
          onClose={() => void closeBuilder()}
          onImportJson={() => {
            setJsonImportTarget('edit')
            setIsJsonImportOpen(true)
          }}
          onDeleteTemplate={() => setDeleteTarget(editing)}
          onCloseSubtaskDetail={() => {
            setSelectedSubtaskId(null)
            setSelectedSubtaskDescriptionDraft('')
            setIsSelectedSubtaskDescriptionDirty(false)
            setCustomFieldError(null)
          }}
          onFilesDrop={(files) => void uploadTemplateAttachments(files)}
          onSubtaskFilesDrop={(files) => void uploadTemplateSubtaskAttachments(files)}
          resizeTitleTextarea={resizeTitleTextarea}
          onNameChange={(value) => {
            setNameDraft(value)
            nameRef.current = value
            patchTemplate({ title: value })
          }}
          onDescriptionChange={(nextValue) => {
            setDescriptionDraft(nextValue)
            descriptionRef.current = nextValue
            patchTemplate({ description: nextValue }, { schedule: false })
            scheduleDescriptionSave()
          }}
          onSelectedSubtaskDescriptionChange={updateSelectedSubtaskDescription}
          onResetSelectedSubtaskDescription={resetSelectedTemplateSubtaskDescription}
          onPatchTemplate={patchTemplate}
          onPatchSubtasks={patchSubtasks}
          onUpdateSelectedSubtask={updateSelectedSubtask}
          onUpdateSelectedSubtaskPayload={updateSelectedSubtaskPayload}
          onPersistNow={persistNow}
          onCreateDescriptionDataFormat={createDescriptionDataFormat}
          tagOptions={tagOptions}
          selectedTags={selectedTags}
          selectedSkillObjects={selectedSkillObjects}
          selectedSubtaskTags={selectedSubtaskTags}
          selectedSubtaskAgent={selectedSubtaskAgent}
          selectedSubtaskSkillObjects={selectedSubtaskSkillObjects}
          selectedSubtaskChecklistItems={selectedSubtaskChecklistItems}
          agents={agents}
          skills={skills}
          customFields={customFields}
          outputFormats={outputFormats}
          templateAttachmentRows={templateAttachmentRows}
          subtaskAttachmentRows={subtaskAttachmentRows}
          isAttachmentUploading={isAttachmentUploading}
          onUploadTemplateAttachments={uploadTemplateAttachments}
          onUploadSubtaskAttachments={uploadTemplateSubtaskAttachments}
          onRemoveTemplateAttachment={removeTemplateAttachment}
          onRemoveSubtaskAttachment={removeTemplateSubtaskAttachment}
          onAttachmentError={(message) => {
            setSaveState('failed')
            setSaveError(message)
          }}
          commentDraft={commentDraft}
          setCommentDraft={setCommentDraft}
          editingCommentId={editingCommentId}
          onSubmitComment={submitComment}
          onStartEditComment={startEditComment}
          onRemoveComment={removeComment}
          onCancelEditComment={() => {
            setEditingCommentId(null)
            setCommentDraft('')
          }}
          subtaskCommentDraft={subtaskCommentDraft}
          setSubtaskCommentDraft={setSubtaskCommentDraft}
          editingSubtaskCommentId={editingSubtaskCommentId}
          onSubmitSubtaskComment={submitSubtaskComment}
          onStartEditSubtaskComment={startEditSubtaskComment}
          onRemoveSubtaskComment={removeSubtaskComment}
          onCancelEditSubtaskComment={cancelEditSubtaskComment}
          editingTemplateSubtaskId={editingTemplateSubtaskId}
          setEditingTemplateSubtaskId={setEditingTemplateSubtaskId}
          templateSubtaskDraft={templateSubtaskDraft}
          setTemplateSubtaskDraft={setTemplateSubtaskDraft}
          onScheduleOpenSubtaskDetail={scheduleOpenSubtaskDetail}
          onStartTemplateSubtaskRename={startTemplateSubtaskRename}
          onSaveTemplateSubtaskRename={saveTemplateSubtaskRename}
          isSubtaskModalOpen={isSubtaskModalOpen}
          setIsSubtaskModalOpen={setIsSubtaskModalOpen}
          subtaskRows={subtaskRows}
          setSubtaskRows={setSubtaskRows}
          onAddSubtaskRows={addSubtaskRows}
          isChecklistModalOpen={isChecklistModalOpen}
          setIsChecklistModalOpen={setIsChecklistModalOpen}
          checklistRows={checklistRows}
          setChecklistRows={setChecklistRows}
          onOpenChecklistModal={openChecklistModal}
          onOpenSubtaskChecklistModal={openSubtaskChecklistModal}
          onAddChecklistRows={addChecklistRows}
          onSetSubtaskAgent={setTemplateSubtaskAgent}
          onToggleSubtaskChecklistItem={toggleTemplateSubtaskChecklistItem}
          onRemoveSubtaskChecklistItem={removeTemplateSubtaskChecklistItem}
          customFieldOptions={customFieldOptions}
          customFieldError={customFieldError}
          selectedCustomField={selectedCustomField}
          setSelectedCustomField={setSelectedCustomField}
          customFieldDraft={customFieldDraft}
          setCustomFieldDraft={setCustomFieldDraft}
          isCustomFieldModalOpen={isCustomFieldModalOpen}
          setIsCustomFieldModalOpen={setIsCustomFieldModalOpen}
          isCreateCustomFieldOpen={isCreateCustomFieldOpen}
          setIsCreateCustomFieldOpen={setIsCreateCustomFieldOpen}
          customFieldRows={customFieldRows}
          setCustomFieldRows={setCustomFieldRows}
          quickFieldName={quickFieldName}
          setQuickFieldName={setQuickFieldName}
          quickFieldType={quickFieldType}
          setQuickFieldType={setQuickFieldType}
          onOpenCustomFieldModal={openCustomFieldModal}
          onAddCustomFieldRows={addCustomFieldRows}
          onAddCustomFieldValue={addCustomFieldValue}
          onCreateCustomFieldFromModal={createCustomFieldFromModal}
          onRemoveCustomFieldValue={removeCustomFieldValue}
          inputFormatOptions={inputFormatOptions}
          outputFormatOptions={outputFormatOptions}
          isOutputFormatModalOpen={isOutputFormatModalOpen}
          setIsOutputFormatModalOpen={setIsOutputFormatModalOpen}
          isCreateOutputFormatOpen={isCreateOutputFormatOpen}
          setIsCreateOutputFormatOpen={setIsCreateOutputFormatOpen}
          outputFormatDraftOption={outputFormatDraftOption}
          setOutputFormatDraftOption={setOutputFormatDraftOption}
          dataFormatRoleDraft={dataFormatRoleDraft}
          onSaveOutputFormatFromModal={saveOutputFormatFromModal}
          quickOutputFormatName={quickOutputFormatName}
          setQuickOutputFormatName={setQuickOutputFormatName}
          quickOutputFormatDescription={quickOutputFormatDescription}
          setQuickOutputFormatDescription={setQuickOutputFormatDescription}
          onCreateOutputFormatFromModal={createOutputFormatFromModal}
          gateways={gateways}
          templateGatewayId={templateGatewayId}
          templateGatewayModel={templateGatewayModel}
          selectedTemplateGateway={selectedTemplateGateway}
          templateGatewayOptions={templateGatewayOptions}
          selectedTemplateGatewayOption={selectedTemplateGatewayOption}
          templateModelOptions={templateModelOptions}
          selectedTemplateModelOption={selectedTemplateModelOption}
          gatewayModelOptions={gatewayModelOptions}
          gatewayModelLoading={gatewayModelLoading}
          gatewayModelError={gatewayModelError}
          createLocalId={createLocalId}
        />
      ) : null}

      <CreateTaskPopup
        open={isApplyTemplateOpen && Boolean(applyTemplate)}
        project={projects.find((item) => item.id === applyProjectId) ?? null}
        projects={projects}
        selectedProjectId={applyProjectId}
        tags={tags}
        agents={agents}
        templates={applyTemplate ? [applyTemplate] : []}
        statusColumns={applyStatusColumns}
        defaultStatus={applyStatusColumns[0]?.status ?? PROJECT_STATUS_COLUMNS[0].status}
        initialTitle={applyTemplate?.template.title ?? applyTemplate?.name ?? ''}
        initialTemplateId={applyTemplate?.id ?? null}
        busy={isApplyTemplateLoading}
        error={applyTemplateError}
        onClose={() => {
          setIsApplyTemplateOpen(false)
          setApplyTemplate(null)
          setApplyProjectId('')
          setApplyStatusColumns(PROJECT_STATUS_COLUMNS)
          setApplyTemplateError(null)
        }}
        onProjectChange={setApplyProjectId}
        onCreate={(input) => void handleApplyTemplate(input)}
      />

      <TaskJsonImportPopup
        open={isJsonImportOpen}
        title={jsonImportTarget === 'create' ? 'Import task template JSON' : 'Import template JSON'}
        busy={isJsonImporting || loading}
        onClose={() => setIsJsonImportOpen(false)}
        onImport={(jsonText) => void importTemplateJson(jsonText)}
      />

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
