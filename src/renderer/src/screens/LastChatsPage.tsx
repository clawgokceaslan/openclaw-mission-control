import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuRefreshCw } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { ActivityPopup } from '@renderer/popups/Activity'
import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import { activityMessagesFromTask, formatChatTime } from '@renderer/screens/projects/detail/chat/chatUtils'
import { codexConfigOf, createLocalId, projectCodexSettings, readTaskCodexOverride } from '@renderer/screens/projects/detail/projectDetailUtils'
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
  count: number
  model?: string
  latestBody: string
  messages: TaskActivityMessage[]
}

type ConversationGroupKey = 'ongoing' | 'successful' | 'failed' | 'other'

type CodexChatResponse = {
  runId: string
  conversationId: string
  executionMode: 'terminal' | 'exec'
}

type CodexStopResponse = {
  stopped: number
}

type GroupConfig = {
  key: ConversationGroupKey
  title: string
}

const GROUPS: GroupConfig[] = [
  { key: 'ongoing', title: 'Running' },
  { key: 'successful', title: 'Completed' },
  { key: 'failed', title: 'Failed' },
  { key: 'other', title: 'Other' }
]

const EMPTY_SLASH_COMMANDS: SlashCommand[] = []
const MESSAGE_RENDER_LIMIT = 80
const RUNNING_ACTIVITY_STALE_MS = 15 * 60 * 1000

function resolveStatusRow(status: ConversationStatus): ConversationGroupKey {
  if (status === 'running' || status === 'queued') return 'ongoing'
  if (status === 'completed') return 'successful'
  if (status === 'failed') return 'failed'
  return 'other'
}

function statusBadgeClass(status: ConversationStatus) {
  if (status === 'running' || status === 'queued') return projectStyles.chatStatus_running
  if (status === 'completed') return projectStyles.chatStatus_completed
  if (status === 'failed') return projectStyles.chatStatus_failed
  return ''
}

function statusLabel(status: ConversationStatus): string {
  if (status === 'running') return 'RUNNING'
  if (status === 'queued') return 'QUEUED'
  if (status === 'completed') return 'COMPLETED'
  if (status === 'failed') return 'FAILED'
  return 'EVENT'
}

function sourceLabel(source: TaskActivityMessage['source']): string {
  if (source === 'codex-plan') return 'Plan'
  if (source === 'codex-run') return 'Run'
  return 'Follow-up'
}

function shortText(value: string, max: number) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'No message'
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function conversationIdOf(message: TaskActivityMessage): string | null {
  return message.conversationId || message.runId || null
}

function isRunCompleteMessage(message: TaskActivityMessage): boolean {
  return message.metadata?.codexBlock === 'run-complete' || message.metadata?.stopped === true || message.role === 'error'
}

function isFreshRunningMessage(message: TaskActivityMessage, now: number): boolean {
  if (message.status !== 'running' && message.metadata?.runStatus !== 'running') return false
  const at = message.updatedAt ?? message.createdAt
  return now - at <= RUNNING_ACTIVITY_STALE_MS
}

function buildTaskConversations(messages: TaskActivityMessage[]): ChatConversationSummary[] {
  const grouped = new Map<string, ChatConversationSummary>()
  for (const message of messages) {
    const id = conversationIdOf(message)
    if (!id) continue
    const current = grouped.get(id)
    const nextStatus = message.status ?? 'event'
    const nextAt = message.updatedAt ?? message.createdAt
    const isLatest = !current || nextAt >= current.at
    grouped.set(id, {
      id,
      title: sourceLabel(message.source),
      count: (current?.count ?? 0) + 1,
      status: isLatest ? nextStatus : current?.status ?? nextStatus,
      at: Math.max(current?.at ?? 0, nextAt),
      source: message.source,
      model: typeof message.metadata?.model === 'string' ? message.metadata.model : current?.model
    })
  }
  return Array.from(grouped.values()).sort((a, b) => b.at - a.at)
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
  const [chatIncludeContext, setChatIncludeContext] = useState(true)
  const [chatFeedback, setChatFeedback] = useState<ChatOperationFeedbackData | null>(null)
  const [stoppingConversationIds, setStoppingConversationIds] = useState<Set<string>>(() => new Set())
  const [localSettledConversationIds, setLocalSettledConversationIds] = useState<Set<string>>(() => new Set())
  const activityFeedRef = useRef<HTMLDivElement | null>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadData = useCallback(async () => {
    setStatus('Loading...')
    const [taskResponse, projectResponse, gatewayResponse, workspaceResponse] = await Promise.all([
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token)
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
    setError(null)
    setStatus('Ready')
  }, [token])

  useEffect(() => {
    void loadData()
  }, [loadData])

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
        const last = ordered[ordered.length - 1]
        const latestAt = last?.updatedAt ?? last?.createdAt ?? 0
        const latestBody = last?.body ?? ''
        const status = last?.status ?? 'event'
        rows.push({
          id: conversationId,
          taskId: task.id,
          taskTitle: task.title,
          taskStatus: task.status,
          projectId: task.projectId,
          projectName: projectNameById.get(task.projectId) ?? task.projectId,
          status,
          at: latestAt,
          source: last?.source ?? 'codex-chat',
          count: ordered.length,
          model: typeof last?.metadata?.model === 'string' ? last.metadata.model : undefined,
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
    () => visibleMessages.length > MESSAGE_RENDER_LIMIT ? visibleMessages.slice(-MESSAGE_RENDER_LIMIT) : visibleMessages,
    [visibleMessages]
  )

  const projectCodex = useMemo(() => projectCodexSettings(selectedProject), [selectedProject])
  const taskCodex = useMemo(() => readTaskCodexOverride(selectedTask), [selectedTask])
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
  const runtimeWorkspaceId = projectCodex.runtimeWorkspaceId || selectedProject?.workspaceId || null
  const chatRuntimeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === runtimeWorkspaceId) ?? null,
    [runtimeWorkspaceId, workspaces]
  )
  const taskContextSkills = useMemo<Skill[]>(() => selectedTask?.skills ?? [], [selectedTask?.skills])

  const runningConversationIds = useMemo(() => {
    const ids = new Set<string>()
    const now = Date.now()
    const settled = new Set<string>()
    for (const message of selectedTaskMessages) {
      const id = conversationIdOf(message)
      if (id && isRunCompleteMessage(message)) settled.add(id)
    }
    for (const conversation of chatConversations) {
      if (settled.has(conversation.id) || localSettledConversationIds.has(conversation.id)) continue
      const hasFreshRunningEvent = selectedTaskMessages.some((message) => conversationIdOf(message) === conversation.id && isFreshRunningMessage(message, now))
      if (hasFreshRunningEvent) ids.add(conversation.id)
    }
    return ids
  }, [chatConversations, localSettledConversationIds, selectedTaskMessages])

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
      source: 'codex-chat',
      role: chatFeedback.state === 'error' ? 'error' : 'thinking',
      status: chatFeedback.state === 'running' ? 'running' : chatFeedback.state === 'error' ? 'failed' : 'completed',
      body: `${chatFeedback.title}: ${chatFeedback.message}`,
      createdAt: Date.now()
    }
  }, [chatFeedback, selectedConversationId])

  const selectedProjectName = selectedProject?.name ?? 'Project Detail'

  useEffect(() => {
    if (!selectedTask || !selectedProject) return
    const nextGateway = taskCodex.gatewayId || projectCodex.gatewayId || ''
    const nextPlanModel = taskCodex.planModel || projectCodex.planModel || projectCodex.defaultModel || ''
    const nextRunModel = taskCodex.runModel || taskCodex.legacyModel || projectCodex.runModel || projectCodex.defaultModel || ''
    setChatGatewayId(nextGateway)
    setChatPlanModel(nextPlanModel)
    setChatRunModel(nextRunModel)
    setChatModel(nextRunModel)
    setChatFeedback(null)
    setChatSettingsOpen(false)
    setChatAttachments([])
    setChatDraft('')
  }, [projectCodex.defaultModel, projectCodex.gatewayId, projectCodex.planModel, projectCodex.runModel, selectedProject, selectedTask, taskCodex.gatewayId, taskCodex.legacyModel, taskCodex.planModel, taskCodex.runModel])

  useEffect(() => {
    if (!selectedTaskId) return
    if (selectedTask) return
    setSelectedTaskId(null)
    setSelectedConversationId('')
    setIsStartingNewChat(false)
  }, [selectedTask, selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) return
    const timer = window.setInterval(() => {
      void loadData()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [loadData, selectedTaskId])

  useEffect(() => {
    const feed = activityFeedRef.current
    if (!feed) return
    const frame = requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [renderedMessages.length, renderedMessages[renderedMessages.length - 1]?.body.length, selectedConversationId, isStartingNewChat])

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

  const sendCodexChatMessage = async () => {
    if (!selectedTask || !selectedProject) return
    if (!chatDraft.trim() && chatAttachments.length === 0) return
    const effectiveSelectedChatSummary = isStartingNewChat ? null : selectedChatSummary
    const sendAsPlanRevision = !isStartingNewChat && effectiveSelectedChatSummary?.source === 'codex-plan'
    const isPlanDraft = chatDraft.trim().toLowerCase().startsWith('/plan')
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
      const response = await invokeBridge<CodexChatResponse>(IPC_CHANNELS.tasks.codexChatSend, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: selectedProject.id,
        message: chatDraft.trim() || 'Review the attached file(s) in the task context.',
        gatewayId: chatGatewayId,
        model: resolvedModel,
        conversationId: isStartingNewChat ? undefined : selectedConversationId || undefined,
        includeTaskContext: chatIncludeContext,
        mode,
        attachments: chatAttachments.map((attachment) => ({ name: attachment.name, bytes: attachment.bytes }))
      })
      if (!response.ok || !response.data) {
        setChatFeedback({ state: 'error', title: 'Action needs attention', message: response.error?.message ?? 'Unable to send Codex chat message.' })
        return
      }
      setSelectedConversationId(response.data.conversationId)
      setIsStartingNewChat(false)
      setChatDraft('')
      setChatAttachments([])
      setChatFeedback(null)
      void loadData()
    } catch (sendError) {
      setChatFeedback({ state: 'error', title: 'Action needs attention', message: sendError instanceof Error ? sendError.message : 'Unable to send Codex chat message.' })
    } finally {
      setChatSending(false)
    }
  }

  const stopCodexChat = async (conversationIdOverride?: string) => {
    const conversationId = conversationIdOverride || selectedConversationId
    if (!selectedTask || !conversationId) return
    setChatStopping(true)
    setStoppingConversationIds((current) => new Set(current).add(conversationId))
    setChatFeedback({ state: 'running', title: 'Stopping chat', message: 'Asking Codex to stop the active run.' })
    try {
      const response = await invokeBridge<CodexStopResponse>(IPC_CHANNELS.tasks.codexChatStop, {
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
        setChatFeedback({ state: 'error', title: 'Action needs attention', message: 'No running Codex chat was found to stop.' })
        return
      }
      setLocalSettledConversationIds((current) => new Set(current).add(conversationId))
      setChatFeedback(null)
      void loadData()
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

  const chatState = selectedTask ? {
    task: selectedTask,
    chatDragDepth,
    conversations: chatConversations,
    sidebarConversations: chatConversations,
    selectedConversationId,
    isStartingNewChat,
    runningConversationIds,
    stoppingConversationIds,
    chatHistoryCount: selectedTask.comments?.length ?? 0,
    chatSettingsOpen,
    selectedChatCanStop,
    chatStopping,
    codexPlanLaunching: false,
    codexRunLaunching: false,
    visibleMessages,
    renderedMessages,
    hiddenMessageCount,
    localStatusMessage,
    activityFeedRef,
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
      setTimeout(() => draftTextareaRef.current?.focus(), 0)
    },
    onConversationSelect: (conversationId: string) => {
      setIsStartingNewChat(false)
      setSelectedConversationId(conversationId)
      setChatFeedback(null)
    },
    onSettingsToggle: () => setChatSettingsOpen((value) => !value),
    onSettingsClose: () => setChatSettingsOpen(false),
    onStopChat: (conversationId?: string) => void stopCodexChat(conversationId),
    onPlan: () => {},
    onRun: () => {},
    onLoadEarlier: () => {},
    onActivityScroll: () => {},
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
    onSend: () => void sendCodexChatMessage()
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.title}>Chats</p>
          <p className={styles.subtitle}>View the latest Codex conversations across tasks.</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadData()}>
          <LuRefreshCw size={16} />
          Refresh
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.statusNotice}>{status}</p>

      {!error && status !== 'Ready' && conversations.length === 0 ? (
        <p className={styles.emptyState}>Loading...</p>
      ) : null}

      {totalConversations === 0 ? (
        <p className={styles.emptyState}>No chats found yet.</p>
      ) : (
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
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          className={styles.row}
                          onClick={() => onSelectConversation(conversation)}
                          title={conversation.taskTitle}
                        >
                          <div className={styles.rowHead}>
                            <span className={styles.rowTitle}>
                              <b>{conversation.taskTitle}</b>
                              <span>{conversation.projectName}</span>
                            </span>
                            <span className={`${projectStyles.chatStatusBadge} ${statusBadgeClass(conversation.status)}`}>
                              {statusLabel(conversation.status)}
                            </span>
                          </div>
                          <p className={styles.rowMessage}>{shortText(conversation.latestBody, 140)}</p>
                          <div className={styles.rowMeta}>
                            <span>{sourceLabel(conversation.source)} · {conversation.count} messages</span>
                            <span>{at}</span>
                          </div>
                        </button>
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
      )}

      {chatState ? (
        <ActivityPopup
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
