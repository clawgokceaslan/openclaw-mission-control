import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  LuMessageSquare,
  LuPlus
} from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS, type AppNavigateState } from '@shared/contracts/ipc'
import { GATEWAY_REASONING_EFFORT_OPTIONS, DEFAULT_GATEWAY_LANGUAGE, gatewayModelReasoningEfforts, gatewayModelSupportsReasoning } from '@shared/utils/gateway-language'
import { gatewayChatLifecycleStatusKey, gatewayChatPhaseActionLabel, gatewayLifecycleStatusMeta, inferGatewayChatPhase, type GatewayChatPhase } from '@shared/utils/gateway-chat-phase'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { clearRendererDiagnosticContext, setRendererDiagnosticContext } from '@renderer/utils/rendererResilience'
import { Agent, OutputFormat, Project, ProjectGroup, ProjectStatus, Skill, StatusTemplate, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskEntity, TaskJsonImportResult, TaskSubtask, CustomField } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { LoadingState } from '@renderer/components/loading'
import { prefixDataFormatTokens, type DescriptionDataFormat } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { storedAttachmentRows } from '@renderer/components/attachments/AttachmentTable'
import { AttachmentRow, attachmentRowsFromDescription, removeAttachmentFromMarkdown, uploadTaskAttachment } from '@renderer/components/attachments/attachments'
import { ProjectDetailHeader } from '@renderer/components/projects/detail/ProjectDetailHeader'
import { ActiveProjectView } from '@renderer/components/projects/detail/ActiveProjectView'
import { createTaskWithTemplate, type CreateTaskInput } from './detail/createTaskWithTemplate'
import { useProjectDetailData } from './detail/hooks/useProjectDetailData'
import { useProjectChatPopup } from './detail/hooks/useProjectChatPopup'
import { useProjectGatewayFlow } from './detail/hooks/useProjectGatewayFlow'
import { useProjectSelection } from './detail/hooks/useProjectSelection'
import { useProjectDerivedState } from './detail/hooks/useProjectDerivedState'
import { useProjectWorkspaceSettings } from './detail/hooks/useProjectWorkspaceSettings'
import { buildAgentMarkdown, buildSkillsMarkdown, buildTaskImportJson, buildTaskJson, buildTaskMarkdown, buildTaskToon, downloadMarkdownFile, downloadTaskZip, downloadTextFile } from './detail/taskExport'
import { resolveProjectStatusColumn } from './detail/status'
import { useProjectDetailDispatcher, useProjectDetailReducer } from './detail/state/projectDetailState'
import {
  CHAT_INITIAL_MESSAGE_LIMIT
} from './detail/chat/chatUtils'
import {
  activityMessagesFromTask,
  buildGeneratedContextEntries,
  buildLatestGeneratedFollowUpContext,
  formatChatTime,
  appendActivityMessageToTasks
} from './detail/chat/chatUtils'
import {
  codexConfigOf,
  codexPayloadOverride,
  createLocalId,
  customFieldValueToDraft,
  latestActiveTaskGatewayConversation,
  nextStatusTopOrder,
  projectDefaultAgentId,
  projectDefaultSkillIds,
  readTaskGatewayOverride,
  reorderTasksForDrop,
  taskGatewayId,
  taskGatewayRunModel,
  withTaskMeta,
  type TaskDropPosition
} from './detail/projectDetailUtils'
import {
  getSubtaskAgentId,
  getSubtaskAttachments,
  getSubtaskChecklistItems,
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
  ChatComposerMode,
  CustomFieldDraftRow,
  DataFormatRole,
  DetailTab,
  DetailViewMode,
  ProjectPromptTab,
  ProjectSettingsTab,
  TaskHistoryItem,
  TaskActivityMessage,
  TextDraftRow,
  ThreadEntry
} from './detail/types'
import { PlanChoiceModal } from '@renderer/popups/PlanChoiceModal'
import styles from './ProjectDetailPage.module.scss'

const DETAIL_RATIO_KEY = 'omc:task-modal:detail-ratio'
const DEFAULT_DETAIL_RATIO = 0.7
const MIN_DETAIL_WIDTH = 420
const MIN_COMMENTS_WIDTH = 320
const ProjectAnalyticsModal = lazy(() => import('@renderer/components/projects/detail/ProjectAnalyticsModal'))

type ProjectRecentChatRow = {
  id: string
  taskId: string
  taskTitle: string
  conversationId: string
  phase: GatewayChatPhase
  status: TaskActivityMessage['status'] | 'event'
  at: number
  count: number
  model?: string
  preview: string
}

function projectRecentChatStatusMeta(row: ProjectRecentChatRow) {
  const active = row.status === 'running' || row.status === 'queued'
  return gatewayLifecycleStatusMeta(gatewayChatLifecycleStatusKey(row.phase, row.status, active))
}

function projectRecentChatPreview(value: string, max = 118): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'Mesaj yok'
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function buildProjectRecentChats(tasks: TaskEntity[], limit = 10): ProjectRecentChatRow[] {
  const rows: ProjectRecentChatRow[] = []
  for (const task of tasks) {
    const grouped = new Map<string, {
      last: TaskActivityMessage
      phaseMessage: TaskActivityMessage
      count: number
    }>()

    for (const message of activityMessagesFromTask(task)) {
      const conversationId = message.conversationId || message.runId
      if (!conversationId) continue
      const current = grouped.get(conversationId)
      const createdAt = message.createdAt ?? 0
      const currentLastAt = current?.last ? current.last.createdAt ?? 0 : -1
      const phase = inferGatewayChatPhase(message)
      const shouldReplacePhase = !current || (inferGatewayChatPhase(current.phaseMessage) === 'FOLLOW UP' && phase !== 'FOLLOW UP')
      grouped.set(conversationId, {
        last: !current || createdAt >= currentLastAt ? message : current.last,
        phaseMessage: current && !shouldReplacePhase ? current.phaseMessage : message,
        count: (current?.count ?? 0) + (message.role === 'user' ? 1 : 0)
      })
    }

    grouped.forEach((conversation, conversationId) => {
      const last = conversation.last
      rows.push({
        id: `${task.id}:${conversationId}`,
        taskId: task.id,
        taskTitle: task.title,
        conversationId,
        phase: inferGatewayChatPhase(conversation.phaseMessage),
        status: last.status ?? 'event',
        at: last.updatedAt ?? last.createdAt,
        count: conversation.count,
        model: typeof last.metadata?.model === 'string' ? last.metadata.model : undefined,
        preview: projectRecentChatPreview(last.body)
      })
    })
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit)
}

function resizeTitleTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

function clampRatio(value: number) {
  if (Number.isNaN(value)) return DEFAULT_DETAIL_RATIO
  return Math.max(0.45, Math.min(0.8, value))
}

const DESCRIPTION_AUTOSAVE_DELAY_MS = 5000
const ProjectDetailSettingsPopup = lazy(() => import('@renderer/popups/ProjectDetailSettingsPopup').then((module) => ({ default: module.ProjectDetailSettingsPopup })))
const TaskModals = lazy(() => import('@renderer/components/projects/detail/TaskModals').then((module) => ({ default: module.TaskModals })))
const TaskDetailPopup = lazy(() => import('@renderer/popups/TaskDetail').then((module) => ({ default: module.TaskDetailPopup })))
const ChatPopup = lazy(() => import('@renderer/popups/ChatPopup').then((module) => ({ default: module.ChatPopup })))

function ProjectDetailLazyFallback() {
  return <LoadingState size="compact" message="" />
}

function loadInitialRatio() {
  if (typeof window === 'undefined') return DEFAULT_DETAIL_RATIO
  const saved = window.localStorage.getItem(DETAIL_RATIO_KEY)
  if (!saved) return DEFAULT_DETAIL_RATIO
  return clampRatio(Number(saved))
}

export function ProjectDetailPage() {
  const params = useParams<{ projectId?: string; taskId?: string; subtaskId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const projectId = params.projectId
  const routeTaskId = params.taskId ?? null
  const routeSubtaskId = params.subtaskId ?? null
  const { token, user } = useAuth()
  const [projectDetailRawState, projectDetailDispatch] = useProjectDetailReducer({
    chatVisibleLimit: CHAT_INITIAL_MESSAGE_LIMIT,
    detailRatio: loadInitialRatio()
  })
  const projectDetailState = useProjectDetailDispatcher(projectDetailRawState, projectDetailDispatch)
  const {
    project,
    setProject,
    projectGroups,
    setProjectGroups,
    tasks,
    setTasks,
    agents,
    setAgents,
    gateways,
    setGateways,
    tags,
    setTags,
    skills,
    setSkills,
    customFields,
    setCustomFields,
    outputFormats,
    setOutputFormats,
    taskTemplates,
    setTaskTemplates,
    workspaces,
    setWorkspaces,
    projectStatuses,
    setProjectStatuses,
    statusTemplates,
    setStatusTemplates,
    taskTitle,
    setTaskTitle,
    isCreateTaskOpen,
    setIsCreateTaskOpen,
    isStatusEditorOpen,
    setIsStatusEditorOpen,
    projectSettingsTab,
    setProjectSettingsTab,
    isWorkspacePickerOpen,
    setIsWorkspacePickerOpen,
    isProjectGroupPickerOpen,
    setIsProjectGroupPickerOpen,
    projectGroupNameDraft,
    setProjectGroupNameDraft,
    projectGroupDescriptionDraft,
    setProjectGroupDescriptionDraft,
    projectGroupSaving,
    setProjectGroupSaving,
    projectSyncing,
    setProjectSyncing,
    projectSyncMessage,
    setProjectSyncMessage,
    workspaceDraftName,
    setWorkspaceDraftName,
    workspaceDraftPath,
    setWorkspaceDraftPath,
    movingWorkspace,
    setMovingWorkspace,
    workspaceMoveMessage,
    setWorkspaceMoveMessage,
    isStatusTemplatePickerOpen,
    setIsStatusTemplatePickerOpen,
    pendingStatusTemplate,
    setPendingStatusTemplate,
    projectFolderPreview,
    setProjectFolderPreview,
    isProjectPromptSettingsOpen,
    setIsProjectPromptSettingsOpen,
    projectPromptTab,
    setProjectPromptTab,
    projectPromptContext,
    setProjectPromptContext,
    projectPromptPrompt,
    setProjectPromptPrompt,
    projectPromptPlanGuide,
    setProjectPromptPlanGuide,
    projectPromptOutput,
    setProjectPromptOutput,
    projectPromptRules,
    setProjectPromptRules,
    projectPromptPostRun,
    setProjectPromptPostRun,
    projectPromptError,
    setProjectPromptError,
    isProjectPromptSaving,
    setIsProjectPromptSaving,
    gatewayId,
    setGatewayId,
    gatewayRuntimeWorkspaceId,
    setGatewayRuntimeWorkspaceId,
    gatewayDefaultModel,
    setGatewayDefaultModel,
    gatewayDefaultPlanModel,
    setGatewayDefaultPlanModel,
    gatewayDefaultRunModel,
    setGatewayDefaultRunModel,
    gatewayModelLoading,
    setGatewayModelLoading,
    gatewayModelError,
    setGatewayModelError,
    gatewaySaving,
    setGatewaySaving,
    gatewayRunLaunching,
    setGatewayRunLaunching,
    gatewayPlanLaunching,
    setGatewayPlanLaunching,
    gatewayRunFeedback,
    setGatewayRunFeedback,
    chatDraft,
    setChatDraft,
    chatSending,
    setChatSending,
    chatStopping,
    setChatStopping,
    chatSettingsOpen,
    setChatSettingsOpen,
    chatGatewayId,
    setChatGatewayId,
    chatModel,
    setChatModel,
    chatPlanModel,
    setChatPlanModel,
    chatRunModel,
    setChatRunModel,
    chatPlanReasoningEffort,
    setChatPlanReasoningEffort,
    chatRunReasoningEffort,
    setChatRunReasoningEffort,
    chatIncludeContext,
    setChatIncludeContext,
    chatComposerMode,
    setChatComposerMode,
    chatAttachments,
    setChatAttachments,
    selectedChatConversationId,
    setSelectedChatConversationId,
    isStartingNewChat,
    setIsStartingNewChat,
    chatDragDepth,
    setChatDragDepth,
    slashCommandIndex,
    setSlashCommandIndex,
    chatComposerFocused,
    setChatComposerFocused,
    chatVisibleLimit,
    setChatVisibleLimit,
    statusDrafts,
    setStatusDrafts,
    statusMapping,
    setStatusMapping,
    createTaskStatus,
    setCreateTaskStatus,
    createTaskInitialTitle,
    setCreateTaskInitialTitle,
    createTaskInitialTemplateId,
    setCreateTaskInitialTemplateId,
    error,
    setError,
    busy,
    setBusy,
    selectedTaskId,
    setSelectedTaskId,
    isChatPopupOpen,
    setIsChatPopupOpen,
    isTitleEditing,
    setIsTitleEditing,
    titleDraft,
    setTitleDraft,
    isDescriptionEditing,
    setIsDescriptionEditing,
    isDescriptionSaving,
    setIsDescriptionSaving,
    isAttachmentUploading,
    setIsAttachmentUploading,
    detailTab,
    setDetailTab,
    detailViewMode,
    setDetailViewMode,
    selectedSubtaskId,
    setSelectedSubtaskId,
    descriptionDraft,
    setDescriptionDraft,
    subtaskDescriptionDraft,
    setSubtaskDescriptionDraft,
    isSubtaskDescriptionDirty,
    setIsSubtaskDescriptionDirty,
    isSubtaskDescriptionSaving,
    setIsSubtaskDescriptionSaving,
    commentDraft,
    setCommentDraft,
    editingCommentId,
    setEditingCommentId,
    subtaskCommentDraft,
    setSubtaskCommentDraft,
    editingSubtaskCommentId,
    setEditingSubtaskCommentId,
    isAddSubtaskOpen,
    setIsAddSubtaskOpen,
    isTaskImportOpen,
    setIsTaskImportOpen,
    isTaskImporting,
    setIsTaskImporting,
    subtaskRows,
    setSubtaskRows,
    isChecklistModalOpen,
    setIsChecklistModalOpen,
    checklistRows,
    setChecklistRows,
    checklistDraft,
    setChecklistDraft,
    editingSubtaskId,
    setEditingSubtaskId,
    subtaskDraft,
    setSubtaskDraft,
    selectedCustomFieldOption,
    setSelectedCustomFieldOption,
    editingCustomFieldId,
    setEditingCustomFieldId,
    customFieldDraft,
    setCustomFieldDraft,
    customFieldError,
    setCustomFieldError,
    isCustomFieldModalOpen,
    setIsCustomFieldModalOpen,
    isCreateCustomFieldOpen,
    setIsCreateCustomFieldOpen,
    customFieldRows,
    setCustomFieldRows,
    quickFieldName,
    setQuickFieldName,
    quickFieldType,
    setQuickFieldType,
    isOutputFormatModalOpen,
    setIsOutputFormatModalOpen,
    isCreateOutputFormatOpen,
    setIsCreateOutputFormatOpen,
    outputFormatDraftOption,
    setOutputFormatDraftOption,
    dataFormatRoleDraft,
    setDataFormatRoleDraft,
    dataFormatTarget,
    setDataFormatTarget,
    quickOutputFormatName,
    setQuickOutputFormatName,
    quickOutputFormatDescription,
    setQuickOutputFormatDescription,
    pendingDeleteSubtaskId,
    setPendingDeleteSubtaskId,
    selectedSubtaskIds,
    setSelectedSubtaskIds,
    subtaskStatusMenu,
    setSubtaskStatusMenu,
    history,
    setHistory,
    localChatEntries,
    setLocalChatEntries,
    detailRatio,
    setDetailRatio,
    isResizingSplit,
    setIsResizingSplit
  } = projectDetailState

  const modalBodyRef = useRef<HTMLDivElement | null>(null)
  const chatFeedRef = useRef<HTMLDivElement | null>(null)
  const chatFileInputRef = useRef<HTMLInputElement | null>(null)
  const chatDraftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const subtaskStatusMenuRef = useRef<HTMLDivElement | null>(null)
  const subtaskClickTimerRef = useRef<number | null>(null)
  const descriptionAutosaveTimerRef = useRef<number | null>(null)
  const descriptionAutosaveInFlightRef = useRef(false)
  const descriptionAutosavePendingRef = useRef(false)
  const descriptionAutosaveSnapshotRef = useRef('')
  const descriptionSavedSnapshotRef = useRef('')
  const descriptionAutosaveRequestIdRef = useRef(0)
  const selectedTaskRef = useRef<TaskEntity | null>(null)
  const selectedSubtaskRef = useRef<TaskSubtask | null>(null)
  const descriptionDraftRef = useRef('')
  const subtaskDescriptionDraftRef = useRef('')
  const subtaskDescriptionAutosaveTimerRef = useRef<number | null>(null)
  const subtaskDescriptionAutosaveInFlightRef = useRef(false)
  const subtaskDescriptionAutosavePendingRef = useRef(false)
  const subtaskDescriptionAutosaveSnapshotRef = useRef('')
  const subtaskDescriptionSavedSnapshotRef = useRef('')
  const subtaskDescriptionAutosaveRequestIdRef = useRef(0)
  const lastGatewayModelRefreshRef = useRef<string | null>(null)
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false)
  const [isRecentChatsView, setIsRecentChatsView] = useState(false)
  const [pendingChatOpen, setPendingChatOpen] = useState<{ taskId: string; conversationId: string } | null>(null)
  const [defaultAgentId, setDefaultAgentId] = useState<string>('')
  const [gatewayLanguage, setGatewayLanguage] = useState<string>(DEFAULT_GATEWAY_LANGUAGE)
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskEntity | null>(null)
  const [selectedTaskDetailLoading, setSelectedTaskDetailLoading] = useState(false)
  const [selectedTaskDetailError, setSelectedTaskDetailError] = useState<string | null>(null)
  const selectedTaskDetailRequestIdRef = useRef(0)
  const {
    refresh,
    projectLoadError
  } = useProjectDetailData({
    token: token ?? undefined,
    projectId,
    state: projectDetailState
  })

  const refreshSelectedTaskDetail = useCallback(async (
    taskId = selectedTaskId,
    options: { silent?: boolean } = {}
  ) => {
    if (!taskId) {
      selectedTaskDetailRequestIdRef.current += 1
      setSelectedTaskDetail(null)
      setSelectedTaskDetailLoading(false)
      setSelectedTaskDetailError(null)
      return
    }

    const requestId = ++selectedTaskDetailRequestIdRef.current
    if (!options.silent) {
      setSelectedTaskDetail(null)
      setSelectedTaskDetailLoading(true)
    }
    setSelectedTaskDetailError(null)

    try {
      const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.get, { actorToken: token, id: taskId })
      if (selectedTaskDetailRequestIdRef.current !== requestId) return
      if (!response.ok || !response.data) {
        setSelectedTaskDetail(null)
        setSelectedTaskDetailError(response.error?.message ?? 'Task detail could not be loaded.')
        return
      }
      setSelectedTaskDetail(withTaskMeta(response.data))
    } catch (error) {
      if (selectedTaskDetailRequestIdRef.current !== requestId) return
      setSelectedTaskDetail(null)
      setSelectedTaskDetailError(error instanceof Error ? error.message : 'Task detail could not be loaded.')
    } finally {
      if (selectedTaskDetailRequestIdRef.current === requestId) setSelectedTaskDetailLoading(false)
    }
  }, [selectedTaskId, token])

  const refreshProjectAndSelectedTask = useCallback(async () => {
    await Promise.all([
      refresh(),
      refreshSelectedTaskDetail(selectedTaskId, { silent: true })
    ])
  }, [refresh, refreshSelectedTaskDetail, selectedTaskId])

  useEffect(() => {
    void refreshSelectedTaskDetail(selectedTaskId)
  }, [refreshSelectedTaskDetail, selectedTaskId])

  useEffect(() => {
    const onTaskActivity = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as { projectId?: string; taskId?: string; message?: TaskActivityMessage } | undefined
      if (!payload?.projectId || payload.projectId !== projectId || !payload.taskId || !payload.message) return
      setSelectedTaskDetail((current) => {
        if (!current || current.id !== payload.taskId) return current
        return appendActivityMessageToTasks([current], payload.taskId ?? '', payload.message as TaskActivityMessage)[0] ?? current
      })
    }

    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
  }, [projectId])

  const { openTask, clearSelection } = useProjectSelection({
    state: {
      selectedTaskId,
      selectedSubtaskId,
      setSelectedTaskId,
      setSelectedSubtaskId,
      setDetailTab,
      setDetailViewMode,
      setIsTitleEditing,
      setTitleDraft,
      setIsDescriptionEditing,
      setIsSubtaskDescriptionDirty,
      setDescriptionDraft
    },
    tasks
  })

  const routeParam = (value: string) => encodeURIComponent(value)
  const projectDetailRoute = () => projectId
    ? APP_ROUTES.PROJECT_DETAIL.replace(':projectId', routeParam(projectId))
    : APP_ROUTES.PROJECTS
  const taskDetailRoute = (taskId: string) => projectId
    ? APP_ROUTES.PROJECT_TASK_DETAIL
      .replace(':projectId', routeParam(projectId))
      .replace(':taskId', routeParam(taskId))
    : APP_ROUTES.PROJECTS
  const subtaskDetailRoute = (taskId: string, subtaskId: string) => projectId
    ? APP_ROUTES.PROJECT_SUBTASK_DETAIL
      .replace(':projectId', routeParam(projectId))
      .replace(':taskId', routeParam(taskId))
      .replace(':subtaskId', routeParam(subtaskId))
    : APP_ROUTES.PROJECTS

  const navigateToProjectDetail = useCallback((options: { replace?: boolean } = {}) => {
    navigate(projectDetailRoute(), { replace: options.replace ?? false })
  }, [navigate, projectId])

  const navigateToTaskDetail = useCallback((taskId: string, options: { replace?: boolean } = {}) => {
    navigate(taskDetailRoute(taskId), { replace: options.replace ?? false })
  }, [navigate, projectId])

  const navigateToSubtaskDetail = useCallback((taskId: string, subtaskId: string, options: { replace?: boolean } = {}) => {
    navigate(subtaskDetailRoute(taskId, subtaskId), { replace: options.replace ?? false })
  }, [navigate, projectId])

  useEffect(() => {
    if (!routeTaskId) {
      if (selectedTaskId || selectedSubtaskId) clearSelection()
      return
    }

    if (selectedTaskId !== routeTaskId) setSelectedTaskId(routeTaskId)

    if (routeSubtaskId) {
      if (selectedSubtaskId !== routeSubtaskId) setSelectedSubtaskId(routeSubtaskId)
      if (detailViewMode !== 'subtask') setDetailViewMode('subtask')
      if (detailTab === 'subtasks' || detailTab === 'model') setDetailTab('agent')
      return
    }

    if (selectedSubtaskId) setSelectedSubtaskId(null)
    if (detailViewMode !== 'task') setDetailViewMode('task')
    if (detailTab !== 'subtasks') setDetailTab('subtasks')
  }, [
    routeTaskId,
    routeSubtaskId,
    selectedTaskId,
    selectedSubtaskId,
    detailViewMode,
    detailTab,
    setSelectedTaskId,
    setSelectedSubtaskId,
    setDetailViewMode,
    setDetailTab,
    clearSelection
  ])

  useEffect(() => {
    if (!routeTaskId || !routeSubtaskId || tasks.length === 0) return
    const routeTask = tasks.find((task) => task.id === routeTaskId) ?? null
    const parentTask = tasks.find((task) => (task.subtasks ?? []).some((subtask) => subtask.id === routeSubtaskId)) ?? null

    if (parentTask && parentTask.id !== routeTaskId) {
      navigateToSubtaskDetail(parentTask.id, routeSubtaskId, { replace: true })
      return
    }

    if (!parentTask && routeTask) {
      navigateToTaskDetail(routeTask.id, { replace: true })
    }
  }, [routeTaskId, routeSubtaskId, tasks])

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setDefaultAgentId('')
      setGatewayLanguage(DEFAULT_GATEWAY_LANGUAGE)
      return
    }
    void Promise.all([
      invokeBridge<{ agentId: string | null }>(IPC_CHANNELS.appSettings.getDefaultAgent, { actorToken: token }),
      invokeBridge<{ language: string }>(IPC_CHANNELS.appSettings.getGatewayLanguage, { actorToken: token })
    ])
      .then(([agentResponse, languageResponse]) => {
        if (cancelled) return
        setDefaultAgentId(agentResponse.ok && agentResponse.data?.agentId ? agentResponse.data.agentId : '')
        setGatewayLanguage(languageResponse.ok && languageResponse.data?.language ? languageResponse.data.language : DEFAULT_GATEWAY_LANGUAGE)
      })
      .catch(() => {
        if (!cancelled) {
          setDefaultAgentId('')
          setGatewayLanguage(DEFAULT_GATEWAY_LANGUAGE)
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const {
    hydratedTasks,
    selectedTask,
    selectedSubtask,
    statusColumns,
    defaultStatus,
    completedStatusIds,
    tasksByStatus,
    chatActivityMessages,
    chatConversations: derivedChatConversations,
    selectedChatSummary: derivedSelectedChatSummary
  } = useProjectDerivedState({
    project,
    tasks,
    selectedTaskOverride: selectedTaskDetail,
    tags,
    projectStatuses,
    selectedTaskId,
    selectedSubtaskId,
    detailTab,
    detailViewMode,
    selectedChatConversationId,
    isStartingNewChat
  })

  const generatedContextEntries = useMemo(() => buildGeneratedContextEntries(chatActivityMessages), [chatActivityMessages])
  const chatFollowUpContext = useMemo(() => buildLatestGeneratedFollowUpContext(chatActivityMessages), [chatActivityMessages])

  useEffect(() => {
    setRendererDiagnosticContext({
      area: 'project-detail',
      projectId: projectId ?? null,
      projectLoaded: Boolean(project),
      taskCount: tasks.length,
      selectedTaskId: selectedTaskId ?? null,
      selectedSubtaskId: selectedSubtaskId ?? null,
      detailViewMode,
      detailTab,
      chatPopupOpen: isChatPopupOpen,
      selectedChatConversationId: selectedChatConversationId || null,
      isStartingNewChat
    })
    return () => clearRendererDiagnosticContext('project-detail')
  }, [
    projectId,
    project,
    tasks.length,
    selectedTaskId,
    selectedSubtaskId,
    detailViewMode,
    detailTab,
    isChatPopupOpen,
    selectedChatConversationId,
    isStartingNewChat
  ])

  const {
    state: {
      selectedWorkspace,
      savedGatewaySettings,
      gatewayModelOptions,
      gatewayOptions,
      workspaceOptions,
      projectGatewayModelOptions,
      selectedGatewayOption,
      selectedRuntimeWorkspaceOption,
      selectedDefaultModelOption,
      selectedDefaultPlanModelOption,
      selectedDefaultRunModelOption,
      chatRuntimeWorkspace,
      projectGroupForExport
    },
    actions: {
      chooseProjectWorkspaceFolder,
      createWorkspaceFromDraft,
      updateProjectWorkspace,
      saveProjectDefaultsSettings,
      saveProjectGatewaySettings,
      updateProjectGroupMembership,
      saveSelectedProjectGroup,
      syncProjectWorkspace: workspaceSyncProjectWorkspace,
      openStatusEditor: workspaceOpenStatusEditor,
      openProjectPromptSettings: workspaceOpenProjectPromptSettings,
      saveProjectPromptSettings: workspaceSaveProjectPromptSettings,
      updateStatusDraft: workspaceUpdateStatusDraft,
      addActiveStatus: workspaceAddActiveStatus,
      removeStatusDraft: workspaceRemoveStatusDraft,
      applyStatusTemplate: workspaceApplyStatusTemplate,
      saveProjectStatuses: workspaceSaveProjectStatuses,
      setGateway
    }
  } = useProjectWorkspaceSettings({
    token,
    project,
    projectGroups,
    workspaces,
    gateways,
    projectStatuses,
    statusTemplates,
    defaultStatus,
    tags,
    skills,
    agents,
    customFields,
    tasks,
    refresh,
    state: projectDetailState
  })

  const projectGatewayLanguage = savedGatewaySettings.language || savedGatewaySettings.outputLanguage || savedGatewaySettings.inputLanguage || gatewayLanguage
  const projectGatewayPromptShape = savedGatewaySettings.promptShape || 'markdown'
  const projectGatewayPlanReasoningEffort = savedGatewaySettings.planReasoningEffort || 'medium'
  const projectGatewayRunReasoningEffort = savedGatewaySettings.runReasoningEffort || 'medium'

  const chatGateway = useMemo(() => gateways.find((gateway) => gateway.id === chatGatewayId) ?? null, [chatGatewayId, gateways])
  const chatGatewayConfig = useMemo(() => codexConfigOf(chatGateway), [chatGateway])
  const chatModelOptions = useMemo<AppSelectOption[]>(() => (chatGatewayConfig.models ?? []).map((model) => ({ label: model.label || model.id, value: model.id })), [chatGatewayConfig.models])
  const chatGatewayOption = gatewayOptions.find((option) => option.value === chatGatewayId) ?? null
  const chatModelOption = chatModelOptions.find((option) => option.value === chatModel) ?? null
  const chatPlanModelOption = chatModelOptions.find((option) => option.value === (chatPlanModel || chatModel)) ?? null
  const chatRunModelOption = chatModelOptions.find((option) => option.value === (chatRunModel || chatModel)) ?? null
  const chatPlanModelRecord = useMemo(() => (chatGatewayConfig.models ?? []).find((model) => model.id === (chatPlanModel || chatModel)) ?? null, [chatGatewayConfig.models, chatModel, chatPlanModel])
  const chatRunModelRecord = useMemo(() => (chatGatewayConfig.models ?? []).find((model) => model.id === (chatRunModel || chatModel)) ?? null, [chatGatewayConfig.models, chatModel, chatRunModel])
  const chatPlanReasoningOptions = useMemo<AppSelectOption[]>(() => {
    const efforts = gatewayModelReasoningEfforts(chatPlanModelRecord)
    return GATEWAY_REASONING_EFFORT_OPTIONS.filter((option) => efforts.includes(option.value)).map((option) => ({ label: option.label, value: option.value }))
  }, [chatPlanModelRecord])
  const chatRunReasoningOptions = useMemo<AppSelectOption[]>(() => {
    const efforts = gatewayModelReasoningEfforts(chatRunModelRecord)
    return GATEWAY_REASONING_EFFORT_OPTIONS.filter((option) => efforts.includes(option.value)).map((option) => ({ label: option.label, value: option.value }))
  }, [chatRunModelRecord])
  const selectedTaskGatewaySignature = useMemo(() => JSON.stringify(selectedTask?.payload?.gateway ?? null), [selectedTask?.payload])

  useEffect(() => {
    if (chatPlanReasoningOptions.length === 0) return
    if (chatPlanReasoningOptions.some((option) => option.value === chatPlanReasoningEffort)) return
    setChatPlanReasoningEffort(chatPlanReasoningOptions.find((option) => option.value === 'medium')?.value ?? chatPlanReasoningOptions[0].value)
  }, [chatPlanReasoningEffort, chatPlanReasoningOptions, setChatPlanReasoningEffort])

  useEffect(() => {
    if (chatRunReasoningOptions.length === 0) return
    if (chatRunReasoningOptions.some((option) => option.value === chatRunReasoningEffort)) return
    setChatRunReasoningEffort(chatRunReasoningOptions.find((option) => option.value === 'medium')?.value ?? chatRunReasoningOptions[0].value)
  }, [chatRunReasoningEffort, chatRunReasoningOptions, setChatRunReasoningEffort])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DETAIL_RATIO_KEY, String(detailRatio))
  }, [detailRatio])

  useEffect(() => {
    selectedTaskRef.current = selectedTask
  }, [selectedTask])

  useEffect(() => {
    selectedSubtaskRef.current = selectedSubtask
  }, [selectedSubtask])

  useEffect(() => {
    descriptionDraftRef.current = descriptionDraft
  }, [descriptionDraft])

  useEffect(() => {
    subtaskDescriptionDraftRef.current = subtaskDescriptionDraft
  }, [subtaskDescriptionDraft])

  const clearDescriptionAutosaveTimer = () => {
    if (!descriptionAutosaveTimerRef.current) return
    window.clearTimeout(descriptionAutosaveTimerRef.current)
    descriptionAutosaveTimerRef.current = null
  }

  const clearSubtaskDescriptionAutosaveTimer = () => {
    if (!subtaskDescriptionAutosaveTimerRef.current) return
    window.clearTimeout(subtaskDescriptionAutosaveTimerRef.current)
    subtaskDescriptionAutosaveTimerRef.current = null
  }

  useEffect(() => {
    return () => {
      clearDescriptionAutosaveTimer()
      clearSubtaskDescriptionAutosaveTimer()
      if (subtaskClickTimerRef.current) {
        window.clearTimeout(subtaskClickTimerRef.current)
        subtaskClickTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (isChatPopupOpen) return
    setChatDragDepth((value) => value === 0 ? value : 0)
    setSlashCommandIndex((value) => value === 0 ? value : 0)
    setChatComposerFocused((value) => value ? false : value)
    setChatSettingsOpen((value) => value ? false : value)
    setChatAttachments((value) => value.length === 0 ? value : [])
    setChatVisibleLimit((value) => value === CHAT_INITIAL_MESSAGE_LIMIT ? value : CHAT_INITIAL_MESSAGE_LIMIT)
  }, [isChatPopupOpen])

  useEffect(() => {
    if (!selectedTask || detailViewMode !== 'task' || !isDescriptionEditing) {
      clearDescriptionAutosaveTimer()
      descriptionAutosaveRequestIdRef.current += 1
      descriptionAutosaveInFlightRef.current = false
      descriptionAutosavePendingRef.current = false
      return
    }
    clearDescriptionAutosaveTimer()
    descriptionAutosaveTimerRef.current = window.setTimeout(() => {
      void saveDescription({ finalize: false })
    }, DESCRIPTION_AUTOSAVE_DELAY_MS)
    return () => {
      clearDescriptionAutosaveTimer()
    }
  }, [descriptionDraft, detailViewMode, isDescriptionEditing, selectedTask?.id])

  useEffect(() => {
    if (!selectedSubtask || detailViewMode !== 'subtask' || !isSubtaskDescriptionDirty) {
      clearSubtaskDescriptionAutosaveTimer()
      subtaskDescriptionAutosaveRequestIdRef.current += 1
      subtaskDescriptionAutosaveInFlightRef.current = false
      subtaskDescriptionAutosavePendingRef.current = false
      return
    }
    clearSubtaskDescriptionAutosaveTimer()
    subtaskDescriptionAutosaveTimerRef.current = window.setTimeout(() => {
      void saveSubtaskDetail({ finalize: false })
    }, DESCRIPTION_AUTOSAVE_DELAY_MS)
    return () => {
      clearSubtaskDescriptionAutosaveTimer()
    }
  }, [subtaskDescriptionDraft, detailViewMode, isSubtaskDescriptionDirty, selectedSubtask?.id])

  useEffect(() => {
    if (!selectedTask) return
    const override = readTaskGatewayOverride(selectedTask)
    const nextRunModel = override.runModel || override.legacyModel || savedGatewaySettings.runModel || savedGatewaySettings.defaultModel || ''
    const nextPlanReasoningEffort = override.planReasoningEffort || projectGatewayPlanReasoningEffort
    const nextRunReasoningEffort = override.runReasoningEffort || projectGatewayRunReasoningEffort
    const nextGatewayId = override.gatewayId || savedGatewaySettings.gatewayId || ''
    const nextPlanModel = override.planModel || savedGatewaySettings.planModel || savedGatewaySettings.defaultModel || ''
    setChatGatewayId(nextGatewayId)
    setChatModel(nextRunModel)
    setChatPlanModel(nextPlanModel)
    setChatRunModel(nextRunModel)
    setChatPlanReasoningEffort(nextPlanReasoningEffort)
    setChatRunReasoningEffort(nextRunReasoningEffort)
  }, [
    selectedTask?.id,
    selectedTaskGatewaySignature,
    savedGatewaySettings.gatewayId,
    savedGatewaySettings.defaultModel,
    savedGatewaySettings.planModel,
    savedGatewaySettings.runModel,
    projectGatewayPlanReasoningEffort,
    projectGatewayRunReasoningEffort,
    setChatGatewayId,
    setChatModel,
    setChatPlanModel,
    setChatRunModel,
    setChatPlanReasoningEffort,
    setChatRunReasoningEffort
  ])
  useEffect(() => {
    setGatewayRunFeedback(null)
  }, [selectedTaskId])
  const selectedTaskGatewayId = taskGatewayId(selectedTask)
  const effectiveTaskGatewayId = selectedTaskGatewayId || savedGatewaySettings.gatewayId || ''
  const effectiveTaskGateway = gateways.find((gateway) => gateway.id === effectiveTaskGatewayId) ?? null
  const taskModelOptions = useMemo<AppSelectOption[]>(() => (codexConfigOf(effectiveTaskGateway).models ?? []).map((model) => ({ label: model.label || model.id, value: model.id })), [effectiveTaskGateway])

  useEffect(() => {
    clearDescriptionAutosaveTimer()
    descriptionAutosavePendingRef.current = false
    const nextDescription = prefixDataFormatTokens(
      selectedTask?.description ?? '',
      getTaskInputFormatId(selectedTask),
      getTaskOutputFormatId(selectedTask),
      outputFormats
    )
    descriptionSavedSnapshotRef.current = nextDescription
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
    setIsSubtaskDescriptionDirty(false)
    setIsChatPopupOpen(false)
    setLocalChatEntries([])
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
      }).then(() => refreshProjectAndSelectedTask())
    }
  }, [selectedTask?.id])

  useEffect(() => {
    if (!selectedTask) return
    if (!isTitleEditing) setTitleDraft(selectedTask.title)
    if (!isDescriptionEditing || detailViewMode !== 'task') {
      const nextDescription = prefixDataFormatTokens(
        selectedTask.description ?? '',
        getTaskInputFormatId(selectedTask),
        getTaskOutputFormatId(selectedTask),
        outputFormats
      )
      descriptionSavedSnapshotRef.current = nextDescription
      setDescriptionDraft(nextDescription)
    }
  }, [
    selectedTask?.id,
    selectedTask?.title,
    selectedTask?.description,
    selectedTask?.updatedAt,
    selectedTask?.payload,
    outputFormats,
    isTitleEditing,
    isDescriptionEditing,
    detailViewMode
  ])

  useEffect(() => {
    if (!selectedSubtask) {
      setSubtaskDescriptionDraft('')
      setIsSubtaskDescriptionDirty(false)
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
    subtaskDescriptionSavedSnapshotRef.current = nextDescription
    setSelectedSubtaskDescriptionDraft(nextDescription)
    setIsSubtaskDescriptionDirty(false)
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
      }).then(() => refreshProjectAndSelectedTask())
    }
  }, [selectedSubtask?.id])

  useEffect(() => {
    if (!selectedSubtask || detailViewMode !== 'subtask') return
    const nextDescription = prefixDataFormatTokens(
      getSubtaskDescription(selectedSubtask),
      getSubtaskInputFormatId(selectedSubtask),
      getSubtaskOutputFormatId(selectedSubtask),
      outputFormats
    )
    if (isSubtaskDescriptionDirty && nextDescription !== subtaskDescriptionDraftRef.current) return
    subtaskDescriptionSavedSnapshotRef.current = nextDescription
    setSubtaskDescriptionDraft(nextDescription)
  }, [
    selectedSubtask?.id,
    selectedSubtask?.updatedAt,
    selectedSubtask?.payload,
    outputFormats,
    isSubtaskDescriptionDirty,
    detailViewMode
  ])

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
        if (isChatPopupOpen) {
          setIsChatPopupOpen(false)
          return
        }
        if (detailViewMode === 'subtask') {
          setDetailViewMode('task')
          setSelectedSubtaskId(null)
          setDetailTab('subtasks')
          navigateToTaskDetail(selectedTask.id, { replace: true })
          return
        }
        clearSelection()
        navigateToProjectDetail({ replace: true })
      }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [selectedTask, isChatPopupOpen, detailViewMode])

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

  const projectAgentRows = useMemo(() => {
    const rows = new Map<string, { agent: Agent; count: number }>()
    const addAgent = (agentId?: string | null) => {
      if (!agentId) return
      const agent = agents.find((item) => item.id === agentId)
      if (!agent) return
      const current = rows.get(agent.id)
      rows.set(agent.id, { agent, count: (current?.count ?? 0) + 1 })
    }
    for (const task of hydratedTasks) {
      addAgent(task.agentId)
      for (const subtask of task.subtasks ?? []) {
        addAgent(getSubtaskAgentId(subtask))
      }
    }
    return Array.from(rows.values()).sort((a, b) => a.agent.name.localeCompare(b.agent.name, 'tr'))
  }, [agents, hydratedTasks])

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

  const defaultAgent = useMemo(() => {
    if (!defaultAgentId) return null
    return agents.find((item) => item.id === defaultAgentId) ?? null
  }, [agents, defaultAgentId])

  const projectDefaultAgent = useMemo(() => {
    const agentId = projectDefaultAgentId(project)
    if (!agentId) return null
    return agents.find((item) => item.id === agentId) ?? null
  }, [agents, project])

  const projectDefaultSkills = useMemo(() => {
    const skillIds = new Set(projectDefaultSkillIds(project))
    return skills.filter((skill) => skillIds.has(skill.id)).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [project, skills])

  const selectedTaskAgentIsDefault = Boolean(selectedTask && !selectedTask.agentId && (projectDefaultAgent || defaultAgent))
  const selectedTaskAgentDefaultLabel = selectedTask && !selectedTask.agentId
    ? projectDefaultAgent ? 'Project default' : defaultAgent ? 'Default' : undefined
    : undefined

  const selectedTaskAgent = useMemo(() => {
    if (selectedTask?.agentId) return agents.find((item) => item.id === selectedTask.agentId) ?? null
    return projectDefaultAgent ?? defaultAgent
  }, [agents, defaultAgent, projectDefaultAgent, selectedTask])

  const selectedTaskSkills = useMemo(() => {
    if (!selectedTask) return []
    return (selectedTask.skills?.length ?? 0) > 0 ? selectedTask.skills ?? [] : projectDefaultSkills
  }, [projectDefaultSkills, selectedTask])

  const selectedTaskSkillsAreDefault = Boolean(selectedTask && (selectedTask.skills?.length ?? 0) === 0 && projectDefaultSkills.length > 0)

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

  const chatConversations = derivedChatConversations
  const projectRecentChats = useMemo<ProjectRecentChatRow[]>(() => {
    return buildProjectRecentChats(tasks)
  }, [tasks])
  const taskContextSkills = selectedTaskSkills

  const selectedTaskExportContext = useMemo(() => {
    if (!selectedTask) return null
    const effectiveTask = {
      ...selectedTask,
      agentId: selectedTask.agentId || selectedTaskAgent?.id || null,
      skills: selectedTaskSkills
    }
    return { task: effectiveTask, project, projectGroup: projectGroupForExport, agents, skills, tags, customFields, projectStatuses, gatewayLanguage: projectGatewayLanguage, gatewayPlanReasoningEffort: projectGatewayPlanReasoningEffort, gatewayRunReasoningEffort: projectGatewayRunReasoningEffort }
  }, [agents, customFields, project, projectGatewayLanguage, projectGatewayPlanReasoningEffort, projectGatewayRunReasoningEffort, projectGroupForExport, projectStatuses, selectedTask, selectedTaskAgent, selectedTaskSkills, skills, tags])
  const selectedTaskAgentMarkdown = selectedTaskExportContext ? buildAgentMarkdown(selectedTaskExportContext) : ''
  const selectedTaskSkillsMarkdown = selectedTaskExportContext ? buildSkillsMarkdown(selectedTaskExportContext) : ''

  const openRecentChat = (row: ProjectRecentChatRow) => {
    setPendingChatOpen({ taskId: row.taskId, conversationId: row.conversationId })
    navigateToTaskDetail(row.taskId)
    setDetailViewMode('task')
    setSelectedSubtaskId(null)
  }

  const openTaskChatConversation = (taskId: string, conversationId: string) => {
    setPendingChatOpen({ taskId, conversationId })
    navigateToTaskDetail(taskId)
    setDetailViewMode('task')
    setSelectedSubtaskId(null)
  }

  useEffect(() => {
    if (!pendingChatOpen) return
    if (selectedTask?.id !== pendingChatOpen.taskId) return
    setIsStartingNewChat(false)
    setSelectedChatConversationId(pendingChatOpen.conversationId)
    setIsChatPopupOpen(true)
    setPendingChatOpen(null)
  }, [pendingChatOpen, selectedTask?.id])

  const { canRunSelectedTaskWithCodex, canPlanSelectedTaskWithCodex, canSendChat, chatOperationFeedback, planChoiceOpen, refreshGatewayModels, runSelectedTaskWithCodex, planSelectedTaskWithCodex, confirmPlanWithGateway, closePlanChoice, sendGatewayChatMessage, sendPlannerClarification, stopGatewayChat, addChatAttachments, applySlashCommand } = useProjectGatewayFlow({
    token,
    project,
    selectedTask,
    selectedTaskExportContext,
    taskRunGatewayId: selectedTask ? taskGatewayId(selectedTask) : '',
    taskPlanModel: selectedTask ? readTaskGatewayOverride(selectedTask).planModel : '',
    taskRunModel: selectedTask ? taskGatewayRunModel(selectedTask) : '',
    savedGatewayDefaultGatewayId: savedGatewaySettings.gatewayId || '',
    savedGatewayDefaultModel: savedGatewaySettings.defaultModel || '',
    savedGatewayDefaultPlanModel: savedGatewaySettings.planModel || savedGatewaySettings.defaultModel || '',
    savedGatewayDefaultRunModel: savedGatewaySettings.runModel || savedGatewaySettings.defaultModel || '',
    chatDraft,
    chatAttachments,
    chatGatewayId: chatGatewayId || '',
    chatModel,
    chatPlanModel,
    chatRunModel,
    gatewayLanguage: projectGatewayLanguage,
    planReasoningEffort: chatPlanReasoningOptions.length > 0 ? chatPlanReasoningEffort : undefined,
    runReasoningEffort: chatRunReasoningOptions.length > 0 ? chatRunReasoningEffort : undefined,
    chatIncludeContext,
    chatComposerMode,
    selectedChatConversationId,
    isStartingNewChat,
    chatFollowUpContext,
    selectedChatSummary: derivedSelectedChatSummary,
    gatewayRunFeedback,
    gatewayRunLaunching,
    gatewayPlanLaunching,
    chatSending,
    chatStopping,
    state: {
      setGatewayRunLaunching,
      setGatewayPlanLaunching,
      setGatewayRunFeedback,
      setChatSending,
      setChatStopping,
      setChatSettingsOpen,
      setIsChatPopupOpen,
      setIsStartingNewChat,
      setSelectedChatConversationId,
      setGatewayModelLoading,
      setGatewayModelError,
      setGatewayDefaultModel,
      setChatDraft,
      setChatAttachments,
      setChatComposerMode,
      setChatIncludeContext,
      setError,
      setDetailTab,
      setGateways
    },
    openChatAttachmentPicker: () => {
      if (chatFileInputRef.current) chatFileInputRef.current.click()
    }
  })

  const activeSelectedTaskPlanConversation = useMemo(() => {
    return selectedTask ? latestActiveTaskGatewayConversation(selectedTask, 'PLAN') : null
  }, [selectedTask])

  const activeSelectedTaskRunConversation = useMemo(() => {
    return selectedTask ? latestActiveTaskGatewayConversation(selectedTask, 'RUN') : null
  }, [selectedTask])

  const handleRunSelectedTaskWithCodex = () => {
    void runSelectedTaskWithCodex()
  }

  const handlePlanSelectedTaskWithCodex = () => {
    void planSelectedTaskWithCodex()
  }

  const handleStopSelectedTaskPlan = () => {
    if (!activeSelectedTaskPlanConversation?.conversationId) return
    void stopGatewayChat(activeSelectedTaskPlanConversation.conversationId)
  }

  const handleStopSelectedTaskRun = () => {
    if (!activeSelectedTaskRunConversation?.conversationId) return
    void stopGatewayChat(activeSelectedTaskRunConversation.conversationId)
  }

  const { chatState, chatHandlers } = useProjectChatPopup({
    selectedTask,
    isChatPopupOpen,
    selectedChatSummary: derivedSelectedChatSummary,
    chatFeedRef,
    chatDraftTextareaRef,
    chatFileInputRef,
    chatDragDepth,
    chatDraft,
    chatSending,
    canSendChat,
    chatAttachments,
    chatVisibleLimit,
    chatGateway,
    chatGatewayOption,
    chatGatewayOptions: gatewayOptions,
    chatModel,
    chatModelOption,
    chatPlanModel,
    chatPlanModelOption,
    chatRunModel,
    chatRunModelOption,
    chatPlanReasoningEffort,
    chatRunReasoningEffort,
    chatPlanReasoningOptions,
    chatRunReasoningOptions,
    chatModelOptions,
    chatGatewayConfig,
    chatRuntimeWorkspace,
    runtimeWorkspaceId: savedGatewaySettings.runtimeWorkspaceId,
    chatIncludeContext,
    chatOperationFeedback,
    gatewayPlanLaunching,
    gatewayRunLaunching,
    planChoiceOpen,
    selectedChatConversationId,
    setSelectedChatConversationId,
    isStartingNewChat,
    setIsStartingNewChat,
    setChatComposerMode,
    setGatewayRunFeedback,
    setChatDraft,
    setChatAttachments,
    setChatVisibleLimit,
    chatConversations,
    chatActivityMessages,
    contextEntries: generatedContextEntries,
    chatStopping,
    selectedTaskAgent,
    taskContextSkills,
    setSlashCommandIndex,
    setChatSettingsOpen,
    setChatModel,
    setChatPlanModel,
    setChatRunModel,
    setChatPlanReasoningEffort,
    setChatRunReasoningEffort,
    setChatIncludeContext,
    setChatGatewayId,
    setChatComposerFocused,
    chatSettingsOpen,
    slashCommandIndex,
    chatComposerFocused,
    runSelectedTaskWithCodex,
    planSelectedTaskWithCodex,
    confirmPlanWithGateway,
    closePlanChoice,
    sendGatewayChatMessage,
    sendPlannerClarification,
    stopGatewayChat,
    applySlashCommand,
    addChatAttachments,
    onClose: () => setIsChatPopupOpen(false),
    setChatDragDepth
  })

  const closeSelectedTaskDetail = () => {
    clearSelection()
    navigateToProjectDetail({ replace: true })
  }

  const syncProjectWorkspace = () => {
    void workspaceSyncProjectWorkspace()
  }

  const saveReorderedTasks = async (sourceTaskId: string, status: TaskEntity['status'], targetTaskId?: string, position: TaskDropPosition = 'after') => {
    const result = reorderTasksForDrop(tasks, sourceTaskId, status, targetTaskId, position)
    if (result.updates.length === 0) return
    setTasks(result.tasks)
    const responses = await Promise.all(result.updates.map((update) => invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: update.task.id,
      status: update.status,
      payload: update.task.payload ?? {}
    })))
    const failed = responses.find((response) => !response.ok)
    if (failed) {
      setError(failed.error?.message ?? 'Unable to save task order')
      await refreshProjectAndSelectedTask()
    }
  }

  const reorderBoardTasks = async (sourceTaskId: string, targetTaskId: string, position: TaskDropPosition) => {
    if (sourceTaskId === targetTaskId) return
    const targetTask = tasks.find((task) => task.id === targetTaskId)
    if (!targetTask) return
    await saveReorderedTasks(sourceTaskId, targetTask.status, targetTaskId, position)
  }

  const onDropColumn = async (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain')
    if (!taskId) return
    await saveReorderedTasks(taskId, status)
  }

  const handleQuickCreate = async () => {
    if (!projectId || !taskTitle.trim()) return
    setBusy(true)
    const statusOrder = nextStatusTopOrder(tasks, defaultStatus)
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
    await refreshProjectAndSelectedTask()
  }

  const openCreateTask = (status: TaskEntity['status'] = defaultStatus) => {
    setCreateTaskStatus(status)
    setIsCreateTaskOpen(true)
  }

  useEffect(() => {
    const state = location.state as AppNavigateState | null
    if (state?.openTaskId && state.openTaskChat) {
      if (state.openTaskConversationId) {
        setPendingChatOpen({
          taskId: state.openTaskId,
          conversationId: state.openTaskConversationId
        })
      }
      navigate(taskDetailRoute(state.openTaskId), { replace: true, state: null })
      return
    }
    if (state?.openProjectSettings) {
      if (state.openTaskId) openTask(state.openTaskId)
      setProjectSettingsTab(state.projectSettingsTab ?? 'models')
      setIsStatusEditorOpen(true)
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
          statusOrder: nextStatusTopOrder(tasks, input.status)
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
      await refreshProjectAndSelectedTask()
      openTask(result.task.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Task create failed')
    } finally {
      setBusy(false)
    }
  }

  const resolveColumnByStatus = (status: TaskEntity['status']) => resolveProjectStatusColumn(status, statusColumns)

  const updateTaskStatus = async (taskId: string, nextStatus: TaskEntity['status']) => {
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.status === nextStatus) return
    const currentPayload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload)
      ? task.payload as Record<string, unknown>
      : {}
    const currentStatusOrder = currentPayload.statusOrder && typeof currentPayload.statusOrder === 'object' && !Array.isArray(currentPayload.statusOrder)
      ? currentPayload.statusOrder as Record<string, unknown>
      : {}
    const nextPayload = {
      ...currentPayload,
      statusOrder: {
        ...currentStatusOrder,
        [nextStatus]: nextStatusTopOrder(tasks, nextStatus)
      }
    }
    setTasks((current) => current.map((item) => (
      item.id === taskId ? { ...item, status: nextStatus, payload: nextPayload } : item
    )))
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: taskId,
      status: nextStatus,
      payload: nextPayload
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update task status')
      await refreshProjectAndSelectedTask()
      return
    }
    await refreshProjectAndSelectedTask()
  }

  const openStatusEditor = () => {
    setProjectSettingsTab('statuses')
    void workspaceOpenStatusEditor()
  }

  const openProjectPromptSettings = () => {
    void workspaceOpenProjectPromptSettings()
  }

  const saveProjectPromptSettings = async () => {
    await workspaceSaveProjectPromptSettings()
  }

  const updateStatusDraft = (id: string, patch: Partial<ProjectStatus>) => {
    workspaceUpdateStatusDraft(id, patch)
  }

  const addActiveStatus = () => {
    workspaceAddActiveStatus()
  }

  const removeStatusDraft = (status: ProjectStatus) => {
    workspaceRemoveStatusDraft(status)
  }

  const applyStatusTemplate = (template: StatusTemplate) => {
    void workspaceApplyStatusTemplate(template)
  }

  const saveProjectStatuses = async () => {
    await workspaceSaveProjectStatuses()
  }

  const saveDescription = async (options: { finalize?: boolean } = {}) => {
    const task = selectedTaskRef.current
    const draft = descriptionDraftRef.current
    if (!task) return true
    const shouldFinalize = options.finalize ?? true
    const taskId = task.id
    const normalizedDraft = draft
    clearDescriptionAutosaveTimer()
    if (normalizedDraft === descriptionSavedSnapshotRef.current) {
      if (shouldFinalize || isDescriptionEditing) {
        setIsDescriptionEditing(false)
      }
      return true
    }
    if (descriptionAutosaveInFlightRef.current) {
      if (normalizedDraft !== descriptionAutosaveSnapshotRef.current) {
        descriptionAutosavePendingRef.current = true
      }
      return true
    }
    const requestId = ++descriptionAutosaveRequestIdRef.current
    descriptionAutosaveInFlightRef.current = true
    descriptionAutosaveSnapshotRef.current = normalizedDraft
    setIsDescriptionSaving(true)
    const isCurrentTask = () => selectedTaskRef.current?.id === taskId
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: task.id,
      description: normalizedDraft,
      payload: {
        ...(task.payload ?? {}),
        inputFormatId: '',
        outputFormatId: ''
      }
    })
    if (descriptionAutosaveRequestIdRef.current !== requestId) {
      descriptionAutosaveInFlightRef.current = false
      setIsDescriptionSaving(false)
      descriptionAutosavePendingRef.current = false
      return true
    }
    descriptionAutosaveInFlightRef.current = false
    if (!isCurrentTask()) {
      setIsDescriptionSaving(false)
      return true
    }

    const latestDraft = descriptionDraftRef.current
    const isOutOfDate = latestDraft !== normalizedDraft
    if (isOutOfDate) {
      if (descriptionAutosavePendingRef.current) {
        descriptionAutosavePendingRef.current = false
        return saveDescription({ finalize: shouldFinalize })
      }
      setIsDescriptionSaving(false)
      return true
    }

    if (!response.ok) {
      setIsDescriptionSaving(false)
      setError(response.error?.message ?? 'Unable to update description')
      descriptionAutosaveSnapshotRef.current = latestDraft
      descriptionDraftRef.current = latestDraft
      descriptionAutosavePendingRef.current = false
      setIsDescriptionEditing(true)
      return false
    }
    descriptionAutosaveSnapshotRef.current = normalizedDraft
    descriptionSavedSnapshotRef.current = normalizedDraft
    descriptionDraftRef.current = normalizedDraft
    const nextTask = {
      ...task,
      description: normalizedDraft,
      payload: {
        ...(task.payload ?? {}),
        inputFormatId: '',
        outputFormatId: ''
      }
    } as TaskEntity
    selectedTaskRef.current = nextTask
    setTasks((current) => current.map((item) => item.id === taskId ? nextTask : item))
    if (descriptionAutosavePendingRef.current) {
      descriptionAutosavePendingRef.current = false
      return saveDescription({ finalize: shouldFinalize })
    }
    setIsDescriptionSaving(false)
    if (descriptionDraftRef.current === normalizedDraft && selectedTaskRef.current?.id === taskId) {
      setIsDescriptionEditing(false)
    }
    return true
  }

  const setTaskDescriptionDraft = (next: string) => {
    descriptionDraftRef.current = next
    setDescriptionDraft(next)
    setIsDescriptionEditing(next !== descriptionSavedSnapshotRef.current)
  }

  const resetTaskDescriptionDraft = () => {
    clearDescriptionAutosaveTimer()
    const next = descriptionSavedSnapshotRef.current
    descriptionDraftRef.current = next
    setDescriptionDraft(next)
    setIsDescriptionEditing(false)
  }

  const setSelectedSubtaskDescriptionDraft = (next: string) => {
    subtaskDescriptionDraftRef.current = next
    setSubtaskDescriptionDraft(next)
    setIsSubtaskDescriptionDirty(next !== subtaskDescriptionSavedSnapshotRef.current)
  }

  const resetSelectedSubtaskDescriptionDraft = () => {
    clearSubtaskDescriptionAutosaveTimer()
    const next = subtaskDescriptionSavedSnapshotRef.current
    subtaskDescriptionDraftRef.current = next
    setSubtaskDescriptionDraft(next)
    setIsSubtaskDescriptionDirty(false)
  }

  const saveAcceptanceCriteria = async (value: string) => {
    if (!selectedTask) return
    const currentPayload = selectedTask.payload && typeof selectedTask.payload === 'object' && !Array.isArray(selectedTask.payload)
      ? selectedTask.payload as Record<string, unknown>
      : {}
    const currentAgenticInputs = currentPayload.agenticInputs && typeof currentPayload.agenticInputs === 'object' && !Array.isArray(currentPayload.agenticInputs)
      ? currentPayload.agenticInputs as Record<string, unknown>
      : {}
    const nextAgenticInputs: Record<string, unknown> = {
      ...currentAgenticInputs,
      acceptanceCriteria: value.trim()
    }
    delete nextAgenticInputs.constraints
    delete nextAgenticInputs.expectedOutput
    delete nextAgenticInputs.references
    if (!nextAgenticInputs.acceptanceCriteria) delete nextAgenticInputs.acceptanceCriteria
    const nextPayload: Record<string, unknown> = {
      ...currentPayload,
      agenticInputs: nextAgenticInputs
    }
    if (Object.keys(nextAgenticInputs).length === 0) delete nextPayload.agenticInputs
    const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken: token,
      id: selectedTask.id,
      payload: nextPayload
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update acceptance criteria')
      return
    }
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
        setSelectedSubtaskDescriptionDraft(nextDescription)
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
      await refreshProjectAndSelectedTask()
      return
    }
    if (row.origin === 'stored') {
      await saveTaskAttachments(getTaskAttachments(selectedTask).filter((attachment) => attachment.id !== row.id))
      return
    }
    const nextDescription = removeAttachmentFromMarkdown(descriptionDraft, row.url)
    setTaskDescriptionDraft(nextDescription)
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
  }

  const setTaskGatewaySelection = async (patch: { gatewayId?: string | null; model?: string | null; planModel?: string | null; runModel?: string | null; planReasoningEffort?: string | null; runReasoningEffort?: string | null }) => {
    if (!selectedTask) return
    const nextPayload: Record<string, unknown> = { ...(selectedTask.payload ?? {}) }
    const currentGateway = readTaskGatewayOverride(selectedTask)
    const currentGatewayId = currentGateway.gatewayId
    const currentPlanModel = currentGateway.planModel
    const currentRunModel = currentGateway.runModel || currentGateway.legacyModel
    const currentPlanReasoningEffort = currentGateway.planReasoningEffort
    const currentRunReasoningEffort = currentGateway.runReasoningEffort
    const nextGatewayId = patch.gatewayId === undefined ? currentGatewayId : patch.gatewayId ?? ''
    const nextPlanModel = patch.planModel === undefined ? currentPlanModel : patch.planModel ?? ''
    const nextRunModel = patch.runModel === undefined ? currentRunModel : patch.runModel ?? ''
    const nextModel = patch.model === undefined ? nextRunModel : patch.model ?? ''
    const effectiveGateway = gateways.find((gateway) => gateway.id === (nextGatewayId || savedGatewaySettings.gatewayId)) ?? null
    const gatewayModels = codexConfigOf(effectiveGateway).models ?? []
    const effectivePlanModel = nextPlanModel || savedGatewaySettings.planModel || savedGatewaySettings.defaultModel || ''
    const effectiveRunModel = nextRunModel || savedGatewaySettings.runModel || savedGatewaySettings.defaultModel || ''
    const planModelRecord = gatewayModels.find((model) => model.id === effectivePlanModel) ?? null
    const runModelRecord = gatewayModels.find((model) => model.id === effectiveRunModel) ?? null
    const nextPlanReasoningEffort = patch.planReasoningEffort === undefined ? currentPlanReasoningEffort : patch.planReasoningEffort ?? ''
    const nextRunReasoningEffort = patch.runReasoningEffort === undefined ? currentRunReasoningEffort : patch.runReasoningEffort ?? ''
    const override = codexPayloadOverride(
      nextGatewayId,
      nextModel,
      nextPlanModel,
      nextRunModel,
      gatewayModelSupportsReasoning(planModelRecord) ? nextPlanReasoningEffort : '',
      gatewayModelSupportsReasoning(runModelRecord) ? nextRunReasoningEffort : ''
    )
    if (override) {
      nextPayload.gateway = override
    } else {
      delete nextPayload.gateway
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    const createdField = response.data as CustomField
    setCustomFields((current) => [...current, createdField])
    setCustomFieldRows((current) => {
      const nextOption = { value: createdField.id, label: createdField.name }
      const emptyIndex = current.findIndex((row) => !row.field)
      if (emptyIndex === -1) return [...current, { id: createLocalId(), field: nextOption, value: customFieldValueToDraft(createdField, createdField.defaultValue) }]
      return current.map((row, index) => index === emptyIndex ? { ...row, field: nextOption, value: customFieldValueToDraft(createdField, createdField.defaultValue) } : row)
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
    navigateToTaskDetail(response.data.task.id, { replace: true })
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
    await refreshProjectAndSelectedTask()
  }

  const saveSubtaskChecklistItems = async (items: TaskChecklistItem[]) => {
    if (!selectedSubtask) return
    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: selectedSubtask.id,
      payload: {
        ...getSubtaskPayload(selectedSubtask),
        checklistItems: items
      }
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update subtask checklist')
      return
    }
    await refreshProjectAndSelectedTask()
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
    if (!selectedTask && !selectedSubtask) return
    const titles = checklistRows.map((row) => row.title.trim()).filter(Boolean)
    if (titles.length === 0) return
    const now = Date.now()
    const createdItems = titles.map((title) => ({
      id: createLocalId(),
      title,
      checked: false,
      createdAt: now,
      updatedAt: now
    }))
    if (detailViewMode === 'subtask' && selectedSubtask) {
      await saveSubtaskChecklistItems([
        ...getSubtaskChecklistItems(selectedSubtask),
        ...createdItems
      ])
    } else if (selectedTask) {
      await saveChecklistItems([
        ...(selectedTask.checklistItems ?? []),
        ...createdItems
      ])
    }
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

  const toggleSubtaskChecklistItem = async (itemId: string) => {
    if (!selectedSubtask) return
    const now = Date.now()
    await saveSubtaskChecklistItems(getSubtaskChecklistItems(selectedSubtask).map((item) => (
      item.id === itemId ? { ...item, checked: !item.checked, updatedAt: now } : item
    )))
  }

  const removeSubtaskChecklistItem = async (itemId: string) => {
    if (!selectedSubtask) return
    await saveSubtaskChecklistItems(getSubtaskChecklistItems(selectedSubtask).filter((item) => item.id !== itemId))
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
  }

  const saveSubtaskDetail = async (options: { finalize?: boolean } = {}) => {
    const subtask = selectedSubtaskRef.current
    if (!subtask) return true
    const draft = subtaskDescriptionDraftRef.current
    const shouldFinalize = options.finalize ?? true
    const subtaskId = subtask.id
    const nextPayload = {
      ...getSubtaskPayload(subtask),
      description: draft,
      inputFormatId: '',
      outputFormatId: ''
    }
    const normalizedDraft = draft
    const isCurrentSubtask = () => selectedSubtaskRef.current?.id === subtaskId
    const isCurrentSubtaskDescriptionContext = () => isCurrentSubtask() && detailViewMode === 'subtask'

    clearSubtaskDescriptionAutosaveTimer()

    if (normalizedDraft === subtaskDescriptionSavedSnapshotRef.current) {
      if ((shouldFinalize || isSubtaskDescriptionDirty) && isCurrentSubtaskDescriptionContext()) {
        setIsSubtaskDescriptionDirty(false)
      }
      return true
    }

    if (subtaskDescriptionAutosaveInFlightRef.current) {
      if (normalizedDraft !== subtaskDescriptionAutosaveSnapshotRef.current) {
        subtaskDescriptionAutosavePendingRef.current = true
      }
      return true
    }

    const requestId = ++subtaskDescriptionAutosaveRequestIdRef.current
    subtaskDescriptionAutosaveInFlightRef.current = true
    subtaskDescriptionAutosaveSnapshotRef.current = normalizedDraft
    setIsSubtaskDescriptionSaving(true)

    const response = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
      actorToken: token,
      id: subtask.id,
      status: subtask.status,
      payload: nextPayload
    })

    if (subtaskDescriptionAutosaveRequestIdRef.current !== requestId) {
      subtaskDescriptionAutosaveInFlightRef.current = false
      setIsSubtaskDescriptionSaving(false)
      subtaskDescriptionAutosavePendingRef.current = false
      return true
    }

    subtaskDescriptionAutosaveInFlightRef.current = false

    if (!isCurrentSubtask()) {
      setIsSubtaskDescriptionSaving(false)
      return true
    }

    const latestDraft = subtaskDescriptionDraftRef.current
    const isOutOfDate = latestDraft !== normalizedDraft
    if (isOutOfDate) {
      if (subtaskDescriptionAutosavePendingRef.current) {
        subtaskDescriptionAutosavePendingRef.current = false
        return saveSubtaskDetail({ finalize: shouldFinalize })
      }
      setIsSubtaskDescriptionSaving(false)
      return true
    }

    if (!response.ok) {
      setIsSubtaskDescriptionSaving(false)
      setError(response.error?.message ?? 'Unable to update subtask details')
      subtaskDescriptionAutosaveSnapshotRef.current = latestDraft
      subtaskDescriptionDraftRef.current = latestDraft
      subtaskDescriptionAutosavePendingRef.current = false
      setIsSubtaskDescriptionDirty(true)
      return false
    }

    subtaskDescriptionAutosaveSnapshotRef.current = normalizedDraft
    subtaskDescriptionSavedSnapshotRef.current = normalizedDraft
    subtaskDescriptionDraftRef.current = normalizedDraft
    const nextSubtask = {
      ...subtask,
      payload: nextPayload
    } as TaskSubtask
    selectedSubtaskRef.current = nextSubtask
    setTasks((current) => current.map((task) => {
      if (!(task.subtasks ?? []).some((item) => item.id === subtaskId)) return task
      return {
        ...task,
        subtasks: (task.subtasks ?? []).map((item) => item.id === subtaskId ? nextSubtask : item)
      }
    }))
    if (subtaskDescriptionAutosavePendingRef.current) {
      subtaskDescriptionAutosavePendingRef.current = false
      return saveSubtaskDetail({ finalize: shouldFinalize })
    }
    setIsSubtaskDescriptionSaving(false)
    if (subtaskDescriptionDraftRef.current === normalizedDraft && isCurrentSubtaskDescriptionContext()) {
      setIsSubtaskDescriptionDirty(false)
    }
    return true
  }

  const openSubtaskDetail = (subtaskId: string) => {
    if (selectedTask?.id) {
      navigateToSubtaskDetail(selectedTask.id, subtaskId)
    }
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
      await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
  }

  const removeSelectedSubtasks = async () => {
    if (selectedSubtaskIds.length === 0) return
    const ids = [...selectedSubtaskIds]
    for (const id of ids) {
      const ok = await removeSubtask(id, false)
      if (!ok) return
    }
    setSelectedSubtaskIds([])
    await refreshProjectAndSelectedTask()
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
      setLocalChatEntries((prev) => ([
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
      await refreshProjectAndSelectedTask()
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
    setLocalChatEntries((prev) => ([
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
    await refreshProjectAndSelectedTask()
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
    setLocalChatEntries((prev) => ([
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
    await refreshProjectAndSelectedTask()
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
    await refreshProjectAndSelectedTask()
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
    clearSelection()
    setSelectedSubtaskId(null)
    setDetailViewMode('task')
    await refreshProjectAndSelectedTask()
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

  const projectSettingsModalScope = {
    project,
    projectSettingsTab,
    setProjectSettingsTab,
    selectedWorkspace,
    selectedWorkspaceId: project?.workspaceId,
    workspaceOptions,
    workspaceMoveMessage,
    movingWorkspace,
    workspaceDraftName,
    workspaceDraftPath,
    onWorkspaceDraftChange: ({ name, path }: { name: string; path: string }) => {
      setWorkspaceDraftName(name)
      setWorkspaceDraftPath(path)
    },
    onChooseWorkspaceFolder: () => void chooseProjectWorkspaceFolder(),
    onCreateWorkspace: createWorkspaceFromDraft,
    onCloseWorkspacePicker: () => setIsWorkspacePickerOpen(false),

    selectedGatewayOption,
    gateways,
    gatewayOptions,
    selectedRuntimeWorkspaceOption,
    selectedDefaultModelOption,
    selectedDefaultPlanModelOption,
    selectedDefaultRunModelOption,
              gatewayModelOptions: projectGatewayModelOptions,
    gatewayModelLoading,
    gatewayModelError,
    gatewayDefaultModel,
    gatewayDefaultPlanModel,
    gatewayDefaultRunModel,
    gatewayLanguage: projectGatewayLanguage,
    codexPromptShape: projectGatewayPromptShape,
    gatewayPlanReasoningEffort: projectGatewayPlanReasoningEffort,
    gatewayRunReasoningEffort: projectGatewayRunReasoningEffort,
    gatewayId,
    gatewayRuntimeWorkspaceId,
    onSetGatewayId: setGateway,
    onSetGatewayDefaultModel: setGatewayDefaultModel,
    onSetGatewayDefaultPlanModel: setGatewayDefaultPlanModel,
    onSetGatewayDefaultRunModel: setGatewayDefaultRunModel,
    onSetGatewayRuntimeWorkspaceId: setGatewayRuntimeWorkspaceId,
    onSetGatewayModelError: setGatewayModelError,
    gatewaySaving,
    agents,
    skills,
    defaultAgentId: projectDefaultAgentId(project),
    defaultSkillIds: projectDefaultSkillIds(project),
    onSaveProjectDefaultsSettings: saveProjectDefaultsSettings,
    onSaveProjectGatewaySettings: saveProjectGatewaySettings,
    onRefreshGatewayModels: refreshGatewayModels,
    projectGatewayModelOptions,

    isStatusTemplatePickerOpen,
    statusTemplates,
    onStatusTemplatePickerOpen: () => setIsStatusTemplatePickerOpen(true),
    onStatusTemplateClose: () => setIsStatusTemplatePickerOpen(false),
    onStatusTemplatePick: applyStatusTemplate,

    isProjectGroupPickerOpen,
    projectGroupForExport,
    projectGroups,
    projectGroupNameDraft,
    projectGroupDescriptionDraft,
    projectGroupSaving,
    onProjectGroupNameChange: setProjectGroupNameDraft,
    onProjectGroupDescriptionChange: setProjectGroupDescriptionDraft,
    onProjectGroupPickerOpen: () => setIsProjectGroupPickerOpen(true),
    onProjectGroupPickerClose: () => setIsProjectGroupPickerOpen(false),
    onProjectGroupClear: () => updateProjectGroupMembership(null),
    onProjectGroupPick: (group: ProjectGroup) => updateProjectGroupMembership(group.id),
    onSaveProjectGroup: saveSelectedProjectGroup,

    projectStatuses,
    statusDrafts,
    statusMapping,
    setStatusDrafts,
    setStatusMapping,
    onStatusDraftChange: updateStatusDraft,
    onAddActiveStatus: addActiveStatus,
    onRemoveStatusDraft: removeStatusDraft,
    onSaveProjectStatuses: saveProjectStatuses,

    projectAgentRows,
    isWorkspacePickerOpen,
    setIsWorkspacePickerOpen,
    onMoveProjectWorkspace: updateProjectWorkspace,
    pendingStatusTemplate,
    projectFolderPreview,
    workspaces,
  }


  const splitTemplate = `${Math.round(detailRatio * 100)}% 6px minmax(${MIN_COMMENTS_WIDTH}px, 1fr)`
  const hasTaskModalOpen = Boolean(
    isCreateTaskOpen ||
    isAddSubtaskOpen ||
    isProjectPromptSettingsOpen ||
    isCustomFieldModalOpen ||
    isChecklistModalOpen ||
    isOutputFormatModalOpen ||
    isTaskImportOpen
  )
  const assignedFieldIdsForModal = useMemo(() => {
    if (detailViewMode === 'subtask' && selectedSubtask) return new Set(Object.keys(getSubtaskCustomFieldValues(selectedSubtask)))
    return new Set(Object.keys(selectedTask?.customFieldValues ?? {}))
  }, [detailViewMode, selectedSubtask, selectedTask?.customFieldValues])

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
        {error ? <p>{error}</p> : <LoadingState messageIndex={0} />}
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <ProjectDetailHeader
        project={project}
        taskTitle={taskTitle}
        busy={busy}
        onTaskTitleChange={setTaskTitle}
        onQuickCreate={() => void handleQuickCreate()}
        onOpenCreateTask={() => openCreateTask(defaultStatus)}
        onOpenProjectPrompts={openProjectPromptSettings}
        onOpenAnalytics={() => setIsAnalyticsOpen(true)}
        onOpenStatusSettings={openStatusEditor}
        onSyncProject={() => void syncProjectWorkspace()}
        syncDisabled={projectSyncing}
        onBoardSelect={() => setIsRecentChatsView(false)}
        recentChatsActive={isRecentChatsView}
        recentChatsCount={projectRecentChats.length}
        onRecentChatsSelect={() => setIsRecentChatsView(true)}
      />

      {isAnalyticsOpen ? (
        <Suspense fallback={
          <>
            <div className={styles.chatBackdrop} />
            <section
              className={styles.chatPopupShell}
              role="dialog"
              aria-modal="true"
              aria-label="Loading project analytics"
              style={{ gridTemplateColumns: 'minmax(0, 1fr)', placeItems: 'center', padding: 24 }}
            >
              <LoadingState messageIndex={1} />
            </section>
          </>
        }
        >
          <ProjectAnalyticsModal
            project={project}
            tasks={hydratedTasks}
            statusColumns={statusColumns}
            agents={agents}
            onClose={() => setIsAnalyticsOpen(false)}
          />
        </Suspense>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
      {projectSyncMessage ? <p className={styles.notice}>{projectSyncMessage}</p> : null}

      {isRecentChatsView ? (
        <section className={styles.projectRecentChatsView} aria-label="Chats">
          <header className={styles.projectRecentChatsHeader}>
            <div>
              <span>Codex</span>
              <h2>Chats</h2>
            </div>
            <b>{projectRecentChats.length}</b>
          </header>
          {projectRecentChats.length > 0 ? (
            <div className={styles.projectRecentChatList}>
              {projectRecentChats.map((row) => (
                <button type="button" key={row.id} className={styles.projectRecentChatRow} onClick={() => openRecentChat(row)}>
                  <span className={styles.projectRecentChatBadges}>
                    <b className={styles.projectRecentChatSourceBadge}>{gatewayChatPhaseActionLabel(row.phase)}</b>
                    <b className={`${styles.chatStatusBadge} ${styles[`chatStatus_${projectRecentChatStatusMeta(row).tone}`] ?? ''}`}>{projectRecentChatStatusMeta(row).label}</b>
                  </span>
                  <span className={styles.projectRecentChatTask}>{row.taskTitle}</span>
                  <span className={styles.projectRecentChatMeta}>{formatChatTime(row.at)} · {row.count} mesaj{row.model ? ` · ${row.model}` : ''}</span>
                  <span className={styles.projectRecentChatPreview}>{row.preview}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.projectRecentChatEmpty}>Henüz Codex chat geçmişi yok.</p>
          )}
        </section>
      ) : (
        <ActiveProjectView
          statusColumns={statusColumns}
          tasksByStatus={tasksByStatus}
          agents={agents}
          onDropStatus={(event, status) => {
            void onDropColumn(event, status)
          }}
          onReorder={(sourceTaskId, targetTaskId, position) => void reorderBoardTasks(sourceTaskId, targetTaskId, position)}
          onOpenTask={navigateToTaskDetail}
          onOpenSubtask={navigateToSubtaskDetail}
          onOpenCreateTask={openCreateTask}
        />
      )}

      {hasTaskModalOpen ? (
        <Suspense fallback={<ProjectDetailLazyFallback />}>
          <TaskModals
            open
            selectedTask={selectedTask}
            project={project}
            isCreateTaskOpen={isCreateTaskOpen}
            onCreateTaskClose={() => {
              setIsCreateTaskOpen(false)
              setCreateTaskInitialTitle('')
              setCreateTaskInitialTemplateId(null)
            }}
            createTaskProject={{
              tags,
              agents,
              templates: taskTemplates,
              statusColumns,
              defaultStatus: createTaskStatus,
              initialTitle: createTaskInitialTitle,
              initialTemplateId: createTaskInitialTemplateId,
              busy,
              onCreate: (input) => void handleCreateTask({ ...input, projectId: projectId ?? input.projectId })
            }}
            isAddSubtaskOpen={isAddSubtaskOpen}
            onAddSubtaskClose={() => setIsAddSubtaskOpen(false)}
            onAddSubtaskCreate={(input) => void createSubtask(input)}
            onAddSubtasksCreate={(inputs) => void createSubtasks(inputs)}
            isProjectPromptSettingsOpen={isProjectPromptSettingsOpen}
            projectPromptTab={projectPromptTab}
            projectPromptContext={projectPromptContext}
            projectPromptPrompt={projectPromptPrompt}
            projectPromptPlanGuide={projectPromptPlanGuide}
            projectPromptOutput={projectPromptOutput}
            projectPromptRules={projectPromptRules}
            projectPromptPostRun={projectPromptPostRun}
            projectPromptError={projectPromptError}
            projectPromptSaving={isProjectPromptSaving}
            onProjectPromptTabChange={setProjectPromptTab}
            onProjectPromptContextChange={setProjectPromptContext}
            onProjectPromptPromptChange={setProjectPromptPrompt}
            onProjectPromptPlanGuideChange={setProjectPromptPlanGuide}
            onProjectPromptOutputChange={setProjectPromptOutput}
            onProjectPromptRulesChange={setProjectPromptRules}
            onProjectPromptPostRunChange={setProjectPromptPostRun}
            onProjectPromptClose={() => setIsProjectPromptSettingsOpen(false)}
            onProjectPromptSave={() => void saveProjectPromptSettings()}
            isCustomFieldModalOpen={isCustomFieldModalOpen}
            customFieldRows={customFieldRows}
            customFields={customFields}
            assignedFieldIds={assignedFieldIdsForModal}
            customFieldError={customFieldError}
            isCreateCustomFieldOpen={isCreateCustomFieldOpen}
            quickFieldName={quickFieldName}
            quickFieldType={quickFieldType}
            onCustomFieldRowsChange={setCustomFieldRows}
            onCustomFieldCreateRow={() => ({ id: createLocalId(), field: null, value: '' })}
            onCreateCustomFieldOpenChange={setIsCreateCustomFieldOpen}
            onQuickFieldNameChange={setQuickFieldName}
            onQuickFieldTypeChange={setQuickFieldType}
            onCustomFieldModalClose={() => setIsCustomFieldModalOpen(false)}
            onCustomFieldSave={() => void saveCustomFieldRows()}
            onCustomFieldCreate={() => void createCustomFieldFromModal()}
            onCustomFieldErrorClear={() => setCustomFieldError(null)}
            isChecklistModalOpen={isChecklistModalOpen}
            checklistRows={checklistRows}
            onChecklistRowsChange={setChecklistRows}
            onChecklistCreateRow={() => ({ id: createLocalId(), title: '' })}
            onChecklistModalClose={() => setIsChecklistModalOpen(false)}
            onChecklistSave={() => void addChecklistItems()}
            isOutputFormatModalOpen={isOutputFormatModalOpen}
            dataFormatRoleDraft={dataFormatRoleDraft}
            outputFormatDraftOption={outputFormatDraftOption}
            outputFormatOptions={dataFormatRoleDraft === 'input' ? inputFormatOptions : outputFormatOptions}
            isCreateOutputFormatOpen={isCreateOutputFormatOpen}
            quickOutputFormatName={quickOutputFormatName}
            quickOutputFormatDescription={quickOutputFormatDescription}
            onOutputFormatDraftOptionChange={setOutputFormatDraftOption}
            onCreateOutputFormatOpenChange={setIsCreateOutputFormatOpen}
            onQuickOutputFormatNameChange={setQuickOutputFormatName}
            onQuickOutputFormatDescriptionChange={setQuickOutputFormatDescription}
            onOutputFormatClose={() => setIsOutputFormatModalOpen(false)}
            onOutputFormatSave={() => void saveTaskOutputFormatFromModal()}
            onOutputFormatCreate={() => void createOutputFormatFromModal()}
            isTaskImportOpen={isTaskImportOpen}
            isTaskImporting={isTaskImporting}
            onTaskImportClose={() => setIsTaskImportOpen(false)}
            onTaskImport={(jsonText) => void importSelectedTaskJson(jsonText)}
          >
            {null}
          </TaskModals>
        </Suspense>
      ) : null}

      {isStatusEditorOpen ? (
        <Suspense fallback={<ProjectDetailLazyFallback />}>
          <ProjectDetailSettingsPopup
            open
            onClose={() => setIsStatusEditorOpen(false)}
            scope={projectSettingsModalScope}
          />
        </Suspense>
      ) : null}

      {selectedTaskId && !isChatPopupOpen ? (
        <Suspense fallback={<ProjectDetailLazyFallback />}>
          <TaskDetailPopup
            taskId={selectedTaskId}
            onClose={closeSelectedTaskDetail}
            onOpenChat={() => setIsChatPopupOpen(true)}
            onEditTitle={() => {
              if (!selectedTask) return
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
            onDownloadTaskJson={() => {
              if (selectedTaskExportContext) downloadTextFile('Task.json', buildTaskJson(selectedTaskExportContext), 'application/json;charset=utf-8')
            }}
            onExportTaskJson={() => {
              if (selectedTaskExportContext) downloadTextFile(`${selectedTask?.title || 'Task'}.json`, buildTaskImportJson(selectedTaskExportContext), 'application/json;charset=utf-8')
            }}
            onDownloadTaskToon={() => {
              if (selectedTaskExportContext) downloadTextFile('Task.toon', buildTaskToon(selectedTaskExportContext), 'text/plain;charset=utf-8')
            }}
            onDownloadAgentMarkdown={selectedTaskAgentMarkdown.trim() ? () => downloadMarkdownFile('Agents.md', selectedTaskAgentMarkdown) : undefined}
            onDownloadSkillsMarkdown={selectedTaskSkillsMarkdown.trim() ? () => downloadMarkdownFile('Skills.md', selectedTaskSkillsMarkdown) : undefined}
            onRunGateway={handleRunSelectedTaskWithCodex}
            isRunGatewayBusy={gatewayRunLaunching}
            isRunGatewayDisabled={!canRunSelectedTaskWithCodex}
            onStopRunGateway={handleStopSelectedTaskRun}
            isRunGatewayRunning={Boolean(activeSelectedTaskRunConversation)}
            onPlanWithGateway={handlePlanSelectedTaskWithCodex}
            isPlanWithGatewayBusy={gatewayPlanLaunching}
            isPlanWithGatewayDisabled={!canPlanSelectedTaskWithCodex}
            onStopPlanGateway={handleStopSelectedTaskPlan}
            isPlanWithGatewayRunning={Boolean(activeSelectedTaskPlanConversation)}
            isStopGatewayBusy={chatStopping}
            onImportJson={() => setIsTaskImportOpen(true)}
            scope={{
              isTaskDetailLoading: selectedTaskDetailLoading,
              taskDetailError: selectedTaskDetailError,
              project,
              selectedTask,
              detailTab,
              setDetailTab,
              detailViewMode,
              setDetailViewMode,
              selectedSubtask,
              setSelectedSubtaskId,
              modalBodyRef,
              splitTemplate,
              onResizeStart: () => setIsResizingSplit(true),
              clearSelection,
              closeTaskDetail: () => {
                clearSelection()
                navigateToProjectDetail({ replace: true })
              },
              isTitleEditing,
              setIsTitleEditing,
              titleDraft,
              setTitleDraft,
              resizeTitleTextarea,
              saveTitle,
              resolveColumnByStatus,
              statusColumns,
              updateTaskStatus,
              selectedTaskTagOptions,
              availableTagOptions,
              setTaskTags,
              createTagAndAttach,
              descriptionDraft,
              setDescriptionDraft: setTaskDescriptionDraft,
              isDescriptionEditing,
              isDescriptionSaving,
              resetDescriptionDraft: resetTaskDescriptionDraft,
              outputFormats,
              createDescriptionDataFormat,
              saveDescription,
              saveAcceptanceCriteria,
              completedStatusIds,
              selectedSubtaskIds,
              removeSelectedSubtasks,
              setIsAddSubtaskOpen,
              pendingDeleteSubtaskId,
              setSubtaskStatusMenu,
              scheduleOpenSubtaskDetail,
              startSubtaskRename,
              removeSubtask,
              assignedCustomFieldValues,
              openCustomFieldModal,
              customFieldError,
              editingCustomFieldId,
              setEditingCustomFieldId,
              customFieldDraft,
              setCustomFieldDraft,
              setCustomFieldError,
              setSelectedCustomFieldOption,
              saveCustomFieldValue,
              removeCustomFieldValue,
              openChecklistModal,
              toggleChecklistItem,
              removeChecklistItem,
              taskAttachmentRows,
              isAttachmentUploading,
              uploadTaskAttachments,
              removeTaskAttachment,
              setError,
              selectedTaskAgent,
              selectedTaskAgentIsDefault,
              selectedTaskAgentDefaultLabel,
              agents,
              setTaskAgent,
              selectedTaskSkills,
              selectedTaskSkillsAreDefault,
              selectedTaskSkillOptions,
              skills,
              setTaskSkills,
              savedGatewaySettings,
              gateways,
              gatewayOptions,
              selectedGateway: selectedGatewayOption ? { name: selectedGatewayOption.label, id: selectedGatewayOption.value ?? '' } : null,
              setTaskGatewaySelection,
              openGatewaySettings: () => { setIsStatusEditorOpen(true); setProjectSettingsTab('codex') },
              commentDraft,
              setCommentDraft,
              editingCommentId,
              submitComment,
              startEditComment,
              removeComment,
              cancelEditComment
            }}
          />

          {selectedSubtask && detailViewMode === 'subtask' ? (
            <TaskDetailPopup
              taskId={selectedSubtask.id}
              title="Subtask detail"
              nested
              hideTaskActions
              onClose={() => {
                setSelectedSubtaskId(null)
                setDetailViewMode('task')
                setDetailTab('subtasks')
                setCustomFieldError(null)
                navigateToTaskDetail(selectedTask.id, { replace: true })
              }}
              onOpenChat={() => undefined}
              onEditTitle={() => {
                setEditingSubtaskId(selectedSubtask.id)
                setSubtaskDraft(selectedSubtask.title)
              }}
              onDeleteTask={() => void removeSubtask(selectedSubtask.id)}
              onFilesDrop={(files) => void uploadSubtaskAttachments(files)}
              scope={{
                variant: 'subtask',
                project,
                selectedTask,
                selectedSubtask,
                detailTab,
                setDetailTab,
                modalBodyRef,
                splitTemplate,
                onResizeStart: () => setIsResizingSplit(true),
                setSelectedSubtaskId,
                setDetailViewMode,
                closeSubtaskDetail: () => {
                  setSelectedSubtaskId(null)
                  setDetailViewMode('task')
                  setDetailTab('subtasks')
                  setCustomFieldError(null)
                  navigateToTaskDetail(selectedTask.id, { replace: true })
                },
                setCustomFieldError,
                editingSubtaskId,
                setEditingSubtaskId,
                subtaskDraft,
                setSubtaskDraft,
                resizeTitleTextarea,
                saveSubtaskTitle,
                resolveColumnByStatus,
                statusColumns,
                updateSubtaskStatus,
                selectedSubtaskTagOptions,
                availableTagOptions,
                setSubtaskTags,
                createTagAndAttachToSubtask,
                subtaskDescriptionDraft,
                setSubtaskDescriptionDraft: setSelectedSubtaskDescriptionDraft,
                isSubtaskDescriptionDirty,
                isSubtaskDescriptionSaving,
                resetSubtaskDescriptionDraft: resetSelectedSubtaskDescriptionDraft,
                outputFormats,
                createDescriptionDataFormat,
                saveSubtaskDetail,
                getSubtaskDescription,
                selectedSubtaskAgent,
                agents,
                setSubtaskAgent,
                selectedSubtaskSkillOptions,
                selectedSubtaskSkills,
                skills,
                setSubtaskSkills,
                assignedSubtaskCustomFieldValues,
                openCustomFieldModal,
                customFieldError,
                editingCustomFieldId,
                setEditingCustomFieldId,
                setSelectedCustomFieldOption,
                customFieldDraft,
                setCustomFieldDraft,
                saveCustomFieldValue,
                removeCustomFieldValue,
                openChecklistModal,
                toggleSubtaskChecklistItem,
                removeSubtaskChecklistItem,
                subtaskAttachmentRows,
                isAttachmentUploading,
                uploadSubtaskAttachments,
                removeSubtaskAttachment,
                setError,
                comments: getSubtaskComments(selectedSubtask),
                commentDraft: subtaskCommentDraft,
                setCommentDraft: setSubtaskCommentDraft,
                editingCommentId: editingSubtaskCommentId,
                submitComment: submitSubtaskComment,
                startEditComment: startEditSubtaskComment,
                removeComment: removeSubtaskComment,
                cancelEditComment: cancelEditSubtaskComment
              }}
            />
          ) : null}
        </Suspense>
      ) : null}

        {isChatPopupOpen ? (
          <Suspense fallback={<ProjectDetailLazyFallback />}>
            <ChatPopup chatState={chatState} chatHandlers={chatHandlers} />
          </Suspense>
        ) : null}
        <PlanChoiceModal
          open={planChoiceOpen}
          loading={gatewayPlanLaunching}
          onClose={closePlanChoice}
          onSelect={(mode) => void confirmPlanWithGateway(mode)}
        />
    </section>
  )
}
