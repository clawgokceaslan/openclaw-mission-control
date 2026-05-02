import { type RefObject, useEffect, useMemo, useRef, type DragEvent } from 'react'
import { type AppSelectOption } from '@renderer/components/select/AppSelect'
import { type Agent, type Gateway, type Skill, type TaskEntity, type Workspace } from '@shared/types/entities'
import { CHAT_MESSAGE_LOAD_STEP, usageFromMetadata } from '../chat/chatUtils'
import type { ChatAttachmentDraft, ChatConversationSummary, ChatOperationFeedbackData, SlashCommand, TaskActivityMessage, TaskHistoryItem, ThreadEntry } from '../types'

interface Setter<T> {
  (value: T | ((previous: T) => T)): void
}

export interface ActivityPopupState {
  task: TaskEntity | null
  chatDragDepth: number
  conversations: ChatConversationSummary[]
  sidebarConversations: ChatConversationSummary[]
  selectedConversationId: string
  isStartingNewChat: boolean
  runningConversationIds: Set<string>
  chatHistoryCount: number
  chatSettingsOpen: boolean
  selectedChatCanStop: boolean
  chatStopping: boolean
  codexPlanLaunching: boolean
  codexRunLaunching: boolean
  visibleMessages: TaskActivityMessage[]
  renderedMessages: TaskActivityMessage[]
  hiddenMessageCount: number
  localStatusMessage: TaskActivityMessage | null
  activityFeedRef: RefObject<HTMLDivElement | null>
  chatGateway: Gateway | null
  chatGatewayOption: AppSelectOption | null
  chatGatewayOptions: AppSelectOption[]
  chatModel: string
  chatModelOption: AppSelectOption | null
  chatModelOptions: AppSelectOption[]
  chatGatewayConfig: { executionMode?: string }
  chatRuntimeWorkspace: Workspace | null
  runtimeWorkspaceId?: string | null
  chatIncludeContext: boolean
  attachments: ChatAttachmentDraft[]
  slashMenuOpen: boolean
  slashCommands: SlashCommand[]
  slashCommandIndex: number
  draftTextareaRef: RefObject<HTMLTextAreaElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  draft: string
  chatSending: boolean
  canSendChat: boolean
  selectedChatIsRunning: boolean
  selectedChatSummary: ChatConversationSummary | null
  selectedChatUsage: ReturnType<typeof usageFromMetadata> | null
  selectedTaskAgent: Agent | null
  taskContextSkills: Skill[]
}

interface ActivityPopupHandlers {
  onClose: () => void
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onNewConversation: () => void
  onConversationSelect: (conversationId: string) => void
  onSettingsToggle: () => void
  onSettingsClose: () => void
  onStopChat: () => void
  onPlan: () => void
  onRun: () => void
  onLoadEarlier: () => void
  onActivityScroll: () => void
  onGatewayChange: (option: AppSelectOption | null) => void
  onModelChange: (option: AppSelectOption | null) => void
  onIncludeContextChange: (value: boolean) => void
  onAttachmentRemove: (attachmentId: string) => void
  onAttachFilesClick: () => void
  onFilesSelected: (files: FileList | null) => void
  onDraftChange: (value: string, textarea: HTMLTextAreaElement) => void
  onComposerFocusChange: (focused: boolean) => void
  onSlashCommandApply: (command: SlashCommand) => void
  onSlashCommandIndexChange: (updater: (value: number) => number) => void
  onClearSlashDraft: () => void
  onSend: () => void
}

const LOCAL_CHAT_STATUS_RUN_ID = 'local-chat-status'
const slashCommands: SlashCommand[] = [
  { id: 'plan', label: '/plan', hint: 'Draft a plan in this chat' },
  { id: 'run', label: '/run', hint: 'Start a Codex run for the task' },
  { id: 'steer', label: '/steer', hint: 'Steer the selected conversation' },
  { id: 'settings', label: '/settings', hint: 'Open Codex chat settings' },
  { id: 'attach', label: '/attach', hint: 'Choose files to attach' },
  { id: 'context', label: '/context', hint: 'Toggle task context in the prompt' }
]

interface ActivityPopupParams {
  selectedTask: TaskEntity | null
  isActivityModalOpen: boolean
  selectedChatSummary?: ChatConversationSummary | null
  activityFeedRef: RefObject<HTMLDivElement | null>
  chatDraftTextareaRef: RefObject<HTMLTextAreaElement | null>
  chatFileInputRef: RefObject<HTMLInputElement | null>
  chatDragDepth: number
  chatDraft: string
  chatSending: boolean
  canSendChat: boolean
  chatAttachments: ChatAttachmentDraft[]
  chatGateway: Gateway | null
  chatGatewayOption: AppSelectOption | null
  chatGatewayOptions: AppSelectOption[]
  chatModel: string
  chatModelOption: AppSelectOption | null
  chatModelOptions: AppSelectOption[]
  chatGatewayConfig: { executionMode?: string }
  chatRuntimeWorkspace: Workspace | null
  runtimeWorkspaceId?: string | null
  chatIncludeContext: boolean
  chatOperationFeedback: ChatOperationFeedbackData | null
  codexPlanLaunching: boolean
  codexRunLaunching: boolean
  selectedChatConversationId: string
  setSelectedChatConversationId: Setter<string>
  isStartingNewChat: boolean
  setIsStartingNewChat: Setter<boolean>
  setChatComposerMode: Setter<'chat' | 'steer'>
  setCodexRunFeedback: Setter<ChatOperationFeedbackData | null>
  setChatDraft: Setter<string>
  setChatAttachments: Setter<ChatAttachmentDraft[]>
  setChatVisibleLimit: Setter<number>
  chatConversations: ChatConversationSummary[]
  chatActivityMessages: TaskActivityMessage[]
  history: TaskHistoryItem[]
  localActivityEntries: ThreadEntry[]
  chatStopping: boolean
  selectedTaskAgent: Agent | null
  taskContextSkills: Skill[]
  setSlashCommandIndex: Setter<number>
  setChatSettingsOpen: Setter<boolean>
  setChatModel: Setter<string>
  setChatIncludeContext: Setter<boolean>
  setChatGatewayId: Setter<string>
  setChatComposerFocused: Setter<boolean>
  chatSettingsOpen: boolean
  selectedChatCanStop?: boolean
  slashCommandIndex: number
  chatComposerFocused: boolean
  runSelectedTaskWithCodex: () => Promise<void>
  planSelectedTaskWithCodex: () => Promise<void>
  sendCodexChatMessage: () => Promise<void>
  stopCodexChat: () => Promise<void>
  applySlashCommand: (command: SlashCommand) => Promise<void>
  addChatAttachments: (files: FileList | File[]) => Promise<void>
  onClose: () => void
  setChatDragDepth: Setter<number>
}

export interface UseProjectActivityPopupResult {
  chatState: ActivityPopupState
  chatHandlers: ActivityPopupHandlers
  selectedChatSummary: ChatConversationSummary | null
}

export function useProjectActivityPopup({
  selectedTask,
  isActivityModalOpen,
  selectedChatSummary: selectedChatSummaryFromState,
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
  chatGatewayOptions,
  chatModel,
  chatModelOption,
  chatModelOptions,
  chatGatewayConfig,
  chatRuntimeWorkspace,
  runtimeWorkspaceId,
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
  selectedChatCanStop = false,
  slashCommandIndex,
  chatComposerFocused,
  runSelectedTaskWithCodex,
  planSelectedTaskWithCodex,
  sendCodexChatMessage,
  stopCodexChat,
  applySlashCommand,
  addChatAttachments,
  onClose,
  setChatDragDepth
}: ActivityPopupParams): UseProjectActivityPopupResult {
  const keepActivityBottomRef = useRef(true)

  const isChatModalMounted = Boolean(selectedTask && isActivityModalOpen)
  const runningConversationIds = useMemo(() => {
    const ids = new Set<string>()
    for (const conversation of chatConversations) {
      if (conversation.status === 'running') ids.add(conversation.id)
    }
    return ids
  }, [chatConversations])

  const sidebarConversations = useMemo(() => {
    if (chatConversations.length <= 30) return chatConversations
    const selectedConversation = chatConversations.find((conversation) => conversation.id === selectedChatConversationId)
    const selectedInRecent = chatConversations.slice(0, 30).some((conversation) => conversation.id === selectedChatConversationId)
    return selectedConversation && !selectedInRecent
      ? [selectedConversation, ...chatConversations.slice(0, 29)]
      : chatConversations.slice(0, 30)
  }, [chatConversations, selectedChatConversationId])

  const chatHistoryCount = isChatModalMounted
    ? (selectedTask?.comments?.length ?? 0) + history.length + localActivityEntries.length
    : 0

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

  const renderedChatMessages = useMemo(
    () => (visibleChatMessages.length > 40
      ? visibleChatMessages.slice(visibleChatMessages.length - 40)
      : visibleChatMessages
    ),
    [visibleChatMessages]
  )

  const hiddenMessageCount = Math.max(0, visibleChatMessages.length - renderedChatMessages.length)

  const selectedChatSummary = selectedChatSummaryFromState
    ?? chatConversations.find((conversation) => conversation.id === selectedChatConversationId) ?? null

  const selectedChatIsRunning = Boolean(selectedChatSummary && runningConversationIds.has(selectedChatSummary.id))

  const selectedChatUsage = useMemo(() => {
    for (const message of [...visibleChatMessages].reverse()) {
      const usage = usageFromMetadata(message.metadata)
      if (usage) return usage
    }
    return null
  }, [visibleChatMessages])

  const selectedChatCanStopComputed = useMemo(() => {
    if (selectedChatCanStop) return true
    return visibleChatMessages.some((message) => ((
      message.source === 'codex-chat' || (message.source === 'codex-plan' && Boolean(message.conversationId))
    ) && message.status === 'running'))
  }, [selectedChatCanStop, visibleChatMessages])

  const localChatStatusMessage = useMemo<TaskActivityMessage | null>(() => {
    if (!chatOperationFeedback || !isChatModalMounted) return null
    if (chatOperationFeedback.state === 'success') return null

    const source = codexPlanLaunching ? 'codex-plan' : codexRunLaunching ? 'codex-run' : 'codex-chat'
    const role = chatOperationFeedback.state === 'error' ? 'error' : 'thinking'
    const status = chatOperationFeedback.state === 'running'
      ? 'running'
      : chatOperationFeedback.state === 'error' ? 'failed' : 'completed'

    return {
      id: `${LOCAL_CHAT_STATUS_RUN_ID}-${chatOperationFeedback.state}-${chatOperationFeedback.title}`,
      runId: LOCAL_CHAT_STATUS_RUN_ID,
      conversationId: selectedChatConversationId || undefined,
      source,
      role,
      status,
      body: `${chatOperationFeedback.title}: ${chatOperationFeedback.message}`,
      createdAt: Date.now()
    }
  }, [chatOperationFeedback, codexPlanLaunching, codexRunLaunching, isChatModalMounted, selectedChatConversationId])

  const slashMatch = chatDraft.match(/(?:^|\s)\/([a-z]*)$/i)
  const slashQuery = slashMatch?.[1]?.toLowerCase() ?? ''
  const slashMenuOpen = chatComposerFocused && Boolean(slashMatch)
  const filteredSlashCommands = useMemo(() => slashCommands
    .filter((command) => command.label.slice(1).startsWith(slashQuery))
    .slice(0, 6), [slashQuery])

  useEffect(() => {
    if (!isChatModalMounted) return
    setSlashCommandIndex(0)
  }, [isChatModalMounted, slashQuery, slashMenuOpen, setSlashCommandIndex])

  useEffect(() => {
    const textarea = chatDraftTextareaRef.current
    if (!isChatModalMounted || !textarea) return
    textarea.style.height = 'auto'
    const nextHeight = Math.min(150, Math.max(36, textarea.scrollHeight))
    textarea.style.height = `${nextHeight}px`
    textarea.scrollTop = textarea.scrollHeight
  }, [chatDraft, chatAttachments.length, isChatModalMounted, chatDraftTextareaRef])

  useEffect(() => {
    if (!isChatModalMounted) return
    setChatVisibleLimit(40)
  }, [isChatModalMounted, selectedChatConversationId, selectedTask?.id, setChatVisibleLimit])

  useEffect(() => {
    setIsStartingNewChat(false)
  }, [selectedTask?.id, setIsStartingNewChat])

  useEffect(() => {
    if (!isActivityModalOpen) return
    const feed = activityFeedRef.current
    if (!feed) return
    if (keepActivityBottomRef.current) {
      feed.scrollTop = feed.scrollHeight
    }
  }, [visibleChatMessages.length, isActivityModalOpen, activityFeedRef])

  useEffect(() => {
    if (!isChatModalMounted) return
    if (chatConversations.length === 0) {
      if (selectedChatConversationId) setSelectedChatConversationId('')
      return
    }
    if (isStartingNewChat) return
    if (!chatConversations.some((conversation) => conversation.id === selectedChatConversationId)) {
      setSelectedChatConversationId(chatConversations[0].id)
    }
  }, [chatConversations, isChatModalMounted, isStartingNewChat, selectedChatConversationId, setSelectedChatConversationId])

  const onActivityScroll = () => {
    const feed = activityFeedRef.current
    if (!feed) return
    const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    keepActivityBottomRef.current = distanceToBottom < 36
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

  const chatState: ActivityPopupState = {
    task: selectedTask,
    chatDragDepth,
    conversations: chatConversations,
    sidebarConversations,
    selectedConversationId: selectedChatConversationId,
    isStartingNewChat,
    runningConversationIds,
    chatHistoryCount,
    chatSettingsOpen,
    selectedChatCanStop: selectedChatCanStopComputed,
    chatStopping,
    codexPlanLaunching,
    codexRunLaunching,
    visibleMessages: visibleChatMessages,
    renderedMessages: renderedChatMessages,
    hiddenMessageCount,
    localStatusMessage: localChatStatusMessage,
    activityFeedRef,
    chatGateway,
    chatGatewayOption,
    chatGatewayOptions,
    chatModel,
    chatModelOption,
    chatModelOptions,
    chatGatewayConfig,
    chatRuntimeWorkspace,
    runtimeWorkspaceId,
    chatIncludeContext,
    attachments: chatAttachments,
    slashMenuOpen,
    slashCommands: filteredSlashCommands,
    slashCommandIndex,
    draftTextareaRef: chatDraftTextareaRef,
    fileInputRef: chatFileInputRef,
    draft: chatDraft,
    chatSending,
    canSendChat,
    selectedChatIsRunning,
    selectedChatSummary,
    selectedChatUsage,
    selectedTaskAgent,
    taskContextSkills
  }

  const chatHandlers: ActivityPopupHandlers = {
    onClose,
    onDragEnter: handleChatDragEnter,
    onDragOver: handleChatDragOver,
    onDragLeave: handleChatDragLeave,
    onDrop: handleChatDrop,
    onNewConversation: () => {
      setIsStartingNewChat(true)
      setSelectedChatConversationId('')
      setChatComposerMode('chat')
      setCodexRunFeedback(null)
      setTimeout(() => chatDraftTextareaRef.current?.focus(), 0)
    },
    onConversationSelect: (conversationId) => {
      setIsStartingNewChat(false)
      setSelectedChatConversationId(conversationId)
    },
    onSettingsToggle: () => setChatSettingsOpen((value) => !value),
    onSettingsClose: () => setChatSettingsOpen(false),
    onStopChat: () => void stopCodexChat(),
    onPlan: () => void planSelectedTaskWithCodex(),
    onRun: () => void runSelectedTaskWithCodex(),
    onLoadEarlier: () => setChatVisibleLimit((value) => value + CHAT_MESSAGE_LOAD_STEP),
    onActivityScroll,
    onGatewayChange: (option) => {
      setChatGatewayId(option?.value ?? '')
      setChatModel('')
    },
    onModelChange: (option) => setChatModel(option?.value ?? ''),
    onIncludeContextChange: setChatIncludeContext,
    onAttachmentRemove: (attachmentId) => setChatAttachments((current) => current.filter((item) => item.id !== attachmentId)),
    onAttachFilesClick: () => chatFileInputRef.current?.click(),
    onFilesSelected: (files) => {
      if (files) void addChatAttachments(files)
      if (chatFileInputRef.current) chatFileInputRef.current.value = ''
    },
    onDraftChange: (value, textarea) => {
      setChatDraft(value)
      textarea.style.height = 'auto'
      const nextHeight = Math.min(150, Math.max(36, textarea.scrollHeight))
      textarea.style.height = `${nextHeight}px`
      textarea.scrollTop = textarea.scrollHeight
    },
    onComposerFocusChange: setChatComposerFocused,
    onSlashCommandApply: applySlashCommand,
    onSlashCommandIndexChange: (updater) => setSlashCommandIndex((value) => updater(value)),
    onClearSlashDraft: () => setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, '')),
    onSend: () => void sendCodexChatMessage()
  }

  return { chatState, chatHandlers, selectedChatSummary }
}
