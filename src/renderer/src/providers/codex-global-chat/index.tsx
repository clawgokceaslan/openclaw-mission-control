import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { CustomField, Gateway, Project, ProjectStatus, Skill, Tag, TaskEntity, Workspace, Agent } from '@shared/types/entities'
import { DEFAULT_CODEX_LANGUAGE } from '@shared/utils/codex-language'
import { ChatPopup } from '@renderer/popups/ChatPopup'
import { useConfirmation } from '@renderer/components/confirmation'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { buildChatConversationSummaries, buildGeneratedContextEntries, activityMessagesFromTask, appendActivityMessageToTasks, conversationIdOf, visibleChatMessagesForLimit } from '@renderer/screens/projects/detail/chat/chatUtils'
import { buildProjectWorkspaceExportTaskPayload, buildTaskZipArchive } from '@renderer/screens/projects/detail/taskExport'
import { codexConfigOf, projectCodexSettings, projectDefaultAgentId, projectDefaultSkillIds, readTaskCodexOverride } from '@renderer/screens/projects/detail/projectDetailUtils'
import type { ChatConversationSummary, TaskActivityMessage } from '@renderer/screens/projects/detail/types'

type LaunchRequest = {
  projectId: string
  taskId: string
}

type GlobalCodexChatContextValue = {
  launchPlannedTaskRun: (request: LaunchRequest) => Promise<boolean>
  openProjectCodexSettings: (projectId: string, taskId?: string) => void
  busy: boolean
  error: string | null
}

type CodexRunResponse = {
  workspacePath?: string
  runtimeWorkspacePath?: string
  model: string
  gatewayId: string
  executionMode?: 'terminal' | 'exec'
  runId?: string
  conversationId?: string
}

const GlobalCodexChatContext = createContext<GlobalCodexChatContextValue | null>(null)

export function useGlobalCodexChat(): GlobalCodexChatContextValue {
  const value = useContext(GlobalCodexChatContext)
  if (!value) throw new Error('useGlobalCodexChat must be used inside GlobalCodexChatProvider')
  return value
}

export function GlobalCodexChatProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const confirm = useConfirmation()
  const chatFeedRef = useRef<HTMLDivElement | null>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [task, setTask] = useState<TaskEntity | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState('')
  const [popupOpen, setPopupOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<TaskActivityMessage | null>(null)

  const openProjectCodexSettings = useCallback((projectId: string, taskId?: string) => {
    navigate(`${APP_ROUTES.PROJECTS}/${projectId}`, {
      state: {
        openTaskId: taskId,
        openProjectSettings: true,
        projectSettingsTab: 'models'
      }
    })
  }, [navigate])

  const loadRunContext = useCallback(async (projectId: string, taskId: string) => {
    const [
      taskResponse,
      projectResponse,
      agentsResponse,
      skillsResponse,
      tagsResponse,
      customFieldsResponse,
      statusesResponse,
      gatewaysResponse,
      workspacesResponse
    ] = await Promise.all([
      invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.get, { actorToken: token, id: taskId }),
      invokeBridge<Project>(IPC_CHANNELS.projects.get, { actorToken: token, id: projectId }),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token ?? null),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token ?? null),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token ?? null),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token ?? null),
      invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId }),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token ?? null),
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token ?? null)
    ])

    if (!taskResponse.ok || !taskResponse.data) throw new Error(taskResponse.error?.message ?? 'Task not found')
    if (!projectResponse.ok || !projectResponse.data) throw new Error(projectResponse.error?.message ?? 'Project not found')

    return {
      task: taskResponse.data,
      project: projectResponse.data,
      agents: Array.isArray(agentsResponse.data) ? agentsResponse.data : [],
      skills: Array.isArray(skillsResponse.data) ? skillsResponse.data : [],
      tags: Array.isArray(tagsResponse.data) ? tagsResponse.data : [],
      customFields: Array.isArray(customFieldsResponse.data) ? customFieldsResponse.data : [],
      projectStatuses: Array.isArray(statusesResponse.data) ? statusesResponse.data : [],
      gateways: Array.isArray(gatewaysResponse.data) ? gatewaysResponse.data : [],
      workspaces: Array.isArray(workspacesResponse.data) ? workspacesResponse.data : []
    }
  }, [token])

  const launchPlannedTaskRun = useCallback(async ({ projectId, taskId }: LaunchRequest) => {
    if (!token) {
      setError('Sign in is required before starting a Codex run.')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      const context = await loadRunContext(projectId, taskId)
      const codex = projectCodexSettings(context.project)
      const taskCodex = readTaskCodexOverride(context.task)
      const gatewayId = taskCodex.gatewayId || codex.gatewayId || ''
      const model = taskCodex.runModel || taskCodex.legacyModel || codex.runModel || codex.defaultModel || ''
      if (!gatewayId || !model) {
        setBusy(false)
        openProjectCodexSettings(projectId, taskId)
        return false
      }

      const confirmed = await confirm({
        title: 'Start Codex run?',
        message: `Run "${context.task.title}" from ${context.project.name}.`,
        confirmLabel: 'Start run',
        cancelLabel: 'Cancel'
      })
      if (!confirmed) {
        setBusy(false)
        return false
      }

      const defaultAgentId = projectDefaultAgentId(context.project)
      const defaultSkillIds = new Set(projectDefaultSkillIds(context.project))
      const taskSkills = (context.task.skills?.length ?? 0) > 0
        ? context.task.skills ?? []
        : context.skills.filter((skill) => defaultSkillIds.has(skill.id))
      const effectiveTask = {
        ...context.task,
        agentId: context.task.agentId || defaultAgentId || null,
        skills: taskSkills
      }
      const exportContext = {
        task: effectiveTask,
        project: context.project,
        projectGroup: null,
        agents: context.agents,
        skills: context.skills,
        tags: context.tags,
        customFields: context.customFields,
        projectStatuses: context.projectStatuses,
        codexLanguage: codex.language || DEFAULT_CODEX_LANGUAGE,
        codexRunReasoningEffort: codex.runReasoningEffort || 'medium'
      }
      setTask(effectiveTask)
      setProject(context.project)
      setGateways(context.gateways)
      setWorkspaces(context.workspaces)
      setPopupOpen(true)
      setLocalStatus({
        id: `global-run-${Date.now()}`,
        runId: 'global-run-launch',
        conversationId: selectedConversationId || undefined,
        source: 'codex-run',
        role: 'thinking',
        status: 'running',
        body: 'Starting Codex run...',
        createdAt: Date.now()
      })

      const snapshot = buildProjectWorkspaceExportTaskPayload(exportContext)
      const basePayload = {
        actorToken: token,
        taskId,
        projectId,
        gatewayId,
        model,
        language: codex.language || DEFAULT_CODEX_LANGUAGE,
        reasoningEffort: codex.runReasoningEffort || 'medium',
        generalContext: context.project.generalContext ?? '',
        generalPrompt: context.project.generalPrompt ?? '',
        defaultOutput: context.project.defaultOutput ?? ''
      }
      let response = await invokeBridge<CodexRunResponse>(IPC_CHANNELS.tasks.runCodex, {
        ...basePayload,
        taskMarkdown: snapshot.taskMarkdown,
        agentMarkdown: snapshot.agentMarkdown,
        skillsMarkdown: snapshot.skillsMarkdown,
        attachments: snapshot.attachments
      })
      const errorMessage = response.ok ? '' : response.error?.message ?? ''
      if (!response.ok && /zip bytes|required/i.test(errorMessage)) {
        const zip = await buildTaskZipArchive(exportContext)
        response = await invokeBridge<CodexRunResponse>(IPC_CHANNELS.tasks.runCodex, {
          ...basePayload,
          zipName: zip.fileName,
          zipBytes: zip.archive
        })
      }
      if (!response.ok) throw new Error(response.error?.message ?? 'Unable to launch Codex')
      const conversationId = response.data?.conversationId || response.data?.runId || ''
      if (conversationId) setSelectedConversationId(conversationId)
      setLocalStatus(null)
      return true
    } catch (launchError) {
      const message = launchError instanceof Error ? launchError.message : 'Unable to launch Codex'
      setError(message)
      setLocalStatus({
        id: `global-run-error-${Date.now()}`,
        runId: 'global-run-launch',
        source: 'codex-run',
        role: 'error',
        status: 'failed',
        body: message,
        createdAt: Date.now()
      })
      return false
    } finally {
      setBusy(false)
    }
  }, [confirm, loadRunContext, openProjectCodexSettings, selectedConversationId, token])

  useEffect(() => {
    const onTaskActivity = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as { projectId?: string; taskId?: string; message?: TaskActivityMessage } | undefined
      if (!payload?.taskId || !payload.message) return
      setTask((current) => {
        if (!current || current.id !== payload.taskId) return current
        return appendActivityMessageToTasks([current], current.id, payload.message)[0] ?? current
      })
      const nextConversationId = conversationIdOf(payload.message)
      if (nextConversationId) setSelectedConversationId((current) => current || nextConversationId)
    }
    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
  }, [])

  const messages = useMemo(() => task ? activityMessagesFromTask(task) : [], [task])
  const conversations = useMemo(() => buildChatConversationSummaries(messages), [messages])
  const contextEntries = useMemo(() => buildGeneratedContextEntries(messages), [messages])
  const activeConversationId = selectedConversationId || conversations[0]?.id || ''
  const visibleMessages = useMemo(() => {
    if (!activeConversationId) return []
    return messages
      .filter((message) => conversationIdOf(message) === activeConversationId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }, [activeConversationId, messages])
  const renderedMessages = useMemo(() => visibleChatMessagesForLimit(visibleMessages, 80), [visibleMessages])
  const runningConversationIds = useMemo(() => {
    const ids = new Set<string>()
    conversations.filter((conversation) => conversation.status === 'running' || conversation.status === 'queued').forEach((conversation) => ids.add(conversation.id))
    return ids
  }, [conversations])
  const gateway = useMemo(() => gateways.find((item) => item.id === (readTaskCodexOverride(task).gatewayId || projectCodexSettings(project).gatewayId)) ?? null, [gateways, project, task])
  const codex = projectCodexSettings(project)
  const taskCodex = readTaskCodexOverride(task)
  const model = taskCodex.runModel || taskCodex.legacyModel || codex.runModel || codex.defaultModel || ''
  const modelOptions = useMemo(() => (codexConfigOf(gateway).models ?? []).map((item) => ({ label: item.label || item.id, value: item.id })), [gateway])
  const chatState = {
    task,
    chatDragDepth: 0,
    conversations,
    sidebarConversations: conversations.slice(0, 30),
    selectedConversationId: activeConversationId,
    isStartingNewChat: false,
    runningConversationIds,
    stoppingConversationIds: new Set<string>(),
    chatHistoryCount: 0,
    contextEntries,
    chatSettingsOpen: false,
    chatMode: 'chat' as const,
    selectedChatCanStop: Boolean(activeConversationId && runningConversationIds.has(activeConversationId)),
    chatStopping: false,
    codexPlanLaunching: false,
    codexRunLaunching: busy,
    planChoiceOpen: false,
    visibleMessages,
    renderedMessages,
    hiddenMessageCount: Math.max(0, visibleMessages.length - renderedMessages.length),
    localStatusMessage: localStatus,
    chatFeedRef,
    chatGateway: gateway,
    chatGatewayOption: gateway ? { label: gateway.name, value: gateway.id } : null,
    chatGatewayOptions: gateways.map((item) => ({ label: item.name, value: item.id })),
    chatModel: model,
    chatModelOption: model ? { label: model, value: model } : null,
    chatPlanModel: codex.planModel || codex.defaultModel || '',
    chatPlanModelOption: null,
    chatRunModel: model,
    chatRunModelOption: model ? { label: model, value: model } : null,
    chatModelOptions: modelOptions,
    chatGatewayConfig: codexConfigOf(gateway),
    chatRuntimeWorkspace: workspaces.find((workspace) => workspace.id === codex.runtimeWorkspaceId) ?? null,
    runtimeWorkspaceId: codex.runtimeWorkspaceId,
    chatIncludeContext: true,
    attachments: [],
    slashMenuOpen: false,
    slashCommands: [],
    slashCommandIndex: 0,
    draftTextareaRef,
    fileInputRef,
    draft: '',
    chatSending: false,
    canSendChat: false,
    selectedChatIsRunning: Boolean(activeConversationId && runningConversationIds.has(activeConversationId)),
    selectedChatSummary: conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    selectedChatUsage: null,
    selectedTaskAgent: null,
    taskContextSkills: task?.skills ?? []
  }
  const chatHandlers = {
    onClose: () => setPopupOpen(false),
    onDragEnter: (_event: DragEvent<HTMLElement>) => {},
    onDragOver: (_event: DragEvent<HTMLElement>) => {},
    onDragLeave: (_event: DragEvent<HTMLElement>) => {},
    onDrop: (_event: DragEvent<HTMLElement>) => {},
    onNewConversation: () => {},
    onConversationSelect: (conversationId: string) => setSelectedConversationId(conversationId),
    onSettingsToggle: () => openProjectCodexSettings(project?.id ?? '', task?.id),
    onSettingsClose: () => {},
    onStopChat: () => {},
    onPlan: () => {},
    onPlanChoiceClose: () => {},
    onPlanChoiceSelect: () => {},
    onRun: () => task && project ? void launchPlannedTaskRun({ projectId: project.id, taskId: task.id }) : undefined,
    onLoadEarlier: () => {},
    onChatScroll: () => {},
    onGatewayChange: () => {},
    onModelChange: () => {},
    onPlanModelChange: () => {},
    onRunModelChange: () => {},
    onIncludeContextChange: () => {},
    onAttachmentRemove: () => {},
    onAttachFilesClick: () => {},
    onFilesSelected: () => {},
    onDraftChange: () => {},
    onComposerFocusChange: () => {},
    onSlashCommandApply: () => {},
    onSlashCommandIndexChange: () => {},
    onClearSlashDraft: () => {},
    onSend: () => {},
    onPlannerQuestionAnswer: () => {}
  }

  const value = useMemo(() => ({ launchPlannedTaskRun, openProjectCodexSettings, busy, error }), [busy, error, launchPlannedTaskRun, openProjectCodexSettings])

  return (
    <GlobalCodexChatContext.Provider value={value}>
      {children}
      {popupOpen && task ? (
        <ChatPopup
          chatState={chatState}
          chatHandlers={chatHandlers}
          chatOptions={{ title: 'Codex run', sidebarTitle: 'Global chat', showRunActions: false }}
        />
      ) : null}
    </GlobalCodexChatContext.Provider>
  )
}
