import { useEffect, useMemo, useState, type DragEvent, type RefObject } from 'react'
import { LuBot, LuCircleStop, LuCloudUpload, LuMessageSquare, LuPaperclip, LuPlay, LuPlus, LuSend, LuSettings2, LuSignal, LuSparkles, LuX } from 'react-icons/lu'
import { formatUsageSummary } from '@shared/utils/codex-events'
import type { Agent, Gateway, Skill, TaskEntity, Workspace } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { CodexChatMessageItem, CodexWorkBlock } from '@renderer/components/projects/detail/chat/CodexChatMessageItem'
import { formatChatTime, groupCodexTranscriptMessages } from '@renderer/screens/projects/detail/chat/chatUtils'
import type { ChatAttachmentDraft, ChatConversationSummary, PlannerClarificationMode, SlashCommand, TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ActivityPopupLegacyProps {
  task: TaskEntity | null
  chatDragDepth: number
  conversations: ChatConversationSummary[]
  sidebarConversations: ChatConversationSummary[]
  selectedConversationId: string
  isStartingNewChat: boolean
  runningConversationIds: Set<string>
  stoppingConversationIds: Set<string>
  chatHistoryCount: number
  chatSettingsOpen: boolean
  selectedChatCanStop: boolean
  chatStopping: boolean
  codexPlanLaunching: boolean
  codexRunLaunching: boolean
  planChoiceOpen: boolean
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
  chatPlanModel: string
  chatPlanModelOption: AppSelectOption | null
  chatRunModel: string
  chatRunModelOption: AppSelectOption | null
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
  onActivityScroll: () => void
  onGatewayChange: (option: AppSelectOption | null) => void
  onModelChange: (option: AppSelectOption | null) => void
  onPlanModelChange: (option: AppSelectOption | null) => void
  onRunModelChange: (option: AppSelectOption | null) => void
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

type ActivityPopupStateProps = Omit<
  ActivityPopupLegacyProps,
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
  | 'onActivityScroll'
  | 'onGatewayChange'
  | 'onModelChange'
  | 'onPlanModelChange'
  | 'onRunModelChange'
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

type ActivityPopupHandlerProps = Pick<
  ActivityPopupLegacyProps,
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
  | 'onActivityScroll'
  | 'onGatewayChange'
  | 'onModelChange'
  | 'onPlanModelChange'
  | 'onRunModelChange'
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

interface ActivityPopupProps extends Partial<ActivityPopupStateProps>, Partial<ActivityPopupHandlerProps> {
  chatState?: Partial<ActivityPopupStateProps>
  chatHandlers?: Partial<ActivityPopupHandlerProps>
  chatOptions?: {
    title?: string
    subtitle?: string
    sidebarTitle?: string
    sidebarSubtitle?: string
    showRunActions?: boolean
  }
}

export function ActivityPopup({
  chatState,
  chatHandlers,
  chatOptions,
  ...legacyState
}: ActivityPopupProps) {
  const noOp = () => {}
  const state = (chatState ?? legacyState) as ActivityPopupStateProps | null
  const [isConfigurationDetailsOpen, setIsConfigurationDetailsOpen] = useState(false)
  const isSteerMode = state?.chatMode === 'steer'

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
    state?.chatRuntimeWorkspace?.name,
    state?.runtimeWorkspaceId,
    state?.selectedChatSummary?.status,
    state?.selectedTaskAgent?.name,
    state?.selectedChatUsage,
    state?.taskContextSkills,
    state?.visibleMessages.length,
    state?.chatRunModel
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
      { title: 'Models', items: pick(['Plan model', 'Run model']) },
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
    onClose: chatHandlers?.onClose ?? legacyState.onClose ?? noOp,
    onDragEnter: chatHandlers?.onDragEnter ?? legacyState.onDragEnter ?? (() => {}),
    onDragOver: chatHandlers?.onDragOver ?? legacyState.onDragOver ?? (() => {}),
    onDragLeave: chatHandlers?.onDragLeave ?? legacyState.onDragLeave ?? (() => {}),
    onDrop: chatHandlers?.onDrop ?? legacyState.onDrop ?? (() => {}),
    onNewConversation: chatHandlers?.onNewConversation ?? legacyState.onNewConversation ?? noOp,
    onConversationSelect: chatHandlers?.onConversationSelect ?? legacyState.onConversationSelect ?? noOp,
    onSettingsToggle: chatHandlers?.onSettingsToggle ?? legacyState.onSettingsToggle ?? noOp,
    onSettingsClose: chatHandlers?.onSettingsClose ?? legacyState.onSettingsClose ?? noOp,
    onStopChat: chatHandlers?.onStopChat ?? legacyState.onStopChat ?? noOp,
    onPlan: chatHandlers?.onPlan ?? legacyState.onPlan ?? noOp,
    onPlanChoiceClose: chatHandlers?.onPlanChoiceClose ?? legacyState.onPlanChoiceClose ?? noOp,
    onPlanChoiceSelect: chatHandlers?.onPlanChoiceSelect ?? legacyState.onPlanChoiceSelect ?? noOp,
    onRun: chatHandlers?.onRun ?? legacyState.onRun ?? noOp,
    onLoadEarlier: chatHandlers?.onLoadEarlier ?? legacyState.onLoadEarlier ?? noOp,
    onActivityScroll: chatHandlers?.onActivityScroll ?? legacyState.onActivityScroll ?? noOp,
    onGatewayChange: chatHandlers?.onGatewayChange ?? legacyState.onGatewayChange ?? (() => {}),
    onModelChange: chatHandlers?.onModelChange ?? legacyState.onModelChange ?? (() => {}),
    onPlanModelChange: chatHandlers?.onPlanModelChange ?? legacyState.onPlanModelChange ?? (() => {}),
    onRunModelChange: chatHandlers?.onRunModelChange ?? legacyState.onRunModelChange ?? (() => {}),
    onIncludeContextChange: chatHandlers?.onIncludeContextChange ?? legacyState.onIncludeContextChange ?? noOp,
    onAttachmentRemove: chatHandlers?.onAttachmentRemove ?? legacyState.onAttachmentRemove ?? noOp,
    onAttachFilesClick: chatHandlers?.onAttachFilesClick ?? legacyState.onAttachFilesClick ?? noOp,
    onFilesSelected: chatHandlers?.onFilesSelected ?? legacyState.onFilesSelected ?? ((_) => {}),
    onDraftChange: chatHandlers?.onDraftChange ?? legacyState.onDraftChange ?? (() => {}),
    onComposerFocusChange: chatHandlers?.onComposerFocusChange ?? legacyState.onComposerFocusChange ?? noOp,
    onSlashCommandApply: chatHandlers?.onSlashCommandApply ?? legacyState.onSlashCommandApply ?? noOp,
    onSlashCommandIndexChange: chatHandlers?.onSlashCommandIndexChange ?? legacyState.onSlashCommandIndexChange ?? (() => {}),
    onClearSlashDraft: chatHandlers?.onClearSlashDraft ?? legacyState.onClearSlashDraft ?? noOp,
    onSend: chatHandlers?.onSend ?? legacyState.onSend ?? noOp,
    onPlannerQuestionAnswer: chatHandlers?.onPlannerQuestionAnswer ?? legacyState.onPlannerQuestionAnswer ?? noOp
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
    chatSettingsOpen,
    selectedChatCanStop,
    chatStopping,
    codexPlanLaunching,
    codexRunLaunching,
    visibleMessages,
    renderedMessages,
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
    onActivityScroll,
    onGatewayChange,
    onModelChange,
    onPlanModelChange,
    onRunModelChange,
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
  const conversationStatusLabel = (conversation: ChatConversationSummary) => (
    runningConversationIds.has(conversation.id)
      ? <em className={styles.chatSidebarLoader} aria-label="Codex chat is running"><i /><i /><i /></em>
      : conversation.status
  )
  const conversationStatusClass = (conversation: ChatConversationSummary) => (
    styles[`chatStatus_${runningConversationIds.has(conversation.id) ? 'running' : conversation.status}`] ?? ''
  )
  const conversationSourceClass = (conversation: ChatConversationSummary) => {
    if (conversation.source === 'codex-plan') return styles.chatSource_plan
    if (conversation.source === 'codex-run') return styles.chatSource_run
    return styles.chatSource_followUp
  }

  return (
    <>
      <div className={styles.activityBackdrop} onClick={onClose} />
      <section className={`${styles.modalShell} ${styles.activityModalShell}`} role="dialog" aria-modal="true" aria-label="Codex chat" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
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
            <div className={styles.chatTopbarTitle}><h2>{title}</h2><p title={subtitle}>{subtitle}</p></div>
            <div className={styles.chatTopbarActions}>
              <button type="button" onClick={onSettingsToggle} className={`${styles.chatIconAction} ${chatSettingsOpen ? styles.chatActionActive : ''}`} aria-label="Chat settings" title="Chat settings"><LuSettings2 size={16} /></button>
              {selectedChatCanStop ? <button type="button" onClick={() => onStopChat()} disabled={chatStopping} className={`${styles.chatIconAction} ${styles.chatStopAction}`} aria-label="Stop Codex chat" title="Stop Codex chat"><LuCircleStop size={16} /></button> : null}
              {showRunActions ? <button type="button" onClick={onPlan} disabled={codexPlanLaunching} className={styles.chatIconAction} aria-label={codexPlanLaunching ? 'Planning with Codex' : 'Plan with Codex'} title={codexPlanLaunching ? 'Planning with Codex' : 'Plan with Codex'}><LuSparkles size={16} /></button> : null}
              {showRunActions ? <button type="button" onClick={onRun} disabled={codexRunLaunching} className={styles.chatIconAction} aria-label={codexRunLaunching ? 'Running with Codex' : 'Run with Codex'} title={codexRunLaunching ? 'Running with Codex' : 'Run with Codex'}><LuPlay size={16} /></button> : null}
              <button type="button" onClick={onClose} aria-label="Close chat" title="Close chat" className={styles.chatIconAction}><LuX size={16} /></button>
            </div>
          </header>
          <div className={styles.chatWorkspace}>
            <div className={styles.chatTranscript} ref={activityFeedRef} onScroll={onActivityScroll}>
              {visibleMessages.length > 0 ? (
                <div className={styles.chatMessageList}>
                  {transcriptItems.map((item) => (
                    item.kind === 'work-block'
                      ? <CodexWorkBlock key={item.id} block={item.block} />
                      : <CodexChatMessageItem key={item.id} message={item.message} />
                  ))}
                </div>
              ) : (
                <div className={styles.chatEmptyState}>
                  {localStatusMessage ? (
                    <div className={styles.chatMessageList}><CodexChatMessageItem message={localStatusMessage} /></div>
                  ) : (
                    <>
                      <LuMessageSquare size={28} />
                      <h3>Start a Codex chat for this task</h3>
                      <p>Use Plan, Run, or send a follow-up message. Codex messages will appear here as a transcript.</p>
                      <div>
                        {showRunActions ? <button type="button" onClick={onPlan} disabled={codexPlanLaunching}><LuSparkles size={15} /> Plan</button> : null}
                        {showRunActions ? <button type="button" onClick={onRun} disabled={codexRunLaunching}><LuPlay size={15} /> Run</button> : null}
                        {(!chatGateway || (!chatPlanModel && !chatModel) || (!chatRunModel && !chatModel)) ? <button type="button" onClick={onSettingsToggle}><LuSettings2 size={15} /> Configure</button> : null}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {chatSettingsOpen ? (
              <aside className={styles.chatSettingsPanel}>
                <div className={styles.chatSettingsHeader}>
                  <div><span>Codex</span><h3>Run settings</h3></div>
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
                <div className={styles.chatSettingsCard}>
                  <div className={styles.chatSettingTitle}><span><LuBot size={14} /></span><div><b>Run / chat model</b><small>{chatRunModel || chatModel || 'Select a run model'}</small></div></div>
                  <AppSelect mode="single" value={chatRunModelOption ?? chatModelOption} options={chatModelOptions} onChange={(option) => { if (!Array.isArray(option)) onRunModelChange(option) }} placeholder="Select run model" isDisabled={!chatGatewayOption} />
                </div>
                <div className={styles.chatSettingsMetaGrid}>
                  <div className={styles.chatSettingReadout}><span>Mode</span><b>{chatGatewayConfig.executionMode === 'exec' ? 'Exec' : 'Terminal'}</b></div>
                  <div className={styles.chatSettingReadout}><span>Workspace</span><b>{chatRuntimeWorkspace?.name ?? runtimeWorkspaceId ?? 'Not configured'}</b></div>
                </div>
                <label className={styles.chatSettingsToggle}>
                  <input type="checkbox" checked={chatIncludeContext} onChange={(event) => onIncludeContextChange(event.target.checked)} />
                  <span><b>Task context</b><small>Include current task details in the next run.</small></span>
                </label>
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
                      if (event.key === 'Enter') { event.preventDefault(); onSlashCommandApply(slashCommands[slashCommandIndex] ?? slashCommands[0]); return }
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
