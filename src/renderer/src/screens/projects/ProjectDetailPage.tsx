import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  LuCheck,
  LuBot,
  LuChevronDown,
  LuCircleStop,
  LuColumns3,
  LuFlag,
  LuListChecks,
  LuListTodo,
  LuMessageSquare,
  LuPaperclip,
  LuPencil,
  LuPlay,
  LuPlus,
  LuCloudUpload,
  LuSettings2,
  LuSignal,
  LuSlidersHorizontal,
  LuSend,
  LuSparkles,
  LuTrash2,
  LuX
} from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { formatUsageSummary } from '@shared/utils/codex-events'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { Agent, Gateway, OutputFormat, Project, ProjectGroup, ProjectStatus, ProjectStatusCategory, Skill, StatusTemplate, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskEntity, TaskJsonImportResult, TaskSubtask, TaskTemplate, Workspace, CustomField } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { MarkdownDescriptionEditor, prefixDataFormatTokens, type DescriptionDataFormat } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { AttachmentTable, storedAttachmentRows } from '@renderer/components/attachments/AttachmentTable'
import { AttachmentRow, attachmentRowsFromDescription, removeAttachmentFromMarkdown, uploadTaskAttachment } from '@renderer/components/attachments/attachments'
import { Card, Form, Stack } from 'react-bootstrap'
import { ProjectDetailHeader } from './detail/ProjectDetailHeader'
import { ProjectBoardView } from './detail/ProjectBoardView'
import { ProjectListView } from './detail/ProjectListView'
import { ProjectTableView } from './detail/ProjectTableView'
import { CreateTaskModal } from './detail/CreateTaskModal'
import { createTaskWithTemplate, type CreateTaskInput } from './detail/createTaskWithTemplate'
import { AddSubtaskModal } from './detail/AddSubtaskModal'
import { TaskJsonImportModal } from './detail/TaskJsonImportModal'
import { AgentAssignmentPanel, SkillsAssignmentPanel } from './detail/AssignmentPanels'
import { TaskDetailModal } from './detail/TaskDetailModal'
import { TaskDetailContent } from './detail/TaskDetailContent'
import { buildAgentMarkdown, buildProjectWorkspaceExportTaskPayload, buildSkillsMarkdown, buildTaskMarkdown, buildTaskZipArchive, downloadMarkdownFile, downloadTaskZip } from './detail/taskExport'
import { PROJECT_STATUS_COLUMNS, columnsFromProjectStatuses, resolveProjectStatusColumn } from './detail/status'
import { ChatOperationFeedback } from './detail/chat/ChatOperationFeedback'
import { CodexChatMessageItem } from './detail/chat/CodexChatMessageItem'
import {
  CHAT_COMPOSER_MAX_HEIGHT,
  CHAT_COMPOSER_MIN_HEIGHT,
  CHAT_INITIAL_MESSAGE_LIMIT,
  CHAT_MESSAGE_LOAD_STEP,
  activityMessagesFromTask,
  asCodexThread,
  asCommentThread,
  formatChatTime,
  parseHistoryPatch,
  usageFromMetadata
} from './detail/chat/chatUtils'
import {
  DEFAULT_TABLE_COLUMNS,
  codexConfigOf,
  codexPayloadOverride,
  createLocalId,
  customFieldValueLabel,
  customFieldValueToDraft,
  getLegacyTableOrder,
  getStatusOrder,
  getTableViewConfig,
  getTaskNewestTime,
  normalizeTableColumns,
  projectCodexSettings,
  projectWorkspaceFolder,
  statusOrderPayload,
  taskCodexGatewayId,
  taskCodexModel,
  withTaskMeta
} from './detail/projectDetailUtils'
import {
  getSubtaskAgentId,
  getSubtaskAttachments,
  getSubtaskComments,
  getSubtaskCustomFieldValues,
  getSubtaskDescription,
  getSubtaskInputFormatId,
  getSubtaskOutputFormatId,
  getSubtaskPayload,
  getSubtaskSkillIds,
  getSubtaskTagIds,
  getTaskAttachments,
  getTaskInputFormatId,
  getTaskOutputFormatId
} from './detail/subtaskUtils'
import type {
  ChatAttachmentDraft,
  ChatComposerMode,
  ChatConversationSummary,
  ChatOperationFeedbackData,
  CodexModelsResponse,
  CodexRunFeedback,
  CustomFieldDraftRow,
  DataFormatRole,
  DetailTab,
  DetailViewMode,
  ProjectPromptTab,
  ProjectSettingsTab,
  ProjectViewMode,
  SlashCommand,
  TableColumnConfig,
  TaskHistoryItem,
  TextDraftRow,
  ThreadEntry
} from './detail/types'
import styles from './ProjectDetailPage.module.scss'

const DETAIL_RATIO_KEY = 'omc:task-modal:detail-ratio'
const DEFAULT_DETAIL_RATIO = 0.7
const MIN_DETAIL_WIDTH = 420
const MIN_COMMENTS_WIDTH = 320

function resizeTitleTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

function resizeChatComposerTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = 'auto'
  const nextHeight = Math.min(CHAT_COMPOSER_MAX_HEIGHT, Math.max(CHAT_COMPOSER_MIN_HEIGHT, element.scrollHeight))
  element.style.height = `${nextHeight}px`
  element.scrollTop = element.scrollHeight
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
  const location = useLocation()
  const navigate = useNavigate()
  const projectId = params.projectId
  const { token, user } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([])
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>([])
  const [statusTemplates, setStatusTemplates] = useState<StatusTemplate[]>([])
  const [viewMode, setViewMode] = useState<ProjectViewMode>('board')
  const [taskTitle, setTaskTitle] = useState('')
  const [listCreateStatus, setListCreateStatus] = useState<TaskEntity['status'] | null>(null)
  const [listCreateTitle, setListCreateTitle] = useState('')
  const [tableCreateActive, setTableCreateActive] = useState(false)
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false)
  const [isStatusEditorOpen, setIsStatusEditorOpen] = useState(false)
  const [projectSettingsTab, setProjectSettingsTab] = useState<ProjectSettingsTab>('statuses')
  const [isWorkspacePickerOpen, setIsWorkspacePickerOpen] = useState(false)
  const [isProjectGroupPickerOpen, setIsProjectGroupPickerOpen] = useState(false)
  const [projectGroupNameDraft, setProjectGroupNameDraft] = useState('')
  const [projectGroupDescriptionDraft, setProjectGroupDescriptionDraft] = useState('')
  const [projectGroupSaving, setProjectGroupSaving] = useState(false)
  const [projectSyncing, setProjectSyncing] = useState(false)
  const [projectSyncMessage, setProjectSyncMessage] = useState<string | null>(null)
  const [workspaceDraftName, setWorkspaceDraftName] = useState('')
  const [workspaceDraftPath, setWorkspaceDraftPath] = useState('')
  const [movingWorkspace, setMovingWorkspace] = useState(false)
  const [workspaceMoveMessage, setWorkspaceMoveMessage] = useState<string | null>(null)
  const [isStatusTemplatePickerOpen, setIsStatusTemplatePickerOpen] = useState(false)
  const [pendingStatusTemplate, setPendingStatusTemplate] = useState<StatusTemplate | null>(null)
  const [projectFolderPreview, setProjectFolderPreview] = useState('')
  const [isProjectPromptSettingsOpen, setIsProjectPromptSettingsOpen] = useState(false)
  const [projectPromptTab, setProjectPromptTab] = useState<ProjectPromptTab>('context')
  const [projectPromptContext, setProjectPromptContext] = useState('')
  const [projectPromptPrompt, setProjectPromptPrompt] = useState('')
  const [projectPromptOutput, setProjectPromptOutput] = useState('')
  const [projectPromptError, setProjectPromptError] = useState<string | null>(null)
  const [isProjectPromptSaving, setIsProjectPromptSaving] = useState(false)
  const [codexGatewayId, setCodexGatewayId] = useState('')
  const [codexRuntimeWorkspaceId, setCodexRuntimeWorkspaceId] = useState('')
  const [codexDefaultModel, setCodexDefaultModel] = useState('')
  const [codexModelLoading, setCodexModelLoading] = useState(false)
  const [codexModelError, setCodexModelError] = useState<string | null>(null)
  const [codexSaving, setCodexSaving] = useState(false)
  const [codexRunLaunching, setCodexRunLaunching] = useState(false)
  const [codexPlanLaunching, setCodexPlanLaunching] = useState(false)
  const [codexRunFeedback, setCodexRunFeedback] = useState<CodexRunFeedback | null>(null)
  const [chatDraft, setChatDraft] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatStopping, setChatStopping] = useState(false)
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false)
  const [chatGatewayId, setChatGatewayId] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [chatIncludeContext, setChatIncludeContext] = useState(true)
  const [chatComposerMode, setChatComposerMode] = useState<ChatComposerMode>('chat')
  const [chatAttachments, setChatAttachments] = useState<ChatAttachmentDraft[]>([])
  const [selectedChatConversationId, setSelectedChatConversationId] = useState('')
  const [isStartingNewChat, setIsStartingNewChat] = useState(false)
  const [chatDragDepth, setChatDragDepth] = useState(0)
  const [slashCommandIndex, setSlashCommandIndex] = useState(0)
  const [chatComposerFocused, setChatComposerFocused] = useState(false)
  const [chatVisibleLimit, setChatVisibleLimit] = useState(CHAT_INITIAL_MESSAGE_LIMIT)
  const [statusDrafts, setStatusDrafts] = useState<ProjectStatus[]>([])
  const [statusMapping, setStatusMapping] = useState<Record<string, string>>({})
  const [createTaskStatus, setCreateTaskStatus] = useState<TaskEntity['status']>('pending')
  const [createTaskInitialTitle, setCreateTaskInitialTitle] = useState('')
  const [createTaskInitialTemplateId, setCreateTaskInitialTemplateId] = useState<string | null>(null)
  const [collapsedStatuses, setCollapsedStatuses] = useState<TaskEntity['status'][]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(false)
  const [isDescriptionSaving, setIsDescriptionSaving] = useState(false)
  const [isAttachmentUploading, setIsAttachmentUploading] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTab>('subtasks')
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>('task')
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [subtaskDescriptionDraft, setSubtaskDescriptionDraft] = useState('')
  const [isSubtaskDescriptionSaving, setIsSubtaskDescriptionSaving] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [subtaskCommentDraft, setSubtaskCommentDraft] = useState('')
  const [editingSubtaskCommentId, setEditingSubtaskCommentId] = useState<string | null>(null)
  const [isAddSubtaskOpen, setIsAddSubtaskOpen] = useState(false)
  const [isTaskImportOpen, setIsTaskImportOpen] = useState(false)
  const [isTaskImporting, setIsTaskImporting] = useState(false)
  const [subtaskRows, setSubtaskRows] = useState<TextDraftRow[]>([{ id: createLocalId(), title: '' }])
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false)
  const [checklistRows, setChecklistRows] = useState<TextDraftRow[]>([{ id: createLocalId(), title: '' }])
  const [checklistDraft, setChecklistDraft] = useState('')
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null)
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [selectedCustomFieldOption, setSelectedCustomFieldOption] = useState<AppSelectOption | null>(null)
  const [editingCustomFieldId, setEditingCustomFieldId] = useState<string | null>(null)
  const [customFieldDraft, setCustomFieldDraft] = useState('')
  const [customFieldError, setCustomFieldError] = useState<string | null>(null)
  const [isCustomFieldModalOpen, setIsCustomFieldModalOpen] = useState(false)
  const [isCreateCustomFieldOpen, setIsCreateCustomFieldOpen] = useState(false)
  const [customFieldRows, setCustomFieldRows] = useState<CustomFieldDraftRow[]>([{ id: createLocalId(), field: null, value: '' }])
  const [quickFieldName, setQuickFieldName] = useState('')
  const [quickFieldType, setQuickFieldType] = useState<CustomField['type']>('text')
  const [isOutputFormatModalOpen, setIsOutputFormatModalOpen] = useState(false)
  const [isCreateOutputFormatOpen, setIsCreateOutputFormatOpen] = useState(false)
  const [outputFormatDraftOption, setOutputFormatDraftOption] = useState<AppSelectOption | null>(null)
  const [dataFormatRoleDraft, setDataFormatRoleDraft] = useState<DataFormatRole>('output')
  const [dataFormatTarget, setDataFormatTarget] = useState<{ role: DataFormatRole; scope: DetailViewMode } | null>(null)
  const [quickOutputFormatName, setQuickOutputFormatName] = useState('')
  const [quickOutputFormatDescription, setQuickOutputFormatDescription] = useState('')
  const [pendingDeleteSubtaskId, setPendingDeleteSubtaskId] = useState<string | null>(null)
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<string[]>([])
  const [subtaskStatusMenu, setSubtaskStatusMenu] = useState<{ subtaskId: string; left: number; top: number } | null>(null)
  const [history, setHistory] = useState<TaskHistoryItem[]>([])
  const [localActivityEntries, setLocalActivityEntries] = useState<ThreadEntry[]>([])
  const [detailRatio, setDetailRatio] = useState(loadInitialRatio)
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const [isTableColumnPickerOpen, setIsTableColumnPickerOpen] = useState(false)

  const modalBodyRef = useRef<HTMLDivElement | null>(null)
  const activityFeedRef = useRef<HTMLDivElement | null>(null)
  const chatFileInputRef = useRef<HTMLInputElement | null>(null)
  const chatDraftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const subtaskStatusMenuRef = useRef<HTMLDivElement | null>(null)
  const subtaskClickTimerRef = useRef<number | null>(null)
  const keepActivityBottomRef = useRef(true)
  const lastCodexModelRefreshRef = useRef<string | null>(null)

  const projectLoadError = projectId ? null : 'Project id not found.'

  const refresh = async () => {
    if (!projectId) return
    const [projectResponse, taskResponse, tagsResponse, skillsResponse, customFieldsResponse, agentsResponse, gatewaysResponse, outputFormatsResponse, taskTemplatesResponse, statusesResponse, workspacesResponse, statusTemplatesResponse, projectGroupsResponse] = await Promise.all([
      invokeBridge<Project>(IPC_CHANNELS.projects.get, { actorToken: token, id: projectId }),
      invokeBridge<TaskEntity[]>(IPC_CHANNELS.tasks.list, { actorToken: token, projectId }),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token),
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId }),
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token),
      invokeBridge<StatusTemplate[]>(IPC_CHANNELS.statuses.listTemplates, { actorToken: token }),
      loadList<ProjectGroup[]>(IPC_CHANNELS.projectGroups.list, token)
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
    setGateways(Array.isArray(gatewaysResponse.data) ? gatewaysResponse.data : [])
    setOutputFormats(Array.isArray(outputFormatsResponse.data) ? outputFormatsResponse.data : [])
    setTaskTemplates(Array.isArray(taskTemplatesResponse.data) ? taskTemplatesResponse.data : [])
    setProjectStatuses(Array.isArray(statusesResponse.data) ? statusesResponse.data : [])
    setWorkspaces(Array.isArray(workspacesResponse.data) ? workspacesResponse.data : [])
    setStatusTemplates(Array.isArray(statusTemplatesResponse.data) ? statusTemplatesResponse.data : [])
    if (projectGroupsResponse.ok) setProjectGroups(Array.isArray(projectGroupsResponse.data) ? projectGroupsResponse.data : [])
    setError(!taskResponse.ok
      ? taskResponse.error?.message ?? 'Unable to load tasks'
      : !outputFormatsResponse.ok
        ? outputFormatsResponse.error?.message ?? 'Unable to load data formats'
        : !taskTemplatesResponse.ok
          ? taskTemplatesResponse.error?.message ?? 'Unable to load task templates'
          : null)
  }

  useEffect(() => {
    void refresh()
  }, [projectId, token])

  useEffect(() => {
    const onTaskUpdated = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as { projectId?: string; taskId?: string; action?: string } | undefined
      if (!payload?.projectId || payload.projectId !== projectId) return
      void refresh()
      if (payload.action === 'created' && payload.taskId) setSelectedTaskId(payload.taskId)
    }
    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)
  }, [projectId, token])

  useEffect(() => {
    const codex = projectCodexSettings(project)
    setCodexGatewayId(codex.gatewayId ?? '')
    setCodexRuntimeWorkspaceId(codex.runtimeWorkspaceId ?? '')
    setCodexDefaultModel(codex.defaultModel ?? '')
  }, [project?.id, project?.metrics])

  const chooseProjectWorkspaceFolder = async () => {
    const pickResponse = await invokeBridge<{ rootPath: string } | null>(IPC_CHANNELS.workspaces.pickFolder, { actorToken: token })
    if (!pickResponse.ok) {
      setError(pickResponse.error?.message ?? 'Unable to select workspace folder')
      return
    }
    const rootPath = pickResponse.data?.rootPath
    if (rootPath) setWorkspaceDraftPath(rootPath)
  }

  const createWorkspaceFromDraft = async (): Promise<Workspace | null> => {
    if (!workspaceDraftName.trim() || !workspaceDraftPath.trim()) return null
    const createResponse = await invokeBridge<Workspace>(IPC_CHANNELS.workspaces.create, {
      actorToken: token,
      name: workspaceDraftName.trim(),
      rootPath: workspaceDraftPath.trim()
    })
    if (!createResponse.ok || !createResponse.data) {
      setError(createResponse.error?.message ?? 'Unable to create workspace')
      return null
    }
    setWorkspaces((current) => [createResponse.data!, ...current.filter((item) => item.id !== createResponse.data!.id)])
    setWorkspaceDraftName('')
    setWorkspaceDraftPath('')
    return createResponse.data
  }

  const selectedWorkspace = useMemo(() => {
    if (!project?.workspaceId) return null
    return workspaces.find((workspace) => workspace.id === project.workspaceId) ?? null
  }, [project?.workspaceId, workspaces])

  const savedCodexSettings = useMemo(() => projectCodexSettings(project), [project])
  const selectedCodexGateway = useMemo(() => gateways.find((gateway) => gateway.id === (codexGatewayId || savedCodexSettings.gatewayId)) ?? null, [codexGatewayId, gateways, savedCodexSettings.gatewayId])
  const selectedCodexConfig = useMemo(() => codexConfigOf(selectedCodexGateway), [selectedCodexGateway])
  const codexModelOptions = selectedCodexConfig.models ?? []
  const codexGatewayOptions = useMemo<AppSelectOption[]>(() => gateways.map((gateway) => ({ label: gateway.name, value: gateway.id })), [gateways])
  const workspaceOptions = useMemo<AppSelectOption[]>(() => workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id })), [workspaces])
  const projectCodexModelOptions = useMemo<AppSelectOption[]>(() => codexModelOptions.map((model) => ({ label: model.label || model.id, value: model.id })), [codexModelOptions])
  const selectedCodexGatewayOption = codexGatewayOptions.find((option) => option.value === codexGatewayId) ?? null
  const selectedRuntimeWorkspaceOption = workspaceOptions.find((option) => option.value === codexRuntimeWorkspaceId) ?? null
  const selectedDefaultModelOption = projectCodexModelOptions.find((option) => option.value === codexDefaultModel) ?? null
  const chatGateway = useMemo(() => gateways.find((gateway) => gateway.id === chatGatewayId) ?? null, [chatGatewayId, gateways])
  const chatGatewayConfig = useMemo(() => codexConfigOf(chatGateway), [chatGateway])
  const chatModelOptions = useMemo<AppSelectOption[]>(() => (chatGatewayConfig.models ?? []).map((model) => ({ label: model.label || model.id, value: model.id })), [chatGatewayConfig.models])
  const chatGatewayOption = codexGatewayOptions.find((option) => option.value === chatGatewayId) ?? null
  const chatModelOption = chatModelOptions.find((option) => option.value === chatModel) ?? null
  const chatRuntimeWorkspace = useMemo(() => workspaces.find((workspace) => workspace.id === savedCodexSettings.runtimeWorkspaceId) ?? null, [savedCodexSettings.runtimeWorkspaceId, workspaces])

  useEffect(() => {
    let cancelled = false
    void projectWorkspaceFolder(selectedWorkspace, project).then((value) => {
      if (!cancelled) setProjectFolderPreview(value)
    })
    return () => {
      cancelled = true
    }
  }, [project, selectedWorkspace])

  const updateProjectWorkspace = async (workspaceId: string | null) => {
    if (!project) return
    setMovingWorkspace(true)
    setWorkspaceMoveMessage('Moving project files...')
    const response = await invokeBridge<{ project: Project; movedFiles: number; projectFolderPath?: string }>(IPC_CHANNELS.projects.moveWorkspace, {
      actorToken: token,
      projectId: project.id,
      workspaceId
    })
    setMovingWorkspace(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to update project workspace')
      setWorkspaceMoveMessage(null)
      return
    }
    setProject(response.data.project)
    setWorkspaceMoveMessage(`Workspace updated. ${response.data.movedFiles} file(s) moved.`)
    await refresh()
  }

  const createAndAssignWorkspace = async () => {
    const workspace = await createWorkspaceFromDraft()
    if (workspace) await updateProjectWorkspace(workspace.id)
  }

  const saveProjectCodexSettings = async () => {
    if (!project) return
    setCodexSaving(true)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      codex: {
        gatewayId: codexGatewayId || null,
        runtimeWorkspaceId: codexRuntimeWorkspaceId || null,
        defaultModel: codexDefaultModel || null
      }
    })
    setCodexSaving(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to save Codex settings')
      return
    }
    setProject(response.data)
    setError(null)
  }

  const refreshCodexGatewayModels = async (gatewayId: string) => {
    if (!gatewayId) return
    setCodexModelLoading(true)
    setCodexModelError(null)
    const response = await invokeBridge<CodexModelsResponse>(IPC_CHANNELS.gateways.codexModels, {
      actorToken: token,
      gatewayId
    })
    setCodexModelLoading(false)
    if (!response.ok || !response.data) {
      setCodexModelError(response.error?.message ?? 'Unable to load Codex models')
      return
    }
    setGateways((current) => current.map((gateway) => gateway.id === response.data!.gateway.id ? response.data!.gateway : gateway))
    if (response.data.error) setCodexModelError(response.data.error)
    const modelIds = new Set(response.data.models.map((model) => model.id))
    if (gatewayId === codexGatewayId && codexDefaultModel && !modelIds.has(codexDefaultModel)) setCodexDefaultModel('')
    lastCodexModelRefreshRef.current = gatewayId
  }

  useEffect(() => {
    if (projectSettingsTab !== 'codex' || !codexGatewayId) return
    const shouldRefresh = lastCodexModelRefreshRef.current !== codexGatewayId || codexModelOptions.length === 0
    if (shouldRefresh && !codexModelLoading) void refreshCodexGatewayModels(codexGatewayId)
  }, [projectSettingsTab, codexGatewayId, codexModelOptions.length])

  const updateProjectGroupMembership = async (nextGroupId: string | null) => {
    if (!project) return
    const currentGroup = projectGroups.find((group) => Array.isArray(group.projectIds) && group.projectIds.includes(project.id)) ?? null
    if ((currentGroup?.id ?? null) === nextGroupId) {
      setIsProjectGroupPickerOpen(false)
      return
    }

    setProjectGroupSaving(true)
    setError(null)
    if (currentGroup) {
      const removeResponse = await invokeBridge<ProjectGroup>(IPC_CHANNELS.projectGroups.update, {
        actorToken: token,
        id: currentGroup.id,
        name: currentGroup.name,
        description: currentGroup.description ?? '',
        projectIds: (currentGroup.projectIds ?? []).filter((id) => id !== project.id)
      })
      if (!removeResponse.ok) {
        setProjectGroupSaving(false)
        setError(removeResponse.error?.message ?? 'Unable to update current project group')
        return
      }
    }

    if (nextGroupId) {
      const nextGroup = projectGroups.find((group) => group.id === nextGroupId)
      if (nextGroup) {
        const addResponse = await invokeBridge<ProjectGroup>(IPC_CHANNELS.projectGroups.update, {
          actorToken: token,
          id: nextGroup.id,
          name: nextGroup.name,
          description: nextGroup.description ?? '',
          projectIds: Array.from(new Set([...(nextGroup.projectIds ?? []), project.id]))
        })
        if (!addResponse.ok) {
          setProjectGroupSaving(false)
          setError(addResponse.error?.message ?? 'Unable to assign project group')
          return
        }
      }
    }

    setProjectGroupSaving(false)
    setIsProjectGroupPickerOpen(false)
    await refresh()
  }

  const saveSelectedProjectGroup = async () => {
    if (!projectGroupForExport || !projectGroupNameDraft.trim()) return
    setProjectGroupSaving(true)
    setError(null)
    const response = await invokeBridge<ProjectGroup>(IPC_CHANNELS.projectGroups.update, {
      actorToken: token,
      id: projectGroupForExport.id,
      name: projectGroupNameDraft.trim(),
      description: projectGroupDescriptionDraft.trim(),
      projectIds: projectGroupForExport.projectIds ?? []
    })
    setProjectGroupSaving(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to save project group')
      return
    }
    setProjectGroups((current) => current.map((group) => group.id === response.data!.id ? response.data! : group))
  }

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
    if (!selectedTask) return
    setChatGatewayId(taskCodexGatewayId(selectedTask) || savedCodexSettings.gatewayId || '')
    setChatModel(taskCodexModel(selectedTask) || savedCodexSettings.defaultModel || '')
    setSelectedChatConversationId('all')
  }, [selectedTask?.id, savedCodexSettings.gatewayId, savedCodexSettings.defaultModel])
  useEffect(() => {
    setCodexRunFeedback(null)
  }, [selectedTaskId])
  const selectedTaskGatewayId = taskCodexGatewayId(selectedTask)
  const effectiveTaskGatewayId = selectedTaskGatewayId || savedCodexSettings.gatewayId || ''
  const effectiveTaskGateway = gateways.find((gateway) => gateway.id === effectiveTaskGatewayId) ?? null
  const taskModelOptions = useMemo<AppSelectOption[]>(() => (codexConfigOf(effectiveTaskGateway).models ?? []).map((model) => ({ label: model.label || model.id, value: model.id })), [effectiveTaskGateway])
  const selectedTaskGatewayOption = selectedTaskGatewayId ? codexGatewayOptions.find((option) => option.value === selectedTaskGatewayId) ?? null : null
  const selectedTaskModelOption = taskModelOptions.find((option) => option.value === taskCodexModel(selectedTask)) ?? null
  useEffect(() => {
    if (detailTab !== 'model' || !effectiveTaskGatewayId) return
    const shouldRefresh = lastCodexModelRefreshRef.current !== effectiveTaskGatewayId || taskModelOptions.length === 0
    if (shouldRefresh && !codexModelLoading) void refreshCodexGatewayModels(effectiveTaskGatewayId)
  }, [detailTab, effectiveTaskGatewayId, taskModelOptions.length, codexModelLoading])

  useEffect(() => {
    const nextDescription = prefixDataFormatTokens(
      selectedTask?.description ?? '',
      getTaskInputFormatId(selectedTask),
      getTaskOutputFormatId(selectedTask),
      outputFormats
    )
    setTitleDraft(selectedTask?.title ?? '')
    setDescriptionDraft(nextDescription)
    setCommentDraft('')
    setEditingCommentId(null)
    setSubtaskCommentDraft('')
    setEditingSubtaskCommentId(null)
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
    setIsActivityModalOpen(false)
    setLocalActivityEntries([])
    keepActivityBottomRef.current = true
    if (selectedTask && nextDescription !== (selectedTask.description ?? '')) {
      void invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
        actorToken: token,
        id: selectedTask.id,
        description: nextDescription,
        payload: {
          ...(selectedTask.payload ?? {}),
          inputFormatId: '',
          outputFormatId: ''
        }
      }).then(() => refresh())
    }
  }, [selectedTask?.id])

  const selectedSubtask = useMemo(
    () => selectedTask?.subtasks?.find((item) => item.id === selectedSubtaskId) ?? null,
    [selectedTask, selectedSubtaskId]
  )

  useEffect(() => {
    if (!selectedSubtask) {
      setSubtaskDescriptionDraft('')
      setSubtaskCommentDraft('')
      setEditingSubtaskCommentId(null)
      return
    }
    const nextDescription = prefixDataFormatTokens(
      getSubtaskDescription(selectedSubtask),
      getSubtaskInputFormatId(selectedSubtask),
      getSubtaskOutputFormatId(selectedSubtask),
      outputFormats
    )
    setSubtaskCommentDraft('')
    setEditingSubtaskCommentId(null)
    setSubtaskDescriptionDraft(nextDescription)
    if (nextDescription !== getSubtaskDescription(selectedSubtask)) {
      void invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
        actorToken: token,
        id: selectedSubtask.id,
        payload: {
          ...getSubtaskPayload(selectedSubtask),
          description: nextDescription,
          inputFormatId: '',
          outputFormatId: ''
        }
      }).then(() => refresh())
    }
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
  }, [visibleTasks])

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
    const grouped = statusColumns.reduce<Record<TaskEntity['status'], TaskEntity[]>>((acc, column) => {
      acc[column.status] = []
      return acc
    }, {})
    const fallback = defaultStatus
    for (const task of visibleTasks) {
      const target = grouped[task.status] ? task.status : fallback
      grouped[target] = [...(grouped[target] ?? []), task]
    }
    Object.keys(grouped).forEach((status) => {
      grouped[status] = orderedTasksForStatus(grouped[status] ?? [])
    })
    return grouped
  }, [defaultStatus, statusColumns, visibleTasks])

  const tableColumns = useMemo(() => normalizeTableColumns(project, customFields), [customFields, project])
  const availableTableColumns = useMemo<TableColumnConfig[]>(() => {
    const customColumns = customFields
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((field) => ({
        id: `custom:${field.id}`,
        kind: 'custom' as const,
        label: field.name,
        width: 190,
        customFieldId: field.id
      }))
    return [...DEFAULT_TABLE_COLUMNS, ...customColumns]
  }, [customFields])
  const projectGroupForExport = useMemo(
    () => projectGroups.find((group) => project?.id && Array.isArray(group.projectIds) && group.projectIds.includes(project.id)) ?? null,
    [project?.id, projectGroups]
  )

  useEffect(() => {
    setProjectGroupNameDraft(projectGroupForExport?.name ?? '')
    setProjectGroupDescriptionDraft(projectGroupForExport?.description ?? '')
  }, [projectGroupForExport])

  const projectAgentRows = useMemo(() => {
    const rows = new Map<string, { agent: Agent; count: number }>()
    const addAgent = (agentId?: string | null) => {
      if (!agentId) return
      const agent = agents.find((item) => item.id === agentId)
      if (!agent) return
      const current = rows.get(agent.id)
      rows.set(agent.id, { agent, count: (current?.count ?? 0) + 1 })
    }
    for (const task of visibleTasks) {
      addAgent(task.agentId)
      for (const subtask of task.subtasks ?? []) {
        addAgent(getSubtaskAgentId(subtask))
      }
    }
    return Array.from(rows.values()).sort((a, b) => a.agent.name.localeCompare(b.agent.name, 'tr'))
  }, [agents, visibleTasks])

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

  const inputFormatOptions: AppSelectOption[] = useMemo(() => {
    return [...outputFormats]
      .filter((format) => format.formatRole === 'input')
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((format) => ({ value: format.id, label: format.name }))
  }, [outputFormats])

  const outputFormatOptions: AppSelectOption[] = useMemo(() => {
    return [...outputFormats]
      .filter((format) => format.formatRole !== 'input')
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((format) => ({ value: format.id, label: format.name }))
  }, [outputFormats])

  const outputFormatById = useMemo(() => new Map(outputFormats.map((format) => [format.id, format])), [outputFormats])

  const selectedTaskAgent = useMemo(() => {
    if (!selectedTask?.agentId) return null
    return agents.find((item) => item.id === selectedTask.agentId) ?? null
  }, [agents, selectedTask])

  const selectedTaskOutputFormatOption: AppSelectOption | null = useMemo(() => {
    const outputFormatId = getTaskOutputFormatId(selectedTask)
    if (!outputFormatId) return null
    const format = outputFormatById.get(outputFormatId)
    return format ? { value: format.id, label: format.name } : null
  }, [outputFormatById, selectedTask])

  const selectedTaskInputFormatOption: AppSelectOption | null = useMemo(() => {
    const inputFormatId = getTaskInputFormatId(selectedTask)
    if (!inputFormatId) return null
    const format = outputFormatById.get(inputFormatId)
    return format ? { value: format.id, label: format.name } : null
  }, [outputFormatById, selectedTask])

  const selectedSubtaskAgent = useMemo(() => {
    const agentId = getSubtaskAgentId(selectedSubtask)
    if (!agentId) return null
    return agents.find((item) => item.id === agentId) ?? null
  }, [agents, selectedSubtask])

  const selectedSubtaskSkills = useMemo(() => {
    const skillIds = new Set(getSubtaskSkillIds(selectedSubtask))
    return skills
      .filter((skill) => skillIds.has(skill.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [selectedSubtask, skills])

  const selectedSubtaskSkillOptions: AppSelectOption[] = useMemo(() => {
    const skillIds = new Set(getSubtaskSkillIds(selectedSubtask))
    return skills
      .filter((skill) => skillIds.has(skill.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((skill) => ({ value: skill.id, label: skill.name }))
  }, [selectedSubtask, skills])

  const selectedSubtaskTagOptions: AppSelectOption[] = useMemo(() => {
    const tagIds = new Set(getSubtaskTagIds(selectedSubtask))
    return tags
      .filter((tag) => tagIds.has(tag.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((tag) => ({ value: tag.id, label: tag.name, color: tag.color }))
  }, [selectedSubtask, tags])

  const selectedSubtaskOutputFormatOption: AppSelectOption | null = useMemo(() => {
    const outputFormatId = getSubtaskOutputFormatId(selectedSubtask)
    if (!outputFormatId) return null
    const format = outputFormatById.get(outputFormatId)
    return format ? { value: format.id, label: format.name } : null
  }, [outputFormatById, selectedSubtask])

  const selectedSubtaskInputFormatOption: AppSelectOption | null = useMemo(() => {
    const inputFormatId = getSubtaskInputFormatId(selectedSubtask)
    if (!inputFormatId) return null
    const format = outputFormatById.get(inputFormatId)
    return format ? { value: format.id, label: format.name } : null
  }, [outputFormatById, selectedSubtask])

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

  const taskAttachmentRows = useMemo<AttachmentRow[]>(() => {
    if (!selectedTask) return []
    const taskOwner = { ownerType: 'task' as const, ownerId: selectedTask.id, ownerTitle: selectedTask.title }
    return [
      ...storedAttachmentRows(getTaskAttachments(selectedTask), 'Task attachments', taskOwner),
      ...attachmentRowsFromDescription(descriptionDraft, 'Task description', taskOwner),
      ...(selectedTask.subtasks ?? []).flatMap((subtask) => {
        const owner = { ownerType: 'subtask' as const, ownerId: subtask.id, ownerTitle: subtask.title }
        return [
          ...storedAttachmentRows(getSubtaskAttachments(subtask), `Subtask: ${subtask.title}`, owner),
          ...attachmentRowsFromDescription(getSubtaskDescription(subtask), `Subtask description: ${subtask.title}`, owner)
        ]
      })
    ]
  }, [descriptionDraft, selectedTask])

  const subtaskAttachmentRows = useMemo<AttachmentRow[]>(() => {
    if (!selectedSubtask) return []
    return [
      ...storedAttachmentRows(getSubtaskAttachments(selectedSubtask)),
      ...attachmentRowsFromDescription(subtaskDescriptionDraft, 'Subtask description')
    ]
  }, [selectedSubtask, subtaskDescriptionDraft])

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

  const chatActivityMessages = useMemo(() => selectedTask ? activityMessagesFromTask(selectedTask) : [], [selectedTask])
  const chatConversations = useMemo(() => {
    const grouped = new Map<string, ChatConversationSummary>()
    for (const message of chatActivityMessages) {
      const id = message.conversationId || message.runId
      const current = grouped.get(id)
      const nextStatus = message.status ?? 'event'
      const nextAt = message.updatedAt ?? message.createdAt
      const isLatest = !current || nextAt >= current.at
      grouped.set(id, {
        id,
        title: message.source === 'codex-plan' ? 'Plan' : message.source === 'codex-run' ? 'Run' : 'Follow-up',
        count: (current?.count ?? 0) + 1,
        status: isLatest ? nextStatus : current?.status ?? nextStatus,
        at: Math.max(current?.at ?? 0, nextAt),
        source: message.source,
        model: typeof message.metadata?.model === 'string' ? message.metadata.model : current?.model
      })
    }
    return Array.from(grouped.values()).sort((a, b) => b.at - a.at)
  }, [chatActivityMessages])
  const runningChatConversationIds = useMemo(() => {
    const ids = new Set<string>()
    for (const conversation of chatConversations) {
      if (conversation.status === 'running' || conversation.status === 'in_progress') ids.add(conversation.id)
    }
    return ids
  }, [chatConversations])
  useEffect(() => {
    if (chatConversations.length === 0) {
      if (selectedChatConversationId) setSelectedChatConversationId('')
      return
    }
    if (isStartingNewChat) return
    if (!chatConversations.some((conversation) => conversation.id === selectedChatConversationId)) {
      setSelectedChatConversationId(chatConversations[0].id)
    }
  }, [chatConversations, isStartingNewChat, selectedChatConversationId])
  const sidebarChatConversations = useMemo(() => {
    if (chatConversations.length <= 30) return chatConversations
    const selected = chatConversations.find((conversation) => conversation.id === selectedChatConversationId)
    const selectedInRecent = chatConversations.slice(0, 30).some((conversation) => conversation.id === selectedChatConversationId)
    return selected && !selectedInRecent
      ? [selected, ...chatConversations.slice(0, 29)]
      : chatConversations.slice(0, 30)
  }, [chatConversations, selectedChatConversationId])
  const visibleChatMessages = useMemo(() => {
    if (isStartingNewChat) return []
    if (!selectedChatConversationId) return []
    const messages = chatActivityMessages.filter((message) => (message.conversationId || message.runId) === selectedChatConversationId)
    const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt)
    const settledRuns = new Set<string>()
    for (const message of sorted) {
      if (message.role !== 'user' && (message.status === 'completed' || message.status === 'failed')) settledRuns.add(message.runId)
    }
    return sorted.filter((message) => !(message.role === 'thinking' && message.status === 'running' && settledRuns.has(message.runId)))
  }, [chatActivityMessages, isStartingNewChat, selectedChatConversationId])
  const renderedChatMessages = useMemo(() => (
    visibleChatMessages.length > chatVisibleLimit
      ? visibleChatMessages.slice(visibleChatMessages.length - chatVisibleLimit)
      : visibleChatMessages
  ), [chatVisibleLimit, visibleChatMessages])
  const hiddenChatMessageCount = Math.max(0, visibleChatMessages.length - renderedChatMessages.length)
  const chatHistoryCount = (selectedTask?.comments?.length ?? 0) + history.length + localActivityEntries.length
  const isPlanDraft = chatDraft.trim().toLowerCase().startsWith('/plan')
  const effectiveChatMode: 'chat' | 'plan' | 'steer' = isPlanDraft ? 'plan' : chatComposerMode
  const canSendChat = Boolean(chatDraft.trim() || chatAttachments.length > 0)
  const selectedChatSummary = useMemo(() => {
    if (isStartingNewChat) return null
    return chatConversations.find((conversation) => conversation.id === selectedChatConversationId) ?? null
  }, [chatConversations, isStartingNewChat, selectedChatConversationId])
  const selectedChatIsRunning = Boolean(selectedChatSummary && runningChatConversationIds.has(selectedChatSummary.id))
  const selectedChatCanStop = visibleChatMessages.some((message) => (
    message.source === 'codex-chat' &&
    (message.status === 'running' || message.status === 'in_progress')
  ))
  const selectedChatUsage = useMemo(() => {
    for (const message of [...visibleChatMessages].reverse()) {
      const usage = usageFromMetadata(message.metadata)
      if (usage) return usage
    }
    return undefined
  }, [visibleChatMessages])
  const taskContextSkills = selectedTask?.skills ?? []
  const slashCommands = useMemo<SlashCommand[]>(() => [
    { id: 'plan', label: '/plan', hint: 'Draft a plan in this chat' },
    { id: 'run', label: '/run', hint: 'Start a Codex run for the task' },
    { id: 'steer', label: '/steer', hint: 'Steer the selected conversation' },
    { id: 'settings', label: '/settings', hint: 'Open Codex chat settings' },
    { id: 'attach', label: '/attach', hint: 'Choose files to attach' },
    { id: 'context', label: '/context', hint: 'Toggle task context in the prompt' }
  ], [])
  const slashMatch = chatDraft.match(/(?:^|\s)\/([a-z]*)$/i)
  const slashQuery = slashMatch?.[1]?.toLowerCase() ?? ''
  const slashMenuOpen = chatComposerFocused && Boolean(slashMatch)
  const filteredSlashCommands = useMemo(() => slashCommands
    .filter((command) => command.label.slice(1).startsWith(slashQuery))
    .slice(0, 6), [slashCommands, slashQuery])

  useEffect(() => {
    setSlashCommandIndex(0)
  }, [slashQuery, slashMenuOpen])

  useEffect(() => {
    resizeChatComposerTextarea(chatDraftTextareaRef.current)
  }, [chatDraft, chatAttachments.length, isActivityModalOpen])

  useEffect(() => {
    setChatVisibleLimit(CHAT_INITIAL_MESSAGE_LIMIT)
  }, [selectedChatConversationId, selectedTask?.id])

  useEffect(() => {
    setIsStartingNewChat(false)
  }, [selectedTask?.id])

  const selectedTaskExportContext = useMemo(() => {
    if (!selectedTask) return null
    return { task: selectedTask, project, projectGroup: projectGroupForExport, agents, skills, tags, customFields, projectStatuses }
  }, [agents, customFields, project, projectGroupForExport, projectStatuses, selectedTask, skills, tags])
  const selectedTaskAgentMarkdown = selectedTaskExportContext ? buildAgentMarkdown(selectedTaskExportContext) : ''
  const selectedTaskSkillsMarkdown = selectedTaskExportContext ? buildSkillsMarkdown(selectedTaskExportContext) : ''
  const selectedTaskRunGatewayId = selectedTask ? taskCodexGatewayId(selectedTask) || savedCodexSettings.gatewayId || '' : ''
  const selectedTaskRunModel = selectedTask ? taskCodexModel(selectedTask) || savedCodexSettings.defaultModel || '' : ''
  const chatOperationFeedback: ChatOperationFeedbackData | null = codexPlanLaunching
    ? { state: 'running', title: 'Planning with Codex', message: `Launching ${chatModel || selectedTaskRunModel || 'the selected model'} with the current task context.` }
    : codexRunLaunching
      ? { state: 'running', title: 'Running task with Codex', message: `Preparing the task workspace for ${chatModel || selectedTaskRunModel || 'the selected model'}.` }
      : chatSending
        ? { state: 'running', title: 'Sending message', message: `Starting ${chatModel || 'the selected model'} for this chat thread.` }
        : chatStopping
          ? { state: 'running', title: 'Stopping chat', message: 'Asking Codex to stop the active run.' }
          : codexRunFeedback
            ? {
                state: codexRunFeedback.kind,
                title: codexRunFeedback.kind === 'error' ? 'Action needs attention' : 'Operation started',
                message: codexRunFeedback.message
              }
            : null
  const canRunSelectedTaskWithCodex = Boolean(selectedTaskExportContext && selectedTaskRunGatewayId && selectedTaskRunModel)
  const canPlanSelectedTaskWithCodex = Boolean(selectedTask && selectedTaskRunGatewayId && selectedTaskRunModel)

  const runSelectedTaskWithCodex = async () => {
    if (!selectedTask || !selectedTaskExportContext || !project) {
      setCodexRunFeedback({ kind: 'error', message: 'Task is not ready for a Codex run.' })
      return
    }
    const gatewayId = taskCodexGatewayId(selectedTask) || savedCodexSettings.gatewayId || ''
    const model = taskCodexModel(selectedTask) || savedCodexSettings.defaultModel || ''
    if (!gatewayId) {
      setCodexRunFeedback({ kind: 'error', message: 'Configure a Codex gateway before running this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    if (!model) {
      setCodexRunFeedback({ kind: 'error', message: 'Choose a Codex model before running this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    setCodexRunFeedback(null)
    setCodexRunLaunching(true)
    try {
      const { fileName, archive } = await buildTaskZipArchive(selectedTaskExportContext)
      const response = await invokeBridge<{ runFolderPath: string; workspacePath: string; model: string; gatewayId: string; command?: string; executionMode?: 'terminal' | 'exec'; runId?: string; pid?: number }>(IPC_CHANNELS.tasks.runCodex, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        zipName: fileName,
        zipBytes: archive,
        gatewayId,
        model,
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? ''
      })
      if (!response.ok) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to launch Codex' })
        return
      }
      setCodexRunFeedback({
        kind: 'success',
        message: response.data.executionMode === 'exec'
          ? `Codex exec started. Chat will update as it runs.`
          : `Codex terminal launched. Workspace: ${response.data.workspacePath}`
      })
      setError(null)
    } catch (error) {
      setCodexRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to launch Codex' })
    } finally {
      setCodexRunLaunching(false)
    }
  }

  const planSelectedTaskWithCodex = async () => {
    if (!selectedTask || !project) {
      setCodexRunFeedback({ kind: 'error', message: 'Task is not ready for Codex planning.' })
      return
    }
    const gatewayId = taskCodexGatewayId(selectedTask) || savedCodexSettings.gatewayId || ''
    const model = taskCodexModel(selectedTask) || savedCodexSettings.defaultModel || ''
    if (!gatewayId) {
      setCodexRunFeedback({ kind: 'error', message: 'Configure a Codex gateway before planning this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    if (!model) {
      setCodexRunFeedback({ kind: 'error', message: 'Choose a Codex model before planning this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    setCodexRunFeedback(null)
    setCodexPlanLaunching(true)
    try {
      const response = await invokeBridge<{ runFolderPath: string; runtimeWorkspacePath: string; model: string; gatewayId: string; bridgeUrl?: string; command?: string; executionMode?: 'terminal' | 'exec'; runId?: string; pid?: number }>(IPC_CHANNELS.tasks.planWithCodex, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        gatewayId,
        model,
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? ''
      })
      if (!response.ok) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to launch Codex planner' })
        return
      }
      setCodexRunFeedback({
        kind: 'success',
        message: response.data.executionMode === 'exec'
          ? 'Codex planner exec started. Chat will update as it runs.'
          : `Codex planner launched. Runtime workspace: ${response.data.runtimeWorkspacePath}`
      })
      setError(null)
    } catch (error) {
      setCodexRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to launch Codex planner' })
    } finally {
      setCodexPlanLaunching(false)
    }
  }

  const sendCodexChatMessage = async () => {
    if (!selectedTask || !project) return
    if (selectedChatCanStop) {
      await stopCodexChat()
      return
    }
    const message = chatDraft.trim()
    if (!message && chatAttachments.length === 0) return
    if (!chatGatewayId || !chatModel) {
      setChatSettingsOpen(true)
      setCodexRunFeedback({ kind: 'error', message: 'Choose a Codex gateway and model before sending chat.' })
      return
    }
    if (effectiveChatMode === 'steer' && !selectedChatConversationId) {
      setCodexRunFeedback({ kind: 'error', message: 'Select a conversation before sending a steer message.' })
      return
    }
    setChatSending(true)
    setCodexRunFeedback(null)
    try {
      const conversationId = isStartingNewChat ? undefined : selectedChatConversationId || undefined
      const response = await invokeBridge<{ runId: string; conversationId: string; executionMode: 'terminal' | 'exec' }>(IPC_CHANNELS.tasks.codexChatSend, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        message: message || 'Review the attached file(s) in the task context.',
        gatewayId: chatGatewayId,
        model: chatModel,
        conversationId,
        includeTaskContext: chatIncludeContext,
        mode: effectiveChatMode,
        attachments: chatAttachments.map((attachment) => ({ name: attachment.name, bytes: attachment.bytes }))
      })
      if (!response.ok || !response.data) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to send Codex chat message.' })
        return
      }
      setSelectedChatConversationId(response.data.conversationId)
      setIsStartingNewChat(false)
      setChatDraft('')
      setChatAttachments([])
      setCodexRunFeedback(
        response.data.executionMode === 'terminal'
          ? { kind: 'success', message: 'Codex terminal chat launched.' }
          : null
      )
    } catch (error) {
      setCodexRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to send Codex chat message.' })
    } finally {
      setChatSending(false)
    }
  }

  const stopCodexChat = async () => {
    if (!selectedTask || chatStopping) return
    setChatStopping(true)
    setCodexRunFeedback(null)
    try {
      const response = await invokeBridge<{ stopped: number }>(IPC_CHANNELS.tasks.codexChatStop, {
        actorToken: token,
        taskId: selectedTask.id,
        conversationId: selectedChatConversationId || undefined
      })
      if (!response.ok) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to stop Codex chat.' })
        return
      }
      if (!response.data?.stopped) {
        setCodexRunFeedback({ kind: 'error', message: 'No running Codex chat was found to stop.' })
      }
    } catch (error) {
      setCodexRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to stop Codex chat.' })
    } finally {
      setChatStopping(false)
    }
  }

  const addChatAttachments = async (files: FileList | File[]) => {
    const next: ChatAttachmentDraft[] = []
    for (const file of Array.from(files).slice(0, 6)) {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
      next.push({ id: createLocalId(), name: file.name, size: file.size, bytes })
    }
    setChatAttachments((current) => [...current, ...next].slice(0, 10))
    if (chatFileInputRef.current) chatFileInputRef.current.value = ''
  }

  const applySlashCommand = (command: SlashCommand) => {
    if (command.id === 'plan') {
      setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, (match) => `${match.startsWith(' ') ? ' ' : ''}/plan `))
      setChatComposerMode('chat')
      return
    }
    if (command.id === 'run') {
      setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, ''))
      void runSelectedTaskWithCodex()
      return
    }
    if (command.id === 'steer') {
      setChatComposerMode('steer')
      setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, ''))
      return
    }
    if (command.id === 'settings') {
      setChatSettingsOpen(true)
      setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, ''))
      return
    }
    if (command.id === 'attach') {
      setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, ''))
      chatFileInputRef.current?.click()
      return
    }
    setChatIncludeContext((value) => !value)
    setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, ''))
  }

  const handleChatDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setChatDragDepth((value) => value + 1)
  }

  const handleChatDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleChatDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setChatDragDepth((value) => Math.max(0, value - 1))
  }

  const handleChatDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    setChatDragDepth(0)
    void addChatAttachments(event.dataTransfer.files)
  }

  const closeSelectedTaskDetail = () => {
    setSelectedTaskId(null)
  }

  const syncProjectWorkspace = async () => {
    if (!project) return
    if (!project.workspaceId) {
      setProjectSyncMessage('Assign a workspace before syncing project exports.')
      return
    }
    setProjectSyncing(true)
    setProjectSyncMessage(`Preparing ${hydratedTasks.length} task export(s)...`)
    const exportTasks = hydratedTasks.map((task) => buildProjectWorkspaceExportTaskPayload({
      task,
      project,
      projectGroup: projectGroupForExport,
      agents,
      skills,
      tags,
      customFields,
      projectStatuses
    }))
    const response = await invokeBridge<{ projectFolderPath: string; processedTasks: number; writtenFiles: string[]; skippedFiles: string[]; errors: string[] }>(IPC_CHANNELS.projects.exportWorkspace, {
      actorToken: token,
      projectId: project.id,
      tasks: exportTasks
    })
    setProjectSyncing(false)
    if (!response.ok || !response.data) {
      setProjectSyncMessage(response.error?.message ?? 'Unable to sync project exports.')
      return
    }
    const skipped = response.data.skippedFiles.length ? ` ${response.data.skippedFiles.length} skipped.` : ''
    const errors = response.data.errors.length ? ` ${response.data.errors.length} errors.` : ''
    setProjectSyncMessage(`Synced ${response.data.processedTasks} task(s), wrote ${response.data.writtenFiles.length} file(s).${skipped}${errors}`)
  }

  useEffect(() => {
    const feed = activityFeedRef.current
    if (!feed || !isActivityModalOpen) return
    if (keepActivityBottomRef.current) {
      feed.scrollTop = feed.scrollHeight
    }
  }, [visibleChatMessages.length, isActivityModalOpen])

  const onActivityScroll = () => {
    const feed = activityFeedRef.current
    if (!feed) return
    const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    keepActivityBottomRef.current = distanceToBottom < 36
  }

  const updateTaskStatus = async (taskId: string, status: TaskEntity['status']) => {
    const movingTask = tasks.find((task) => task.id === taskId)
    const targetRows = tasks.filter((task) => task.id !== taskId && task.status === status)
    const nextOrder = targetRows.length
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: taskId,
      status,
      payload: {
        ...(movingTask?.payload ?? {}),
        statusOrder: {
          ...(movingTask ? statusOrderPayload(movingTask, status, nextOrder) : { [status]: nextOrder })
        }
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to move task')
      return
    }
    await refresh()
  }

  const reorderTableTasks = async (sourceTaskId: string, targetTaskId: string) => {
    if (sourceTaskId === targetTaskId) return
    const sourceTask = tasks.find((task) => task.id === sourceTaskId)
    const targetTask = tasks.find((task) => task.id === targetTaskId)
    if (!sourceTask || !targetTask) return
    const status = targetTask.status
    if (sourceTask.status !== status) {
      await updateTaskStatus(sourceTaskId, status)
      return
    }
    const statusTasks = orderedTasksForStatus(tasks.filter((task) => task.status === status))
    const sourceIndex = statusTasks.findIndex((task) => task.id === sourceTaskId)
    const targetIndex = statusTasks.findIndex((task) => task.id === targetTaskId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const nextTasks = statusTasks.filter((task) => task.id !== sourceTaskId)
    const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextTasks.splice(adjustedTargetIndex, 0, sourceTask)

    setTasks((current) => current.map((task) => {
      const nextIndex = nextTasks.findIndex((item) => item.id === task.id)
      return nextIndex >= 0 ? { ...task, payload: { ...(task.payload ?? {}), statusOrder: statusOrderPayload(task, status, nextIndex) } } : task
    }))

    const responses = await Promise.all(nextTasks.map((task, index) => invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: task.id,
      payload: {
        ...(task.payload ?? {}),
        statusOrder: {
          ...statusOrderPayload(task, status, index)
        }
      }
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
    const statusOrder = orderedTasksForStatus(tasks.filter((task) => task.status === defaultStatus)).length
    const response = await invokeBridge(IPC_CHANNELS.tasks.create, {
      actorToken: token,
      projectId,
      title: taskTitle.trim(),
      status: defaultStatus,
      payload: { statusOrder: { [defaultStatus]: statusOrder } }
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

  useEffect(() => {
    const state = location.state as { openCreateTask?: boolean; openTaskId?: string; title?: string; templateId?: string | null } | null
    if (state?.openTaskId) {
      setSelectedTaskId(state.openTaskId)
      navigate(location.pathname, { replace: true, state: null })
      return
    }
    if (!project || !state?.openCreateTask) return
    setCreateTaskInitialTitle(state.title ?? '')
    setCreateTaskInitialTemplateId(state.templateId ?? null)
    openCreateTask(defaultStatus)
    navigate(location.pathname, { replace: true, state: null })
  }, [defaultStatus, location.pathname, location.state, navigate, project])

  const handleCreateTask = async (input: CreateTaskInput) => {
    if (!projectId || !input.title.trim()) return
    setBusy(true)
    try {
      const result = await createTaskWithTemplate({
        actorToken: token,
        userName: user?.name,
        input: {
          ...input,
          projectId,
          statusOrder: orderedTasksForStatus(tasks.filter((task) => task.status === input.status)).length
        },
        templates: taskTemplates,
        statusColumns,
        defaultStatus,
        outputFormats
      })
      if (result.warnings[0]) setError(result.warnings[0])
      setIsCreateTaskOpen(false)
      setCreateTaskInitialTitle('')
      setCreateTaskInitialTemplateId(null)
      await refresh()
      setSelectedTaskId(result.task.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Task create failed')
    } finally {
      setBusy(false)
    }
  }

  const handleListCreate = async (status: TaskEntity['status']) => {
    if (!projectId || !listCreateTitle.trim()) return
    setBusy(true)
    const statusOrder = orderedTasksForStatus(tasks.filter((task) => task.status === status)).length
    const response = await invokeBridge(IPC_CHANNELS.tasks.create, {
      actorToken: token,
      projectId,
      title: listCreateTitle.trim(),
      status,
      payload: { statusOrder: { [status]: statusOrder } }
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
    setProjectSettingsTab('statuses')
    setWorkspaceMoveMessage(null)
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

  const saveProjectTableView = async (nextConfig: ProjectTableViewConfig) => {
    if (!project) return
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      metrics: {
        ...(project.metrics ?? {}),
        tableView: nextConfig
      }
    })
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to save table view settings')
      return
    }
    setProject(response.data)
  }

  const setTableColumns = async (columns: TableColumnConfig[]) => {
    const current = getTableViewConfig(project)
    await saveProjectTableView({ ...current, columns: columns.slice(0, 12) })
  }

  const setTableColumnWidth = async (columnId: string, width: number) => {
    const current = getTableViewConfig(project)
    await saveProjectTableView({
      ...current,
      columns: tableColumns.map((column) => column.id === columnId ? { ...column, width } : column),
      columnWidths: {
        ...(current.columnWidths ?? {}),
        [columnId]: Math.max(80, Math.min(520, Math.round(width)))
      }
    })
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

  const buildStatusTemplateMapping = (template: StatusTemplate): { mapping: Record<string, string>; needsReview: boolean } => {
    const nextItems = template.items ?? []
    const mapping: Record<string, string> = {}
    let needsReview = false
    for (const current of projectStatuses) {
      const exact = nextItems.find((item) => item.id === current.id)
      if (exact) continue
      const named = nextItems.find((item) => (
        item.category === current.category &&
        item.name.trim().toLowerCase() === current.name.trim().toLowerCase()
      ))
      if (named) {
        mapping[current.id] = named.id
        continue
      }
      const categoryFallback = nextItems.find((item) => item.category === current.category) ?? nextItems[0]
      if (categoryFallback) {
        mapping[current.id] = categoryFallback.id
        needsReview = true
      }
    }
    return { mapping, needsReview }
  }

  const applyStatusTemplate = async (template: StatusTemplate) => {
    if (!project) return
    const items = template.items ?? []
    if (!items.length) return
    const { mapping, needsReview } = buildStatusTemplateMapping(template)
    const nextDrafts = items.map((item, index) => ({
      ...item,
      projectId: project.id,
      sortOrder: index,
      isDefault: item.category === 'not_started'
    }))
    setStatusDrafts(nextDrafts)
    setStatusMapping(mapping)
    setPendingStatusTemplate(needsReview ? template : null)
    setIsStatusTemplatePickerOpen(false)
    if (!needsReview && projectId) {
      const response = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.updateProjectStatuses, {
        actorToken: token,
        projectId,
        items: nextDrafts.map((item, index) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          color: item.color,
          sortOrder: index,
          isDefault: item.category === 'not_started'
        })),
        mapping: {}
      })
      if (!response.ok) {
        setError(response.error?.message ?? 'Unable to apply status template')
        return
      }
      setIsStatusEditorOpen(false)
      await refresh()
    }
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
      description: descriptionDraft,
      payload: {
        ...(selectedTask.payload ?? {}),
        inputFormatId: '',
        outputFormatId: ''
      }
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

  const saveTaskAttachments = async (attachments: TaskAttachment[]) => {
    if (!selectedTask) return
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      payload: {
        ...(selectedTask.payload ?? {}),
        attachments
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update attachments')
      return
    }
    await refresh()
  }

  const uploadTaskAttachments = async (files: File[]) => {
    if (!selectedTask) return
    setIsAttachmentUploading(true)
    try {
      const uploaded = await Promise.all(files.map((file) => uploadTaskAttachment(file, token, {
        scope: 'task',
        projectId: selectedTask.projectId,
        taskId: selectedTask.id
      })))
      await saveTaskAttachments([...getTaskAttachments(selectedTask), ...uploaded])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to upload attachments')
    } finally {
      setIsAttachmentUploading(false)
    }
  }

  const saveSubtaskAttachmentsFor = async (subtask: TaskSubtask, attachments: TaskAttachment[]) => {
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: subtask.id,
      payload: {
        ...getSubtaskPayload(subtask),
        attachments
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask attachments')
      return
    }
    await refresh()
  }

  const saveSubtaskAttachments = async (attachments: TaskAttachment[]) => {
    if (!selectedSubtask) return
    await saveSubtaskAttachmentsFor(selectedSubtask, attachments)
  }

  const uploadSubtaskAttachments = async (files: File[]) => {
    if (!selectedTask || !selectedSubtask) return
    setIsAttachmentUploading(true)
    try {
      const uploaded = await Promise.all(files.map((file) => uploadTaskAttachment(file, token, {
        scope: 'subtask',
        projectId: selectedTask.projectId,
        taskId: selectedTask.id,
        subtaskId: selectedSubtask.id
      })))
      await saveSubtaskAttachments([...getSubtaskAttachments(selectedSubtask), ...uploaded])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to upload subtask attachments')
    } finally {
      setIsAttachmentUploading(false)
    }
  }

  const removeSubtaskAttachment = async (row: AttachmentRow) => {
    if (!selectedSubtask) return
    if (row.origin === 'stored') {
      await saveSubtaskAttachments(getSubtaskAttachments(selectedSubtask).filter((attachment) => attachment.id !== row.id))
      return
    }
    const nextDescription = removeAttachmentFromMarkdown(subtaskDescriptionDraft, row.url)
    setSubtaskDescriptionDraft(nextDescription)
    setIsSubtaskDescriptionSaving(true)
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        description: nextDescription
      }
    })
    setIsSubtaskDescriptionSaving(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to remove subtask attachment')
      return
    }
    await refresh()
  }

  const removeTaskAttachment = async (row: AttachmentRow) => {
    if (!selectedTask) return
    if (row.ownerType === 'subtask' && row.ownerId) {
      const targetSubtask = (selectedTask.subtasks ?? []).find((subtask) => subtask.id === row.ownerId)
      if (!targetSubtask) return
      if (row.origin === 'stored') {
        await saveSubtaskAttachmentsFor(targetSubtask, getSubtaskAttachments(targetSubtask).filter((attachment) => attachment.id !== row.id))
        return
      }
      const nextDescription = removeAttachmentFromMarkdown(getSubtaskDescription(targetSubtask), row.url)
      if (selectedSubtask?.id === targetSubtask.id) {
        setSubtaskDescriptionDraft(nextDescription)
      }
      setIsSubtaskDescriptionSaving(true)
      const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
        actorToken: token,
        id: targetSubtask.id,
        payload: {
          ...getSubtaskPayload(targetSubtask),
          description: nextDescription
        }
      })
      setIsSubtaskDescriptionSaving(false)
      if (!response.ok) {
        setError(response.error?.message ?? 'Unable to remove subtask attachment')
        return
      }
      await refresh()
      return
    }
    if (row.origin === 'stored') {
      await saveTaskAttachments(getTaskAttachments(selectedTask).filter((attachment) => attachment.id !== row.id))
      return
    }
    const nextDescription = removeAttachmentFromMarkdown(descriptionDraft, row.url)
    setDescriptionDraft(nextDescription)
    setIsDescriptionSaving(true)
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      description: nextDescription
    })
    setIsDescriptionSaving(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to remove description attachment')
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

  const setTaskCodexSelection = async (patch: { gatewayId?: string | null; model?: string | null }) => {
    if (!selectedTask) return
    const nextPayload: Record<string, unknown> = { ...(selectedTask.payload ?? {}) }
    const currentCodex = nextPayload.codex && typeof nextPayload.codex === 'object' && !Array.isArray(nextPayload.codex)
      ? nextPayload.codex as Record<string, unknown>
      : {}
    const currentGatewayId = typeof currentCodex.gatewayId === 'string' ? currentCodex.gatewayId : ''
    const currentModel = typeof currentCodex.model === 'string' ? currentCodex.model : ''
    const nextGatewayId = patch.gatewayId === undefined ? currentGatewayId : patch.gatewayId ?? ''
    const nextModel = patch.model === undefined ? currentModel : patch.model ?? ''
    const override = codexPayloadOverride(nextGatewayId, nextModel)
    if (override) {
      nextPayload.codex = override
    } else {
      nextPayload.codex = undefined
    }
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      payload: nextPayload
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update task model')
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

  const setSubtaskSkills = async (nextSkillIds: string[]) => {
    if (!selectedSubtask) return
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        skillIds: nextSkillIds
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask skills')
      return
    }
    await refresh()
  }

  const setSubtaskTags = async (nextTagIds: string[]) => {
    if (!selectedSubtask) return
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        tagIds: nextTagIds
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask tags')
      return
    }
    await refresh()
  }

  const setTaskDataFormat = async (role: DataFormatRole, formatId: string | null) => {
    if (!selectedTask) return false
    const key = role === 'input' ? 'inputFormatId' : 'outputFormatId'
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      payload: {
        ...(selectedTask.payload ?? {}),
        [key]: formatId ?? ''
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update task data format')
      return false
    }
    await refresh()
    return true
  }

  const openDataFormatModal = (role: DataFormatRole, scope: DetailViewMode) => {
    const selectedOption = scope === 'task'
      ? role === 'input' ? selectedTaskInputFormatOption : selectedTaskOutputFormatOption
      : role === 'input' ? selectedSubtaskInputFormatOption : selectedSubtaskOutputFormatOption
    setDataFormatTarget({ role, scope })
    setDataFormatRoleDraft(role)
    setOutputFormatDraftOption(selectedOption)
    setQuickOutputFormatName('')
    setQuickOutputFormatDescription('')
    setIsCreateOutputFormatOpen(false)
    setIsOutputFormatModalOpen(true)
  }

  const saveTaskOutputFormatFromModal = async () => {
    if (!dataFormatTarget) return
    const saved = dataFormatTarget.scope === 'task'
      ? await setTaskDataFormat(dataFormatTarget.role, outputFormatDraftOption?.value ?? null)
      : await setSubtaskDataFormat(dataFormatTarget.role, outputFormatDraftOption?.value ?? null)
    if (saved) setIsOutputFormatModalOpen(false)
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

  const setSubtaskDataFormat = async (role: DataFormatRole, formatId: string | null) => {
    if (!selectedSubtask) return false
    const key = role === 'input' ? 'inputFormatId' : 'outputFormatId'
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        [key]: formatId ?? ''
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask data format')
      return false
    }
    await refresh()
    return true
  }

  const parseCustomFieldValueInput = (field: CustomField, inputValue: string): { ok: true; value: unknown } | { ok: false; error: string } => {
    const draft = inputValue.trim()
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
    return { ok: true, value: inputValue }
  }

  const parseCustomFieldDraft = (field: CustomField): { ok: true; value: unknown } | { ok: false; error: string } => {
    return parseCustomFieldValueInput(field, customFieldDraft)
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
    setIsCustomFieldModalOpen(false)
    await refresh()
  }

  const openCustomFieldModal = () => {
    setSelectedCustomFieldOption(null)
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

  const saveCustomFieldRows = async () => {
    if (!selectedTask) return
    const isSubtaskContext = detailViewMode === 'subtask' && selectedSubtask
    const currentValues = isSubtaskContext ? getSubtaskCustomFieldValues(selectedSubtask) : (selectedTask.customFieldValues ?? {})
    const knownFieldIds = new Set(customFields.map((item) => item.id))
    const nextValues: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(currentValues).filter(([key]) => knownFieldIds.has(key)))
    }
    const seen = new Set<string>()
    for (const row of customFieldRows) {
      if (!row.field) continue
      if (seen.has(row.field.value)) continue
      const field = customFields.find((item) => item.id === row.field?.value)
      if (!field) continue
      const parsed = parseCustomFieldValueInput(field, row.value)
      if (!parsed.ok) {
        setCustomFieldError(`${field.name}: ${parsed.error}`)
        return
      }
      seen.add(field.id)
      nextValues[field.id] = parsed.value
    }
    if (seen.size === 0) return
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
      setCustomFieldError(response.error?.message ?? 'Unable to update custom fields')
      return
    }
    setCustomFieldError(null)
    setIsCustomFieldModalOpen(false)
    setCustomFieldRows([{ id: createLocalId(), field: null, value: '' }])
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

  const createTagAndAttachToSubtask = async (inputValue: string) => {
    const normalized = inputValue.trim()
    if (!normalized || !selectedSubtask) return
    const createRes = await invokeBridge<Tag>(IPC_CHANNELS.customFields.tagsCreate, {
      actorToken: token,
      name: normalized
    })
    if (!createRes.ok || !createRes.data) {
      setError(createRes.error?.message ?? 'Unable to create tag')
      return
    }
    await setSubtaskTags(Array.from(new Set([...getSubtaskTagIds(selectedSubtask), createRes.data.id])))
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

  const createSubtasks = async (inputs: Array<{
    title: string
    description: string
    status: TaskSubtask['status']
    agentId?: string | null
    dueAt?: number
  }>) => {
    if (!selectedTask) return
    const validInputs = inputs.filter((input) => input.title.trim())
    if (validInputs.length === 0) return
    for (const input of validInputs) {
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
    }
    setIsAddSubtaskOpen(false)
    setSubtaskRows([{ id: createLocalId(), title: '' }])
    await refresh()
  }

  const importSelectedTaskJson = async (jsonText: string) => {
    if (!selectedTask) return
    setIsTaskImporting(true)
    const response = await invokeBridge<TaskJsonImportResult>(IPC_CHANNELS.tasks.importJson, {
      actorToken: token,
      taskId: selectedTask.id,
      json: jsonText
    })
    setIsTaskImporting(false)
    if (!response.ok || !response.data?.task) {
      setError(response.error?.message ?? 'Task JSON import failed')
      return
    }
    setIsTaskImportOpen(false)
    if (response.data.warnings.length > 0) setError(response.data.warnings.join(' '))
    await refresh()
    setSelectedTaskId(response.data.task.id)
    setDetailViewMode('task')
    setSelectedSubtaskId(null)
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

  const openChecklistModal = () => {
    setChecklistRows([{ id: createLocalId(), title: '' }])
    setIsChecklistModalOpen(true)
  }

  const addChecklistItems = async () => {
    if (!selectedTask) return
    const titles = checklistRows.map((row) => row.title.trim()).filter(Boolean)
    if (titles.length === 0) return
    const now = Date.now()
    await saveChecklistItems([
      ...(selectedTask.checklistItems ?? []),
      ...titles.map((title) => ({
        id: createLocalId(),
        title,
        checked: false,
        createdAt: now,
        updatedAt: now
      }))
    ])
    setChecklistRows([{ id: createLocalId(), title: '' }])
    setIsChecklistModalOpen(false)
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
      inputFormatId: '',
      outputFormatId: ''
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
    setDetailTab('agent')
  }

  const scheduleOpenSubtaskDetail = (subtaskId: string) => {
    if (subtaskClickTimerRef.current) window.clearTimeout(subtaskClickTimerRef.current)
    subtaskClickTimerRef.current = window.setTimeout(() => {
      openSubtaskDetail(subtaskId)
      subtaskClickTimerRef.current = null
    }, 180)
  }

  const startSubtaskRename = (subtask: TaskSubtask) => {
    if (subtaskClickTimerRef.current) {
      window.clearTimeout(subtaskClickTimerRef.current)
      subtaskClickTimerRef.current = null
    }
    setEditingSubtaskId(subtask.id)
    setSubtaskDraft(subtask.title)
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

  const updateSubtaskComments = async (nextComments: TaskComment[], errorMessage: string) => {
    if (!selectedSubtask) return false
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        comments: nextComments
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? errorMessage)
      return false
    }
    await refresh()
    return true
  }

  const submitSubtaskComment = async () => {
    if (!selectedSubtask || !subtaskCommentDraft.trim()) return
    const now = Date.now()
    const body = subtaskCommentDraft.trim()
    const currentComments = getSubtaskComments(selectedSubtask)

    if (editingSubtaskCommentId) {
      const nextComments = currentComments.map((comment) => (
        comment.id === editingSubtaskCommentId ? { ...comment, body, updatedAt: now } : comment
      ))
      const ok = await updateSubtaskComments(nextComments, 'Unable to update subtask comment')
      if (!ok) return
      setSubtaskCommentDraft('')
      setEditingSubtaskCommentId(null)
      return
    }

    const nextComment: TaskComment = {
      id: createLocalId(),
      authorName: user?.name || 'Operator',
      body,
      createdAt: now
    }
    const ok = await updateSubtaskComments([...currentComments, nextComment], 'Unable to add subtask comment')
    if (!ok) return
    setSubtaskCommentDraft('')
  }

  const startEditSubtaskComment = (comment: TaskComment) => {
    setEditingSubtaskCommentId(comment.id)
    setSubtaskCommentDraft(comment.body)
  }

  const cancelEditSubtaskComment = () => {
    setEditingSubtaskCommentId(null)
    setSubtaskCommentDraft('')
  }

  const removeSubtaskComment = async (comment: TaskComment) => {
    if (!selectedSubtask) return
    const nextComments = getSubtaskComments(selectedSubtask).filter((item) => item.id !== comment.id)
    const ok = await updateSubtaskComments(nextComments, 'Unable to remove subtask comment')
    if (!ok) return
    if (editingSubtaskCommentId === comment.id) {
      setEditingSubtaskCommentId(null)
      setSubtaskCommentDraft('')
    }
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

  const renderDataFormatPanel = () => {
    const isTask = detailViewMode === 'task'
    const inputValue = isTask ? selectedTaskInputFormatOption : selectedSubtaskInputFormatOption
    const outputValue = isTask ? selectedTaskOutputFormatOption : selectedSubtaskOutputFormatOption
    const updateFormat = (role: DataFormatRole, option: AppSelectOption | null) => {
      if (isTask) {
        void setTaskDataFormat(role, option?.value ?? null)
      } else {
        void setSubtaskDataFormat(role, option?.value ?? null)
      }
    }

    return (
      <div className={styles.dataFormatPanel}>
        {([
          { role: 'input' as const, title: 'Input data format', value: inputValue, options: inputFormatOptions, description: 'Incoming data shape' },
          { role: 'output' as const, title: 'Output data format', value: outputValue, options: outputFormatOptions, description: 'Expected result shape' }
        ]).map((item) => (
          <div key={item.role} className={styles.dataFormatCard}>
            <div className={styles.dataFormatHeader}>
              <span className={`${styles.dataFormatRoleBadge} ${item.role === 'input' ? styles.inputFormatBadge : styles.outputFormatBadge}`}>
                {item.role === 'input' ? 'Input' : 'Output'}
              </span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.value?.label ?? 'Not set'} · {item.description}</small>
              </div>
            </div>
            <div className={styles.dataFormatControls}>
              <AppSelect
                mode="single"
                variant="borderless"
                value={item.value}
                options={item.options}
                onChange={(option) => !Array.isArray(option) && updateFormat(item.role, option)}
                placeholder={item.role === 'input' ? 'Choose input format...' : 'Choose output format...'}
                isClearable
              />
              <button type="button" onClick={() => openDataFormatModal(item.role, detailViewMode)}>
                <LuPlus size={14} />
                New
              </button>
            </div>
          </div>
        ))}
      </div>
    )
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
          onReorder={(sourceTaskId, targetTaskId) => void reorderTableTasks(sourceTaskId, targetTaskId)}
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
          tableColumns={tableColumns}
          customFields={customFields}
          agents={agents}
          onOpenTask={setSelectedTaskId}
          onOpenCreateTask={() => openCreateTask(defaultStatus)}
          onStatusChange={(taskId, status) => void updateTaskStatus(taskId, status)}
          onReorder={(sourceTaskId, targetTaskId) => void reorderTableTasks(sourceTaskId, targetTaskId)}
          onOpenColumnPicker={() => setIsTableColumnPickerOpen(true)}
          onColumnWidthChange={(columnId, width) => void setTableColumnWidth(columnId, width)}
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
        onReorder={(sourceTaskId, targetTaskId) => void reorderTableTasks(sourceTaskId, targetTaskId)}
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
        onSyncProject={() => void syncProjectWorkspace()}
        syncDisabled={projectSyncing}
        onViewModeChange={setViewMode}
      />

      {error ? <p className={styles.error}>{error}</p> : null}
      {projectSyncMessage ? <p className={styles.notice}>{projectSyncMessage}</p> : null}

      {renderActiveView()}

      <CreateTaskModal
        open={isCreateTaskOpen}
        project={project}
        tags={tags}
        agents={agents}
        templates={taskTemplates}
        statusColumns={statusColumns}
        defaultStatus={createTaskStatus}
        initialTitle={createTaskInitialTitle}
        initialTemplateId={createTaskInitialTemplateId}
        busy={busy}
        onClose={() => {
          setIsCreateTaskOpen(false)
          setCreateTaskInitialTitle('')
          setCreateTaskInitialTemplateId(null)
        }}
        onCreate={(input) => void handleCreateTask({ ...input, projectId: projectId ?? input.projectId })}
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
        onCreateMany={(inputs) => void createSubtasks(inputs)}
      />

      {isTableColumnPickerOpen ? (
        <>
          <div className={styles.nestedCreateBackdrop} onClick={() => setIsTableColumnPickerOpen(false)} />
          <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Choose table columns">
            <header>
              <h4>Table columns</h4>
              <button type="button" onClick={() => setIsTableColumnPickerOpen(false)} aria-label="Close column picker"><LuX size={15} /></button>
            </header>
            <div className={styles.columnPickerBody}>
              <p className={styles.columnPickerHint}>Choose up to 12 columns. Name and Status stay visible.</p>
              {availableTableColumns.map((column) => {
                const selected = tableColumns.some((item) => item.id === column.id)
                const disabled = column.required || (!selected && tableColumns.length >= 12)
                return (
                  <label key={column.id} className={`${styles.columnPickerRow} ${selected ? styles.columnPickerRowActive : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={(event) => {
                        if (column.required) return
                        if (event.target.checked) {
                          void setTableColumns([...tableColumns, column].slice(0, 12))
                          return
                        }
                        void setTableColumns(tableColumns.filter((item) => item.id !== column.id || item.required))
                      }}
                    />
                    <span>{column.label}</span>
                    {column.kind === 'custom' ? <small>Custom field</small> : <small>Built-in</small>}
                  </label>
                )
              })}
            </div>
          </section>
        </>
      ) : null}

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
          <section className={`${styles.createTaskModal} ${styles.projectSettingsModal}`} role="dialog" aria-modal="true" aria-label="Project settings">
            <header className={styles.projectSettingsHeader}>
              <div>
                <h3>Project settings</h3>
                <p>Manage workflow statuses and project workspace.</p>
              </div>
              <button type="button" onClick={() => setIsStatusEditorOpen(false)} aria-label="Close project settings"><LuX size={17} /></button>
            </header>
            <div className={styles.projectSettingsTabs}>
              <div className={styles.projectPromptTabs}>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectSettingsTab === 'statuses' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectSettingsTab('statuses')}
                >
                  Statuses
                </button>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectSettingsTab === 'workspace' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectSettingsTab('workspace')}
                >
                  Workspace
                </button>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectSettingsTab === 'projectGroup' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectSettingsTab('projectGroup')}
                >
                  Project group
                </button>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectSettingsTab === 'agents' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectSettingsTab('agents')}
                >
                  Agents
                </button>
                <button
                  type="button"
                  className={`${styles.projectPromptTab} ${projectSettingsTab === 'codex' ? styles.projectPromptTabActive : ''}`}
                  onClick={() => setProjectSettingsTab('codex')}
                >
                  Gateway settings
                </button>
              </div>
            </div>
            <div className={styles.projectSettingsBody}>
              {projectSettingsTab === 'statuses' ? (
                <>
                  <div className={styles.tabCtaCard}>
                    <div>
                      <strong>Apply status template</strong>
                      <span>Use a saved workflow and map existing task statuses when needed.</span>
                    </div>
                    <button type="button" className={styles.tabActionButton} onClick={() => setIsStatusTemplatePickerOpen(true)}>
                      Apply template
                    </button>
                  </div>
                  {(['not_started', 'active', 'done', 'closed'] as ProjectStatusCategory[]).map((category) => {
                    const rows = statusDrafts.filter((item) => item.category === category)
                    return (
                      <div key={category} className={styles.drawerSection}>
                        <h4>{category === 'not_started' ? 'Not started' : category === 'active' ? 'Active' : category === 'done' ? 'Done' : 'Closed'}</h4>
                        <Stack gap={2}>
                          {rows.map((status) => (
                            <div key={status.id} className={styles.statusEditorRow}>
                              <input
                                className={styles.subtaskInlineInput}
                                value={status.name}
                                onChange={(event) => updateStatusDraft(status.id, { name: event.target.value })}
                              />
                              <div className={styles.statusColorCell}>
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
                              </div>
                              <div className={styles.statusActionsCell}>
                                {category === 'active' ? (
                                  <button type="button" className={styles.iconBtn} onClick={() => removeStatusDraft(status)} aria-label={`Remove ${status.name}`}>
                                    <LuTrash2 size={15} />
                                  </button>
                                ) : null}
                              </div>
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
                </>
              ) : null}
              {projectSettingsTab === 'statuses' && Object.keys(statusMapping).length > 0 ? (
                <div className={styles.drawerSection}>
                  <h4>{pendingStatusTemplate ? `Map statuses for ${pendingStatusTemplate.name}` : 'Status migration mapping'}</h4>
                  {Object.entries(statusMapping).map(([sourceId, targetId]) => {
                    const source = projectStatuses.find((item) => item.id === sourceId)
                    return (
                      <div key={sourceId} className={styles.statusMappingRow}>
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
              {projectSettingsTab === 'workspace' ? (
                <div className={styles.settingsPanel}>
                  <div className={styles.settingsPanelHeader}>
                    <div>
                      <h4>Workspace</h4>
                      <p>{selectedWorkspace ? 'Assigned workspace' : 'No workspace assigned'}</p>
                    </div>
                    <button type="button" className={styles.tabActionButton} onClick={() => setIsWorkspacePickerOpen(true)} disabled={movingWorkspace}>
                      Change workspace
                    </button>
                  </div>
                  <div className={styles.settingsInfoGrid}>
                    <div>
                      <span>Name</span>
                      <strong>{selectedWorkspace?.name ?? 'No workspace'}</strong>
                    </div>
                    <div>
                      <span>Root path</span>
                      <code>{selectedWorkspace?.rootPath ?? 'Project files are currently stored in staging until a workspace is assigned.'}</code>
                    </div>
                    <div>
                      <span>Project folder</span>
                      <code>{selectedWorkspace ? projectFolderPreview : 'Assign a workspace to create a project folder.'}</code>
                    </div>
                  </div>
                  {movingWorkspace ? (
                    <div className={styles.workspaceProgress} aria-label="Moving project workspace">
                      <span />
                    </div>
                  ) : null}
                  {workspaceMoveMessage ? <p className={styles.customFieldEmpty}>{workspaceMoveMessage}</p> : null}
                </div>
              ) : null}
              {projectSettingsTab === 'projectGroup' ? (
                <div className={styles.settingsPanel}>
                  <div className={styles.settingsPanelHeader}>
                    <div>
                      <h4>Project group</h4>
                      <p>{projectGroupForExport ? 'Assigned project group' : 'No project group assigned'}</p>
                    </div>
                    <button type="button" className={styles.tabActionButton} onClick={() => setIsProjectGroupPickerOpen(true)} disabled={projectGroupSaving}>
                      Change group
                    </button>
                  </div>
                  {projectGroupForExport ? (
                    <div className={styles.settingsFormGrid}>
                      <label>
                        <span>Group name</span>
                        <input value={projectGroupNameDraft} onChange={(event) => setProjectGroupNameDraft(event.target.value)} />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea value={projectGroupDescriptionDraft} onChange={(event) => setProjectGroupDescriptionDraft(event.target.value)} rows={4} />
                      </label>
                      <div className={styles.settingsInfoGrid}>
                        <div>
                          <span>Projects</span>
                          <strong>{projectGroupForExport.projectIds?.length ?? 0}</strong>
                        </div>
                        <div>
                          <span>Updated</span>
                          <strong>{new Date(projectGroupForExport.updatedAt).toLocaleString()}</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.settingsEmptyState}>No project group assigned.</div>
                  )}
                </div>
              ) : null}
              {projectSettingsTab === 'agents' ? (
                <div className={styles.settingsPanel}>
                  <div className={styles.settingsPanelHeader}>
                    <div>
                      <h4>Agents</h4>
                      <p>Unique agents assigned to this project's tasks and subtasks.</p>
                    </div>
                  </div>
                  {projectAgentRows.length > 0 ? (
                    <div className={styles.settingsMiniTable}>
                      <div>
                        <span>Agent</span>
                        <span>Source count</span>
                        <span>Status</span>
                        <span>Title</span>
                      </div>
                      {projectAgentRows.map(({ agent, count }) => (
                        <div key={agent.id}>
                          <strong>{agent.name}</strong>
                          <span>{count}</span>
                          <span>{agent.status}</span>
                          <span>{agent.title || '-'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.settingsEmptyState}>No agents assigned.</div>
                  )}
                </div>
              ) : null}
              {projectSettingsTab === 'codex' ? (
                <div className={styles.settingsPanel}>
                  <div className={styles.settingsPanelHeader}>
                    <div>
                      <h4>Gateway settings</h4>
                      <p>Choose the CLI gateway, runtime workspace, and default Codex model for this project.</p>
                    </div>
                  </div>
                  <div className={styles.settingsFormGrid}>
                    <label>
                      <span>Active gateway</span>
                      <AppSelect
                        value={selectedCodexGatewayOption}
                        options={codexGatewayOptions}
                        placeholder="Select gateway"
                        onChange={(option) => {
                          const nextGatewayId = option?.value ?? ''
                          const nextGateway = gateways.find((item) => item.id === nextGatewayId)
                          const models = codexConfigOf(nextGateway).models ?? []
                          setCodexGatewayId(nextGatewayId)
                          setCodexModelError(null)
                          if (!models.some((model) => model.id === codexDefaultModel)) setCodexDefaultModel('')
                        }}
                      />
                    </label>
                    <label>
                      <span>Runtime workspace</span>
                      <AppSelect
                        value={selectedRuntimeWorkspaceOption}
                        options={workspaceOptions}
                        placeholder="Select workspace"
                        onChange={(option) => setCodexRuntimeWorkspaceId(option?.value ?? '')}
                      />
                    </label>
                    <label>
                      <span>Default model</span>
                      <AppSelect
                        value={selectedDefaultModelOption}
                        options={projectCodexModelOptions}
                        placeholder={codexModelLoading ? 'Loading models...' : codexModelOptions.length > 0 ? 'Select default model' : 'Select a gateway to load models'}
                        isDisabled={!codexGatewayId || codexModelOptions.length === 0}
                        onChange={(option) => setCodexDefaultModel(option?.value ?? '')}
                      />
                    </label>
                  </div>
                  {codexModelLoading ? <div className={styles.settingsEmptyState}>Loading models from Codex CLI...</div> : null}
                  {codexModelError ? <div className={styles.settingsEmptyState}>{codexModelError}</div> : null}
                  {selectedCodexGateway && codexModelOptions.length === 0 ? (
                    <div className={styles.settingsEmptyState}>No models are available yet. Model inspect runs automatically when this gateway is selected.</div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <footer className={styles.createTaskFooter}>
              {projectSettingsTab === 'statuses' ? (
                <>
                  <span>Removing or replacing a status requires mapping old tasks and subtasks to a remaining status.</span>
                  <button type="button" onClick={() => void saveProjectStatuses()}>Save statuses</button>
                </>
              ) : projectSettingsTab === 'workspace' ? (
                <>
                  <span>Workspace changes move existing attachment files into the selected project folder.</span>
                  <button type="button" onClick={() => setIsStatusEditorOpen(false)} disabled={movingWorkspace}>Done</button>
                </>
              ) : projectSettingsTab === 'projectGroup' ? (
                <>
                  <span>Project group assignment controls where this project appears in group views.</span>
                  <button type="button" onClick={() => projectGroupForExport ? void saveSelectedProjectGroup() : setIsStatusEditorOpen(false)} disabled={projectGroupSaving || Boolean(projectGroupForExport && !projectGroupNameDraft.trim())}>
                    {projectGroupForExport ? 'Save group' : 'Done'}
                  </button>
                </>
              ) : projectSettingsTab === 'codex' ? (
                <>
                  <span>Task and template model tabs inherit this gateway default unless they explicitly override it.</span>
                  <button type="button" onClick={() => void saveProjectCodexSettings()} disabled={codexSaving || !codexGatewayId || !codexRuntimeWorkspaceId || !codexDefaultModel}>
                    {codexSaving ? 'Saving...' : 'Save Codex settings'}
                  </button>
                </>
              ) : (
                <>
                  <span>Agents are listed from current task and subtask assignments.</span>
                  <button type="button" onClick={() => setIsStatusEditorOpen(false)}>Done</button>
                </>
              )}
            </footer>
          </section>
          {isStatusTemplatePickerOpen ? (
            <>
              <div className={styles.nestedCreateBackdrop} onClick={() => setIsStatusTemplatePickerOpen(false)} />
              <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Apply status template">
                <header>
                  <h4>Apply status template</h4>
                  <button type="button" onClick={() => setIsStatusTemplatePickerOpen(false)} aria-label="Close status template picker"><LuX size={15} /></button>
                </header>
                <div className={styles.workspacePickerList}>
                  {statusTemplates.map((template) => (
                    <button key={template.id} type="button" className={styles.workspacePickerRow} onClick={() => void applyStatusTemplate(template)}>
                      <strong>{template.name}</strong>
                      <span>{template.items?.length ?? 0} statuses</span>
                    </button>
                  ))}
                  {statusTemplates.length === 0 ? <p className={styles.customFieldEmpty}>No status templates available.</p> : null}
                </div>
              </section>
            </>
          ) : null}
          {isProjectGroupPickerOpen ? (
            <>
              <div className={styles.nestedCreateBackdrop} onClick={() => setIsProjectGroupPickerOpen(false)} />
              <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Choose project group">
                <header>
                  <h4>Choose project group</h4>
                  <button type="button" onClick={() => setIsProjectGroupPickerOpen(false)} aria-label="Close project group picker"><LuX size={15} /></button>
                </header>
                <div className={styles.workspacePickerList}>
                  <button
                    type="button"
                    className={projectGroupForExport ? styles.workspacePickerRow : `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}`}
                    onClick={() => void updateProjectGroupMembership(null)}
                    disabled={projectGroupSaving}
                  >
                    <strong>No project group</strong>
                    <span>Remove this project from its current group.</span>
                  </button>
                  {projectGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={group.id === projectGroupForExport?.id ? `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}` : styles.workspacePickerRow}
                      onClick={() => void updateProjectGroupMembership(group.id)}
                      disabled={projectGroupSaving}
                    >
                      <strong>{group.name}</strong>
                      <span>{group.description || `${group.projectIds?.length ?? 0} projects`}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : null}
          {isWorkspacePickerOpen ? (
            <>
              <div className={styles.nestedCreateBackdrop} onClick={() => setIsWorkspacePickerOpen(false)} />
              <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Choose workspace">
                <header>
                  <h4>Choose workspace</h4>
                  <button type="button" onClick={() => setIsWorkspacePickerOpen(false)} aria-label="Close workspace picker"><LuX size={15} /></button>
                </header>
                <div className={styles.workspacePickerList}>
                  <button
                    type="button"
                    className={project.workspaceId ? styles.workspacePickerRow : `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}`}
                    onClick={() => {
                      setIsWorkspacePickerOpen(false)
                      void updateProjectWorkspace(null)
                    }}
                  >
                    <strong>No workspace</strong>
                    <span>Use staging until a workspace is selected.</span>
                  </button>
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      className={workspace.id === project.workspaceId ? `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}` : styles.workspacePickerRow}
                      onClick={() => {
                        setIsWorkspacePickerOpen(false)
                        void updateProjectWorkspace(workspace.id)
                      }}
                    >
                      <strong>{workspace.name}</strong>
                      <span>{workspace.rootPath}</span>
                    </button>
                  ))}
                </div>
                <div className={styles.nestedCreateBody}>
                  <label>
                    <span>Workspace name</span>
                    <input value={workspaceDraftName} onChange={(event) => setWorkspaceDraftName(event.target.value)} />
                  </label>
                  <label>
                    <span>Folder path</span>
                    <input value={workspaceDraftPath} onChange={(event) => setWorkspaceDraftPath(event.target.value)} />
                  </label>
                </div>
                <footer>
                  <button type="button" onClick={() => void chooseProjectWorkspaceFolder()}>Choose folder</button>
                  <button
                    type="button"
                    disabled={!workspaceDraftName.trim() || !workspaceDraftPath.trim()}
                    onClick={async () => {
                      const workspace = await createWorkspaceFromDraft()
                      if (workspace) {
                        setIsWorkspacePickerOpen(false)
                        await updateProjectWorkspace(workspace.id)
                      }
                    }}
                  >
                    Add workspace
                  </button>
                </footer>
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {selectedTask ? (
        <>
          <TaskDetailModal
            taskId={selectedTask.id}
            onClose={closeSelectedTaskDetail}
            onOpenActivity={() => setIsActivityModalOpen(true)}
            onEditTitle={() => {
              setDetailViewMode('task')
              setSelectedSubtaskId(null)
              setTitleDraft(selectedTask.title)
              setIsTitleEditing(true)
            }}
            onDeleteTask={() => void deleteSelectedTask()}
            onFilesDrop={(files) => void uploadTaskAttachments(files)}
            onDownloadZip={() => {
              if (selectedTaskExportContext) void downloadTaskZip(selectedTaskExportContext).catch(() => setError('Unable to export task ZIP'))
            }}
            onDownloadTaskMarkdown={() => {
              if (selectedTaskExportContext) downloadMarkdownFile('Task.md', buildTaskMarkdown(selectedTaskExportContext))
            }}
            onDownloadAgentMarkdown={selectedTaskAgentMarkdown.trim() ? () => downloadMarkdownFile('Agents.md', selectedTaskAgentMarkdown) : undefined}
            onDownloadSkillsMarkdown={selectedTaskSkillsMarkdown.trim() ? () => downloadMarkdownFile('Skills.md', selectedTaskSkillsMarkdown) : undefined}
            onRunCodex={() => void runSelectedTaskWithCodex()}
            isRunCodexBusy={codexRunLaunching}
            isRunCodexDisabled={!canRunSelectedTaskWithCodex}
            onPlanWithCodex={() => void planSelectedTaskWithCodex()}
            isPlanWithCodexBusy={codexPlanLaunching}
            isPlanWithCodexDisabled={!canPlanSelectedTaskWithCodex}
            onImportJson={() => setIsTaskImportOpen(true)}
          >
            <TaskDetailContent
              bodyRef={modalBodyRef}
              splitTemplate={splitTemplate}
              onResizeStart={() => setIsResizingSplit(true)}
              comments={selectedTask.comments ?? []}
              commentDraft={commentDraft}
              editingCommentId={editingCommentId}
              onCommentDraftChange={setCommentDraft}
              onSubmitComment={() => void submitComment()}
              onEditComment={startEditComment}
              onRemoveComment={(comment) => void removeComment(comment)}
              onCancelEditComment={cancelEditComment}
            >
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
                </section>
                {chatOperationFeedback ? <ChatOperationFeedback feedback={chatOperationFeedback} /> : null}

                <section className={styles.detailTop}>
                  <div className={styles.taskTypeRow}>
                    <span className={styles.taskTypePill}>Task</span>
                    <span className={styles.projectContext}>in {project.name}</span>
                  </div>
                  {!isTitleEditing ? (
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
                    <textarea
                      autoFocus
                      ref={resizeTitleTextarea}
                      className={styles.titleInput}
                      value={titleDraft}
                      rows={1}
                      onInput={(event) => resizeTitleTextarea(event.currentTarget)}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => void saveTitle()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          void saveTitle()
                        }
                        if (event.key === 'Escape') {
                          setTitleDraft(selectedTask.title)
                          setIsTitleEditing(false)
                        }
                      }}
                    />
                  )}
                  <div className={styles.aiHint}>Add description, write summary or find related tasks</div>
                  <div className={styles.topControlGrid}>
                    <div
                      className={`${styles.topControlBlock} ${styles.topControlCard} ${styles.statusControlCard}`}
                      style={{ '--status-accent': resolveColumnByStatus(selectedTask.status).accent } as CSSProperties}
                    >
                      <span className={styles.metaLabel}>Status</span>
                      <AppSelect
                        mode="single"
                        variant="borderless"
                        className={styles.statusInlineSelect}
                        value={{
                          value: selectedTask.status,
                          label: resolveColumnByStatus(selectedTask.status).title,
                          color: resolveColumnByStatus(selectedTask.status).accent
                        }}
                        options={statusColumns.map((column) => ({ value: column.status, label: column.title, color: column.accent }))}
                        onChange={(option) => {
                          if (!Array.isArray(option) && option?.value) void updateTaskStatus(selectedTask.id, option.value as TaskEntity['status'])
                        }}
                      />
                    </div>
                    <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
                      <span className={styles.metaLabel}>Tags (shared)</span>
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
                  </div>
                </section>

                <section className={styles.drawerSection}>
                  <h4>Description</h4>
                  <MarkdownDescriptionEditor
                    value={descriptionDraft}
                    className={`${styles.descriptionField} ${isDescriptionEditing ? styles.editingField : ''}`}
                    minHeight={220}
                    placeholder="Add description, notes, checklists or code..."
                    status={isDescriptionSaving ? 'saving' : isDescriptionEditing ? 'dirty' : 'idle'}
                    enableDataFormatCommands
                    dataFormats={outputFormats}
                    onCreateDataFormat={createDescriptionDataFormat}
                    onChange={(nextValue) => {
                      setIsDescriptionEditing(true)
                      setDescriptionDraft(nextValue)
                    }}
                    onCommit={() => {
                      if (isDescriptionEditing) {
                        void saveDescription()
                      }
                    }}
                    onCancel={() => {
                      setDescriptionDraft(selectedTask.description ?? '')
                      setIsDescriptionEditing(false)
                    }}
                  />
                  <div className={styles.fieldStateRow}>
                    {isDescriptionSaving ? <span className={styles.fieldSaving}>Saving...</span> : null}
                    {isDescriptionEditing && !isDescriptionSaving ? <span className={styles.fieldDirty}>Editing</span> : null}
                  </div>
                </section>

                <section className={styles.drawerSection}>
                  {detailViewMode === 'subtask' && selectedSubtask && false ? (
                    <>
                      <div className={styles.tabRow}>
                        <button
                          type="button"
                          className={detailTab === 'details' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('details')}
                        >
                          <LuSettings2 size={15} />
                          Details
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'customFields' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('customFields')}
                        >
                          <LuSlidersHorizontal size={15} />
                          Custom fields
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
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className={styles.tabRow}>
                        <button
                          type="button"
                          className={detailTab === 'subtasks' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('subtasks')}
                        >
                          <LuListTodo size={15} />
                          Subtasks
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'customFields' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('customFields')}
                        >
                          <LuSlidersHorizontal size={15} />
                          Custom fields
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'checklist' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('checklist')}
                        >
                          <LuListChecks size={15} />
                          Checklist
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'attachments' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('attachments')}
                        >
                          <LuPaperclip size={15} />
                          Attachments
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'agent' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('agent')}
                        >
                          <LuBot size={15} />
                          Agent
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'skills' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('skills')}
                        >
                          <LuSparkles size={15} />
                          Skills
                        </button>
                        <button
                          type="button"
                          className={detailTab === 'model' ? styles.tabActive : styles.tabBtn}
                          onClick={() => setDetailTab('model')}
                        >
                          <LuSettings2 size={15} />
                          Model
                        </button>
                      </div>
                      {detailTab === 'subtasks' ? (
                        <>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Subtasks</h4>
                              <p>
                                {(selectedTask.subtasks ?? []).filter((item) => completedStatusIds.has(item.status)).length} completed /{' '}
                                {(selectedTask.subtasks ?? []).length} total
                              </p>
                            </div>
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
                          <div className={styles.tabCtaCard}>
                            <div>
                              <strong>Add subtask</strong>
                              <span>Create a child task and keep this list organized.</span>
                            </div>
                            <button type="button" className={styles.tabActionButton} onClick={() => setIsAddSubtaskOpen(true)}>
                              <LuPlus size={15} />
                              Add subtask
                            </button>
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
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        scheduleOpenSubtaskDetail(subtask.id)
                                      }}
                                      onDoubleClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        startSubtaskRename(subtask)
                                      }}
                                    >
                                      {subtask.title}
                                    </span>
                                  )}
                                </label>
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
                          <div className={styles.tabCtaCard}>
                            <div>
                              <strong>Add custom field</strong>
                              <span>Attach a field value to this task.</span>
                            </div>
                            <button type="button" className={styles.tabActionButton} onClick={openCustomFieldModal}>
                              <LuPlus size={15} />
                              Add custom field
                            </button>
                          </div>
                          <div className={styles.customFieldPanel}>
                            {customFieldError ? <p className={styles.customFieldError}>{customFieldError}</p> : null}
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
                            <div className={styles.tabCtaCard}>
                              <div>
                                <strong>Add checklist item</strong>
                                <span>Add multiple checklist items in one flow.</span>
                              </div>
                              <button type="button" className={styles.tabActionButton} onClick={openChecklistModal}>
                                <LuPlus size={15} />
                                Add checklist item
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
                      ) : detailTab === 'attachments' ? (
                        <>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Attachments</h4>
                              <p>{taskAttachmentRows.length} files</p>
                            </div>
                          </div>
                          <AttachmentTable
                            rows={taskAttachmentRows}
                            uploading={isAttachmentUploading}
                            onUpload={(files) => void uploadTaskAttachments(files)}
                            onRemove={(row) => void removeTaskAttachment(row)}
                            onError={setError}
                          />
                        </>
                      ) : detailTab === 'agent' ? (
                        <>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Agent</h4>
                              <p>{selectedTaskAgent?.name ?? 'Unassigned'}</p>
                            </div>
                          </div>
                          <AgentAssignmentPanel
                            agent={selectedTaskAgent}
                            agents={agents}
                            ctaDescription="Choose the agent responsible for this task."
                            onChange={setTaskAgent}
                          />
                        </>
                      ) : detailTab === 'skills' ? (
                        <>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Skills</h4>
                              <p>{selectedTaskSkillOptions.length} selected</p>
                            </div>
                          </div>
                          <SkillsAssignmentPanel
                            selectedSkills={selectedTask?.skills ?? []}
                            skills={skills}
                            source="Task"
                            ctaDescription="Select one or more skills needed for this task."
                            onChange={setTaskSkills}
                          />
                        </>
                      ) : detailTab === 'model' ? (
                        <>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <h4>Model</h4>
                              <p>{taskCodexModel(selectedTask) || `Project default: ${savedCodexSettings.defaultModel ?? 'Not configured'}`}</p>
                            </div>
                          </div>
                          {!savedCodexSettings.gatewayId || !savedCodexSettings.defaultModel ? (
                            <div className={styles.tabCtaCard}>
                              <div>
                                <strong>Project Codex settings required</strong>
                                <span>Configure a gateway and default model in Project settings first.</span>
                              </div>
                              <button type="button" className={styles.tabActionButton} onClick={() => { setIsStatusEditorOpen(true); setProjectSettingsTab('codex') }}>
                                Open settings
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className={styles.codexSummaryCard}>
                                <div>
                                  <span>Gateway</span>
                                  <strong>{selectedTaskGatewayId ? effectiveTaskGateway?.name ?? selectedTaskGatewayId : `Project default: ${selectedCodexGateway?.name ?? savedCodexSettings.gatewayId}`}</strong>
                                </div>
                                <div>
                                  <span>Model</span>
                                  <strong>{taskCodexModel(selectedTask) || `Project default: ${savedCodexSettings.defaultModel}`}</strong>
                                </div>
                              </div>
                              <div className={styles.settingsFormGrid}>
                                <label>
                                  <span>Task gateway</span>
                                  <AppSelect
                                    value={selectedTaskGatewayOption}
                                    options={codexGatewayOptions}
                                    placeholder={`Use project default gateway: ${selectedCodexGateway?.name ?? savedCodexSettings.gatewayId}`}
                                    isClearable
                                    onChange={(option) => {
                                      const nextGatewayId = option?.value ?? ''
                                      const nextGateway = gateways.find((gateway) => gateway.id === (nextGatewayId || savedCodexSettings.gatewayId))
                                      const models = codexConfigOf(nextGateway).models ?? []
                                      const currentModel = taskCodexModel(selectedTask)
                                      void setTaskCodexSelection({
                                        gatewayId: nextGatewayId || null,
                                        model: currentModel && models.some((model) => model.id === currentModel) ? currentModel : null
                                      })
                                    }}
                                  />
                                </label>
                                <label>
                                  <span>Task model</span>
                                  <AppSelect
                                    value={selectedTaskModelOption}
                                    options={taskModelOptions}
                                    placeholder={`Use project default model: ${savedCodexSettings.defaultModel}`}
                                    isClearable
                                    isDisabled={taskModelOptions.length === 0}
                                    onChange={(option) => void setTaskCodexSelection({ model: option?.value ?? null })}
                                  />
                                </label>
                              </div>
                            </>
                          )}
                        </>
                      ) : null}
                    </>
                  )}
                </section>

                <section className={styles.drawerSection}>
                  <h4>Dependencies</h4>
                  <p>No dependencies.</p>
                </section>
              </div>

          </TaskDetailContent>
        </TaskDetailModal>

        {selectedSubtask && detailViewMode === 'subtask' ? (
          <TaskDetailModal
            taskId={selectedSubtask.id}
            title="Subtask detail"
            nested
            hideTaskActions
            onClose={() => {
              setSelectedSubtaskId(null)
              setDetailViewMode('task')
              setDetailTab('subtasks')
              setCustomFieldError(null)
            }}
            onOpenActivity={() => undefined}
            onEditTitle={() => {
              setEditingSubtaskId(selectedSubtask.id)
              setSubtaskDraft(selectedSubtask.title)
            }}
            onDeleteTask={() => void removeSubtask(selectedSubtask.id)}
            onFilesDrop={(files) => void uploadSubtaskAttachments(files)}
          >
            <TaskDetailContent
              bodyRef={modalBodyRef}
              splitTemplate={splitTemplate}
              onResizeStart={() => setIsResizingSplit(true)}
              comments={getSubtaskComments(selectedSubtask)}
              commentDraft={subtaskCommentDraft}
              editingCommentId={editingSubtaskCommentId}
              commentPlaceholder={editingSubtaskCommentId ? 'Edit subtask comment...' : 'Write a subtask comment...'}
              onCommentDraftChange={setSubtaskCommentDraft}
              onSubmitComment={() => void submitSubtaskComment()}
              onEditComment={startEditSubtaskComment}
              onRemoveComment={(comment) => void removeSubtaskComment(comment)}
              onCancelEditComment={cancelEditSubtaskComment}
            >
            <div className={styles.subtaskModalBody}>
              <div className={styles.detailPane}>
                <section className={styles.breadcrumbRow}>
                  <button
                    type="button"
                    className={styles.breadcrumbBtn}
                    onClick={() => {
                      setSelectedSubtaskId(null)
                      setDetailViewMode('task')
                      setDetailTab('subtasks')
                    }}
                  >
                    {selectedTask.title}
                  </button>
                  <span className={styles.breadcrumbSep}>&gt;</span>
                  <button type="button" className={styles.breadcrumbBtnActive}>{selectedSubtask.title}</button>
                </section>
                <section className={styles.detailTop}>
                  <div className={styles.taskTypeRow}>
                    <span className={styles.taskTypePill}>Subtask</span>
                    <span className={styles.projectContext}>in {selectedTask.title}</span>
                  </div>
                  {editingSubtaskId === selectedSubtask.id ? (
                    <textarea
                      autoFocus
                      ref={resizeTitleTextarea}
                      className={styles.titleInput}
                      value={subtaskDraft}
                      rows={1}
                      onInput={(event) => resizeTitleTextarea(event.currentTarget)}
                      onChange={(event) => setSubtaskDraft(event.target.value)}
                      onBlur={() => void saveSubtaskTitle()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
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
                    <h3
                      className={styles.detailTitle}
                      onClick={() => {
                        setEditingSubtaskId(selectedSubtask.id)
                        setSubtaskDraft(selectedSubtask.title)
                      }}
                    >
                      {selectedSubtask.title}
                    </h3>
                  )}
                  <div className={styles.topControlGrid}>
                    <div
                      className={`${styles.topControlBlock} ${styles.topControlCard} ${styles.statusControlCard}`}
                      style={{ '--status-accent': resolveColumnByStatus(selectedSubtask.status).accent } as CSSProperties}
                    >
                      <span className={styles.metaLabel}>Status</span>
                      <AppSelect
                        mode="single"
                        variant="borderless"
                        className={styles.statusInlineSelect}
                        value={{
                          value: selectedSubtask.status,
                          label: resolveColumnByStatus(selectedSubtask.status).title,
                          color: resolveColumnByStatus(selectedSubtask.status).accent
                        }}
                        options={statusColumns.map((column) => ({ value: column.status, label: column.title, color: column.accent }))}
                        onChange={(option) => {
                          if (!Array.isArray(option) && option?.value) void updateSubtaskStatus(selectedSubtask, option.value as TaskSubtask['status'])
                        }}
                      />
                    </div>
                    <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
                      <span className={styles.metaLabel}>Tags</span>
                      <AppSelect
                        mode="multi"
                        creatable
                        variant="borderless"
                        className={styles.tagInlineSelect}
                        value={selectedSubtaskTagOptions}
                        options={availableTagOptions}
                        onChange={(nextValue) => void setSubtaskTags(nextValue.map((item) => item.value))}
                        onCreateOption={(value) => void createTagAndAttachToSubtask(value)}
                        placeholder="Search or add tags..."
                      />
                    </div>
                  </div>
                </section>
                <section className={styles.drawerSection}>
                  <div className={styles.detailSectionHeader}>
                    <div>
                      <h4>Description</h4>
                      <p>{isSubtaskDescriptionSaving ? 'Saving...' : isDescriptionEditing ? 'Editing' : 'Ready'}</p>
                    </div>
                  </div>
                  <MarkdownDescriptionEditor
                    value={subtaskDescriptionDraft}
                    className={`${styles.descriptionField} ${isDescriptionEditing ? styles.editingField : ''}`}
                    minHeight={220}
                    placeholder="Add subtask description, notes, checklists or code..."
                    status={isSubtaskDescriptionSaving ? 'saving' : isDescriptionEditing ? 'dirty' : 'idle'}
                    enableDataFormatCommands
                    dataFormats={outputFormats}
                    onCreateDataFormat={createDescriptionDataFormat}
                    onChange={(nextValue) => {
                      setIsDescriptionEditing(true)
                      setSubtaskDescriptionDraft(nextValue)
                    }}
                    onCommit={() => {
                      if (isDescriptionEditing) void saveSubtaskDetail()
                    }}
                    onCancel={() => {
                      setSubtaskDescriptionDraft(getSubtaskDescription(selectedSubtask))
                      setIsDescriptionEditing(false)
                    }}
                  />
                </section>
                <section className={styles.drawerSection}>
                  <div className={styles.tabRow}>
                    <button type="button" className={detailTab === 'agent' ? styles.tabActive : styles.tabBtn} onClick={() => setDetailTab('agent')}><LuBot size={15} />Agent</button>
                    <button type="button" className={detailTab === 'skills' ? styles.tabActive : styles.tabBtn} onClick={() => setDetailTab('skills')}><LuSparkles size={15} />Skills</button>
                    <button type="button" className={detailTab === 'customFields' ? styles.tabActive : styles.tabBtn} onClick={() => setDetailTab('customFields')}><LuSlidersHorizontal size={15} />Custom fields</button>
                    <button type="button" className={detailTab === 'attachments' ? styles.tabActive : styles.tabBtn} onClick={() => setDetailTab('attachments')}><LuPaperclip size={15} />Attachments</button>
                  </div>
                  {detailTab === 'agent' ? (
                    <>
                      <div className={styles.detailSectionHeader}>
                        <div>
                          <h4>Agent</h4>
                          <p>{selectedSubtaskAgent?.name ?? 'Unassigned'}</p>
                        </div>
                      </div>
                      <AgentAssignmentPanel
                        agent={selectedSubtaskAgent}
                        agents={agents}
                        ctaDescription="Choose the agent responsible for this subtask."
                        onChange={setSubtaskAgent}
                      />
                    </>
                  ) : detailTab === 'skills' ? (
                    <>
                      <div className={styles.detailSectionHeader}>
                        <div>
                          <h4>Skills</h4>
                          <p>{selectedSubtaskSkillOptions.length} selected</p>
                        </div>
                      </div>
                      <SkillsAssignmentPanel
                        selectedSkills={selectedSubtaskSkills}
                        skills={skills}
                        source="Subtask"
                        ctaDescription="Select one or more skills needed for this subtask."
                        onChange={setSubtaskSkills}
                      />
                    </>
                  ) : detailTab === 'customFields' ? (
                    <div className={styles.subtaskCustomFields}>
                      <div className={styles.detailSectionHeader}>
                        <div>
                          <h4>Custom fields</h4>
                          <p>{assignedSubtaskCustomFieldValues.length} assigned</p>
                        </div>
                      </div>
                      <div className={styles.tabCtaCard}>
                        <div>
                          <strong>Add custom field</strong>
                          <span>Attach a field value to this subtask.</span>
                        </div>
                        <button type="button" className={styles.tabActionButton} onClick={openCustomFieldModal}>
                          <LuPlus size={15} />
                          Add custom field
                        </button>
                      </div>
                      <div className={styles.customFieldPanel}>
                        {customFieldError ? <p className={styles.customFieldError}>{customFieldError}</p> : null}
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
                                  <button type="button" aria-label={`Remove ${field.name}`} onClick={() => void removeCustomFieldValue(field.id)}>
                                    <LuTrash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className={styles.customFieldEmpty}>No custom fields on this subtask.</p>
                        )}
                      </div>
                    </div>
                  ) : detailTab === 'attachments' ? (
                    <>
                      <div className={styles.detailSectionHeader}>
                        <div>
                          <h4>Attachments</h4>
                          <p>{subtaskAttachmentRows.length} files</p>
                        </div>
                      </div>
                      <AttachmentTable
                        rows={subtaskAttachmentRows}
                        uploading={isAttachmentUploading}
                        onUpload={(files) => void uploadSubtaskAttachments(files)}
                        onRemove={(row) => void removeSubtaskAttachment(row)}
                        onError={setError}
                      />
                    </>
                  ) : null}
                </section>
              </div>
            </div>
            </TaskDetailContent>
          </TaskDetailModal>
        ) : null}

          <TaskJsonImportModal
            open={isTaskImportOpen}
            title="Import task JSON"
            busy={isTaskImporting}
            onClose={() => setIsTaskImportOpen(false)}
            onImport={(jsonText) => void importSelectedTaskJson(jsonText)}
          />

          {isCustomFieldModalOpen ? (
            <>
              <div className={styles.createTaskBackdrop} onClick={() => setIsCustomFieldModalOpen(false)} />
              <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add custom field">
                <header className={styles.createTaskHeader}>
                  <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Custom field</span></div>
                  <button type="button" onClick={() => setIsCustomFieldModalOpen(false)} aria-label="Close custom field modal"><LuX size={17} /></button>
                </header>
                <div className={styles.createTaskBody}>
                  {customFieldError ? <p className={styles.customFieldError}>{customFieldError}</p> : null}
                  <div className={styles.multiAddList}>
                    {customFieldRows.map((row, index) => {
                      const field = customFields.find((item) => item.id === row.field?.value)
                      const assignedIds = detailViewMode === 'subtask' && selectedSubtask
                        ? new Set(Object.keys(getSubtaskCustomFieldValues(selectedSubtask)))
                        : new Set(Object.keys(selectedTask?.customFieldValues ?? {}))
                      const selectedOtherIds = new Set(customFieldRows.filter((entry) => entry.id !== row.id && entry.field).map((entry) => entry.field?.value ?? ''))
                      const rowOptions = customFields
                        .filter((item) => !assignedIds.has(item.id) && !selectedOtherIds.has(item.id))
                        .map((item) => ({ value: item.id, label: item.name }))
                      return (
                        <div key={row.id} className={styles.multiCustomFieldRow}>
                          <span>{index + 1}</span>
                          <div className={styles.multiCustomFieldMain}>
                            <label className={styles.multiCustomFieldControl}>
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
                            <label className={styles.multiCustomFieldControl}>
                              <span>
                                Value
                                {field ? <em>{field.type}</em> : null}
                              </span>
                              {field?.type === 'boolean' ? (
                                <select
                                  value={row.value || 'false'}
                                  onChange={(event) => setCustomFieldRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}
                                >
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
                          <button
                            type="button"
                            onClick={() => setCustomFieldRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), field: null, value: '' }])}
                            aria-label="Remove custom field row"
                          >
                            <LuTrash2 size={14} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <div className={styles.modalInlineActions}>
                    <button type="button" className={styles.modalAddRowButton} onClick={() => setCustomFieldRows((current) => [...current, { id: createLocalId(), field: null, value: '' }])}>
                      <LuPlus size={15} />
                      Add row
                    </button>
                    <button
                      type="button"
                      className={styles.modalAddRowButton}
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
                  <footer className={styles.modalFooterActions}>
                    <button type="button" onClick={() => setIsCustomFieldModalOpen(false)}>Cancel</button>
                    <button type="button" className={styles.primaryModalAction} onClick={() => void saveCustomFieldRows()}>Save all</button>
                  </footer>
                  {isCreateCustomFieldOpen ? (
                    <>
                      <div className={styles.nestedCreateBackdrop} onClick={() => setIsCreateCustomFieldOpen(false)} />
                      <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new custom field">
                        <header>
                          <h4>Add new custom field</h4>
                          <button type="button" onClick={() => setIsCreateCustomFieldOpen(false)} aria-label="Close custom field create popup"><LuX size={15} /></button>
                        </header>
                        <div className={styles.nestedCreateBody}>
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
              <div className={styles.createTaskBackdrop} onClick={() => setIsChecklistModalOpen(false)} />
              <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add checklist items">
                <header className={styles.createTaskHeader}>
                  <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Checklist</span></div>
                  <button type="button" onClick={() => setIsChecklistModalOpen(false)} aria-label="Close checklist modal"><LuX size={17} /></button>
                </header>
                <form className={styles.createTaskBody} onSubmit={(event) => {
                  event.preventDefault()
                  void addChecklistItems()
                }}>
                  <div className={styles.multiAddList}>
                    {checklistRows.map((row, index) => (
                      <div key={row.id} className={styles.multiAddRow}>
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
                        <button
                          type="button"
                          onClick={() => setChecklistRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), title: '' }])}
                          aria-label="Remove checklist row"
                        >
                          <LuTrash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className={styles.modalAddRowButton} onClick={() => setChecklistRows((current) => [...current, { id: createLocalId(), title: '' }])}>
                    <LuPlus size={15} />
                    Add row
                  </button>
                  <footer className={styles.createTaskFooter}>
                    <span>Enter adds another row.</span>
                    <button type="submit" disabled={!checklistRows.some((row) => row.title.trim())}>Save all</button>
                  </footer>
                </form>
              </section>
            </>
          ) : null}

          {isOutputFormatModalOpen ? (
            <>
              <div className={styles.createTaskBackdrop} onClick={() => setIsOutputFormatModalOpen(false)} />
              <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Set data format">
                <header className={styles.createTaskHeader}>
                  <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>{dataFormatRoleDraft === 'input' ? 'Input data format' : 'Output data format'}</span></div>
                  <button type="button" onClick={() => setIsOutputFormatModalOpen(false)} aria-label="Close data format modal"><LuX size={17} /></button>
                </header>
                <div className={styles.createTaskBody}>
                  <div className={styles.modalField}>
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
                  <div className={styles.modalInlineActions}>
                    <button
                      type="button"
                      className={styles.modalAddRowButton}
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
                  <footer className={styles.modalFooterActions}>
                    <button type="button" onClick={() => setIsOutputFormatModalOpen(false)}>Cancel</button>
                    <button type="button" className={styles.primaryModalAction} onClick={() => void saveTaskOutputFormatFromModal()}>Save</button>
                  </footer>
                  {isCreateOutputFormatOpen ? (
                    <>
                      <div className={styles.nestedCreateBackdrop} onClick={() => setIsCreateOutputFormatOpen(false)} />
                      <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new data format">
                        <header>
                          <h4>Add new data format</h4>
                          <button type="button" onClick={() => setIsCreateOutputFormatOpen(false)} aria-label="Close data format create popup"><LuX size={15} /></button>
                        </header>
                        <div className={styles.nestedCreateBody}>
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

          {isActivityModalOpen ? (
            <>
              <div className={styles.activityBackdrop} onClick={() => setIsActivityModalOpen(false)} />
              <section
                className={`${styles.modalShell} ${styles.activityModalShell}`}
                role="dialog"
                aria-modal="true"
                aria-label="Codex chat"
                onDragEnter={handleChatDragEnter}
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
              >
                {chatDragDepth > 0 ? (
                  <div className={styles.chatDropOverlay}>
                    <LuCloudUpload size={30} />
                    <strong>Drop files to attach</strong>
                    <span>They will be sent with your next Codex message.</span>
                  </div>
                ) : null}
                <aside className={styles.chatSidebar}>
                  <div className={styles.chatBrand}>
                    <span className={styles.chatBrandIcon}><LuMessageSquare size={17} /></span>
                    <strong>Chat</strong>
                    <span>{selectedTask?.title ?? 'Task'}</span>
                  </div>
                  <button
                    type="button"
                    className={`${styles.chatNewConversationButton} ${isStartingNewChat ? styles.chatConversationActive : ''}`}
                    onClick={() => {
                      setIsStartingNewChat(true)
                      setSelectedChatConversationId('')
                      setChatComposerMode('chat')
                      setCodexRunFeedback(null)
                      setTimeout(() => chatDraftTextareaRef.current?.focus(), 0)
                    }}
                  >
                    <span>
                      <span><LuPlus size={14} /> New follow-up</span>
                      <b className={styles.chatStatusBadge}>New</b>
                    </span>
                    <small>Start a separate Follow-up thread</small>
                  </button>
                  {sidebarChatConversations.map((conversation) => (
                    <button
                      type="button"
                      key={conversation.id}
                      className={selectedChatConversationId === conversation.id ? styles.chatConversationActive : ''}
                      onClick={() => {
                        setIsStartingNewChat(false)
                        setSelectedChatConversationId(conversation.id)
                      }}
                    >
                      <span>
                        {conversation.title}
                        <b className={`${styles.chatStatusBadge} ${styles[`chatStatus_${conversation.status}`] ?? ''}`}>
                          {runningChatConversationIds.has(conversation.id) ? (
                            <em className={styles.chatSidebarLoader} aria-label="Codex chat is running">
                              <i /><i /><i />
                            </em>
                          ) : conversation.status}
                        </b>
                      </span>
                      <small>{conversation.count} messages · {formatChatTime(conversation.at)}</small>
                      {conversation.model ? <small>{conversation.model}</small> : null}
                    </button>
                  ))}
                  {chatConversations.length > sidebarChatConversations.length ? (
                    <p>{chatConversations.length - sidebarChatConversations.length} older conversations hidden for performance.</p>
                  ) : null}
                  {chatConversations.length === 0 ? <p>No Codex conversations yet.</p> : null}
                  {chatHistoryCount > 0 ? (
                    <div className={styles.chatHistoryNote}>
                      <span>Task history</span>
                      <b>{chatHistoryCount}</b>
                    </div>
                  ) : null}
                </aside>
                <main className={styles.chatMain}>
                  <header className={styles.chatTopbar}>
                    <div className={styles.chatTopbarTitle}>
                      <h2>Chat</h2>
                      <p title={selectedTask?.title ?? 'Task'}>{selectedTask?.title ?? 'Task'}</p>
                    </div>
                    <div className={styles.chatTopbarActions}>
                      <button type="button" onClick={() => setChatSettingsOpen((value) => !value)} className={`${styles.chatIconAction} ${chatSettingsOpen ? styles.chatActionActive : ''}`} aria-label="Chat settings" title="Chat settings"><LuSettings2 size={16} /></button>
                      {selectedChatCanStop ? (
                        <button type="button" onClick={() => void stopCodexChat()} disabled={chatStopping} className={`${styles.chatIconAction} ${styles.chatStopAction}`} aria-label="Stop Codex chat" title="Stop Codex chat"><LuCircleStop size={16} /></button>
                      ) : null}
                      <button type="button" onClick={() => void planSelectedTaskWithCodex()} disabled={codexPlanLaunching} className={styles.chatIconAction} aria-label={codexPlanLaunching ? 'Planning with Codex' : 'Plan with Codex'} title={codexPlanLaunching ? 'Planning with Codex' : 'Plan with Codex'}><LuSparkles size={16} /></button>
                      <button type="button" onClick={() => void runSelectedTaskWithCodex()} disabled={codexRunLaunching} className={styles.chatIconAction} aria-label={codexRunLaunching ? 'Running with Codex' : 'Run with Codex'} title={codexRunLaunching ? 'Running with Codex' : 'Run with Codex'}><LuPlay size={16} /></button>
                      <button type="button" onClick={() => setIsActivityModalOpen(false)} aria-label="Close chat" title="Close chat" className={styles.chatIconAction}>
                        <LuX size={16} />
                      </button>
                    </div>
                  </header>
                  <div className={styles.chatWorkspace}>
                    <div className={styles.chatTranscript} ref={activityFeedRef} onScroll={onActivityScroll}>
                      {visibleChatMessages.length > 0 ? (
                        <div className={styles.chatMessageList}>
                          {hiddenChatMessageCount > 0 ? (
                            <button
                              type="button"
                              className={styles.chatLoadEarlierButton}
                              onClick={() => setChatVisibleLimit((value) => value + CHAT_MESSAGE_LOAD_STEP)}
                            >
                              Load {Math.min(CHAT_MESSAGE_LOAD_STEP, hiddenChatMessageCount)} earlier messages
                            </button>
                          ) : null}
                          {renderedChatMessages
                            .filter((message) => !(message.role === 'system' && /^Started Codex/i.test(message.body)))
                            .map((message) => <CodexChatMessageItem key={message.id} message={message} />)}
                        </div>
                      ) : (
                        <div className={styles.chatEmptyState}>
                          <LuMessageSquare size={28} />
                          <h3>Start a Codex chat for this task</h3>
                          <p>Use Plan, Run, or send a follow-up message. Codex messages will appear here as a transcript.</p>
                          <div>
                            <button type="button" onClick={() => void planSelectedTaskWithCodex()} disabled={codexPlanLaunching}><LuSparkles size={15} /> Plan</button>
                            <button type="button" onClick={() => void runSelectedTaskWithCodex()} disabled={codexRunLaunching}><LuPlay size={15} /> Run</button>
                            {(!chatGateway || !chatModel) ? <button type="button" onClick={() => setChatSettingsOpen(true)}><LuSettings2 size={15} /> Configure</button> : null}
                          </div>
                        </div>
                      )}
                    </div>
                    {chatSettingsOpen ? (
                      <aside className={styles.chatSettingsPanel}>
                        <div className={styles.chatSettingsHeader}>
                          <div>
                            <span>Codex</span>
                            <h3>Run settings</h3>
                          </div>
                          <button type="button" onClick={() => setChatSettingsOpen(false)} aria-label="Close run settings" title="Close">
                            <LuX size={15} />
                          </button>
                        </div>
                        <div className={styles.chatSettingsCard}>
                          <div className={styles.chatSettingTitle}>
                            <span><LuSignal size={14} /></span>
                            <div>
                              <b>Gateway</b>
                              <small>{chatGateway?.name ?? 'Select a gateway'}</small>
                            </div>
                          </div>
                          <AppSelect
                            mode="single"
                            value={chatGatewayOption}
                            options={codexGatewayOptions}
                            onChange={(option) => {
                              if (Array.isArray(option)) return
                              setChatGatewayId(option?.value ?? '')
                              setChatModel('')
                            }}
                            placeholder="Select gateway"
                          />
                        </div>
                        <div className={styles.chatSettingsCard}>
                          <div className={styles.chatSettingTitle}>
                            <span><LuBot size={14} /></span>
                            <div>
                              <b>Model</b>
                              <small>{chatModel || 'Select a model'}</small>
                            </div>
                          </div>
                          <AppSelect
                            mode="single"
                            value={chatModelOption}
                            options={chatModelOptions}
                            onChange={(option) => {
                              if (Array.isArray(option)) return
                              setChatModel(option?.value ?? '')
                            }}
                            placeholder="Select model"
                            isDisabled={!chatGatewayId}
                          />
                        </div>
                        <div className={styles.chatSettingsMetaGrid}>
                          <div className={styles.chatSettingReadout}>
                            <span>Mode</span>
                            <b>{chatGatewayConfig.executionMode === 'exec' ? 'Exec' : 'Terminal'}</b>
                          </div>
                          <div className={styles.chatSettingReadout}>
                            <span>Workspace</span>
                            <b>{chatRuntimeWorkspace?.name ?? savedCodexSettings.runtimeWorkspaceId ?? 'Not configured'}</b>
                          </div>
                        </div>
                        <label className={styles.chatSettingsToggle}>
                          <input type="checkbox" checked={chatIncludeContext} onChange={(event) => setChatIncludeContext(event.target.checked)} />
                          <span>
                            <b>Task context</b>
                            <small>Include current task details in the next run.</small>
                          </span>
                        </label>
                      </aside>
                    ) : null}
                  </div>
                  <footer className={styles.chatComposer}>
                    {chatAttachments.length > 0 ? (
                      <div className={styles.chatAttachmentChips}>
                        {chatAttachments.map((attachment) => (
                          <span key={attachment.id}>
                            <LuPaperclip size={13} />
                            <span className={styles.chatAttachmentName}>{attachment.name}</span>
                            <button type="button" onClick={() => setChatAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.name}`}>
                              <LuX size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className={styles.chatComposerFrame}>
                      {slashMenuOpen && filteredSlashCommands.length > 0 ? (
                        <div className={styles.slashCommandMenu} role="listbox" aria-label="Slash commands">
                          {filteredSlashCommands.map((command, index) => (
                            <button
                              key={command.id}
                              type="button"
                              className={index === slashCommandIndex ? styles.slashCommandActive : ''}
                              onMouseDown={(event) => {
                                event.preventDefault()
                                applySlashCommand(command)
                              }}
                              role="option"
                              aria-selected={index === slashCommandIndex}
                            >
                              <span>{command.label}</span>
                              <small>{command.hint}</small>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className={styles.chatComposerBox}>
                        <textarea
                          ref={chatDraftTextareaRef}
                          value={chatDraft}
                          onChange={(event) => {
                            setChatDraft(event.target.value)
                            resizeChatComposerTextarea(event.currentTarget)
                          }}
                          onFocus={() => setChatComposerFocused(true)}
                          onBlur={() => setChatComposerFocused(false)}
                          placeholder="Message Codex or type / for commands..."
                          onKeyDown={(event) => {
                            if (slashMenuOpen && filteredSlashCommands.length > 0) {
                              if (event.key === 'ArrowDown') {
                                event.preventDefault()
                                setSlashCommandIndex((value) => (value + 1) % filteredSlashCommands.length)
                                return
                              }
                              if (event.key === 'ArrowUp') {
                                event.preventDefault()
                                setSlashCommandIndex((value) => (value - 1 + filteredSlashCommands.length) % filteredSlashCommands.length)
                                return
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, ''))
                                return
                              }
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                applySlashCommand(filteredSlashCommands[slashCommandIndex] ?? filteredSlashCommands[0])
                                return
                              }
                            }
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              void sendCodexChatMessage()
                            }
                          }}
                        />
                        <button type="button" className={styles.chatAttachButton} onClick={() => chatFileInputRef.current?.click()} aria-label="Attach files">
                          <LuPaperclip size={16} />
                        </button>
                        <input
                          ref={chatFileInputRef}
                          type="file"
                          multiple
                          hidden
                          onChange={(event) => {
                            if (event.currentTarget.files) void addChatAttachments(event.currentTarget.files)
                          }}
                        />
                        <button
                          type="button"
                          className={selectedChatCanStop ? styles.chatStopButton : ''}
                          onClick={() => void (selectedChatCanStop ? stopCodexChat() : sendCodexChatMessage())}
                          disabled={chatSending || chatStopping || (!selectedChatCanStop && (!canSendChat || selectedChatIsRunning))}
                          aria-label={selectedChatCanStop ? 'Stop Codex chat' : 'Send message'}
                          title={selectedChatCanStop ? 'Stop' : 'Send'}
                        >
                          {selectedChatCanStop ? <LuCircleStop size={17} /> : chatSending ? <span className={styles.thinkingDots}><i /><i /><i /></span> : <LuSend size={16} />}
                        </button>
                      </div>
                    </div>
                    <div className={styles.chatComposerRail}>
                      {chatOperationFeedback ? <ChatOperationFeedback feedback={chatOperationFeedback} /> : null}
                      <div className={styles.chatPillRow}>
                        <span className={!chatGateway ? styles.chatPillWarning : ''}>
                          <small>Gateway</small>
                          <b title={chatGateway?.name ?? 'Gateway required'}>{chatGateway?.name ?? 'Gateway required'}</b>
                        </span>
                        <span className={!chatModel ? styles.chatPillWarning : ''}>
                          <small>Model</small>
                          <b title={chatModel || 'Model required'}>{chatModel || 'Model required'}</b>
                        </span>
                        <span>
                          <small>Mode</small>
                          <b>{chatGatewayConfig.executionMode === 'exec' ? 'Exec' : 'Terminal'}</b>
                        </span>
                        <span>
                          <small>Workspace</small>
                          <b title={chatRuntimeWorkspace?.name ?? savedCodexSettings.runtimeWorkspaceId ?? 'Workspace required'}>{chatRuntimeWorkspace?.name ?? savedCodexSettings.runtimeWorkspaceId ?? 'Workspace required'}</b>
                        </span>
                        <span>
                          <small>Session</small>
                          <b>{selectedChatSummary?.status ?? (visibleChatMessages.length ? 'mixed' : 'ready')}</b>
                        </span>
                        <span>
                          <small>Agent</small>
                          <b>{selectedTaskAgent?.name ?? 'Unassigned'}</b>
                        </span>
                        <span>
                          <small>Skills</small>
                          <b>{taskContextSkills.length ? taskContextSkills.slice(0, 3).map((skill) => skill.name).join(', ') : 'None'}</b>
                        </span>
                        {selectedChatUsage ? (
                          <span>
                            <small>Usage</small>
                            <b>{formatUsageSummary(selectedChatUsage)}</b>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </footer>
                </main>
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
