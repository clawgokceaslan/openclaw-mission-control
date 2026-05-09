import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react'
import type { IconType } from 'react-icons'
import { LuBot, LuCircleCheck, LuCircleStop, LuCloudUpload, LuEllipsis, LuFileText, LuHistory, LuMessageSquare, LuPaperclip, LuPlay, LuPlus, LuRefreshCw, LuSend, LuSettings2, LuSignal, LuSparkles, LuX } from 'react-icons/lu'
import { formatUsageSummary } from '@shared/utils/gateway-events'
import type { Agent, Gateway, Skill, TaskEntity, Workspace } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { GatewayChatMessageItem, CodexWorkBlock } from '@renderer/components/projects/detail/chat/CodexChatMessageItem'
import { formatChatTime, groupCodexTranscriptMessages } from '@renderer/screens/projects/detail/chat/chatUtils'
import type { ChatAttachmentDraft, ChatConversationSummary, GeneratedContextEntry, PlannerClarificationMode, SlashCommand, TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import { gatewayChatLifecycleStatusKey, gatewayChatPhaseTone, gatewayLifecycleStatusMeta } from '@shared/utils/gateway-chat-phase'
import { lockModalInteractionRegion } from '@renderer/utils/modalInteractionLock'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'
import popupStyles from './index.module.scss'

interface ChatPopupFlatProps {
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
  selectedChatUsage: Parameters<typeof formatUsageSummary>[0] | null
  selectedTaskAgent: Agent | null
  taskContextSkills: Skill[]
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
  onSend: () => void
  onPlannerQuestionAnswer: (answer: string) => void
}

type ChatPopupStateProps = Omit<
  ChatPopupFlatProps,
  | 'onClose'
  | 'onDragEnter'
  | 'onDragOver'
  | 'onDragLeave'
  | 'onDrop'
  | 'onNewConversation'
  | 'onConversationSelect'
  | 'onSettingsToggle'
  | 'onSettingsClose'
  | 'onStopChat'
  | 'onPlan'
  | 'onPlanChoiceClose'
  | 'onPlanChoiceSelect'
  | 'onRun'
  | 'onLoadEarlier'
  | 'onChatScroll'
  | 'onGatewayChange'
  | 'onModelChange'
  | 'onPlanModelChange'
  | 'onRunModelChange'
  | 'onPlanReasoningChange'
  | 'onRunReasoningChange'
  | 'onIncludeContextChange'
  | 'onAttachmentRemove'
  | 'onAttachFilesClick'
  | 'onFilesSelected'
  | 'onDraftChange'
  | 'onComposerFocusChange'
  | 'onSlashCommandApply'
  | 'onSlashCommandIndexChange'
  | 'onClearSlashDraft'
  | 'onSend'
  | 'onPlannerQuestionAnswer'
>

type ChatPopupHandlerProps = Pick<
  ChatPopupFlatProps,
  | 'onClose'
  | 'onDragEnter'
  | 'onDragOver'
  | 'onDragLeave'
  | 'onDrop'
  | 'onNewConversation'
  | 'onConversationSelect'
  | 'onSettingsToggle'
  | 'onSettingsClose'
  | 'onStopChat'
  | 'onPlan'
  | 'onPlanChoiceClose'
  | 'onPlanChoiceSelect'
  | 'onRun'
  | 'onLoadEarlier'
  | 'onChatScroll'
  | 'onGatewayChange'
  | 'onModelChange'
  | 'onPlanModelChange'
  | 'onRunModelChange'
  | 'onPlanReasoningChange'
  | 'onRunReasoningChange'
  | 'onIncludeContextChange'
  | 'onAttachmentRemove'
  | 'onAttachFilesClick'
  | 'onFilesSelected'
  | 'onDraftChange'
  | 'onComposerFocusChange'
  | 'onSlashCommandApply'
  | 'onSlashCommandIndexChange'
  | 'onClearSlashDraft'
  | 'onSend'
  | 'onPlannerQuestionAnswer'
>

interface ChatPopupProps extends Partial<ChatPopupStateProps>, Partial<ChatPopupHandlerProps> {
  chatState?: Partial<ChatPopupStateProps>
  chatHandlers?: Partial<ChatPopupHandlerProps>
  chatOptions?: {
    title?: string
    subtitle?: string
    sidebarTitle?: string
    sidebarSubtitle?: string
    showRunActions?: boolean
  }
}

type ChatHeaderAction = {
  key: string
  label: string
  ariaLabel: string
  title: string
  icon: IconType
  onSelect: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
}

function ChatHeaderOverflowMenu({ actions }: { actions: ChatHeaderAction[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  if (actions.length === 0) return null

  return (
    <div className={popupStyles.chatHeaderMoreWrap} ref={menuRef}>
      <button
        type="button"
        className={`${styles.chatIconAction} ${popupStyles.chatHeaderMoreButton} ${isOpen ? styles.chatActionActive : ''}`}
        onClick={() => setIsOpen((value) => !value)}
        aria-label="More chat actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="More"
      >
        <LuEllipsis size={17} />
      </button>
      {isOpen ? (
        <div className={popupStyles.chatHeaderMenu} role="menu">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                className={`${action.active ? popupStyles.chatHeaderMenuActive : ''} ${action.danger ? popupStyles.chatHeaderMenuDanger : ''}`}
                disabled={action.disabled}
                onClick={() => {
                  if (action.disabled) return
                  setIsOpen(false)
                  action.onSelect()
                }}
              >
                <Icon size={15} />
                <span>{action.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function ChatPopup({
  chatState,
  chatHandlers,
  chatOptions,
  ...flatProps
}: ChatPopupProps) {
  const noOp = () => {}
  const state = (chatState ?? flatProps) as ChatPopupStateProps | null
  const [isConfigurationDetailsOpen, setIsConfigurationDetailsOpen] = useState(false)
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false)
  const [selectedContextEntryId, setSelectedContextEntryId] = useState<string>('')
  const isSteerMode = state?.chatMode === 'steer'

  useEffect(() => lockModalInteractionRegion(), [])

  const configurationDetails = useMemo(() => {
    const workspaceLabel = state?.chatRuntimeWorkspace?.name || state?.runtimeWorkspaceId || 'Workspace required'
    const sessionLabel = state?.selectedChatSummary?.status ?? (state?.visibleMessages.length ? 'mixed' : 'ready')
    const skillsLabel = state?.taskContextSkills.length ? state.taskContextSkills.map((skill) => skill.name).join(', ') : 'None'
    const usageLabel = state?.selectedChatUsage ? formatUsageSummary(state.selectedChatUsage) : 'N/A'
    const includeContextLabel = state?.chatIncludeContext ? 'On' : 'Off'

    return [
      { label: 'Gateway', value: state?.chatGateway?.name ?? 'Gateway required', warning: !state?.chatGateway },
      { label: 'Plan model', value: state?.chatPlanModel || state?.chatModel || 'Plan model required', warning: !state?.chatPlanModel && !state?.chatModel },
      { label: 'Run model', value: state?.chatRunModel || state?.chatModel || 'Run model required', warning: !state?.chatRunModel && !state?.chatModel },
      { label: 'Plan reasoning', value: state?.chatPlanReasoningEffort || 'Project default', hidden: !(state?.chatPlanReasoningOptions?.length ?? 0) },
      { label: 'Run reasoning', value: state?.chatRunReasoningEffort || 'Project default', hidden: !(state?.chatRunReasoningOptions?.length ?? 0) },
      { label: 'Mode', value: state?.chatGatewayConfig?.executionMode === 'exec' ? 'Exec' : 'Terminal' },
      { label: 'Workspace', value: workspaceLabel, warning: !workspaceLabel || workspaceLabel === 'Workspace required' },
      { label: 'Session', value: sessionLabel },
      { label: 'Agent', value: state?.selectedTaskAgent?.name ?? 'Unassigned' },
      { label: 'Skills', value: skillsLabel },
      { label: 'Usage', value: usageLabel, hidden: !usageLabel },
      { label: 'Task context', value: includeContextLabel }
    ]
  }, [
    state?.chatGateway?.name,
    state?.chatGatewayConfig?.executionMode,
    state?.chatIncludeContext,
    state?.chatModel,
    state?.chatPlanModel,
    state?.chatPlanReasoningEffort,
    state?.chatPlanReasoningOptions?.length,
    state?.chatRuntimeWorkspace?.name,
    state?.runtimeWorkspaceId,
    state?.selectedChatSummary?.status,
    state?.selectedTaskAgent?.name,
    state?.selectedChatUsage,
    state?.taskContextSkills,
    state?.visibleMessages.length,
    state?.chatRunModel,
    state?.chatRunReasoningEffort,
    state?.chatRunReasoningOptions?.length
  ])

  const visibleConfigurationDetails = configurationDetails.filter((item) => !item.hidden)
  const configurationGroups = useMemo(() => {
    const byLabel = new Map(visibleConfigurationDetails.map((item) => [item.label, item]))
    const pick = (labels: string[]) => labels.flatMap((label) => {
      const item = byLabel.get(label)
      return item ? [item] : []
    })
    return [
      { title: 'Runtime', items: pick(['Gateway', 'Mode', 'Workspace', 'Session']) },
      { title: 'Models', items: pick(['Plan model', 'Plan reasoning', 'Run model', 'Run reasoning']) },
      { title: 'Task context', items: pick(['Agent', 'Skills', 'Task context']) },
      { title: 'Usage', items: pick(['Usage']) }
    ].filter((group) => group.items.length > 0)
  }, [visibleConfigurationDetails])

  useEffect(() => {
    if (!isConfigurationDetailsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsConfigurationDetailsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isConfigurationDetailsOpen])

  if (!state) {
    return null
  }
  const handlers = {
    onClose: chatHandlers?.onClose ?? flatProps.onClose ?? noOp,
    onDragEnter: chatHandlers?.onDragEnter ?? flatProps.onDragEnter ?? (() => {}),
    onDragOver: chatHandlers?.onDragOver ?? flatProps.onDragOver ?? (() => {}),
    onDragLeave: chatHandlers?.onDragLeave ?? flatProps.onDragLeave ?? (() => {}),
    onDrop: chatHandlers?.onDrop ?? flatProps.onDrop ?? (() => {}),
    onNewConversation: chatHandlers?.onNewConversation ?? flatProps.onNewConversation ?? noOp,
    onConversationSelect: chatHandlers?.onConversationSelect ?? flatProps.onConversationSelect ?? noOp,
    onSettingsToggle: chatHandlers?.onSettingsToggle ?? flatProps.onSettingsToggle ?? noOp,
    onSettingsClose: chatHandlers?.onSettingsClose ?? flatProps.onSettingsClose ?? noOp,
    onStopChat: chatHandlers?.onStopChat ?? flatProps.onStopChat ?? noOp,
    onPlan: chatHandlers?.onPlan ?? flatProps.onPlan ?? noOp,
    onPlanChoiceClose: chatHandlers?.onPlanChoiceClose ?? flatProps.onPlanChoiceClose ?? noOp,
    onPlanChoiceSelect: chatHandlers?.onPlanChoiceSelect ?? flatProps.onPlanChoiceSelect ?? noOp,
    onRun: chatHandlers?.onRun ?? flatProps.onRun ?? noOp,
    onLoadEarlier: chatHandlers?.onLoadEarlier ?? flatProps.onLoadEarlier ?? noOp,
    onChatScroll: chatHandlers?.onChatScroll ?? flatProps.onChatScroll ?? noOp,
    onGatewayChange: chatHandlers?.onGatewayChange ?? flatProps.onGatewayChange ?? (() => {}),
    onModelChange: chatHandlers?.onModelChange ?? flatProps.onModelChange ?? (() => {}),
    onPlanModelChange: chatHandlers?.onPlanModelChange ?? flatProps.onPlanModelChange ?? (() => {}),
    onRunModelChange: chatHandlers?.onRunModelChange ?? flatProps.onRunModelChange ?? (() => {}),
    onPlanReasoningChange: chatHandlers?.onPlanReasoningChange ?? flatProps.onPlanReasoningChange ?? (() => {}),
    onRunReasoningChange: chatHandlers?.onRunReasoningChange ?? flatProps.onRunReasoningChange ?? (() => {}),
    onIncludeContextChange: chatHandlers?.onIncludeContextChange ?? flatProps.onIncludeContextChange ?? noOp,
    onAttachmentRemove: chatHandlers?.onAttachmentRemove ?? flatProps.onAttachmentRemove ?? noOp,
    onAttachFilesClick: chatHandlers?.onAttachFilesClick ?? flatProps.onAttachFilesClick ?? noOp,
    onFilesSelected: chatHandlers?.onFilesSelected ?? flatProps.onFilesSelected ?? ((_) => {}),
    onDraftChange: chatHandlers?.onDraftChange ?? flatProps.onDraftChange ?? (() => {}),
    onComposerFocusChange: chatHandlers?.onComposerFocusChange ?? flatProps.onComposerFocusChange ?? noOp,
    onSlashCommandApply: chatHandlers?.onSlashCommandApply ?? flatProps.onSlashCommandApply ?? noOp,
    onSlashCommandIndexChange: chatHandlers?.onSlashCommandIndexChange ?? flatProps.onSlashCommandIndexChange ?? (() => {}),
    onClearSlashDraft: chatHandlers?.onClearSlashDraft ?? flatProps.onClearSlashDraft ?? noOp,
    onSend: chatHandlers?.onSend ?? flatProps.onSend ?? noOp,
    onPlannerQuestionAnswer: chatHandlers?.onPlannerQuestionAnswer ?? flatProps.onPlannerQuestionAnswer ?? noOp
  }

  const {
    task,
    chatDragDepth,
    conversations,
    sidebarConversations,
    selectedConversationId,
    isStartingNewChat,
    runningConversationIds,
    stoppingConversationIds,
    chatHistoryCount,
    contextEntries = [],
    chatSettingsOpen,
    selectedChatCanStop,
    chatStopping,
    gatewayPlanLaunching,
    gatewayRunLaunching,
    visibleMessages,
    renderedMessages,
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
    chatPlanReasoningEffort,
    chatRunReasoningEffort,
    chatPlanReasoningOptions = [],
    chatRunReasoningOptions = [],
    chatModelOptions,
    chatGatewayConfig,
    chatRuntimeWorkspace,
    runtimeWorkspaceId,
    chatIncludeContext,
    attachments,
    slashMenuOpen,
    slashCommands,
    slashCommandIndex,
    draftTextareaRef,
    fileInputRef,
    draft,
    chatSending,
    canSendChat,
    selectedChatIsRunning,
    selectedChatSummary,
    selectedChatUsage,
    selectedTaskAgent,
    taskContextSkills
  } = state

  const {
    onClose,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onNewConversation,
    onConversationSelect,
    onSettingsToggle,
    onSettingsClose,
    onStopChat,
    onPlan,
    onRun,
    onChatScroll,
    onGatewayChange,
    onModelChange,
    onPlanModelChange,
    onRunModelChange,
    onPlanReasoningChange,
    onRunReasoningChange,
    onIncludeContextChange,
    onAttachmentRemove,
    onAttachFilesClick,
    onFilesSelected,
    onDraftChange,
    onComposerFocusChange,
    onSlashCommandApply,
    onSlashCommandIndexChange,
    onClearSlashDraft,
    onSend,
  } = handlers

  const isChatStopping = chatStopping
  const showRunActions = chatOptions?.showRunActions !== false
  const title = chatOptions?.title ?? 'Chat'
  const subtitle = chatOptions?.subtitle ?? task?.title ?? 'Task'
  const sidebarTitle = chatOptions?.sidebarTitle ?? 'Chat'
  const sidebarSubtitle = chatOptions?.sidebarSubtitle ?? task?.title ?? 'Task'
  const transcriptMessages = [
    ...renderedMessages.filter((message) => !(message.role === 'system' && /^Started Codex/i.test(message.body))),
    ...(localStatusMessage ? [localStatusMessage] : [])
  ]
  const transcriptItems = groupCodexTranscriptMessages(transcriptMessages)
  const selectedContextEntry = contextEntries.find((entry) => entry.id === selectedContextEntryId) ?? contextEntries[0] ?? null
  const showContextHistory = visibleMessages.length > 0 || contextEntries.length > 0
  const conversationStatusMeta = (conversation: ChatConversationSummary) => {
    const active = runningConversationIds.has(conversation.id) || conversation.status === 'running' || conversation.status === 'queued'
    return gatewayLifecycleStatusMeta(gatewayChatLifecycleStatusKey(conversation.phase, conversation.status, active))
  }
  const conversationStatusLabel = (conversation: ChatConversationSummary) => {
    const meta = conversationStatusMeta(conversation)
    return meta.active
      ? <span className={styles.chatRunningStatusLabel}><span>{meta.label}</span><em className={styles.chatSidebarLoader} aria-label="Codex chat is running"><i /><i /><i /></em></span>
      : meta.label
  }
  const conversationStatusClass = (conversation: ChatConversationSummary) => {
    const meta = conversationStatusMeta(conversation)
    return styles[`chatStatus_${meta.tone}`] ?? ''
  }
  const conversationSourceClass = (conversation: ChatConversationSummary) => {
    return styles[`chatSource_${gatewayChatPhaseTone(conversation.phase)}`] ?? ''
  }
  const selectedChatStatusMeta = selectedChatSummary ? conversationStatusMeta(selectedChatSummary) : null
  const latestConversationForPhase = (phase: 'PLAN' | 'RUN' | 'POST-RUNNING') => conversations
    .filter((conversation) => conversation.phase === phase)
    .slice()
    .sort((a, b) => b.at - a.at)[0] ?? null
  const planConversation = latestConversationForPhase('PLAN')
  const runConversation = latestConversationForPhase('RUN')
  const verifyConversation = latestConversationForPhase('POST-RUNNING')
  const activePlan = planConversation ? runningConversationIds.has(planConversation.id) || planConversation.status === 'running' || conversationStatusMeta(planConversation).active : false
  const activeRun = runConversation ? runningConversationIds.has(runConversation.id) || runConversation.status === 'running' || conversationStatusMeta(runConversation).active : false
  const activeVerify = verifyConversation ? runningConversationIds.has(verifyConversation.id) || verifyConversation.status === 'running' || conversationStatusMeta(verifyConversation).active : false
  const headerActions: ChatHeaderAction[] = [
    ...(showContextHistory ? [{
      key: 'context',
      label: 'Context',
      ariaLabel: 'Context history',
      title: 'Context history',
      icon: LuHistory,
      onSelect: () => setIsContextDrawerOpen(true),
      active: isContextDrawerOpen
    }] : []),
    {
      key: 'settings',
      label: 'Settings',
      ariaLabel: 'Chat settings',
      title: 'Chat settings',
      icon: LuSettings2,
      onSelect: onSettingsToggle,
      active: chatSettingsOpen
    },
    ...(selectedChatCanStop ? [{
      key: 'stop',
      label: 'Stop',
      ariaLabel: 'Stop Codex chat',
      title: 'Stop Codex chat',
      icon: LuCircleStop,
      onSelect: () => onStopChat(),
      disabled: chatStopping,
      danger: true
    }] : []),
    ...(showRunActions ? [{
      key: 'plan',
      label: gatewayPlanLaunching ? 'Planlanıyor' : 'Planla',
      ariaLabel: gatewayPlanLaunching ? 'Task planlanıyor' : 'Taskı planla',
      title: gatewayPlanLaunching ? 'Task planlanıyor' : 'Taskı planla',
      icon: LuSparkles,
      onSelect: onPlan,
      disabled: gatewayPlanLaunching
    }, {
      key: 'run',
      label: gatewayRunLaunching ? 'Çalışıyor' : 'Çalıştır',
      ariaLabel: gatewayRunLaunching ? 'Task çalışıyor' : 'Taskı çalıştır',
      title: gatewayRunLaunching ? 'Task çalışıyor' : 'Taskı çalıştır',
      icon: LuPlay,
      onSelect: onRun,
      disabled: gatewayRunLaunching
    }] : [])
  ]
  const mobilePrimaryActionKeys = new Set(selectedChatCanStop ? ['stop'] : showRunActions ? ['plan', 'run'] : [])
  const mobileOverflowActions = headerActions.filter((action) => !mobilePrimaryActionKeys.has(action.key))
  const pipelineRows = [
    {
      key: 'plan',
      title: 'Planla',
      status: activePlan ? 'Planlanıyor' : planConversation ? conversationStatusMeta(planConversation).label : 'Hazır',
      detail: activePlan ? 'AI uygulanabilir task planını çıkarıyor.' : planConversation ? `${formatChatTime(planConversation.at)} tarihinde plan kaydı var.` : 'İlk adım: kapsamı ve alt işleri netleştir.',
      tone: activePlan ? 'active' : planConversation ? 'done' : 'idle',
      icon: activePlan ? LuRefreshCw : LuSparkles,
      action: activePlan && planConversation ? () => onConversationSelect(planConversation.id) : onPlan,
      actionLabel: activePlan ? 'Durumu aç' : planConversation ? 'Yeniden planla' : 'Planla',
      disabled: gatewayPlanLaunching
    },
    {
      key: 'run',
      title: 'Çalıştır',
      status: activeRun ? 'Çalışıyor' : runConversation ? conversationStatusMeta(runConversation).label : planConversation ? 'Çalıştırılabilir' : 'Plan bekliyor',
      detail: activeRun ? 'AI task çıktısını üretmek için çalışıyor.' : runConversation ? `${formatChatTime(runConversation.at)} tarihinde çalışma kaydı var.` : planConversation ? 'Plan hazır; güvenli sıradaki adım çalışma.' : 'Önce planlama adımı tamamlanmalı.',
      tone: activeRun ? 'active' : runConversation ? 'done' : planConversation ? 'ready' : 'idle',
      icon: activeRun ? LuRefreshCw : LuPlay,
      action: activeRun && runConversation ? () => onConversationSelect(runConversation.id) : onRun,
      actionLabel: activeRun ? 'Durumu aç' : runConversation ? 'Yeniden dene' : 'Çalıştır',
      disabled: gatewayRunLaunching || !planConversation
    },
    {
      key: 'verify',
      title: 'Doğrula',
      status: activeVerify ? 'Doğrulanıyor' : verifyConversation ? conversationStatusMeta(verifyConversation).label : runConversation ? 'Özet bekliyor' : 'Bekliyor',
      detail: activeVerify ? 'Son çalışma özeti ve kontrol noktaları hazırlanıyor.' : verifyConversation ? `${formatChatTime(verifyConversation.at)} tarihinde doğrulama özeti var.` : runConversation ? 'Çalışma çıktısını kabul sinyalleriyle karşılaştır.' : 'Çalışma tamamlandığında burada izlenir.',
      tone: activeVerify ? 'active' : verifyConversation ? 'done' : runConversation ? 'ready' : 'idle',
      icon: LuFileText,
      action: () => setIsContextDrawerOpen(true),
      actionLabel: 'Özet',
      disabled: !showContextHistory
    },
    {
      key: 'complete',
      title: 'Tamamla',
      status: verifyConversation || runConversation ? 'Onay bekliyor' : 'Bekliyor',
      detail: 'Kabul kriterleri tuttuysa task statüsünü tamamlanan kolona taşı; değilse devam mesajı gönder.',
      tone: verifyConversation || runConversation ? 'ready' : 'idle',
      icon: LuCircleCheck,
      action: onNewConversation,
      actionLabel: 'Devam et',
      disabled: false
    }
  ] as const

  return (
    <>
      <div className={styles.chatBackdrop} onClick={onClose} />
      <section className={`${styles.modalShell} ${styles.chatPopupShell}`} role="dialog" aria-modal="true" aria-label="Codex chat" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
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
            <strong>{sidebarTitle}</strong>
            <span>{sidebarSubtitle}</span>
          </div>
          <button type="button" className={`${styles.chatNewConversationButton} ${isStartingNewChat ? styles.chatConversationActive : ''}`} onClick={onNewConversation}>
            <span className={styles.chatConversationLine}><span><LuPlus size={14} /> New follow-up</span><b className={styles.chatStatusBadge}>New</b></span>
            <small>Start a separate Follow-up thread</small>
          </button>
          {sidebarConversations.map((conversation) => (
            <div
              key={conversation.id}
              role="button"
              tabIndex={0}
              className={`${styles.chatConversationButton} ${selectedConversationId === conversation.id ? styles.chatConversationActive : ''}`}
              onClick={() => onConversationSelect(conversation.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onConversationSelect(conversation.id)
              }}
            >
              <span className={styles.chatConversationLine}>
                <span className={styles.chatConversationTitle}>
                  <b className={`${styles.chatConversationSourceBadge} ${conversationSourceClass(conversation)}`}>{conversation.title}</b>
                  {conversation.model ? <em>{conversation.model}</em> : null}
                </span>
                <b className={`${styles.chatStatusBadge} ${conversationStatusClass(conversation)}`}>
                  {conversationStatusLabel(conversation)}
                </b>
                {runningConversationIds.has(conversation.id) ? (
                  <button
                    type="button"
                    className={styles.chatSidebarStopButton}
                    aria-label={`Stop ${conversation.title}`}
                    title="Stop"
                    disabled={stoppingConversationIds.has(conversation.id)}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      onStopChat(conversation.id)
                    }}
                  >
                    {stoppingConversationIds.has(conversation.id) ? <em className={styles.chatSidebarLoader} aria-label="Stopping"><i /><i /><i /></em> : <LuCircleStop size={13} />}
                  </button>
                ) : null}
              </span>
              <small>{conversation.count} messages · {formatChatTime(conversation.at)}</small>
            </div>
          ))}
          {conversations.length > sidebarConversations.length ? <p>{conversations.length - sidebarConversations.length} older conversations hidden for performance.</p> : null}
          {conversations.length === 0 ? <p>No Codex conversations yet.</p> : null}
          {chatHistoryCount > 0 ? <div className={styles.chatHistoryNote}><span>Task history</span><b>{chatHistoryCount}</b></div> : null}
        </aside>
        <main className={styles.chatMain}>
          <header className={styles.chatTopbar}>
            <div className={styles.chatTopbarTitle}>
              <span className={styles.chatTopbarTitleRow}>
                <h2>{title}</h2>
                {selectedChatStatusMeta ? <b className={`${styles.chatStatusBadge} ${styles[`chatStatus_${selectedChatStatusMeta.tone}`] ?? ''}`}>{selectedChatStatusMeta.label}</b> : null}
              </span>
              <p title={subtitle}>{subtitle}</p>
            </div>
            <div className={`${styles.chatTopbarActions} ${popupStyles.chatTopbarActions}`}>
              {headerActions.map((action) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.key}
                    type="button"
                    onClick={action.onSelect}
                    disabled={action.disabled}
                    className={[
                      styles.chatLabeledAction,
                      action.active ? styles.chatActionActive : '',
                      action.danger ? styles.chatStopAction : '',
                      mobilePrimaryActionKeys.has(action.key) ? popupStyles.mobilePrimaryAction : popupStyles.mobileOverflowAction
                    ].filter(Boolean).join(' ')}
                    aria-label={action.ariaLabel}
                    title={action.title}
                  >
                    <Icon size={16} />
                    <span>{action.label}</span>
                  </button>
                )
              })}
              <ChatHeaderOverflowMenu actions={mobileOverflowActions} />
              <button type="button" onClick={onClose} aria-label="Close chat" title="Close chat" className={styles.chatIconAction}><LuX size={16} /></button>
            </div>
          </header>
          {showRunActions ? (
            <section className={styles.chatPipelineStrip} aria-label="Task yaşam döngüsü">
              {pipelineRows.map((item) => {
                const Icon = item.icon
                return (
                  <article key={item.key} className={`${styles.chatPipelineStep} ${styles[`chatPipelineStep_${item.tone}`] ?? ''}`}>
                    <span className={styles.chatPipelineIcon}><Icon size={14} /></span>
                    <div className={styles.chatPipelineCopy}>
                      <strong>{item.title}</strong>
                      <span>{item.status}</span>
                      <p>{item.detail}</p>
                    </div>
                    <button type="button" onClick={item.action} disabled={item.disabled}>{item.actionLabel}</button>
                  </article>
                )
              })}
            </section>
          ) : null}
          <div className={styles.chatWorkspace}>
            <div className={styles.chatTranscript} ref={chatFeedRef} onScroll={onChatScroll}>
              {visibleMessages.length > 0 ? (
                <div className={styles.chatMessageList}>
                  {transcriptItems.map((item) => (
                    item.kind === 'work-block'
                      ? <CodexWorkBlock key={item.id} block={item.block} />
                      : <GatewayChatMessageItem key={item.id} message={item.message} />
                  ))}
                </div>
              ) : (
                <div className={styles.chatEmptyState}>
                  {localStatusMessage ? (
                    <div className={styles.chatMessageList}><GatewayChatMessageItem message={localStatusMessage} /></div>
                  ) : (
                    <>
                      <LuMessageSquare size={28} />
                      <h3>Task akışını başlat</h3>
                      <p>Planla, çalıştır, doğrula veya devam mesajı gönder. Ajan aksiyonları bu task içinde geçmiş olarak görünür.</p>
                      <div>
                        {showRunActions ? <button type="button" onClick={onPlan} disabled={gatewayPlanLaunching}><LuSparkles size={15} /> {gatewayPlanLaunching ? 'Planlanıyor' : 'Planla'}</button> : null}
                        {showRunActions ? <button type="button" onClick={onRun} disabled={gatewayRunLaunching}><LuPlay size={15} /> {gatewayRunLaunching ? 'Çalışıyor' : 'Çalıştır'}</button> : null}
                        {(!chatGateway || (!chatPlanModel && !chatModel) || (!chatRunModel && !chatModel)) ? <button type="button" onClick={onSettingsToggle}><LuSettings2 size={15} /> Configure</button> : null}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {chatSettingsOpen ? (
              <>
                <button type="button" className={styles.chatSettingsScrim} aria-label="Close model settings" onMouseDown={onSettingsClose} />
                <aside className={styles.chatSettingsPanel}>
                  <div className={styles.chatSettingsHeader}>
                    <div><span>Otomatik ilerletme</span><h3>Model ayarları</h3></div>
                    <button type="button" onClick={onSettingsClose} aria-label="Close run settings" title="Close"><LuX size={15} /></button>
                  </div>
                  <div className={styles.chatSettingsCard}>
                    <div className={styles.chatSettingTitle}><span><LuSignal size={14} /></span><div><b>Gateway</b><small>{chatGateway?.name ?? 'Select a gateway'}</small></div></div>
                    <AppSelect mode="single" value={chatGatewayOption} options={chatGatewayOptions} onChange={(option) => { if (!Array.isArray(option)) onGatewayChange(option) }} placeholder="Select gateway" />
                  </div>
                  <div className={styles.chatSettingsCard}>
                    <div className={styles.chatSettingTitle}><span><LuBot size={14} /></span><div><b>Plan model</b><small>{chatPlanModel || chatModel || 'Select a plan model'}</small></div></div>
                    <AppSelect mode="single" value={chatPlanModelOption} options={chatModelOptions} onChange={(option) => { if (!Array.isArray(option)) onPlanModelChange(option) }} placeholder="Select plan model" isDisabled={!chatGatewayOption} />
                  </div>
                  {chatPlanReasoningOptions.length > 0 ? (
                    <div className={styles.chatSettingsCard}>
                      <div className={styles.chatSettingTitle}><span><LuSparkles size={14} /></span><div><b>Plan reasoning</b><small>{chatPlanReasoningEffort || 'Select reasoning'}</small></div></div>
                      <AppSelect mode="single" value={chatPlanReasoningOptions.find((option) => option.value === chatPlanReasoningEffort) ?? null} options={chatPlanReasoningOptions} onChange={(option) => { if (!Array.isArray(option)) onPlanReasoningChange(option) }} placeholder="Select plan reasoning" />
                    </div>
                  ) : null}
                  <div className={styles.chatSettingsCard}>
                    <div className={styles.chatSettingTitle}><span><LuBot size={14} /></span><div><b>Run / chat model</b><small>{chatRunModel || chatModel || 'Select a run model'}</small></div></div>
                    <AppSelect mode="single" value={chatRunModelOption ?? chatModelOption} options={chatModelOptions} onChange={(option) => { if (!Array.isArray(option)) onRunModelChange(option) }} placeholder="Select run model" isDisabled={!chatGatewayOption} />
                  </div>
                  {chatRunReasoningOptions.length > 0 ? (
                    <div className={styles.chatSettingsCard}>
                      <div className={styles.chatSettingTitle}><span><LuSparkles size={14} /></span><div><b>Run reasoning</b><small>{chatRunReasoningEffort || 'Select reasoning'}</small></div></div>
                      <AppSelect mode="single" value={chatRunReasoningOptions.find((option) => option.value === chatRunReasoningEffort) ?? null} options={chatRunReasoningOptions} onChange={(option) => { if (!Array.isArray(option)) onRunReasoningChange(option) }} placeholder="Select run reasoning" />
                    </div>
                  ) : null}
                  <div className={styles.chatSettingsMetaGrid}>
                    <div className={styles.chatSettingReadout}><span>Mode</span><b>{chatGatewayConfig.executionMode === 'exec' ? 'Exec' : 'Terminal'}</b></div>
                    <div className={styles.chatSettingReadout}><span>Workspace</span><b>{chatRuntimeWorkspace?.name ?? runtimeWorkspaceId ?? 'Not configured'}</b></div>
                  </div>
                  <label className={styles.chatSettingsToggle}>
                    <input type="checkbox" checked={chatIncludeContext} onChange={(event) => onIncludeContextChange(event.target.checked)} />
                    <span><b>Task context</b><small>Include current task details in the next run.</small></span>
                  </label>
                </aside>
              </>
            ) : null}
            {isContextDrawerOpen ? (
              <aside className={styles.chatContextDrawer} aria-label="Context history">
                <header className={styles.chatContextDrawerHeader}>
                  <div><span>Generated context</span><h3>History</h3></div>
                  <button type="button" onClick={() => setIsContextDrawerOpen(false)} aria-label="Close context history"><LuX size={15} /></button>
                </header>
                {contextEntries.length > 0 ? (
                  <div className={styles.chatContextDrawerBody}>
                    <div className={styles.chatContextTimeline}>
                      {contextEntries.map((entry) => (
                        <button key={entry.id} type="button" className={selectedContextEntry?.id === entry.id ? styles.chatContextEntryActive : styles.chatContextEntry} onClick={() => setSelectedContextEntryId(entry.id)}>
                          <span className={styles.chatContextEntryIcon}>{entry.source === 'gateway-plan' ? <LuFileText size={14} /> : entry.source === 'gateway-run' ? <LuPlay size={14} /> : <LuMessageSquare size={14} />}</span>
                          <span className={styles.chatContextEntryText}>
                            <b>{entry.title}</b>
                            <small>{formatChatTime(entry.at)} · {entry.status}</small>
                            <em>{entry.preview}</em>
                          </span>
                        </button>
                      ))}
                    </div>
                    <section className={styles.chatContextInspector}>
                      {selectedContextEntry ? (
                        <>
                          <div className={styles.chatContextInspectorMeta}>
                            {selectedContextEntry.metadata.map((item) => <span key={item.key}><b>{item.key}</b>{item.value}</span>)}
                          </div>
                          <pre>{selectedContextEntry.body}</pre>
                        </>
                      ) : null}
                    </section>
                  </div>
                ) : (
                  <p className={styles.chatContextEmpty}>Context will appear after Codex produces chat activity.</p>
                )}
              </aside>
            ) : null}
          </div>
          <footer className={styles.chatComposer}>
            {attachments.length > 0 ? (
              <div className={styles.chatAttachmentChips}>
                {attachments.map((attachment) => (
                  <span key={attachment.id}>
                    <LuPaperclip size={13} />
                    <span className={styles.chatAttachmentName}>{attachment.name}</span>
                    <button type="button" onClick={() => onAttachmentRemove(attachment.id)} aria-label={`Remove ${attachment.name}`}><LuX size={12} /></button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className={styles.chatComposerFrame}>
              {slashMenuOpen && slashCommands.length > 0 ? (
                <div className={styles.slashCommandMenu} role="listbox" aria-label="Slash commands">
                  {slashCommands.map((command, index) => (
                    <button key={command.id} type="button" className={index === slashCommandIndex ? styles.slashCommandActive : ''} onMouseDown={(event) => { event.preventDefault(); onSlashCommandApply(command) }} role="option" aria-selected={index === slashCommandIndex}>
                      <span>{command.label}</span>
                      <small>{command.hint}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {isSteerMode ? (
                <div className={styles.chatSteerModeRow}>
                  <span>Steer</span>
                  <small>Send steering instructions to the selected conversation</small>
                </div>
              ) : null}
              <div className={styles.chatComposerBox}>
                <textarea
                  ref={draftTextareaRef}
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value, event.currentTarget)}
                  onFocus={() => onComposerFocusChange(true)}
                  onBlur={() => onComposerFocusChange(false)}
                  placeholder="Message Codex or type / for commands..."
                  onKeyDown={(event) => {
                    if (slashMenuOpen && slashCommands.length > 0) {
                      if (event.key === 'ArrowDown') { event.preventDefault(); onSlashCommandIndexChange((value) => (value + 1) % slashCommands.length); return }
                      if (event.key === 'ArrowUp') { event.preventDefault(); onSlashCommandIndexChange((value) => (value - 1 + slashCommands.length) % slashCommands.length); return }
                      if (event.key === 'Escape') { event.preventDefault(); onClearSlashDraft(); return }
                      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); onSlashCommandApply(slashCommands[slashCommandIndex] ?? slashCommands[0]); return }
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      onSend()
                    }
                  }}
                />
                <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => onFilesSelected(event.currentTarget.files)} />
                <button type="button" className={[styles.chatSendButton, selectedChatCanStop ? styles.chatStopButton : ''].filter(Boolean).join(' ')} onClick={() => selectedChatCanStop ? onStopChat() : onSend()} disabled={chatSending || isChatStopping || (!selectedChatCanStop && (!canSendChat || selectedChatIsRunning))} aria-label={selectedChatCanStop ? 'Stop Codex chat' : 'Send message'} title={selectedChatCanStop ? 'Stop' : 'Send'}>
                  {selectedChatCanStop ? <LuCircleStop size={17} /> : chatSending ? <span className={styles.thinkingDots}><i /><i /><i /></span> : <LuSend size={16} />}
                </button>
                <div className={styles.chatComposerFooter}>
                  <button type="button" className={styles.chatAttachButton} onClick={onAttachFilesClick} aria-label="Attach files"><LuPaperclip size={16} /></button>
                  <button type="button" className={styles.chatConfigurationButton} onClick={() => setIsConfigurationDetailsOpen(true)} aria-haspopup="dialog">
                    <LuSettings2 size={13} />
                    <span>Configuration details</span>
                  </button>
                </div>
              </div>
            </div>
            {isConfigurationDetailsOpen ? (
              <div className={styles.chatConfigModalOverlay} onMouseDown={() => setIsConfigurationDetailsOpen(false)}>
                <div className={styles.chatConfigModal} role="dialog" aria-modal="true" aria-label="Configuration details" onMouseDown={(event) => event.stopPropagation()}>
                  <header className={styles.chatConfigModalHeader}>
                    <span><LuSettings2 size={16} /></span>
                    <div>
                      <h3>Configuration details</h3>
                      <p>Read-only Codex runtime, model, agent, skills, and context settings.</p>
                    </div>
                    <button type="button" onClick={() => setIsConfigurationDetailsOpen(false)} aria-label="Close configuration details"><LuX size={16} /></button>
                  </header>
                  <div className={styles.chatConfigModalBody}>
                    {configurationGroups.map((group) => (
                      <section key={group.title} className={styles.chatConfigModalSection}>
                        <h4>{group.title}</h4>
                        <div className={styles.chatConfigDetailList}>
                          {group.items.map((item) => (
                            <div key={item.label} className={`${styles.chatConfigDetailRow} ${item.warning ? styles.chatConfigDetailWarning : ''}`}>
                              <b>{item.label}</b>
                              <span>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </footer>
        </main>
      </section>
    </>
  )
}
