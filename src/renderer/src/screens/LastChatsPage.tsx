import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuRefreshCw } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { DEFAULT_GATEWAY_LANGUAGE } from '@shared/utils/gateway-language'
import { gatewayChatLifecycleStatusKey, gatewayLifecycleStatusMeta } from '@shared/utils/gateway-chat-phase'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { createSerializedAsyncRunner } from '@renderer/utils/serializedAsync'
import { ChatPopup } from '@renderer/popups/ChatPopup'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { LoadingState } from '@renderer/components/loading'
import {
  CHAT_INITIAL_MESSAGE_LIMIT,
  CHAT_MESSAGE_LOAD_STEP,
  CHAT_TOP_LAZY_LOAD_THRESHOLD,
  appendActivityMessageToTasks,
  activityMessagesFromTask,
  buildChatConversationSummaries,
  buildLatestRunFollowUpContext,
  formatChatTime,
  preserveScrollTopAfterPrepend,
  shouldLoadEarlierMessages,
  visibleChatMessagesForLimit
} from '@renderer/screens/projects/detail/chat/chatUtils'
import { codexConfigOf, createLocalId, projectGatewaySettings, readTaskGatewayOverride } from '@renderer/screens/projects/detail/projectDetailUtils'
import type { ChatAttachmentDraft, ChatConversationSummary, ChatOperationFeedbackData, SlashCommand, TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import { type Gateway, type Project, type Skill, type TaskEntity, type Workspace } from '@shared/types/entities'
import projectStyles from '@renderer/screens/projects/ProjectDetailPage.module.scss'
import styles from './LastChatsPage.module.scss'

type ConversationStatus = TaskActivityMessage['status'] | 'event'

type ConversationRow = {
  id: string
  taskId: string
  taskTitle: string
  taskStatus: TaskEntity['status']
  projectId: string
  projectName: string
  status: ConversationStatus
  at: number
  source: TaskActivityMessage['source']
  phase: ChatConversationSummary['phase']
  count: number
  model?: string
  latestBody: string
  messages: TaskActivityMessage[]
}

type ConversationGroupKey = 'ongoing' | 'successful' | 'failed' | 'other'

type GatewayChatResponse = {
  runId: string
  conversationId: string
  executionMode: 'terminal' | 'exec'
}

type GatewayPlanResponse = {
  runId?: string
  conversationId?: string
  executionMode?: 'terminal' | 'exec'
  runtimeWorkspacePath: string
  model: string
  gatewayId: string
}

type CodexStopResponse = {
  stopped: number
}

type CodexResolveResolution = 'stopped' | 'completed' | 'failed'

type CodexResolveResponse = {
  resolved: true
  resolution: CodexResolveResolution
}

type GroupConfig = {
  key: ConversationGroupKey
  title: string
}

const GROUPS: GroupConfig[] = [
  { key: 'ongoing', title: 'Working' },
  { key: 'successful', title: 'Completed' },
  { key: 'failed', title: 'Failed' },
  { key: 'other', title: 'Other' }
]

const EMPTY_SLASH_COMMANDS: SlashCommand[] = []
const RESOLUTION_OPTIONS: AppSelectOption[] = [
  { value: 'stopped', label: 'Stopped' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' }
]

function resolveStatusRow(status: ConversationStatus): ConversationGroupKey {
  if (status === 'running' || status === 'queued') return 'ongoing'
  if (status === 'completed') return 'successful'
  if (status === 'failed') return 'failed'
  return 'other'
}

function conversationLifecycleMeta(conversation: ConversationRow) {
  const active = conversation.status === 'running' || conversation.status === 'queued'
  return gatewayLifecycleStatusMeta(gatewayChatLifecycleStatusKey(conversation.phase, conversation.status, active))
}

function statusBadgeClass(conversation: ConversationRow) {
  return projectStyles[`chatStatus_${conversationLifecycleMeta(conversation).tone}`] ?? ''
}

function statusLabel(conversation: ConversationRow): string {
  return conversationLifecycleMeta(conversation).label
}

function sourceLabel(source: TaskActivityMessage['source']): string {
  if (source === 'gateway-plan') return 'Plan'
  if (source === 'gateway-run') return 'Run'
  return 'Follow-up'
}

function isCodexResolveResolution(value: string): value is CodexResolveResolution {
  return value === 'stopped' || value === 'completed' || value === 'failed'
}

function manualResolutionOf(conversation: ConversationRow): CodexResolveResolution | null {
  for (const message of [...conversation.messages].reverse()) {
    if (message.metadata?.manuallyResolved !== true) continue
    const resolution = message.metadata.resolution
    if (typeof resolution === 'string' && isCodexResolveResolution(resolution)) return resolution
  }
  return null
}

function statusResolutionOf(status: ConversationStatus): CodexResolveResolution | null {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return null
}

function resolutionOptionOf(resolution: CodexResolveResolution | null): AppSelectOption | null {
  if (!resolution) return null
  return RESOLUTION_OPTIONS.find((option) => option.value === resolution) ?? null
}

function displayedStatusLabel(conversation: ConversationRow, manualResolution: CodexResolveResolution | null): string {
  if (manualResolution === 'stopped') return 'STOPPED'
  if (manualResolution === 'completed') return 'COMPLETED'
  if (manualResolution === 'failed') return 'FAILED'
  return statusLabel(conversation)
}

function displayedStatusBadgeClass(conversation: ConversationRow, manualResolution: CodexResolveResolution | null): string {
  if (manualResolution === 'failed') return projectStyles.chatStatus_failed
  if (manualResolution === 'completed' || manualResolution === 'stopped') return projectStyles.chatStatus_completed
  return statusBadgeClass(conversation)
}

function shortText(value: string, max: number) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'No message'
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function conversationIdOf(message: TaskActivityMessage): string | null {
  return message.conversationId || message.runId || null
}

function buildTaskConversations(messages: TaskActivityMessage[]): ChatConversationSummary[] {
  return buildChatConversationSummaries(messages)
}

async function filesToAttachments(files: FileList | File[]): Promise<ChatAttachmentDraft[]> {
  const next: ChatAttachmentDraft[] = []
  for (const file of Array.from(files).slice(0, 6)) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
    next.push({ id: createLocalId(), name: file.name, size: file.size, bytes })
  }
  return next
}

export function LastChatsPage() {
  const { token } = useAuth()
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [status, setStatus] = useState('Loading...')
  const [error, setError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState('')
  const [isStartingNewChat, setIsStartingNewChat] = useState(false)
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatStopping, setChatStopping] = useState(false)
  const [chatDragDepth, setChatDragDepth] = useState(0)
  const [chatAttachments, setChatAttachments] = useState<ChatAttachmentDraft[]>([])
  const [chatGatewayId, setChatGatewayId] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [chatPlanModel, setChatPlanModel] = useState('')
  const [chatRunModel, setChatRunModel] = useState('')
  const [gatewayLanguage, setGatewayLanguage] = useState(DEFAULT_GATEWAY_LANGUAGE)
  const [chatIncludeContext, setChatIncludeContext] = useState(true)
  const [chatVisibleLimit, setChatVisibleLimit] = useState(CHAT_INITIAL_MESSAGE_LIMIT)
  const [chatFeedback, setChatFeedback] = useState<ChatOperationFeedbackData | null>(null)
  const [stoppingConversationIds, setStoppingConversationIds] = useState<Set<string>>(() => new Set())
  const [localSettledConversationIds, setLocalSettledConversationIds] = useState<Set<string>>(() => new Set())
  const [resolvingConversationIds, setResolvingConversationIds] = useState<Set<string>>(() => new Set())
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const chatFeedRef = useRef<HTMLDivElement | null>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const keepChatBottomRef = useRef(true)
  const lazyLoadAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  const lazyLoadPendingRef = useRef(false)

  const loadData = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setStatus('Loading...')
    const [taskResponse, projectResponse, gatewayResponse, workspaceResponse, languageResponse] = await Promise.all([
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token),
      invokeBridge<{ language: string }>(IPC_CHANNELS.appSettings.getGatewayLanguage, { actorToken: token })
    ])

    if (!taskResponse.ok) {
      setError(taskResponse.error?.message ?? 'Unable to load chats')
      setStatus('Load failed')
      setTasks([])
      return
    }

    if (!projectResponse.ok) {
      setError(projectResponse.error?.message ?? 'Unable to load projects')
      setStatus('Load failed')
      setTasks(Array.isArray(taskResponse.data) ? taskResponse.data : [])
      setProjects([])
      return
    }

    setTasks(Array.isArray(taskResponse.data) ? taskResponse.data : [])
    setProjects(Array.isArray(projectResponse.data) ? projectResponse.data : [])
    setGateways(gatewayResponse.ok && Array.isArray(gatewayResponse.data) ? gatewayResponse.data : [])
    setWorkspaces(workspaceResponse.ok && Array.isArray(workspaceResponse.data) ? workspaceResponse.data : [])
    setGatewayLanguage(languageResponse.ok && languageResponse.data?.language ? languageResponse.data.language : DEFAULT_GATEWAY_LANGUAGE)
    setError(null)
    setStatus('Ready')
  }, [token])

  const loadDataRef = useRef(loadData)
  const refreshData = useMemo(
    () => createSerializedAsyncRunner((options?: { silent?: boolean }) => loadDataRef.current(options ?? {})),
    []
  )

  useEffect(() => {
    loadDataRef.current = loadData
  }, [loadData])

  useEffect(() => {
    void refreshData({ silent: false })
  }, [refreshData])

  useEffect(() => {
    const onTaskActivity = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as { taskId?: string; message?: TaskActivityMessage } | undefined
      if (!payload?.taskId || !payload.message) return
      setTasks((current) => appendActivityMessageToTasks(current, payload.taskId ?? '', payload.message as TaskActivityMessage))
    }

    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
  }, [])

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    projects.forEach((project) => map.set(project.id, project.name))
    return map
  }, [projects])

  const conversations = useMemo<ConversationRow[]>(() => {
    const rows: ConversationRow[] = []

    for (const task of tasks) {
      const messages = activityMessagesFromTask(task)
      if (messages.length === 0) continue

      const byConversation = new Map<string, TaskActivityMessage[]>()
      for (const message of messages) {
        const conversationId = conversationIdOf(message)
        if (!conversationId) continue
        const list = byConversation.get(conversationId)
        if (list) {
          list.push(message)
          continue
        }
        byConversation.set(conversationId, [message])
      }

      byConversation.forEach((groupMessages, conversationId) => {
        const ordered = [...groupMessages].sort((a, b) => a.createdAt - b.createdAt)
        const summaries = buildChatConversationSummaries(ordered)
        const summary = summaries.find((item) => item.id === conversationId) ?? summaries[0]
        const last = ordered[ordered.length - 1]
        const latestAt = last?.updatedAt ?? last?.createdAt ?? 0
        const latestBody = last?.body ?? ''
        rows.push({
          id: conversationId,
          taskId: task.id,
          taskTitle: task.title,
          taskStatus: task.status,
          projectId: task.projectId,
          projectName: projectNameById.get(task.projectId) ?? task.projectId,
          status: summary?.status ?? last?.status ?? 'event',
          at: latestAt,
          source: summary?.source ?? last?.source ?? 'gateway-chat',
          phase: summary?.phase ?? 'FOLLOW UP',
          count: summary?.count ?? 0,
          model: summary?.model ?? (typeof last?.metadata?.model === 'string' ? last.metadata.model : undefined),
          latestBody,
          messages: ordered
        })
      })
    }

    return rows.sort((a, b) => b.at - a.at)
  }, [tasks, projectNameById])

  const grouped = useMemo<Record<ConversationGroupKey, ConversationRow[]>>(() => {
    const groupMap: Record<ConversationGroupKey, ConversationRow[]> = {
      ongoing: [],
      successful: [],
      failed: [],
      other: []
    }
    for (const row of conversations) {
      groupMap[resolveStatusRow(row.status)].push(row)
    }
    for (const key of Object.keys(groupMap) as ConversationGroupKey[]) {
      groupMap[key].sort((a, b) => b.at - a.at)
    }
    return groupMap
  }, [conversations])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  )

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedTask?.projectId) ?? null,
    [projects, selectedTask?.projectId]
  )

  const selectedTaskMessages = useMemo(
    () => selectedTask ? activityMessagesFromTask(selectedTask) : [],
    [selectedTask]
  )

  const chatConversations = useMemo(
    () => buildTaskConversations(selectedTaskMessages),
    [selectedTaskMessages]
  )

  const selectedChatSummary = useMemo(() => {
    if (isStartingNewChat || !selectedConversationId) return null
    return chatConversations.find((conversation) => conversation.id === selectedConversationId) ?? null
  }, [chatConversations, isStartingNewChat, selectedConversationId])

  const visibleMessages = useMemo(() => {
    if (isStartingNewChat || !selectedConversationId) return []
    return selectedTaskMessages
      .filter((message) => conversationIdOf(message) === selectedConversationId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }, [isStartingNewChat, selectedConversationId, selectedTaskMessages])

  const renderedMessages = useMemo(
    () => visibleChatMessagesForLimit(visibleMessages, chatVisibleLimit),
    [chatVisibleLimit, visibleMessages]
  )

  const projectGateway = useMemo(() => projectGatewaySettings(selectedProject), [selectedProject])
  const projectLanguage = projectGateway.language || projectGateway.outputLanguage || projectGateway.inputLanguage || gatewayLanguage
  const planReasoningEffort = projectGateway.planReasoningEffort || 'medium'
  const runReasoningEffort = projectGateway.runReasoningEffort || 'medium'
  const taskGateway = useMemo(() => readTaskGatewayOverride(selectedTask), [selectedTask])
  const chatGateway = useMemo(
    () => gateways.find((gateway) => gateway.id === chatGatewayId) ?? null,
    [chatGatewayId, gateways]
  )
  const chatGatewayConfig = useMemo(() => codexConfigOf(chatGateway), [chatGateway])
  const chatGatewayOptions = useMemo<AppSelectOption[]>(
    () => gateways.map((gateway) => ({ value: gateway.id, label: gateway.name })),
    [gateways]
  )
  const chatGatewayOption = useMemo(
    () => chatGatewayOptions.find((option) => option.value === chatGatewayId) ?? null,
    [chatGatewayId, chatGatewayOptions]
  )
  const chatModelOptions = useMemo<AppSelectOption[]>(
    () => (chatGatewayConfig.models ?? []).map((model) => ({ value: model.id, label: model.label || model.id })),
    [chatGatewayConfig.models]
  )
  const chatPlanModelOption = useMemo(
    () => chatModelOptions.find((option) => option.value === chatPlanModel) ?? null,
    [chatModelOptions, chatPlanModel]
  )
  const chatRunModelOption = useMemo(
    () => chatModelOptions.find((option) => option.value === chatRunModel) ?? null,
    [chatModelOptions, chatRunModel]
  )
  const chatModelOption = useMemo(
    () => chatModelOptions.find((option) => option.value === chatModel) ?? null,
    [chatModelOptions, chatModel]
  )
  const runtimeWorkspaceId = projectGateway.runtimeWorkspaceId || selectedProject?.workspaceId || null
  const chatRuntimeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === runtimeWorkspaceId) ?? null,
    [runtimeWorkspaceId, workspaces]
  )
  const taskContextSkills = useMemo<Skill[]>(() => selectedTask?.skills ?? [], [selectedTask?.skills])

  const runningConversationIds = useMemo(() => {
    const ids = new Set<string>()
    for (const conversation of chatConversations) {
      if (localSettledConversationIds.has(conversation.id)) continue
      if (conversation.status === 'running' || conversation.status === 'queued') ids.add(conversation.id)
    }
    return ids
  }, [chatConversations, localSettledConversationIds])

  const selectedChatIsRunning = Boolean(selectedChatSummary && runningConversationIds.has(selectedChatSummary.id))
  const selectedChatCanStop = selectedChatIsRunning
  const canSendChat = Boolean((chatDraft.trim() || chatAttachments.length > 0) && chatGatewayId && (chatRunModel || chatModel) && !selectedChatIsRunning)
  const hiddenMessageCount = Math.max(0, visibleMessages.length - renderedMessages.length)

  const localStatusMessage = useMemo<TaskActivityMessage | null>(() => {
    if (!chatFeedback) return null
    return {
      id: `last-chats-feedback-${chatFeedback.state}-${chatFeedback.title}`,
      runId: 'last-chats-feedback',
      conversationId: selectedConversationId || undefined,
      source: 'gateway-chat',
      role: chatFeedback.state === 'error' ? 'error' : 'thinking',
      status: chatFeedback.state === 'running' ? 'running' : chatFeedback.state === 'error' ? 'failed' : 'completed',
      body: `${chatFeedback.title}: ${chatFeedback.message}`,
      createdAt: Date.now()
    }
  }, [chatFeedback, selectedConversationId])

  const selectedProjectName = selectedProject?.name ?? 'Project Detail'

  useEffect(() => {
    if (!selectedTask || !selectedProject) return
    const nextGateway = taskGateway.gatewayId || projectGateway.gatewayId || ''
    const nextPlanModel = taskGateway.planModel || projectGateway.planModel || projectGateway.defaultModel || ''
    const nextRunModel = taskGateway.runModel || taskGateway.legacyModel || projectGateway.runModel || projectGateway.defaultModel || ''
    setChatGatewayId(nextGateway)
    setChatPlanModel(nextPlanModel)
    setChatRunModel(nextRunModel)
    setChatModel(nextRunModel)
    setChatFeedback(null)
    setChatSettingsOpen(false)
    setChatAttachments([])
  }, [projectGateway.defaultModel, projectGateway.gatewayId, projectGateway.planModel, projectGateway.runModel, selectedProject, selectedTask, taskGateway.gatewayId, taskGateway.legacyModel, taskGateway.planModel, taskGateway.runModel])

  useEffect(() => {
    if (!selectedTaskId) return
    if (selectedTask) return
    setSelectedTaskId(null)
    setSelectedConversationId('')
    setIsStartingNewChat(false)
  }, [selectedTask, selectedTaskId])

  useEffect(() => {
    setChatVisibleLimit(CHAT_INITIAL_MESSAGE_LIMIT)
    keepChatBottomRef.current = true
    lazyLoadAnchorRef.current = null
    lazyLoadPendingRef.current = false
  }, [isStartingNewChat, selectedConversationId, selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) return
    const intervalMs = !documentVisible ? 30_000 : selectedChatIsRunning ? 6_000 : 20_000
    const timer = window.setInterval(() => {
      void refreshData({ silent: true })
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [documentVisible, refreshData, selectedChatIsRunning, selectedTaskId])

  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState !== 'hidden'
      setDocumentVisible(visible)
      if (visible && selectedTaskId) void refreshData({ silent: true })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [refreshData, selectedTaskId])

  useEffect(() => {
    const feed = chatFeedRef.current
    if (!feed) return
    const lazyAnchor = lazyLoadAnchorRef.current
    if (lazyAnchor) {
      const frame = requestAnimationFrame(() => {
        feed.scrollTop = preserveScrollTopAfterPrepend(lazyAnchor.scrollTop, lazyAnchor.scrollHeight, feed.scrollHeight)
        lazyLoadAnchorRef.current = null
        lazyLoadPendingRef.current = false
      })
      return () => cancelAnimationFrame(frame)
    }
    const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    const shouldStickToBottom = keepChatBottomRef.current || distanceToBottom < CHAT_TOP_LAZY_LOAD_THRESHOLD
    if (!shouldStickToBottom) return
    const frame = requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [renderedMessages.length, renderedMessages[renderedMessages.length - 1]?.body.length, selectedConversationId, isStartingNewChat])

  const handleChatScroll = () => {
    const feed = chatFeedRef.current
    if (!feed) return
    const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    keepChatBottomRef.current = distanceToBottom < CHAT_TOP_LAZY_LOAD_THRESHOLD
    if (!lazyLoadPendingRef.current && shouldLoadEarlierMessages(feed.scrollTop, hiddenMessageCount, CHAT_TOP_LAZY_LOAD_THRESHOLD)) {
      lazyLoadPendingRef.current = true
      keepChatBottomRef.current = false
      lazyLoadAnchorRef.current = { scrollTop: feed.scrollTop, scrollHeight: feed.scrollHeight }
      setChatVisibleLimit((value) => Math.min(visibleMessages.length, value + CHAT_MESSAGE_LOAD_STEP))
    }
  }

  const totalConversations = conversations.length

  const onSelectConversation = (conversation: ConversationRow) => {
    setSelectedTaskId(conversation.taskId)
    setSelectedConversationId(conversation.id)
    setIsStartingNewChat(false)
    setLocalSettledConversationIds(new Set())
  }

  const onCloseModal = () => {
    setSelectedTaskId(null)
    setSelectedConversationId('')
    setIsStartingNewChat(false)
    setChatSettingsOpen(false)
    setChatFeedback(null)
  }

  const addChatAttachments = async (files: FileList | File[]) => {
    const next = await filesToAttachments(files)
    setChatAttachments((current) => [...current, ...next].slice(0, 10))
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

  const sendGatewayChatMessage = async (draftOverride?: string) => {
    if (!selectedTask || !selectedProject) return
    const draftText = draftOverride ?? chatDraft
    if (!draftText.trim() && chatAttachments.length === 0) return
    const effectiveSelectedChatSummary = isStartingNewChat ? null : selectedChatSummary
    const sendAsPlanRevision = !isStartingNewChat && effectiveSelectedChatSummary?.source === 'gateway-plan'
    const isPlanDraft = draftText.trim().toLowerCase().startsWith('/plan')
    const mode = sendAsPlanRevision || isPlanDraft ? 'plan' : 'chat'
    const resolvedModel = mode === 'plan' ? (chatPlanModel || chatModel) : (chatRunModel || chatModel)

    if (!chatGatewayId || !resolvedModel) {
      setChatSettingsOpen(true)
      setChatFeedback({ state: 'error', title: 'Action needs attention', message: 'Choose a Codex gateway and model before sending chat.' })
      return
    }

    setChatSending(true)
    setChatFeedback({ state: 'running', title: 'Sending message', message: `Starting ${resolvedModel} for this chat thread.` })
    try {
      if (sendAsPlanRevision) {
        if (chatAttachments.length > 0) {
          setChatFeedback({ state: 'error', title: 'Action needs attention', message: 'Planner clarification does not support attachments. Remove attachments and send the answer as text.' })
          return
        }
        const response = await invokeBridge<GatewayPlanResponse>(IPC_CHANNELS.tasks.planWithGateway, {
          actorToken: token,
          taskId: selectedTask.id,
          projectId: selectedProject.id,
          gatewayId: chatGatewayId,
          model: resolvedModel,
          language: projectLanguage,
          reasoningEffort: planReasoningEffort,
          conversationId: selectedConversationId || undefined,
          clarificationMessage: draftText.trim()
        })
        if (!response.ok || !response.data) {
          setChatFeedback({ state: 'error', title: 'Action needs attention', message: response.error?.message ?? 'Unable to send planner clarification.' })
          return
        }
        setSelectedConversationId(response.data.conversationId ?? selectedConversationId)
        setIsStartingNewChat(false)
        setChatAttachments([])
        setChatFeedback(null)
        void refreshData({ silent: true })
        return
      }

      const response = await invokeBridge<GatewayChatResponse>(IPC_CHANNELS.tasks.gatewayChatSend, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: selectedProject.id,
        message: draftText.trim() || 'Review the attached file(s) in the task context.',
        gatewayId: chatGatewayId,
        followUpContext: isStartingNewChat ? buildLatestRunFollowUpContext(selectedTaskMessages).trim() || undefined : undefined,
        model: resolvedModel,
        language: projectLanguage,
        reasoningEffort: mode === 'plan' ? planReasoningEffort : runReasoningEffort,
        conversationId: isStartingNewChat ? undefined : selectedConversationId || undefined,
        includeTaskContext: isStartingNewChat ? false : chatIncludeContext,
        mode,
        attachments: chatAttachments.map((attachment) => ({ name: attachment.name, bytes: attachment.bytes }))
      })
      if (!response.ok || !response.data) {
        setChatFeedback({ state: 'error', title: 'Action needs attention', message: response.error?.message ?? 'Unable to send Codex chat message.' })
        return
      }
      setSelectedConversationId(response.data.conversationId)
      setIsStartingNewChat(false)
      setChatAttachments([])
      setChatFeedback(null)
      void refreshData({ silent: true })
    } catch (sendError) {
      setChatFeedback({ state: 'error', title: 'Action needs attention', message: sendError instanceof Error ? sendError.message : 'Unable to send Codex chat message.' })
    } finally {
      setChatSending(false)
    }
  }

  const stopGatewayChat = async (conversationIdOverride?: string) => {
    const conversationId = conversationIdOverride || selectedConversationId
    if (!selectedTask || !conversationId) return
    setChatStopping(true)
    setStoppingConversationIds((current) => new Set(current).add(conversationId))
    setChatFeedback({ state: 'running', title: 'Stopping chat', message: 'Asking Codex to stop the active chat.' })
    try {
      const response = await invokeBridge<CodexStopResponse>(IPC_CHANNELS.tasks.gatewayChatStop, {
        actorToken: token,
        taskId: selectedTask.id,
        conversationId
      })
      if (!response.ok) {
        setChatFeedback({ state: 'error', title: 'Action needs attention', message: response.error?.message ?? 'Unable to stop Codex chat.' })
        return
      }
      if (!response.data?.stopped) {
        setLocalSettledConversationIds((current) => new Set(current).add(conversationId))
        setChatFeedback({ state: 'error', title: 'Action needs attention', message: 'No active Codex chat was found to stop.' })
        return
      }
      setLocalSettledConversationIds((current) => new Set(current).add(conversationId))
      setChatFeedback(null)
      void refreshData({ silent: true })
    } catch (stopError) {
      setChatFeedback({ state: 'error', title: 'Action needs attention', message: stopError instanceof Error ? stopError.message : 'Unable to stop Codex chat.' })
    } finally {
      setChatStopping(false)
      setStoppingConversationIds((current) => {
        const next = new Set(current)
        next.delete(conversationId)
        return next
      })
    }
  }

  const isResolvingConversation = (conversation: ConversationRow) => RESOLUTION_OPTIONS.some((option) => (
    resolvingConversationIds.has(`${conversation.taskId}:${conversation.id}:${option.value}`)
  ))

  const resolveGatewayChat = async (conversation: ConversationRow, resolution: CodexResolveResolution) => {
    const resolvingKey = `${conversation.taskId}:${conversation.id}:${resolution}`
    setResolvingConversationIds((current) => new Set(current).add(resolvingKey))
    setStatus(`Marking chat as ${resolution}...`)
    try {
      const response = await invokeBridge<CodexResolveResponse>(IPC_CHANNELS.tasks.gatewayChatResolve, {
        actorToken: token,
        taskId: conversation.taskId,
        conversationId: conversation.id,
        resolution
      })
      if (!response.ok) {
        const message = response.error?.message ?? 'Unable to resolve Codex chat.'
        setError(message)
        if (selectedTaskId === conversation.taskId) {
          setChatFeedback({ state: 'error', title: 'Action needs attention', message })
        }
        return
      }
      if (selectedTaskId === conversation.taskId && selectedConversationId === conversation.id) {
        setLocalSettledConversationIds((current) => new Set(current).add(conversation.id))
        setChatFeedback(null)
      }
      setError(null)
      await refreshData({ silent: true })
    } catch (resolveError) {
      const message = resolveError instanceof Error ? resolveError.message : 'Unable to resolve Codex chat.'
      setError(message)
      if (selectedTaskId === conversation.taskId) {
        setChatFeedback({ state: 'error', title: 'Action needs attention', message })
      }
    } finally {
      setResolvingConversationIds((current) => {
        const next = new Set(current)
        next.delete(resolvingKey)
        return next
      })
    }
  }

  const chatState = selectedTask ? {
    task: selectedTask,
    chatDragDepth,
    conversations: chatConversations,
    sidebarConversations: chatConversations,
    selectedConversationId,
    isStartingNewChat,
    runningConversationIds,
    stoppingConversationIds,
    chatHistoryCount: chatConversations.length,
    chatSettingsOpen,
    selectedChatCanStop,
    chatStopping,
    gatewayPlanLaunching: false,
    gatewayRunLaunching: false,
    planChoiceOpen: false,
    visibleMessages,
    renderedMessages,
    hiddenMessageCount,
    localStatusMessage,
    chatFeedRef,
    chatGateway,
    chatGatewayOption,
    chatGatewayOptions,
    chatModel,
    chatModelOption,
    chatPlanModel,
    chatPlanModelOption,
    chatRunModel,
    chatRunModelOption,
    chatModelOptions,
    chatGatewayConfig,
    chatRuntimeWorkspace,
    runtimeWorkspaceId,
    chatIncludeContext,
    attachments: chatAttachments,
    slashMenuOpen: false,
    slashCommands: EMPTY_SLASH_COMMANDS,
    slashCommandIndex: 0,
    draftTextareaRef,
    fileInputRef,
    draft: chatDraft,
    chatSending,
    canSendChat,
    selectedChatIsRunning,
    selectedChatSummary,
    selectedChatUsage: null,
    selectedTaskAgent: null,
    taskContextSkills
  } : null

  const chatHandlers = {
    onClose: onCloseModal,
    onDragEnter: handleChatDragEnter,
    onDragOver: handleChatDragOver,
    onDragLeave: handleChatDragLeave,
    onDrop: handleChatDrop,
    onNewConversation: () => {
      setIsStartingNewChat(true)
      setSelectedConversationId('')
      setChatFeedback(null)
    },
    onConversationSelect: (conversationId: string) => {
      setIsStartingNewChat(false)
      setSelectedConversationId(conversationId)
      setChatFeedback(null)
    },
    onSettingsToggle: () => setChatSettingsOpen((value) => !value),
    onSettingsClose: () => setChatSettingsOpen(false),
    onStopChat: (conversationId?: string) => void stopGatewayChat(conversationId),
    onPlan: () => {},
    onPlanChoiceClose: () => {},
    onPlanChoiceSelect: () => {},
    onRun: () => {},
    onLoadEarlier: () => {},
    onChatScroll: handleChatScroll,
    onGatewayChange: (option: AppSelectOption | null) => {
      setChatGatewayId(option?.value ?? '')
      setChatModel('')
      setChatPlanModel('')
      setChatRunModel('')
    },
    onModelChange: (option: AppSelectOption | null) => setChatModel(option?.value ?? ''),
    onPlanModelChange: (option: AppSelectOption | null) => setChatPlanModel(option?.value ?? ''),
    onRunModelChange: (option: AppSelectOption | null) => {
      const next = option?.value ?? ''
      setChatRunModel(next)
      setChatModel(next)
    },
    onIncludeContextChange: setChatIncludeContext,
    onAttachmentRemove: (attachmentId: string) => setChatAttachments((current) => current.filter((item) => item.id !== attachmentId)),
    onAttachFilesClick: () => fileInputRef.current?.click(),
    onFilesSelected: (files: FileList | null) => {
      if (files) void addChatAttachments(files)
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    onDraftChange: (value: string, textarea: HTMLTextAreaElement) => {
      setChatDraft(value)
      textarea.style.height = 'auto'
      const nextHeight = Math.min(150, Math.max(36, textarea.scrollHeight))
      textarea.style.height = `${nextHeight}px`
      textarea.scrollTop = textarea.scrollHeight
    },
    onComposerFocusChange: () => {},
    onSlashCommandApply: () => {},
    onSlashCommandIndexChange: () => {},
    onClearSlashDraft: () => setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, '')),
    onSend: () => void sendGatewayChatMessage(),
    onPlannerQuestionAnswer: (answer: string) => void sendGatewayChatMessage(answer)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.title}>Chats</p>
          <p className={styles.subtitle}>View the latest Codex conversations across tasks.</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void refreshData({ silent: false })}>
          <LuRefreshCw size={16} />
          Refresh
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status === 'Ready' ? <p className={styles.statusNotice}>{status}</p> : null}

      {!error && status !== 'Ready' && conversations.length === 0 ? (
        <LoadingState variant="skeleton" rows={5} columns={3} messageIndex={4} />
      ) : null}

      {totalConversations === 0 && status === 'Ready' ? (
        <p className={styles.emptyState}>No chats found yet.</p>
      ) : totalConversations > 0 ? (
        <div className={styles.groupList}>
          {GROUPS.map((group) => {
            const rows = grouped[group.key]
            return (
              <section key={group.key} className={styles.groupCard}>
                <header className={styles.groupHeader}>
                  <p className={styles.groupTitle}>
                    {group.title}
                    <b>{rows.length}</b>
                  </p>
                </header>

                {rows.length > 0 ? (
                  <div className={styles.rows}>
                    {rows.map((conversation) => {
                      const at = formatChatTime(conversation.at)
                      const manualResolution = manualResolutionOf(conversation)
                      const currentResolution = manualResolution ?? statusResolutionOf(conversation.status)
                      const selectedResolutionOption = resolutionOptionOf(currentResolution)
                      const isResolving = isResolvingConversation(conversation)
                      const currentStatusBadgeClass = displayedStatusBadgeClass(conversation, manualResolution)
                      const isActiveStatusTone = currentStatusBadgeClass === projectStyles.chatStatus_working
                        || currentStatusBadgeClass === projectStyles.chatStatus_planning
                        || currentStatusBadgeClass === projectStyles['chatStatus_post-running']
                        || currentStatusBadgeClass === projectStyles['chatStatus_following-up']
                      const resolveSelectClassName = [
                        styles.resolveSelect,
                        currentStatusBadgeClass === projectStyles.chatStatus_completed ? styles.resolveSelectCompleted : '',
                        currentStatusBadgeClass === projectStyles.chatStatus_failed ? styles.resolveSelectFailed : '',
                        isActiveStatusTone ? styles.resolveSelectRunning : ''
                      ].filter(Boolean).join(' ')
                      return (
                        <div
                          key={conversation.id}
                          className={styles.row}
                        >
                          <button
                            type="button"
                            className={styles.rowOpenButton}
                            onClick={() => onSelectConversation(conversation)}
                            title={conversation.taskTitle}
                          >
                            <div className={styles.rowTitleLine}>
                              <b className={styles.rowSourceBadge}>{sourceLabel(conversation.source)}</b>
                              <b>{conversation.taskTitle}</b>
                            </div>
                            <p className={styles.rowMessage}>{shortText(conversation.latestBody, 140)}</p>
                            <div className={styles.rowMeta}>
                              {conversation.projectName} · {conversation.count} messages{conversation.model ? ` · ${conversation.model}` : ''}
                            </div>
                          </button>
                          <div className={styles.rowStatusRail}>
                            <div className={styles.rowResolveSelect} aria-label="Update chat status">
                              <AppSelect
                                className={resolveSelectClassName}
                                options={RESOLUTION_OPTIONS}
                                value={isResolving ? null : selectedResolutionOption}
                                placeholder={isResolving ? 'Updating...' : displayedStatusLabel(conversation, manualResolution)}
                                isDisabled={isResolving}
                                onChange={(option) => {
                                  if (!option || !isCodexResolveResolution(option.value)) return
                                  void resolveGatewayChat(conversation, option.value)
                                }}
                              />
                            </div>
                            <span className={styles.rowTime}>{at}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className={styles.emptyRows}>No chats in this group.</p>
                )}
              </section>
            )
          })}
        </div>
      ) : null}

      {chatState ? (
        <ChatPopup
          chatState={chatState}
          chatHandlers={chatHandlers}
          chatOptions={{
            title: 'Chat',
            subtitle: `${selectedProjectName} > Chats`,
            sidebarTitle: 'Chat',
            sidebarSubtitle: `${selectedProjectName} > Chats`,
            showRunActions: false
          }}
        />
      ) : null}
    </section>
  )
}
