import { type RefObject, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { type AppSelectOption } from '@renderer/components/select/AppSelect'
import { type Agent, type AiTool, type Gateway, type Skill, type TaskEntity, type Workspace } from '@shared/types/entities'
import {
  CHAT_MESSAGE_LOAD_STEP,
  CHAT_INITIAL_MESSAGE_LIMIT,
  CHAT_RUNNING_STATUS_LABELS,
  CHAT_TOP_LAZY_LOAD_THRESHOLD,
  conversationIdOf,
  isFreshRunningMessage,
  isRunCompleteMessage,
  preserveScrollTopAfterPrepend,
  shouldLoadEarlierMessages,
  usageFromMetadata,
  visibleChatMessagesForLimit
} from '../chat/chatUtils'
import type { CodexStopResult } from './useProjectGatewayFlow'
import type { ChatAttachmentDraft, ChatConversationSummary, ChatOperationFeedbackData, GeneratedContextEntry, PlannerClarificationMode, SlashCommand, TaskActivityMessage } from '../types'

interface Setter<T> {
  (value: T | ((previous: T) => T)): void
}

export interface ChatPopupState {
  task: TaskEntity | null
  chatDragDepth: number
  conversations: ChatConversationSummary[]
  sidebarConversations: ChatConversationSummary[]
  selectedConversationId: string
  isStartingNewChat: boolean
  runningConversationIds: Set<string>
  stoppingConversationIds: Set<string>
  chatHistoryCount: number
  contextEntries: GeneratedContextEntry[]
  chatSettingsOpen: boolean
  chatMode?: 'chat' | 'plan' | 'steer'
  selectedChatCanStop: boolean
  chatStopping: boolean
  gatewayPlanLaunching: boolean
  gatewayRunLaunching: boolean
  planChoiceOpen: boolean
  visibleMessages: TaskActivityMessage[]
  renderedMessages: TaskActivityMessage[]
  hiddenMessageCount: number
  localStatusMessage: TaskActivityMessage | null
  chatFeedRef: RefObject<HTMLDivElement | null>
  chatGateway: Gateway | null
  chatGatewayOption: AppSelectOption | null
  chatGatewayOptions: AppSelectOption[]
  chatModel: string
  chatModelOption: AppSelectOption | null
  chatPlanModel: string
  chatPlanModelOption: AppSelectOption | null
  chatRunModel: string
  chatRunModelOption: AppSelectOption | null
  chatPlanReasoningEffort: string
  chatRunReasoningEffort: string
  chatPlanReasoningOptions: AppSelectOption[]
  chatRunReasoningOptions: AppSelectOption[]
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
  taskContextTools: AiTool[]
}

interface ChatPopupHandlers {
  onClose: () => void
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onNewConversation: () => void
  onConversationSelect: (conversationId: string) => void
  onSettingsToggle: () => void
  onSettingsClose: () => void
  onStopChat: (conversationId?: string) => void
  onPlan: () => void
  onPlanChoiceClose: () => void
  onPlanChoiceSelect: (clarificationMode: PlannerClarificationMode) => void
  onRun: () => void
  onLoadEarlier: () => void
  onChatScroll: () => void
  onGatewayChange: (option: AppSelectOption | null) => void
  onModelChange: (option: AppSelectOption | null) => void
  onPlanModelChange: (option: AppSelectOption | null) => void
  onRunModelChange: (option: AppSelectOption | null) => void
  onPlanReasoningChange: (option: AppSelectOption | null) => void
  onRunReasoningChange: (option: AppSelectOption | null) => void
  onIncludeContextChange: (value: boolean) => void
  onAttachmentRemove: (attachmentId: string) => void
  onAttachFilesClick: () => void
  onFilesSelected: (files: FileList | null) => void
  onDraftChange: (value: string, textarea: HTMLTextAreaElement) => void
  onComposerFocusChange: (focused: boolean) => void
  onSlashCommandApply: (command: SlashCommand) => void
  onSlashCommandIndexChange: (updater: (value: number) => number) => void
  onClearSlashDraft: () => void
  onSteerMessageClick: (conversationId: string) => void
  onSend: () => void
  onPlannerQuestionAnswer: (answer: string) => void
}

const LOCAL_CHAT_STATUS_RUN_ID = 'local-chat-status'
const CHAT_BOTTOM_STICKY_THRESHOLD = 96
const CHAT_COMPACT_VIEWPORT_QUERY = '(max-width: 860px)'
const slashCommands: SlashCommand[] = [
  { id: 'review', label: '/review', hint: 'Prepare a code review prompt' },
  { id: 'run', label: '/run', hint: 'Start a Codex run for the task' },
  { id: 'plan', label: '/plan', hint: 'Start Codex planning for the task' },
  { id: 'steer', label: '/steer', hint: 'Send only the typed input as a steer instruction' },
  { id: 'settings', label: '/settings', hint: 'Open Codex chat settings' },
  { id: 'attach', label: '/attach', hint: 'Choose files to attach' },
  { id: 'context', label: '/context', hint: 'Toggle task context in the prompt' }
]

function isNoRunningStopFeedback(feedback: ChatOperationFeedbackData | null): boolean {
  return feedback?.state === 'error' && /no running codex chat/i.test(feedback.message)
}

function isCompactChatViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(CHAT_COMPACT_VIEWPORT_QUERY).matches
}

function settledIdsFromMessages(messages: TaskActivityMessage[]): { runIds: Set<string>; conversationIds: Set<string> } {
  const runIds = new Set<string>()
  const conversationIds = new Set<string>()
  for (const message of messages) {
    if (!isRunCompleteMessage(message)) continue
    if (message.runId) runIds.add(message.runId)
    const conversationId = conversationIdOf(message)
    if (conversationId) conversationIds.add(conversationId)
  }
  return { runIds, conversationIds }
}

interface ChatPopupParams {
  selectedTask: TaskEntity | null
  isChatPopupOpen: boolean
  selectedChatSummary?: ChatConversationSummary | null
  chatFeedRef: RefObject<HTMLDivElement | null>
  chatDraftTextareaRef: RefObject<HTMLTextAreaElement | null>
  chatFileInputRef: RefObject<HTMLInputElement | null>
  chatDragDepth: number
  chatDraft: string
  chatSending: boolean
  canSendChat: boolean
  chatAttachments: ChatAttachmentDraft[]
  chatVisibleLimit: number
  chatGateway: Gateway | null
  chatGatewayOption: AppSelectOption | null
  chatGatewayOptions: AppSelectOption[]
  chatModel: string
  chatModelOption: AppSelectOption | null
  chatPlanModel: string
  chatPlanModelOption: AppSelectOption | null
  chatRunModel: string
  chatRunModelOption: AppSelectOption | null
  chatPlanReasoningEffort: string
  chatRunReasoningEffort: string
  chatPlanReasoningOptions: AppSelectOption[]
  chatRunReasoningOptions: AppSelectOption[]
  chatModelOptions: AppSelectOption[]
  chatGatewayConfig: { executionMode?: string }
  chatRuntimeWorkspace: Workspace | null
  runtimeWorkspaceId?: string | null
  chatIncludeContext: boolean
  chatOperationFeedback: ChatOperationFeedbackData | null
  gatewayPlanLaunching: boolean
  gatewayRunLaunching: boolean
  planChoiceOpen: boolean
  selectedChatConversationId: string
  setSelectedChatConversationId: Setter<string>
  isStartingNewChat: boolean
  setIsStartingNewChat: Setter<boolean>
  setChatComposerMode: Setter<'chat' | 'plan' | 'steer'>
  setGatewayRunFeedback: Setter<ChatOperationFeedbackData | null>
  setChatDraft: Setter<string>
  setChatAttachments: Setter<ChatAttachmentDraft[]>
  setChatVisibleLimit: Setter<number>
  chatConversations: ChatConversationSummary[]
  chatActivityMessages: TaskActivityMessage[]
  contextEntries: GeneratedContextEntry[]
  chatStopping: boolean
  selectedTaskAgent: Agent | null
  taskContextSkills: Skill[]
  taskContextTools: AiTool[]
  chatMode: 'chat' | 'plan' | 'steer'
  setSlashCommandIndex: Setter<number>
  setChatSettingsOpen: Setter<boolean>
  setChatModel: Setter<string>
  setChatPlanModel: Setter<string>
  setChatRunModel: Setter<string>
  setChatPlanReasoningEffort: Setter<string>
  setChatRunReasoningEffort: Setter<string>
  setChatIncludeContext: Setter<boolean>
  setChatGatewayId: Setter<string>
  setChatComposerFocused: Setter<boolean>
  chatSettingsOpen: boolean
  selectedChatCanStop?: boolean
  slashCommandIndex: number
  chatComposerFocused: boolean
  runSelectedTaskWithCodex: () => Promise<void>
  planSelectedTaskWithCodex: () => Promise<void>
  confirmPlanWithGateway: (clarificationMode: PlannerClarificationMode) => Promise<void>
  closePlanChoice: () => void
  sendGatewayChatMessage: () => Promise<void>
  sendPlannerClarification: (answer: string) => Promise<void>
  stopGatewayChat: (conversationIdOverride?: string) => Promise<CodexStopResult>
  applySlashCommand: (command: SlashCommand) => Promise<void>
  addChatAttachments: (files: FileList | File[]) => Promise<void>
  onClose: () => void
  setChatDragDepth: Setter<number>
}

export interface UseProjectChatPopupResult {
  chatState: ChatPopupState
  chatHandlers: ChatPopupHandlers
  selectedChatSummary: ChatConversationSummary | null
}

export function useProjectChatPopup({
  selectedTask,
  isChatPopupOpen,
    selectedChatSummary: selectedChatSummaryFromState,
  chatFeedRef,
  chatDraftTextareaRef,
  chatFileInputRef,
  chatDragDepth,
  chatDraft,
  chatSending,
  chatMode,
  canSendChat,
  chatAttachments,
  chatVisibleLimit,
  chatGateway,
  chatGatewayOption,
  chatGatewayOptions,
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
  runtimeWorkspaceId,
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
  contextEntries,
  chatStopping,
  selectedTaskAgent,
  taskContextSkills,
  taskContextTools,
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
  selectedChatCanStop = false,
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
  onClose,
  setChatDragDepth
}: ChatPopupParams): UseProjectChatPopupResult {
  const keepChatBottomRef = useRef(true)
  const lazyLoadAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  const lazyLoadPendingRef = useRef(false)
  const [stoppingConversationIds, setStoppingConversationIds] = useState<Set<string>>(() => new Set())
  const [localSettledConversationIds, setLocalSettledConversationIds] = useState<Set<string>>(() => new Set())

  const isChatModalMounted = Boolean(selectedTask && isChatPopupOpen)
  const settledConversationState = useMemo(() => {
    const now = Date.now()
    const settled = settledIdsFromMessages(chatActivityMessages)
    localSettledConversationIds.forEach((conversationId) => settled.conversationIds.add(conversationId))
    if (selectedChatConversationId && isNoRunningStopFeedback(chatOperationFeedback)) {
      settled.conversationIds.add(selectedChatConversationId)
    }
    const freshRunningConversationIds = new Set<string>()
    for (const message of chatActivityMessages) {
      const conversationId = conversationIdOf(message)
      if (!conversationId) continue
      if (isFreshRunningMessage(message, now)) {
        freshRunningConversationIds.add(conversationId)
      }
    }
    return { settled, freshRunningConversationIds }
  }, [
    chatActivityMessages,
    localSettledConversationIds,
    selectedChatConversationId,
    chatOperationFeedback
  ])

  const runningConversationIds = useMemo(() => {
    const ids = new Set<string>()
    const runningConversationIds = settledConversationState.freshRunningConversationIds
    for (const conversation of chatConversations) {
      if (!CHAT_RUNNING_STATUS_LABELS.includes(conversation.status) || conversation.status === 'completed' || conversation.status === 'failed') continue
      if (!runningConversationIds.has(conversation.id)) continue
      if (settledConversationState.settled.conversationIds.has(conversation.id)) continue
      ids.add(conversation.id)
    }
    return ids
  }, [chatConversations, settledConversationState])

  const sidebarConversations = useMemo(() => {
    if (chatConversations.length <= 120) return chatConversations
    const pinnedIds = new Set<string>(runningConversationIds)
    if (selectedChatConversationId) pinnedIds.add(selectedChatConversationId)
    const merged: ChatConversationSummary[] = []
    const seen = new Set<string>()
    const push = (conversation: ChatConversationSummary | undefined) => {
      if (!conversation || seen.has(conversation.id)) return
      seen.add(conversation.id)
      merged.push(conversation)
    }
    for (const conversation of chatConversations) {
      if (pinnedIds.has(conversation.id)) push(conversation)
    }
    for (const conversation of chatConversations.slice(0, 120)) push(conversation)
    return merged
  }, [chatConversations, runningConversationIds, selectedChatConversationId])

  const chatHistoryCount = isChatModalMounted ? chatConversations.length : 0

  const visibleChatMessages = useMemo(() => {
    if (isStartingNewChat) return []
    if (!selectedChatConversationId) return []
    const messages = chatActivityMessages.filter((message) => conversationIdOf(message) === selectedChatConversationId)
    const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt)
    const settled = settledIdsFromMessages(sorted)
    settledConversationState.settled.conversationIds.forEach((conversationId) => settled.conversationIds.add(conversationId))
    if (isNoRunningStopFeedback(chatOperationFeedback)) settled.conversationIds.add(selectedChatConversationId)
    return sorted.filter((message) => !(message.role === 'thinking' && message.status === 'running' && (
      settledConversationState.settled.runIds.has(message.runId)
      || Boolean(conversationIdOf(message) && settledConversationState.settled.conversationIds.has(conversationIdOf(message) as string))
    )))
  }, [chatActivityMessages, chatOperationFeedback, isStartingNewChat, settledConversationState, selectedChatConversationId])

  const selectedChatSummary = selectedChatSummaryFromState
    ?? (isStartingNewChat ? null : chatConversations.find((conversation) => conversation.id === selectedChatConversationId) ?? null)

  const selectedChatIsRunning = Boolean(selectedChatSummary && runningConversationIds.has(selectedChatSummary.id))

  const renderedChatMessages = useMemo(
    () => visibleChatMessagesForLimit(visibleChatMessages, chatVisibleLimit),
    [chatVisibleLimit, visibleChatMessages]
  )

  const hiddenMessageCount = Math.max(0, visibleChatMessages.length - renderedChatMessages.length)

  const selectedChatUsage = useMemo(() => {
    for (const message of [...visibleChatMessages].reverse()) {
      const usage = usageFromMetadata(message.metadata)
      if (usage) return usage
    }
    return null
  }, [visibleChatMessages])

  const selectedChatCanStopComputed = useMemo(() => {
    return Boolean(selectedChatSummary && runningConversationIds.has(selectedChatSummary.id))
  }, [runningConversationIds, selectedChatSummary])

  const localChatStatusMessage = useMemo<TaskActivityMessage | null>(() => {
    if (!chatOperationFeedback || !isChatModalMounted) return null
    if (chatOperationFeedback.state === 'success') return null

    const source = gatewayPlanLaunching ? 'gateway-plan' : gatewayRunLaunching ? 'gateway-run' : 'gateway-chat'
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
  }, [chatOperationFeedback, gatewayPlanLaunching, gatewayRunLaunching, isChatModalMounted, selectedChatConversationId])

  const scrollSignal = useMemo(() => {
    const lastMessage = renderedChatMessages[renderedChatMessages.length - 1]
    const localSignal = localChatStatusMessage
      ? `${localChatStatusMessage.id}:${localChatStatusMessage.status ?? ''}:${localChatStatusMessage.body.length}`
      : ''
    return [
      renderedChatMessages.length,
      lastMessage?.id ?? '',
      lastMessage?.updatedAt ?? lastMessage?.createdAt ?? 0,
      lastMessage?.status ?? '',
      lastMessage?.body.length ?? 0,
      localSignal
    ].join(':')
  }, [localChatStatusMessage, renderedChatMessages])

  const slashMatch = chatDraft.match(/(?:^|\s)\/([a-z]*)$/i)
  const slashQuery = slashMatch?.[1]?.toLowerCase() ?? ''
  const slashMenuOpen = chatComposerFocused && Boolean(slashMatch)
  const filteredSlashCommands = useMemo(() => slashCommands
    .filter((command) => command.label.slice(1).startsWith(slashQuery))
    .slice(0, 8), [slashQuery])

  useEffect(() => {
    if (!isChatModalMounted) return
    setSlashCommandIndex(0)
  }, [isChatModalMounted, slashQuery, slashMenuOpen])

  useEffect(() => {
    if (!isChatModalMounted || typeof window === 'undefined') return
    const media = window.matchMedia(CHAT_COMPACT_VIEWPORT_QUERY)
    if (media.matches) setChatSettingsOpen(false)

    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) setChatSettingsOpen(false)
    }
    media.addEventListener('change', handleViewportChange)
    return () => media.removeEventListener('change', handleViewportChange)
  }, [isChatModalMounted, selectedTask?.id, setChatSettingsOpen])

  const closeSettingsOnCompactViewport = () => {
    if (isCompactChatViewport()) setChatSettingsOpen(false)
  }

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
    setChatVisibleLimit((value) => value === CHAT_INITIAL_MESSAGE_LIMIT ? value : CHAT_INITIAL_MESSAGE_LIMIT)
  }, [isChatModalMounted, selectedChatConversationId, selectedTask?.id])

  useEffect(() => {
    setIsStartingNewChat(false)
    setLocalSettledConversationIds(new Set())
    setStoppingConversationIds(new Set())
  }, [selectedTask?.id])

  useEffect(() => {
    if (!isChatPopupOpen) return
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
    const shouldStickToBottom = keepChatBottomRef.current || distanceToBottom < CHAT_BOTTOM_STICKY_THRESHOLD
    if (!shouldStickToBottom) return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight
      secondFrame = requestAnimationFrame(() => {
        feed.scrollTop = feed.scrollHeight
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
    }
  }, [chatFeedRef, isChatPopupOpen, isStartingNewChat, scrollSignal, selectedChatConversationId])

  useEffect(() => {
    keepChatBottomRef.current = true
  }, [isStartingNewChat, selectedChatConversationId])

  useEffect(() => {
    if (!isChatModalMounted) return
    if (chatConversations.length === 0) return
    if (isStartingNewChat) return
    if (!selectedChatConversationId) {
      setSelectedChatConversationId(chatConversations[0].id)
    }
  }, [chatConversations, isChatModalMounted, isStartingNewChat, selectedChatConversationId])

  const onChatScroll = () => {
    const feed = chatFeedRef.current
    if (!feed) return
    const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    keepChatBottomRef.current = distanceToBottom < CHAT_BOTTOM_STICKY_THRESHOLD
    if (!lazyLoadPendingRef.current && shouldLoadEarlierMessages(feed.scrollTop, hiddenMessageCount, CHAT_TOP_LAZY_LOAD_THRESHOLD)) {
      lazyLoadPendingRef.current = true
      keepChatBottomRef.current = false
      lazyLoadAnchorRef.current = { scrollTop: feed.scrollTop, scrollHeight: feed.scrollHeight }
      setChatVisibleLimit((value) => Math.min(visibleChatMessages.length, value + CHAT_MESSAGE_LOAD_STEP))
    }
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

  const chatState: ChatPopupState = {
    task: selectedTask,
    chatDragDepth,
    conversations: chatConversations,
    sidebarConversations,
    selectedConversationId: selectedChatConversationId,
    isStartingNewChat,
    chatMode,
    runningConversationIds,
    stoppingConversationIds,
    chatHistoryCount,
    contextEntries,
    chatSettingsOpen,
    selectedChatCanStop: selectedChatCanStopComputed,
    chatStopping,
    gatewayPlanLaunching,
    gatewayRunLaunching,
    planChoiceOpen,
    visibleMessages: visibleChatMessages,
    renderedMessages: renderedChatMessages,
    hiddenMessageCount,
    localStatusMessage: localChatStatusMessage,
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
    chatPlanReasoningEffort,
    chatRunReasoningEffort,
    chatPlanReasoningOptions,
    chatRunReasoningOptions,
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
    taskContextSkills,
    taskContextTools
  }

  const chatHandlers: ChatPopupHandlers = {
    onClose: () => {
      closePlanChoice()
      onClose()
    },
    onDragEnter: handleChatDragEnter,
    onDragOver: handleChatDragOver,
    onDragLeave: handleChatDragLeave,
    onDrop: handleChatDrop,
    onNewConversation: () => {
      setIsStartingNewChat(true)
      setChatComposerMode('chat')
      setGatewayRunFeedback(null)
      closeSettingsOnCompactViewport()
    },
    onConversationSelect: (conversationId) => {
      setIsStartingNewChat(false)
      setSelectedChatConversationId(conversationId)
      closeSettingsOnCompactViewport()
    },
    onSettingsToggle: () => setChatSettingsOpen((value) => !value),
    onSettingsClose: () => setChatSettingsOpen(false),
    onStopChat: (conversationId) => {
      const targetConversationId = conversationId || selectedChatSummary?.id || selectedChatConversationId
      if (!targetConversationId) return
      setStoppingConversationIds((current) => new Set(current).add(targetConversationId))
      void stopGatewayChat(targetConversationId)
        .then((result) => {
          if (result.notFound) {
            setLocalSettledConversationIds((current) => new Set(current).add(targetConversationId))
          }
        })
        .finally(() => {
          setStoppingConversationIds((current) => {
            const next = new Set(current)
            next.delete(targetConversationId)
            return next
          })
        })
    },
    onPlan: () => {
      closeSettingsOnCompactViewport()
      void planSelectedTaskWithCodex()
    },
    onPlanChoiceClose: () => closePlanChoice(),
    onPlanChoiceSelect: (clarificationMode) => {
      closeSettingsOnCompactViewport()
      void confirmPlanWithGateway(clarificationMode)
    },
    onRun: () => {
      closeSettingsOnCompactViewport()
      void runSelectedTaskWithCodex()
    },
    onLoadEarlier: () => setChatVisibleLimit((value) => Math.min(visibleChatMessages.length, value + CHAT_MESSAGE_LOAD_STEP)),
    onChatScroll,
    onGatewayChange: (option) => {
      setChatGatewayId(option?.value ?? '')
      setChatModel('')
      setChatPlanModel('')
      setChatRunModel('')
      closeSettingsOnCompactViewport()
    },
    onModelChange: (option) => {
      setChatModel(option?.value ?? '')
      closeSettingsOnCompactViewport()
    },
    onPlanModelChange: (option) => {
      setChatPlanModel(option?.value ?? '')
      closeSettingsOnCompactViewport()
    },
    onRunModelChange: (option) => {
      const next = option?.value ?? ''
      setChatRunModel(next)
      setChatModel(next)
      closeSettingsOnCompactViewport()
    },
    onPlanReasoningChange: (option) => {
      setChatPlanReasoningEffort(option?.value ?? 'medium')
      closeSettingsOnCompactViewport()
    },
    onRunReasoningChange: (option) => {
      setChatRunReasoningEffort(option?.value ?? 'medium')
      closeSettingsOnCompactViewport()
    },
    onIncludeContextChange: (value) => {
      setChatIncludeContext(value)
      closeSettingsOnCompactViewport()
    },
    onAttachmentRemove: (attachmentId) => setChatAttachments((current) => current.filter((item) => {
      if (item.id !== attachmentId) return true
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return false
    })),
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
    onClearSlashDraft: () => {
      setChatComposerMode('chat')
      setChatDraft((value) => value.replace(/(?:^|\s)\/[a-z]*$/i, ''))
    },
    onSteerMessageClick: (conversationId) => {
      if (!conversationId) return
      setIsStartingNewChat(false)
      setSelectedChatConversationId(conversationId)
      setChatComposerMode('steer')
      setGatewayRunFeedback(null)
      closeSettingsOnCompactViewport()
      requestAnimationFrame(() => chatDraftTextareaRef.current?.focus())
    },
    onSend: () => {
      closeSettingsOnCompactViewport()
      void sendGatewayChatMessage()
    },
    onPlannerQuestionAnswer: (answer) => {
      closeSettingsOnCompactViewport()
      void sendPlannerClarification(answer)
    }
  }

  return { chatState, chatHandlers, selectedChatSummary }
}
