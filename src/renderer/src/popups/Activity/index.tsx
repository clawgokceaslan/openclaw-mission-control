import type { DragEvent, RefObject } from 'react'
import { LuBot, LuCircleStop, LuCloudUpload, LuMessageSquare, LuPaperclip, LuPlay, LuPlus, LuSend, LuSettings2, LuSignal, LuSparkles, LuX } from 'react-icons/lu'
import { formatUsageSummary } from '@shared/utils/codex-events'
import type { Agent, Gateway, Skill, TaskEntity, Workspace } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { CodexChatMessageItem } from '@renderer/components/projects/detail/chat/CodexChatMessageItem'
import { formatChatTime } from '@renderer/screens/projects/detail/chat/chatUtils'
import type { ChatAttachmentDraft, ChatConversationSummary, SlashCommand, TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ActivityPopupProps {
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

export function ActivityPopup({
  task,
  chatDragDepth,
  conversations,
  sidebarConversations,
  selectedConversationId,
  isStartingNewChat,
  runningConversationIds,
  chatHistoryCount,
  chatSettingsOpen,
  selectedChatCanStop,
  chatStopping,
  codexPlanLaunching,
  codexRunLaunching,
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
  chatStopping: isChatStopping,
  canSendChat,
  selectedChatIsRunning,
  selectedChatSummary,
  selectedChatUsage,
  selectedTaskAgent,
  taskContextSkills,
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
  onLoadEarlier,
  onActivityScroll,
  onGatewayChange,
  onModelChange,
  onIncludeContextChange,
  onAttachmentRemove,
  onAttachFilesClick,
  onFilesSelected,
  onDraftChange,
  onComposerFocusChange,
  onSlashCommandApply,
  onSlashCommandIndexChange,
  onClearSlashDraft,
  onSend
}: ActivityPopupProps) {
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
            <strong>Chat</strong>
            <span>{task?.title ?? 'Task'}</span>
          </div>
          <button type="button" className={`${styles.chatNewConversationButton} ${isStartingNewChat ? styles.chatConversationActive : ''}`} onClick={onNewConversation}>
            <span><span><LuPlus size={14} /> New follow-up</span><b className={styles.chatStatusBadge}>New</b></span>
            <small>Start a separate Follow-up thread</small>
          </button>
          {sidebarConversations.map((conversation) => (
            <button type="button" key={conversation.id} className={selectedConversationId === conversation.id ? styles.chatConversationActive : ''} onClick={() => onConversationSelect(conversation.id)}>
              <span>
                {conversation.title}
                <b className={`${styles.chatStatusBadge} ${styles[`chatStatus_${conversation.status}`] ?? ''}`}>
                  {runningConversationIds.has(conversation.id) ? <em className={styles.chatSidebarLoader} aria-label="Codex chat is running"><i /><i /><i /></em> : conversation.status}
                </b>
              </span>
              <small>{conversation.count} messages · {formatChatTime(conversation.at)}</small>
              {conversation.model ? <small>{conversation.model}</small> : null}
            </button>
          ))}
          {conversations.length > sidebarConversations.length ? <p>{conversations.length - sidebarConversations.length} older conversations hidden for performance.</p> : null}
          {conversations.length === 0 ? <p>No Codex conversations yet.</p> : null}
          {chatHistoryCount > 0 ? <div className={styles.chatHistoryNote}><span>Task history</span><b>{chatHistoryCount}</b></div> : null}
        </aside>
        <main className={styles.chatMain}>
          <header className={styles.chatTopbar}>
            <div className={styles.chatTopbarTitle}><h2>Chat</h2><p title={task?.title ?? 'Task'}>{task?.title ?? 'Task'}</p></div>
            <div className={styles.chatTopbarActions}>
              <button type="button" onClick={onSettingsToggle} className={`${styles.chatIconAction} ${chatSettingsOpen ? styles.chatActionActive : ''}`} aria-label="Chat settings" title="Chat settings"><LuSettings2 size={16} /></button>
              {selectedChatCanStop ? <button type="button" onClick={onStopChat} disabled={chatStopping} className={`${styles.chatIconAction} ${styles.chatStopAction}`} aria-label="Stop Codex chat" title="Stop Codex chat"><LuCircleStop size={16} /></button> : null}
              <button type="button" onClick={onPlan} disabled={codexPlanLaunching} className={styles.chatIconAction} aria-label={codexPlanLaunching ? 'Planning with Codex' : 'Plan with Codex'} title={codexPlanLaunching ? 'Planning with Codex' : 'Plan with Codex'}><LuSparkles size={16} /></button>
              <button type="button" onClick={onRun} disabled={codexRunLaunching} className={styles.chatIconAction} aria-label={codexRunLaunching ? 'Running with Codex' : 'Run with Codex'} title={codexRunLaunching ? 'Running with Codex' : 'Run with Codex'}><LuPlay size={16} /></button>
              <button type="button" onClick={onClose} aria-label="Close chat" title="Close chat" className={styles.chatIconAction}><LuX size={16} /></button>
            </div>
          </header>
          <div className={styles.chatWorkspace}>
            <div className={styles.chatTranscript} ref={activityFeedRef} onScroll={onActivityScroll}>
              {visibleMessages.length > 0 ? (
                <div className={styles.chatMessageList}>
                  {hiddenMessageCount > 0 ? <button type="button" className={styles.chatLoadEarlierButton} onClick={onLoadEarlier}>Load earlier messages</button> : null}
                  {renderedMessages.filter((message) => !(message.role === 'system' && /^Started Codex/i.test(message.body))).map((message) => <CodexChatMessageItem key={message.id} message={message} />)}
                  {localStatusMessage ? <CodexChatMessageItem message={localStatusMessage} /> : null}
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
                        <button type="button" onClick={onPlan} disabled={codexPlanLaunching}><LuSparkles size={15} /> Plan</button>
                        <button type="button" onClick={onRun} disabled={codexRunLaunching}><LuPlay size={15} /> Run</button>
                        {(!chatGateway || !chatModel) ? <button type="button" onClick={onSettingsToggle}><LuSettings2 size={15} /> Configure</button> : null}
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
                  <div className={styles.chatSettingTitle}><span><LuBot size={14} /></span><div><b>Model</b><small>{chatModel || 'Select a model'}</small></div></div>
                  <AppSelect mode="single" value={chatModelOption} options={chatModelOptions} onChange={(option) => { if (!Array.isArray(option)) onModelChange(option) }} placeholder="Select model" isDisabled={!chatGatewayOption} />
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
                <button type="button" className={styles.chatAttachButton} onClick={onAttachFilesClick} aria-label="Attach files"><LuPaperclip size={16} /></button>
                <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => onFilesSelected(event.currentTarget.files)} />
                <button type="button" className={selectedChatCanStop ? styles.chatStopButton : ''} onClick={() => selectedChatCanStop ? onStopChat() : onSend()} disabled={chatSending || isChatStopping || (!selectedChatCanStop && (!canSendChat || selectedChatIsRunning))} aria-label={selectedChatCanStop ? 'Stop Codex chat' : 'Send message'} title={selectedChatCanStop ? 'Stop' : 'Send'}>
                  {selectedChatCanStop ? <LuCircleStop size={17} /> : chatSending ? <span className={styles.thinkingDots}><i /><i /><i /></span> : <LuSend size={16} />}
                </button>
              </div>
            </div>
            <div className={styles.chatComposerRail}>
              <div className={styles.chatPillRow}>
                <span className={!chatGateway ? styles.chatPillWarning : ''}><small>Gateway</small><b title={chatGateway?.name ?? 'Gateway required'}>{chatGateway?.name ?? 'Gateway required'}</b></span>
                <span className={!chatModel ? styles.chatPillWarning : ''}><small>Model</small><b title={chatModel || 'Model required'}>{chatModel || 'Model required'}</b></span>
                <span><small>Mode</small><b>{chatGatewayConfig.executionMode === 'exec' ? 'Exec' : 'Terminal'}</b></span>
                <span><small>Workspace</small><b title={chatRuntimeWorkspace?.name ?? runtimeWorkspaceId ?? 'Workspace required'}>{chatRuntimeWorkspace?.name ?? runtimeWorkspaceId ?? 'Workspace required'}</b></span>
                <span><small>Session</small><b>{selectedChatSummary?.status ?? (visibleMessages.length ? 'mixed' : 'ready')}</b></span>
                <span><small>Agent</small><b>{selectedTaskAgent?.name ?? 'Unassigned'}</b></span>
                <span><small>Skills</small><b>{taskContextSkills.length ? taskContextSkills.slice(0, 3).map((skill) => skill.name).join(', ') : 'None'}</b></span>
                {selectedChatUsage ? <span><small>Usage</small><b>{formatUsageSummary(selectedChatUsage)}</b></span> : null}
              </div>
            </div>
          </footer>
        </main>
      </section>
    </>
  )
}
