import { useEffect, useMemo, useRef, type CSSProperties, type DragEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  LuBot,
  LuCheck,
  LuChevronDown,
  LuColumns3,
  LuFlag,
  LuListChecks,
  LuListTodo,
  LuMessageSquare,
  LuPaperclip,
  LuPencil,
  LuPlay,
  LuPlus,
  LuSettings2,
  LuSlidersHorizontal,
  LuSparkles,
  LuTrash2
} from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import { Agent, Gateway, OutputFormat, Project, ProjectGroup, ProjectStatus, ProjectStatusCategory, Skill, StatusTemplate, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskEntity, TaskJsonImportResult, TaskSubtask, TaskTemplate, Workspace, CustomField } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { MarkdownDescriptionEditor, prefixDataFormatTokens, type DescriptionDataFormat } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { AttachmentTable, storedAttachmentRows } from '@renderer/components/attachments/AttachmentTable'
import { AttachmentRow, attachmentRowsFromDescription, removeAttachmentFromMarkdown, uploadTaskAttachment } from '@renderer/components/attachments/attachments'
import { Stack } from 'react-bootstrap'
import { ProjectDetailHeader } from '@renderer/components/projects/detail/ProjectDetailHeader'
import { ProjectSettingsModal } from '@renderer/components/projects/detail/ProjectSettingsModal'
import { ActiveProjectView } from '@renderer/components/projects/detail/ActiveProjectView'
import { TaskModals } from '@renderer/components/projects/detail/TaskModals'
import { TaskDetailPanel } from '@renderer/components/projects/detail/TaskDetailPanel'
import { SubtaskDetailPanel } from '@renderer/components/projects/detail/SubtaskDetailPanel'
import { createTaskWithTemplate, type CreateTaskInput } from './detail/createTaskWithTemplate'
import { useProjectDetailData } from './detail/hooks/useProjectDetailData'
import { useProjectActivityPopup } from './detail/hooks/useProjectActivityPopup'
import { useProjectCodexFlow } from './detail/hooks/useProjectCodexFlow'
import { useProjectSelection } from './detail/hooks/useProjectSelection'
import { useProjectDerivedState } from './detail/hooks/useProjectDerivedState'
import { AgentAssignmentPanel, SkillsAssignmentPanel } from '@renderer/components/projects/detail/AssignmentPanels'
import { TaskDetailContent } from '@renderer/components/projects/detail/TaskDetailContent'
import { buildAgentMarkdown, buildProjectWorkspaceExportTaskPayload, buildSkillsMarkdown, buildTaskMarkdown, downloadMarkdownFile, downloadTaskZip } from './detail/taskExport'
import { resolveProjectStatusColumn } from './detail/status'
import { useProjectDetailDispatcher, useProjectDetailReducer } from './detail/state/projectDetailState'
import {
  CHAT_INITIAL_MESSAGE_LIMIT
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
  projectCodexSettings,
  projectWorkspaceFolder,
  statusOrderPayload,
  taskCodexGatewayId,
  taskCodexModel
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
  ChatComposerMode,
  CustomFieldDraftRow,
  DataFormatRole,
  DetailTab,
  DetailViewMode,
  ProjectPromptTab,
  ProjectSettingsTab,
  ProjectTableViewConfig,
  ProjectViewMode,
  TableColumnConfig,
  TaskActivityMessage,
  TaskHistoryItem,
  TextDraftRow,
  ThreadEntry
} from './detail/types'
import { ActivityPopup } from '@renderer/popups/Activity'
import { TaskDetailPopup } from '@renderer/popups/TaskDetail'
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
    viewMode,
    setViewMode,
    taskTitle,
    setTaskTitle,
    listCreateStatus,
    setListCreateStatus,
    listCreateTitle,
    setListCreateTitle,
    tableCreateActive,
    setTableCreateActive,
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
    projectPromptOutput,
    setProjectPromptOutput,
    projectPromptError,
    setProjectPromptError,
    isProjectPromptSaving,
    setIsProjectPromptSaving,
    codexGatewayId,
    setCodexGatewayId,
    codexRuntimeWorkspaceId,
    setCodexRuntimeWorkspaceId,
    codexDefaultModel,
    setCodexDefaultModel,
    codexModelLoading,
    setCodexModelLoading,
    codexModelError,
    setCodexModelError,
    codexSaving,
    setCodexSaving,
    codexRunLaunching,
    setCodexRunLaunching,
    codexPlanLaunching,
    setCodexPlanLaunching,
    codexRunFeedback,
    setCodexRunFeedback,
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
    collapsedStatuses,
    setCollapsedStatuses,
    error,
    setError,
    busy,
    setBusy,
    selectedTaskId,
    setSelectedTaskId,
    isActivityModalOpen,
    setIsActivityModalOpen,
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
    localActivityEntries,
    setLocalActivityEntries,
    detailRatio,
    setDetailRatio,
    isResizingSplit,
    setIsResizingSplit,
    isTableColumnPickerOpen,
    setIsTableColumnPickerOpen
  } = projectDetailState

  const modalBodyRef = useRef<HTMLDivElement | null>(null)
  const activityFeedRef = useRef<HTMLDivElement | null>(null)
  const chatFileInputRef = useRef<HTMLInputElement | null>(null)
  const chatDraftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const subtaskStatusMenuRef = useRef<HTMLDivElement | null>(null)
  const subtaskClickTimerRef = useRef<number | null>(null)
  const lastCodexModelRefreshRef = useRef<string | null>(null)

  const {
    refresh,
    projectLoadError
  } = useProjectDetailData({
    token,
    projectId,
    state: projectDetailState
  })

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
      setDescriptionDraft
    },
    tasks
  })

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

  const {
    hydratedTasks,
    selectedTask,
    selectedSubtask,
    statusColumns,
    defaultStatus,
    completedStatusIds,
    tableTasks,
    tasksByStatus,
    tableColumns,
    chatActivityMessages,
    chatConversations: derivedChatConversations,
    selectedChatSummary: derivedSelectedChatSummary
  } = useProjectDerivedState({
    project,
    tasks,
    tags,
    projectStatuses,
    selectedTaskId,
    selectedSubtaskId,
    customFields: customFields as Array<{ id: string; name?: string }>,
    detailTab,
    detailViewMode,
    selectedChatConversationId,
    isStartingNewChat
  })

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
        clearSelection()
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

  const chatConversations = derivedChatConversations
  const taskContextSkills = selectedTask?.skills ?? []

  const selectedTaskExportContext = useMemo(() => {
    if (!selectedTask) return null
    return { task: selectedTask, project, projectGroup: projectGroupForExport, agents, skills, tags, customFields, projectStatuses }
  }, [agents, customFields, project, projectGroupForExport, projectStatuses, selectedTask, skills, tags])
  const selectedTaskAgentMarkdown = selectedTaskExportContext ? buildAgentMarkdown(selectedTaskExportContext) : ''
  const selectedTaskSkillsMarkdown = selectedTaskExportContext ? buildSkillsMarkdown(selectedTaskExportContext) : ''
  const { canRunSelectedTaskWithCodex, canPlanSelectedTaskWithCodex, canSendChat, chatOperationFeedback, refreshCodexGatewayModels, runSelectedTaskWithCodex, planSelectedTaskWithCodex, sendCodexChatMessage, stopCodexChat, addChatAttachments, applySlashCommand } = useProjectCodexFlow({
    token,
    project,
    selectedTask,
    selectedTaskExportContext,
    taskRunGatewayId: selectedTask ? taskCodexGatewayId(selectedTask) : '',
    taskRunModel: selectedTask ? taskCodexModel(selectedTask) : '',
    savedCodexDefaultGatewayId: savedCodexSettings.gatewayId,
    savedCodexDefaultModel: savedCodexSettings.defaultModel,
    chatDraft,
    chatAttachments,
    chatGatewayId,
    chatModel,
    chatIncludeContext,
    chatComposerMode,
    selectedChatConversationId,
    isStartingNewChat,
    selectedChatSummary: derivedSelectedChatSummary,
    codexRunFeedback,
    codexRunLaunching,
    codexPlanLaunching,
    chatSending,
    chatStopping,
    state: {
      setCodexRunLaunching,
      setCodexPlanLaunching,
      setCodexRunFeedback,
      setChatSending,
      setChatStopping,
      setChatSettingsOpen,
      setIsActivityModalOpen,
      setIsStartingNewChat,
      setSelectedChatConversationId,
      setCodexModelLoading,
      setCodexModelError,
      setCodexDefaultModel,
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

  const { chatState, chatHandlers } = useProjectActivityPopup({
    selectedTask,
    isActivityModalOpen,
    selectedChatSummary: derivedSelectedChatSummary,
    activityFeedRef,
    chatDraftTextareaRef,
    chatFileInputRef,
    chatDragDepth,
    chatDraft,
    chatSending,
    canSendChat,
    chatAttachments,
    chatGateway,
    chatGatewayOption,
    chatGatewayOptions: codexGatewayOptions,
    chatModel,
    chatModelOption,
    chatModelOptions,
    chatGatewayConfig,
    chatRuntimeWorkspace,
    runtimeWorkspaceId: savedCodexSettings.runtimeWorkspaceId,
    chatIncludeContext,
    chatOperationFeedback,
    codexPlanLaunching,
    codexRunLaunching,
    selectedChatConversationId,
    setSelectedChatConversationId,
    isStartingNewChat,
    setIsStartingNewChat,
    setChatComposerMode,
    setCodexRunFeedback,
    setChatDraft,
    setChatAttachments,
    setChatVisibleLimit,
    chatConversations,
    chatActivityMessages,
    history,
    localActivityEntries,
    chatStopping,
    selectedTaskAgent,
    taskContextSkills,
    setSlashCommandIndex,
    setChatSettingsOpen,
    setChatModel,
    setChatIncludeContext,
    setChatGatewayId,
    setChatComposerFocused,
    chatSettingsOpen,
    slashCommandIndex,
    chatComposerFocused,
    runSelectedTaskWithCodex,
    planSelectedTaskWithCodex,
    sendCodexChatMessage,
    stopCodexChat,
    applySlashCommand,
    addChatAttachments,
    onClose: () => setIsActivityModalOpen(false),
    setChatDragDepth
  })

  useEffect(() => {
    if (projectSettingsTab !== 'codex' || !codexGatewayId) return
    const shouldRefresh = lastCodexModelRefreshRef.current !== codexGatewayId || codexModelOptions.length === 0
    if (shouldRefresh && !codexModelLoading) void refreshCodexGatewayModels(codexGatewayId)
  }, [projectSettingsTab, codexGatewayId, codexModelLoading, codexModelOptions.length, refreshCodexGatewayModels])

  useEffect(() => {
    if (detailTab !== 'model' || !effectiveTaskGatewayId) return
    const shouldRefresh = lastCodexModelRefreshRef.current !== effectiveTaskGatewayId || taskModelOptions.length === 0
    if (shouldRefresh && !codexModelLoading) void refreshCodexGatewayModels(effectiveTaskGatewayId)
  }, [detailTab, effectiveTaskGatewayId, taskModelOptions.length, codexModelLoading, refreshCodexGatewayModels])


  const closeSelectedTaskDetail = () => {
    clearSelection()
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
      openTask(state.openTaskId)
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
    openTask(result.task.id)
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
    clearSelection()
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

    selectedCodexGatewayOption,
    codexGatewayOptions,
    selectedRuntimeWorkspaceOption,
    selectedDefaultModelOption,
    codexModelOptions,
    codexModelLoading,
    codexModelError,
    codexDefaultModel,
    codexGatewayId,
    codexRuntimeWorkspaceId,
    onSetCodexGatewayId: (value: string) => {
      const nextGateway = gateways.find((item) => item.id === value)
      const models = codexConfigOf(nextGateway).models ?? []
      setCodexGatewayId(value)
      setCodexModelError(null)
      if (!models.some((model) => model.id === codexDefaultModel)) setCodexDefaultModel('')
    },
    onSetCodexDefaultModel: setCodexDefaultModel,
    onSetCodexRuntimeWorkspaceId: setCodexRuntimeWorkspaceId,
    onSetCodexModelError: setCodexModelError,
    codexSaving,
    onSaveProjectCodexSettings: saveProjectCodexSettings,
    projectCodexModelOptions,

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
    onProjectGroupClear: () => void updateProjectGroupMembership(null),
    onProjectGroupPick: (group: ProjectGroup) => void updateProjectGroupMembership(group.id),
    onSaveProjectGroup: () => void saveSelectedProjectGroup(),

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

      <ActiveProjectView
        viewMode={viewMode}
        statusColumns={statusColumns}
        tasksByStatus={tasksByStatus}
        agents={agents}
        onDropStatus={(event, status) => {
          void onDropColumn(event, status)
        }}
        onReorder={(sourceTaskId, targetTaskId) => void reorderTableTasks(sourceTaskId, targetTaskId)}
        onOpenTask={setSelectedTaskId}
        onOpenCreateTask={openCreateTask}
        onStatusChange={(taskId, status) => void updateTaskStatus(taskId, status)}
        onToggleStatus={toggleStatusGroup}
        onOpenColumnPicker={() => setIsTableColumnPickerOpen(true)}
        onColumnWidthChange={(columnId, width) => void setTableColumnWidth(columnId, width)}
        collapsedStatuses={collapsedStatuses}
        tableTasks={tableTasks}
        tableColumns={tableColumns}
        customFields={customFields}
      />

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
        isTableColumnPickerOpen={isTableColumnPickerOpen}
        availableTableColumns={availableTableColumns}
        selectedTableColumns={tableColumns}
        onCloseTableColumnPicker={() => setIsTableColumnPickerOpen(false)}
        onTableColumnsSave={(columns) => void setTableColumns(columns)}
        isProjectPromptSettingsOpen={isProjectPromptSettingsOpen}
        projectPromptTab={projectPromptTab}
        projectPromptContext={projectPromptContext}
        projectPromptPrompt={projectPromptPrompt}
        projectPromptOutput={projectPromptOutput}
        projectPromptError={projectPromptError}
        projectPromptSaving={isProjectPromptSaving}
        onProjectPromptTabChange={setProjectPromptTab}
        onProjectPromptContextChange={setProjectPromptContext}
        onProjectPromptPromptChange={setProjectPromptPrompt}
        onProjectPromptOutputChange={setProjectPromptOutput}
        onProjectPromptClose={() => setIsProjectPromptSettingsOpen(false)}
        onProjectPromptSave={() => void saveProjectPromptSettings()}
        isCustomFieldModalOpen={isCustomFieldModalOpen}
        customFieldRows={customFieldRows}
        customFields={customFields}
        assignedFieldIds={
          detailViewMode === 'subtask' && selectedSubtask
            ? new Set(Object.keys(getSubtaskCustomFieldValues(selectedSubtask)))
            : new Set(Object.keys(selectedTask?.customFieldValues ?? {}))
        }
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

      <ProjectSettingsModal
        open={isStatusEditorOpen}
        onClose={() => setIsStatusEditorOpen(false)}
        scope={projectSettingsModalScope}
      ></ProjectSettingsModal>

      {selectedTask ? (
        <>
          <TaskDetailPopup
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
            <TaskDetailPanel>
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
                  <button type="button" className={styles.breadcrumbBtn} onClick={clearSelection}>
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
            </TaskDetailPanel>
        </TaskDetailPopup>

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
                }}
                onOpenActivity={() => undefined}
                onEditTitle={() => {
                  setEditingSubtaskId(selectedSubtask.id)
                  setSubtaskDraft(selectedSubtask.title)
                }}
                onDeleteTask={() => void removeSubtask(selectedSubtask.id)}
            onFilesDrop={(files) => void uploadSubtaskAttachments(files)}
          >
            <SubtaskDetailPanel>
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
            </SubtaskDetailPanel>
              </TaskDetailPopup>
          ) : null}
        </>
      ) : null}

        {isActivityModalOpen ? <ActivityPopup chatState={chatState} chatHandlers={chatHandlers} /> : null}
    </section>
  )
}
