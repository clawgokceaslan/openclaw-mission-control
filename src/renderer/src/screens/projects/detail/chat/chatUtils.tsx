import { formatUsageSummary, parseCodexEvents, type CodexUsageSummary } from '@shared/utils/codex-events'
import type { TaskComment, TaskEntity } from '@shared/types/entities'
import type {
  ChatConversationSummary,
  ChatMessageRole,
  ChatMessageSource,
  ChatMessageStatus,
  GeneratedContextEntry,
  TaskActivityMessage,
  TaskHistoryItem,
  ThreadEntry
} from '../types'

export type CodexChangesSummary = {
  files: number
  blocks: number
  insertions: number
  deletions: number
  hasNoChanges: boolean
  unavailable: boolean
  canRenderCard: boolean
}

export type CodexWorkSummaryKind = 'explored' | 'ran' | 'changed' | 'log'

export type CodexWorkSummaryRow = {
  id: string
  kind: CodexWorkSummaryKind
  label: string
  messages: TaskActivityMessage[]
}

export type CodexWorkBlockEntry = {
  kind: 'text'
  id: string
  message: TaskActivityMessage
} | {
  kind: 'summary'
  id: string
  summary: CodexWorkSummaryRow
}

export type CodexWorkBlock = {
  id: string
  runId: string
  conversationId?: string
  source: ChatMessageSource
  messages: TaskActivityMessage[]
  entries: CodexWorkBlockEntry[]
  summaryRows: CodexWorkSummaryRow[]
  startedAt: number
  endedAt: number
  durationMs?: number
  isRunning: boolean
}

type CodexWorkTerminalState = {
  at: number
  status: 'completed' | 'failed'
  message: TaskActivityMessage
}

export type ChatTranscriptRenderItem = {
  kind: 'message'
  id: string
  message: TaskActivityMessage
} | {
  kind: 'work-block'
  id: string
  block: CodexWorkBlock
}

export type PlannerQuestionOption = {
  id: string
  label: string
  description?: string
}

export type PlannerQuestionItem = {
  id: string
  question: string
  why?: string
  options: PlannerQuestionOption[]
}

export type PlannerQuestionPrompt = {
  messageId: string
  conversationId: string
  summary: string
  questions: PlannerQuestionItem[]
}

export const CHAT_INITIAL_MESSAGE_LIMIT = 80
export const CHAT_MESSAGE_LOAD_STEP = 80
export const CHAT_TOP_LAZY_LOAD_THRESHOLD = 96
export const CHAT_COMPOSER_MIN_HEIGHT = 72
export const CHAT_COMPOSER_MAX_HEIGHT = 270
export const CHAT_RUNNING_ACTIVITY_STALE_MS = 15 * 60 * 1000
const CHAT_FOLLOW_UP_CONTEXT_MAX_LENGTH = 2_800
const CHAT_FOLLOW_UP_CONTEXT_RECENT_MESSAGES = 6
const CHAT_CONTEXT_ENTRY_PREVIEW_LENGTH = 220
const CHAT_CONTEXT_ENTRY_BODY_LENGTH = 2_400

export const CHAT_RUNNING_STATUS_LABELS = ['queued', 'running', 'completed', 'failed'] as const

const TIMESTAMP_MS_THRESHOLD = 1_000_000_000_000

const chatMessageSources = new Set<ChatMessageSource>(['codex-plan', 'codex-run', 'codex-chat'])
const chatMessageRoles = new Set<ChatMessageRole>(['user', 'assistant', 'tool', 'system', 'error', 'thinking'])
const chatMessageStatuses = new Set<ChatMessageStatus>(CHAT_RUNNING_STATUS_LABELS)

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function conversationIdOf(message: TaskActivityMessage): string | null {
  return message.conversationId || message.runId
}

export function isRunCompleteMessage(message: TaskActivityMessage): boolean {
  const runMetadata = asRecord(message.metadata)
  const runStatus = typeof runMetadata?.runStatus === 'string' ? runMetadata.runStatus : undefined
  const codexBlock = typeof runMetadata?.codexBlock === 'string' ? runMetadata.codexBlock : undefined
  if (codexBlock && ['command', 'log', 'changes'].includes(codexBlock)) return false
  return (
    message.metadata?.codexBlock === 'run-complete'
    || message.metadata?.stopped === true
    || message.role === 'error'
    || message.status === 'failed'
    || runStatus === 'completed'
    || runStatus === 'failed'
  )
}

export function messageTimeOf(message: TaskActivityMessage): number {
  return message.updatedAt ?? message.createdAt
}

export function isFreshRunningMessage(message: TaskActivityMessage, now: number): boolean {
  if (message.status !== 'running' && message.metadata?.runStatus !== 'running') return false
  return now - messageTimeOf(message) <= CHAT_RUNNING_ACTIVITY_STALE_MS
}

export function userMessageCount(messages: TaskActivityMessage[]): number {
  return messages.filter((message) => message.role === 'user').length
}

export function visibleChatMessagesForLimit<T>(messages: T[], limit: number): T[] {
  const normalizedLimit = Math.max(1, Math.floor(limit))
  return messages.length > normalizedLimit ? messages.slice(messages.length - normalizedLimit) : messages
}

export function shouldLoadEarlierMessages(scrollTop: number, hiddenMessageCount: number, threshold = CHAT_TOP_LAZY_LOAD_THRESHOLD): boolean {
  return hiddenMessageCount > 0 && scrollTop <= threshold
}

export function preserveScrollTopAfterPrepend(previousScrollTop: number, previousScrollHeight: number, nextScrollHeight: number): number {
  return Math.max(0, previousScrollTop + Math.max(0, nextScrollHeight - previousScrollHeight))
}

export function parseNumberMetadata(value: unknown): number {
  return Number.isFinite(asNumber(value)) ? asNumber(value) : 0
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function parseTimestampMs(value: unknown): number | undefined {
  const direct = asNumber(value)
  if (direct !== undefined) {
    return direct > TIMESTAMP_MS_THRESHOLD ? Math.trunc(direct) : Math.trunc(direct * 1_000)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function extractPatchFromMessageBody(body: string): string {
  const explicitDiff = body.match(/(`{3,})diff\n([\s\S]*?)\n\1/)
  if (explicitDiff?.[2]) return explicitDiff[2].trim()
  const anyFence = body.match(/(`{3,})[^\n]*\n([\s\S]*?)\n\1/)
  return anyFence?.[2]?.trim() ?? ''
}

export function hasNoChangesMessage(message: TaskActivityMessage): boolean {
  const metadata = asRecord(message.metadata)
  if (!metadata) return message.body.trim() === 'No workspace changes detected.'
  return metadata.changeHasNoChanges === true && metadata.unavailable !== true
}

export function codexChangesSummary(message: TaskActivityMessage): CodexChangesSummary {
  const metadata = message.metadata ?? {}
  const files = parseNumberMetadata(metadata.changeFiles)
  const blocks = parseNumberMetadata(metadata.changeBlocks)
  const insertions = parseNumberMetadata(metadata.changeInsertions)
  const deletions = parseNumberMetadata(metadata.changeDeletions)
  const unavailable = metadata.unavailable === true
  const hasNoChanges = hasNoChangesMessage(message)
  const patch = extractPatchFromMessageBody(message.body)
  const fallbackFiles = patch ? patch.split(/\n(?=diff --git\s)/).filter((chunk) => chunk.trim()).length : 0
  const fallbackBlocks = patch ? patch.split(/\n/).filter((line) => /^@@\s/.test(line)).length : 0
  const fallbackInsertions = patch ? patch.split(/\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length : 0
  const fallbackDeletions = patch ? patch.split(/\n/).filter((line) => line.startsWith('-') && !line.startsWith('---')).length : 0
  const nextFiles = Math.max(files, fallbackFiles)
  const nextBlocks = Math.max(blocks, fallbackBlocks)
  const nextInsertions = Math.max(insertions, fallbackInsertions)
  const nextDeletions = Math.max(deletions, fallbackDeletions)
  return {
    files: nextFiles,
    blocks: nextBlocks,
    insertions: nextInsertions,
    deletions: nextDeletions,
    hasNoChanges: hasNoChanges || (nextFiles === 0 && nextBlocks === 0 && !unavailable && metadata.changeHasNoChanges !== false),
    unavailable,
    canRenderCard: !unavailable && !hasNoChanges && (nextFiles > 0 || nextBlocks > 0)
  }
}

function normalizePlannerQuestionOptions(value: unknown): PlannerQuestionOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw, index): PlannerQuestionOption[] => {
    if (typeof raw === 'string') {
      const label = raw.trim()
      return label ? [{ id: `option-${index + 1}`, label }] : []
    }
    const record = asRecord(raw)
    if (!record) return []
    const label = typeof record.label === 'string'
      ? record.label.trim()
      : typeof record.title === 'string'
        ? record.title.trim()
        : typeof record.value === 'string'
          ? record.value.trim()
          : ''
    if (!label) return []
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `option-${index + 1}`
    const description = typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined
    return [{ id, label, description }]
  })
}

function normalizePlannerQuestions(value: unknown): PlannerQuestionItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw, index): PlannerQuestionItem[] => {
    const record = asRecord(raw)
    if (!record) return []
    const question = typeof record.question === 'string' ? record.question.trim() : ''
    if (!question) return []
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `question-${index + 1}`
    const why = typeof record.why === 'string' && record.why.trim() ? record.why.trim() : undefined
    return [{ id, question, why, options: normalizePlannerQuestionOptions(record.options) }]
  })
}

export function plannerQuestionPromptFromMessages(messages: TaskActivityMessage[]): PlannerQuestionPrompt | null {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt)
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const message = sorted[index]
    const metadata = asRecord(message.metadata)
    if (message.source !== 'codex-plan' || message.role !== 'assistant' || metadata?.codexBlock !== 'planner-question') continue
    const conversationId = conversationIdOf(message)
    if (!conversationId) continue
    const answered = sorted.some((candidate) => {
      if (candidate.createdAt <= message.createdAt) return false
      if (conversationIdOf(candidate) !== conversationId) return false
      return candidate.role === 'user' && asRecord(candidate.metadata)?.clarification === true
    })
    if (answered) return null
    const questions = normalizePlannerQuestions(metadata.questions)
    if (questions.length === 0) return null
    const summary = typeof metadata.summary === 'string' && metadata.summary.trim()
      ? metadata.summary.trim()
      : 'Planner needs clarification before updating this task.'
    return { messageId: message.id, conversationId, summary, questions }
  }
  return null
}

export function formatPlannerClarificationAnswer(input: {
  prompt: PlannerQuestionPrompt
  selectedOptionIds: Record<string, string>
  notes: Record<string, string>
}): string {
  return [
    'Planner clarification answers:',
    ...input.prompt.questions.flatMap((question, index) => {
      const selectedOptionId = input.selectedOptionIds[question.id]
      const selectedOption = question.options.find((option) => option.id === selectedOptionId)
      const note = input.notes[question.id]?.trim()
      const lines = [`${index + 1}. Question: ${question.question}`]
      if (selectedOption) lines.push(`Selected option: ${selectedOption.label}${selectedOption.description ? ` - ${selectedOption.description}` : ''}`)
      if (note) lines.push(selectedOption ? `Additional context: ${note}` : `Answer: ${note}`)
      if (!selectedOption && !note) lines.push('No explicit answer provided; use your best judgment from the task context.')
      return lines
    })
  ].join('\n')
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : undefined
  }
  return undefined
}

function truncateText(value: string, max = 500): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n[truncated ${value.length - max} chars]`
}

function oneLine(value: string, max = CHAT_CONTEXT_ENTRY_PREVIEW_LENGTH): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}...`
}

function runCompleteMessage(message: TaskActivityMessage): message is TaskActivityMessage {
  if (!isRunCompleteMessage(message)) return false
  return message.role === 'system' || message.status === 'failed' || message.status === 'completed'
}

function describeRunResult(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return ''
  if (typeof metadata.code === 'number') return `Exit code ${metadata.code}`
  if (typeof metadata.signal === 'string') return `Stopped by signal: ${metadata.signal}`
  if (metadata.stopped === true) return 'Stopped by user'
  if (metadata.stopped === false) return ''
  return ''
}

function formatChangesSummary(summary: CodexChangesSummary): string {
  if (summary.unavailable) return 'Changes summary unavailable.'
  if (summary.hasNoChanges || summary.files === 0) return summary.hasNoChanges
    ? 'No workspace changes detected.'
    : 'Changes reported without file-level detail.'
  const parts = []
  if (summary.files > 0) parts.push(`${summary.files} file${summary.files === 1 ? '' : 's'} changed`)
  if (summary.blocks > 0) parts.push(`${summary.blocks} block${summary.blocks === 1 ? '' : 's'} changed`)
  if (summary.insertions > 0) parts.push(`+${summary.insertions} insertions`)
  if (summary.deletions > 0) parts.push(`-${summary.deletions} deletions`)
  return parts.length > 0 ? parts.join(', ') : 'Workspace changes detected.'
}

function buildConversationIdLatest(messages: TaskActivityMessage[]): string | null {
  const index = new Map<string, { latestAt: number; latestRunCompletedAt: number }>()
  for (const message of messages) {
    const id = conversationIdOf(message)
    if (!id) continue
    const current = index.get(id) ?? { latestAt: -Infinity, latestRunCompletedAt: -Infinity }
    const at = messageTimeOf(message)
    if (at > current.latestAt) current.latestAt = at
    if (runCompleteMessage(message)) current.latestRunCompletedAt = Math.max(current.latestRunCompletedAt, at)
    index.set(id, current)
  }
  let selectedId: string | null = null
  let selectedScore = -Infinity

  for (const [id, stats] of index.entries()) {
    const completedScore = stats.latestRunCompletedAt > -Infinity ? stats.latestRunCompletedAt + (24 * 60 * 60 * 1000) : -Infinity
    const score = Math.max(stats.latestAt, completedScore)
    if (score > selectedScore) {
      selectedScore = score
      selectedId = id
    }
  }
  return selectedId
}

function messageShortLabel(message: TaskActivityMessage): string {
  const summary = message.body.trim().replace(/\s+/g, ' ')
  const role = message.role
  const source = message.source
  return `${source}/${role}: ${truncateText(summary, 220)}`
}

export function buildLatestRunFollowUpContext(messages: TaskActivityMessage[]): string {
  const runMessages = messages.filter((message) => message.source === 'codex-run')
  const conversationId = buildConversationIdLatest(runMessages)
  if (!conversationId) return ''

  const conversationMessages = runMessages
    .filter((message) => conversationIdOf(message) === conversationId)
    .sort((a, b) => a.createdAt - b.createdAt)
  if (conversationMessages.length === 0) return ''

  const runComplete = [...conversationMessages].slice().reverse().find((message) => runCompleteMessage(message))
  const finalAssistant = [...conversationMessages].slice().reverse().find((message) => (
    message.role === 'assistant' && typeof message.body === 'string' && message.body.trim()
  ))
  const reportedChanges = [...conversationMessages]
    .filter((message) => message.role === 'tool' && message.metadata?.codexBlock === 'changes')
    .slice(-1)[0]
  const usage = usageFromMetadata(finalAssistant?.metadata) ?? usageFromMetadata(reportedChanges?.metadata) ?? usageFromMetadata(runComplete?.metadata)
  const result = describeRunResult(runComplete?.metadata)
  const changesSummary = reportedChanges ? codexChangesSummary(reportedChanges) : null
  const recent = conversationMessages
    .slice(-CHAT_FOLLOW_UP_CONTEXT_RECENT_MESSAGES)
    .map(messageShortLabel)

  const lines = [
    `Latest run output context for conversation ${conversationId}:`,
    runComplete ? `Final run status: ${truncateText(runComplete.body.trim() || 'completed', 520)}` : 'Latest run status: not yet completed.',
    result ? `Result: ${result}` : null,
    finalAssistant ? `Final assistant message: ${truncateText(finalAssistant.body.trim(), 760)}` : null,
    changesSummary ? `Reported changes: ${truncateText(formatChangesSummary(changesSummary), 260)}` : null,
    usage ? `Usage: ${formatUsageSummary(usage)}` : null,
    'Recent run activity:',
    ...recent.map((row) => `- ${row}`)
  ].filter(Boolean)

  return truncateText(lines.join('\n'), CHAT_FOLLOW_UP_CONTEXT_MAX_LENGTH)
}

function sourceContextTitle(source: ChatMessageSource): string {
  if (source === 'codex-plan') return 'Plan context'
  if (source === 'codex-run') return 'Run context'
  return 'Chat context'
}

function contextMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function contextEntryFromConversation(conversationId: string, messages: TaskActivityMessage[]): GeneratedContextEntry | null {
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt)
  const last = ordered[ordered.length - 1]
  if (!last) return null
  const terminal = [...ordered].reverse().find((message) => runCompleteMessage(message))
  const assistant = [...ordered].reverse().find((message) => message.role === 'assistant' && message.body.trim())
  const changes = [...ordered].reverse().find((message) => message.role === 'tool' && message.metadata?.codexBlock === 'changes')
  const userMessages = ordered.filter((message) => message.role === 'user').slice(-2)
  const usage = usageFromMetadata(assistant?.metadata) ?? usageFromMetadata(changes?.metadata) ?? usageFromMetadata(terminal?.metadata)
  const changesSummary = changes ? codexChangesSummary(changes) : null
  const status = terminal
    ? (terminal.role === 'error' || terminal.status === 'failed' || terminal.metadata?.runStatus === 'failed' ? 'failed' : 'completed')
    : last.status ?? 'event'
  const source = ordered.find((message) => message.source !== 'codex-chat')?.source ?? last.source
  const result = describeRunResult(terminal?.metadata)
  const recent = ordered.slice(-CHAT_FOLLOW_UP_CONTEXT_RECENT_MESSAGES).map(messageShortLabel)
  const body = [
    `${sourceContextTitle(source)} for conversation ${conversationId}`,
    terminal ? `Status: ${terminal.body.trim() || status}` : `Status: ${status}`,
    result ? `Result: ${result}` : '',
    userMessages.length ? `Recent user direction:\n${userMessages.map((message) => `- ${truncateText(message.body.trim(), 280)}`).join('\n')}` : '',
    assistant ? `Latest assistant output:\n${truncateText(assistant.body.trim(), 780)}` : '',
    changesSummary ? `Reported changes: ${formatChangesSummary(changesSummary)}` : '',
    usage ? `Usage: ${formatUsageSummary(usage)}` : '',
    recent.length ? `Recent activity:\n${recent.map((row) => `- ${row}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n')
  const metadata = [
    { key: 'conversation', value: conversationId },
    { key: 'source', value: source },
    { key: 'status', value: status },
    last.metadata?.model ? { key: 'model', value: contextMetadataValue(last.metadata.model) } : null,
    usage ? { key: 'usage', value: formatUsageSummary(usage) } : null
  ].filter((item): item is { key: string; value: string } => Boolean(item?.value))

  return {
    id: `context-${conversationId}-${last.updatedAt ?? last.createdAt}`,
    conversationId,
    source,
    title: sourceContextTitle(source),
    status,
    at: last.updatedAt ?? last.createdAt,
    preview: oneLine(assistant?.body || terminal?.body || last.body),
    body: truncateText(body, CHAT_CONTEXT_ENTRY_BODY_LENGTH),
    metadata
  }
}

export function buildGeneratedContextEntries(messages: TaskActivityMessage[]): GeneratedContextEntry[] {
  const grouped = new Map<string, TaskActivityMessage[]>()
  for (const message of messages) {
    const conversationId = conversationIdOf(message)
    if (!conversationId) continue
    if (!['codex-plan', 'codex-run', 'codex-chat'].includes(message.source)) continue
    const current = grouped.get(conversationId) ?? []
    current.push(message)
    grouped.set(conversationId, current)
  }
  return Array.from(grouped.entries())
    .map(([conversationId, conversationMessages]) => contextEntryFromConversation(conversationId, conversationMessages))
    .filter((entry): entry is GeneratedContextEntry => Boolean(entry))
    .sort((a, b) => b.at - a.at)
}

export function buildLatestGeneratedFollowUpContext(messages: TaskActivityMessage[]): string {
  const entry = buildGeneratedContextEntries(messages)[0]
  return entry?.body ?? ''
}

function parseDurationMsFromSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value * 1_000))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1_000)) : undefined
  }
  return undefined
}

function formatThinkingSeconds(totalSeconds: number | undefined): string | undefined {
  if (!Number.isFinite(totalSeconds) || totalSeconds === undefined || totalSeconds <= 0) return undefined
  return `Working for ${Math.max(1, Math.round(totalSeconds))} seconds`
}

function formatDurationCompact(totalSeconds: number): string {
  const seconds = Math.max(1, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return `${remainingSeconds}s`
}

export function formatCodexWorkDuration(durationMs: number | undefined, isRunning = false): string {
  if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0) {
    return `Worked for ${formatDurationCompact(durationMs / 1000)}`
  }
  return isRunning ? 'Working...' : 'Worked'
}

export function thinkingDurationLabel(message: TaskActivityMessage, now = Date.now()): string {
  const metadata = message.metadata ?? {}
  const explicitDurationMs =
    parseDurationMs(metadata.thinkingDurationMs)
    ?? parseDurationMs(metadata.durationMs)
    ?? parseDurationMs(metadata.duration_ms)
    ?? parseDurationMsFromSeconds(metadata.duration_sec)
    ?? parseDurationMsFromSeconds(metadata.thinkingDurationSec)
    ?? parseDurationMsFromSeconds(metadata.thinking_duration_sec)
  const startedAt = parseTimestampMs(metadata.thinkingStartedAt)
    ?? parseTimestampMs(metadata.thinking_started_at)
    ?? parseTimestampMs(metadata.startedAt)
    ?? parseTimestampMs(metadata.startTime)
    ?? parseTimestampMs(metadata.start_time)
  const endedAt = parseTimestampMs(metadata.thinkingEndedAt)
    ?? parseTimestampMs(metadata.thinkingEndAt)
    ?? parseTimestampMs(metadata.thinking_ended_at)
    ?? parseTimestampMs(metadata.endedAt)
    ?? parseTimestampMs(metadata.endTime)
    ?? parseTimestampMs(metadata.end_time)
  if (explicitDurationMs !== undefined) return formatThinkingSeconds(explicitDurationMs / 1000) ?? ''
  const started = message.status === 'running' ? (startedAt ?? message.createdAt) : startedAt
  const ended = message.status === 'running' ? now : (endedAt ?? message.updatedAt ?? message.createdAt)
  const durationMs = typeof started === 'number' && Number.isFinite(started) && typeof ended === 'number' && Number.isFinite(ended) ? Math.max(0, ended - started) : undefined
  return formatThinkingSeconds(durationMs !== undefined ? durationMs / 1000 : undefined) ?? ''
}

function metadataCodexBlock(message: TaskActivityMessage): string {
  return typeof message.metadata?.codexBlock === 'string' ? message.metadata.codexBlock : ''
}

function isWorkBlockTextMessage(message: TaskActivityMessage): boolean {
  if (message.role === 'thinking') return true
  if (message.role !== 'assistant') return false
  const codexBlock = metadataCodexBlock(message)
  return codexBlock !== 'planner-question'
}

function isWorkBlockToolMessage(message: TaskActivityMessage): boolean {
  if (message.role !== 'tool') return false
  return ['command', 'log', 'changes'].includes(metadataCodexBlock(message))
}

function isCodexWorkMessage(message: TaskActivityMessage): boolean {
  if (!chatMessageSources.has(message.source)) return false
  if (message.role === 'error' || message.role === 'user') return false
  if (metadataCodexBlock(message) === 'run-complete') return false
  return isWorkBlockTextMessage(message) || isWorkBlockToolMessage(message)
}

function workGroupKey(message: TaskActivityMessage): string {
  return `${conversationIdOf(message) ?? message.runId}:${message.runId}`
}

function commandFromMessage(message: TaskActivityMessage): string {
  if (typeof message.metadata?.command === 'string') return message.metadata.command.trim()
  const commandLine = message.body.match(/^Command:\s*(.+)$/m)
  return commandLine?.[1]?.trim() ?? ''
}

function commandSearchCount(command: string): number {
  return /(^|[\s;&|({])(rg|grep|find)\b/.test(command) ? 1 : 0
}

function commandFileExploreCount(command: string): number {
  return /(^|[\s;&|({])(sed|cat|nl|ls|wc|head|tail|pwd)\b/.test(command) || /\bgit\s+(show|diff|status|log|ls-files)\b/.test(command) ? 1 : 0
}

function commandSummaryKind(message: TaskActivityMessage): CodexWorkSummaryKind {
  const codexBlock = metadataCodexBlock(message)
  if (codexBlock === 'log') return 'log'
  if (codexBlock === 'changes') return 'changed'
  const command = commandFromMessage(message)
  if (commandSearchCount(command) > 0 || commandFileExploreCount(command) > 0) return 'explored'
  return 'ran'
}

function plural(value: number, singular: string, pluralValue = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralValue}`
}

function exploredSummaryLabel(messages: TaskActivityMessage[]): string {
  const counts = messages.reduce((summary, message) => {
    const command = commandFromMessage(message)
    return {
      files: summary.files + commandFileExploreCount(command),
      searches: summary.searches + commandSearchCount(command)
    }
  }, { files: 0, searches: 0 })
  const parts = [
    counts.files > 0 ? plural(counts.files, 'file') : '',
    counts.searches > 0 ? plural(counts.searches, 'search', 'searches') : ''
  ].filter(Boolean)
  return parts.length > 0 ? `Explored ${parts.join(', ')}` : `Explored ${plural(messages.length, 'command')}`
}

function parseChangedStatusCounts(message: TaskActivityMessage): { created: number; edited: number; deleted: number } {
  const metadata = message.metadata ?? {}
  const rawStats = Array.isArray(metadata.changeFileStats) ? metadata.changeFileStats : []
  const totalFiles = Math.max(parseNumberMetadata(metadata.changeFiles), rawStats.length)
  const createdFromStats = rawStats.filter((entry) => {
    const record = asRecord(entry)
    return record?.untracked === true || record?.kind === 'created'
  }).length
  const deletedFromStats = rawStats.filter((entry) => {
    const record = asRecord(entry)
    return record?.deleted === true || record?.kind === 'deleted'
  }).length
  const editedFromStats = rawStats.filter((entry) => asRecord(entry)?.kind === 'edited').length
  const statusLines = typeof metadata.changeStatus === 'string' ? metadata.changeStatus.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []
  const createdFromStatus = statusLines.filter((line) => line.startsWith('?? ')).length
  const deletedFromStatus = statusLines.filter((line) => /^[MADRCU?! ]?D\b|^D[ MADRCU?!]/.test(line)).length
  const created = Math.max(createdFromStats, createdFromStatus)
  const deleted = Math.max(deletedFromStats, deletedFromStatus)
  const edited = editedFromStats > 0 ? editedFromStats : Math.max(0, totalFiles - created - deleted)
  return { created, edited, deleted }
}

function changedSummaryLabel(messages: TaskActivityMessage[]): string {
  const totals = messages.reduce((summary, message) => {
    const next = parseChangedStatusCounts(message)
    return {
      created: summary.created + next.created,
      edited: summary.edited + next.edited,
      deleted: summary.deleted + next.deleted
    }
  }, { created: 0, edited: 0, deleted: 0 })
  const parts = [
    totals.created > 0 ? `Created ${plural(totals.created, 'file')}` : '',
    totals.edited > 0 ? `Edited ${plural(totals.edited, 'file')}` : '',
    totals.deleted > 0 ? `Deleted ${plural(totals.deleted, 'file')}` : ''
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(', ')
  const changesSummary = messages.map(codexChangesSummary).reduce((summary, item) => ({
    files: summary.files + item.files,
    hasNoChanges: summary.hasNoChanges && item.hasNoChanges
  }), { files: 0, hasNoChanges: true })
  if (changesSummary.hasNoChanges) return 'No workspace changes detected'
  return `Edited ${plural(changesSummary.files || messages.length, 'file')}`
}

function summaryLabel(kind: CodexWorkSummaryKind, messages: TaskActivityMessage[]): string {
  if (kind === 'explored') return exploredSummaryLabel(messages)
  if (kind === 'changed') return changedSummaryLabel(messages)
  if (kind === 'log') return `Read ${plural(messages.length, 'log')}`
  return `Ran ${plural(messages.length, 'command')}`
}

function explicitThinkingDurationMs(message: TaskActivityMessage): number | undefined {
  const metadata = message.metadata ?? {}
  return parseDurationMs(metadata.thinkingDurationMs)
    ?? parseDurationMs(metadata.durationMs)
    ?? parseDurationMs(metadata.duration_ms)
    ?? parseDurationMsFromSeconds(metadata.duration_sec)
    ?? parseDurationMsFromSeconds(metadata.thinkingDurationSec)
    ?? parseDurationMsFromSeconds(metadata.thinking_duration_sec)
}

function workBlockDurationMs(messages: TaskActivityMessage[], startedAt: number, endedAt: number): number | undefined {
  const explicitDurations = messages
    .filter((message) => message.role === 'thinking')
    .map(explicitThinkingDurationMs)
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0)
  if (explicitDurations.length > 0) return explicitDurations.reduce((sum, value) => sum + value, 0)
  return endedAt > startedAt ? endedAt - startedAt : undefined
}

function createSummaryRow(kind: CodexWorkSummaryKind, messages: TaskActivityMessage[], index: number): CodexWorkSummaryRow {
  return {
    id: `summary-${index}-${messages.map((message) => message.id).join('-')}`,
    kind,
    label: summaryLabel(kind, messages),
    messages
  }
}

function buildWorkBlockEntries(messages: TaskActivityMessage[]): { entries: CodexWorkBlockEntry[]; summaryRows: CodexWorkSummaryRow[] } {
  const entries: CodexWorkBlockEntry[] = []
  const summaryRows: CodexWorkSummaryRow[] = []
  let pendingKind: CodexWorkSummaryKind | null = null
  let pendingMessages: TaskActivityMessage[] = []

  const flushPending = () => {
    if (!pendingKind || pendingMessages.length === 0) return
    const row = createSummaryRow(pendingKind, pendingMessages, summaryRows.length)
    summaryRows.push(row)
    entries.push({ kind: 'summary', id: row.id, summary: row })
    pendingKind = null
    pendingMessages = []
  }

  for (const message of messages) {
    if (isWorkBlockTextMessage(message)) {
      flushPending()
      entries.push({ kind: 'text', id: message.id, message })
      continue
    }
    const nextKind = commandSummaryKind(message)
    if (pendingKind && pendingKind !== nextKind) flushPending()
    pendingKind = nextKind
    pendingMessages.push(message)
  }
  flushPending()

  return { entries, summaryRows }
}

function terminalStateForMessage(message: TaskActivityMessage): CodexWorkTerminalState | null {
  if (!isRunCompleteMessage(message)) return null
  return {
    at: messageTimeOf(message),
    status: message.role === 'error' || message.status === 'failed' || message.metadata?.runStatus === 'failed' ? 'failed' : 'completed',
    message
  }
}

function createCodexWorkBlock(messages: TaskActivityMessage[], now: number, terminal?: CodexWorkTerminalState): CodexWorkBlock {
  const first = messages[0]
  const startedAt = Math.min(...messages.map((message) => message.createdAt))
  const endedAt = Math.max(...messages.map((message) => message.updatedAt ?? message.createdAt))
  const hasFreshRunningMessage = messages.some((message) => isFreshRunningMessage(message, now))
  const isRunning = !terminal && hasFreshRunningMessage
  const durationEnd = terminal?.at ?? (isRunning ? Math.max(now, endedAt) : endedAt)
  const { entries, summaryRows } = buildWorkBlockEntries(messages)
  return {
    id: `work-${first.conversationId ?? first.runId}-${first.runId}-${first.id}-${messages.at(-1)?.id ?? first.id}`,
    runId: first.runId,
    conversationId: first.conversationId,
    source: first.source,
    messages,
    entries,
    summaryRows,
    startedAt,
    endedAt: durationEnd,
    durationMs: workBlockDurationMs(messages, startedAt, durationEnd),
    isRunning
  }
}

export function groupCodexTranscriptMessages(messages: TaskActivityMessage[], now = Date.now()): ChatTranscriptRenderItem[] {
  const items: ChatTranscriptRenderItem[] = []
  const terminalByWorkKey = new Map<string, CodexWorkTerminalState>()
  for (const message of messages) {
    const terminal = terminalStateForMessage(message)
    if (!terminal) continue
    terminalByWorkKey.set(workGroupKey(message), terminal)
  }
  let pending: TaskActivityMessage[] = []
  let pendingKey = ''

  const flushPending = () => {
    if (pending.length === 0) return
    if (pending.length === 1 && pending[0].role === 'assistant' && pending[0].metadata?.runStatus !== 'running') {
      const message = pending[0]
      items.push({ kind: 'message', id: message.id, message })
    } else {
      const block = createCodexWorkBlock(pending, now, terminalByWorkKey.get(pendingKey))
      items.push({ kind: 'work-block', id: block.id, block })
    }
    pending = []
    pendingKey = ''
  }

  for (const message of messages) {
    if (!isCodexWorkMessage(message)) {
      flushPending()
      items.push({ kind: 'message', id: message.id, message })
      continue
    }
    const nextKey = workGroupKey(message)
    if (pending.length > 0 && pendingKey !== nextKey) flushPending()
    pendingKey = nextKey
    pending.push(message)
  }
  flushPending()

  return items
}

export function chatConversationTitle(source: ChatMessageSource): string {
  if (source === 'codex-plan') return 'Plan'
  if (source === 'codex-run') return 'Run'
  return 'Follow-up'
}

export function buildChatConversationSummaries(messages: TaskActivityMessage[], now = Date.now()): ChatConversationSummary[] {
  type ConversationState = {
    id: string
    count: number
    title: string
    source: TaskActivityMessage['source']
    latestAt: number
    latestStatus: ChatConversationSummary['status']
    model: string | undefined
    latestRunningAt: number
    completedStatus: { status: 'completed' | 'failed'; at: number } | null
  }
  const grouped = new Map<string, ConversationState>()

  for (const message of messages) {
    const id = conversationIdOf(message)
    if (!id) continue
    const at = messageTimeOf(message)
    const current = grouped.get(id)
    const nextTitle = chatConversationTitle(message.source)
    const messageModel = typeof message.metadata?.model === 'string' ? message.metadata.model : undefined
    const nextStatus = message.status ?? 'event'
    const terminalStatus = isRunCompleteMessage(message)
      ? (message.role === 'error' || message.status === 'failed' || message.metadata?.runStatus === 'failed' ? 'failed' : 'completed')
      : null

    if (!current) {
      grouped.set(id, {
        id,
        title: nextTitle,
        count: message.role === 'user' ? 1 : 0,
        source: message.source,
        latestAt: at,
        latestStatus: nextStatus,
        model: messageModel,
        latestRunningAt: isFreshRunningMessage(message, now) ? at : -Infinity,
        completedStatus: terminalStatus ? { status: terminalStatus, at } : null
      })
      continue
    }

    if (message.role === 'user') current.count += 1
    if (at > current.latestAt) {
      current.latestAt = at
      current.latestStatus = nextStatus
      current.model = messageModel ?? current.model
    }
    if (messageModel && !current.model) current.model = messageModel
    if (isFreshRunningMessage(message, now)) {
      current.latestRunningAt = Math.max(current.latestRunningAt, at)
    }
    if (terminalStatus && (!current.completedStatus || at >= current.completedStatus.at)) {
      current.completedStatus = { status: terminalStatus, at }
    }
  }

  return Array.from(grouped.values()).map<ChatConversationSummary>((entry) => {
    let nextStatus: ChatConversationSummary['status'] = entry.latestStatus
    if (entry.completedStatus && entry.completedStatus.at >= entry.latestRunningAt) {
      nextStatus = entry.completedStatus.status
    } else if (entry.latestRunningAt > -Infinity) {
      nextStatus = now - entry.latestRunningAt <= CHAT_RUNNING_ACTIVITY_STALE_MS
        ? 'running'
        : entry.completedStatus?.status ?? 'completed'
    } else if (nextStatus === 'running' && now - entry.latestAt > CHAT_RUNNING_ACTIVITY_STALE_MS) {
      nextStatus = entry.completedStatus?.status ?? 'completed'
    }

    return {
      id: entry.id,
      title: entry.title,
      count: entry.count,
      status: nextStatus,
      at: entry.latestAt,
      source: entry.source,
      model: entry.model
    }
  }).sort((a, b) => b.at - a.at)
}

export function normalizeActivityMessage(raw: unknown): TaskActivityMessage | null {
  const candidate = asRecord(raw)
  if (!candidate) return null
  if (typeof candidate.id !== 'string' || typeof candidate.runId !== 'string' || typeof candidate.body !== 'string') return null
  const createdAt = typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
    ? candidate.createdAt
    : Date.now()
  const source = typeof candidate.source === 'string' && chatMessageSources.has(candidate.source as ChatMessageSource)
    ? candidate.source as ChatMessageSource
    : 'codex-chat'
  const role = typeof candidate.role === 'string' && chatMessageRoles.has(candidate.role as ChatMessageRole)
    ? candidate.role as ChatMessageRole
    : 'assistant'
  const status = typeof candidate.status === 'string' && chatMessageStatuses.has(candidate.status as ChatMessageStatus)
    ? candidate.status as ChatMessageStatus
    : undefined
  const metadata = asRecord(candidate.metadata)
  const updatedAt = typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
    ? candidate.updatedAt
    : undefined
  return {
    id: candidate.id,
    runId: candidate.runId,
    conversationId: typeof candidate.conversationId === 'string' ? candidate.conversationId : undefined,
    source,
    role,
    status,
    body: candidate.body,
    metadata,
    createdAt,
    updatedAt
  }
}

export function activityMessagesFromTask(task: TaskEntity): TaskActivityMessage[] {
  const payload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload)
    ? task.payload as Record<string, unknown>
    : {}
  const raw = payload.activityMessages
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeActivityMessage).filter((item): item is TaskActivityMessage => Boolean(item))
}

export function appendActivityMessageToTasks(
  tasks: TaskEntity[],
  taskId: string,
  message: TaskActivityMessage,
  limit = 300
): TaskEntity[] {
  let changed = false
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task
    const currentMessages = activityMessagesFromTask(task)
    if (currentMessages.some((item) => item.id === message.id)) return task
    const payload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload)
      ? task.payload as Record<string, unknown>
      : {}
    changed = true
    return {
      ...task,
      payload: {
        ...payload,
        activityMessages: [...currentMessages, message].slice(-limit)
      },
      updatedAt: Math.max(task.updatedAt ?? 0, message.updatedAt ?? message.createdAt)
    }
  })
  return changed ? nextTasks : tasks
}

export function formatCodexToolBody(body: string): string {
  const parsed = parseCodexEvents(body)
  if (parsed.parsedCount === 0) return body
  const commands = parsed.commands.map((event) => {
    const output = event.output?.trim()
      ? `\n${event.output.trim().split(/\r?\n/).slice(-8).join('\n')}`
      : ''
    const exit = event.exitCode === undefined ? '' : ` (exit ${event.exitCode})`
    return `${event.status}: ${event.command}${exit}${output}`
  })
  const messages = parsed.messages.map((event) => `${event.role}: ${event.text.trim()}`)
  const usage = formatUsageSummary(parsed.usage)
  return [
    commands.length ? `Commands\n${commands.slice(-12).map((row) => `- ${row}`).join('\n')}` : '',
    messages.length ? `Messages\n${messages.slice(-5).map((row) => `- ${row}`).join('\n')}` : '',
    usage ? `Usage\n- ${usage}` : ''
  ].filter(Boolean).join('\n\n') || 'Codex completed tool steps.'
}

export function usageFromMetadata(metadata: Record<string, unknown> | undefined): CodexUsageSummary | undefined {
  const value = asRecord(metadata?.usage)
  if (!value) return undefined
  const summary: CodexUsageSummary = {}
  if (typeof value.inputTokens === 'number') summary.inputTokens = value.inputTokens
  if (typeof value.cachedInputTokens === 'number') summary.cachedInputTokens = value.cachedInputTokens
  if (typeof value.outputTokens === 'number') summary.outputTokens = value.outputTokens
  if (typeof value.reasoningOutputTokens === 'number') summary.reasoningOutputTokens = value.reasoningOutputTokens
  if (typeof value.totalTokens === 'number') summary.totalTokens = value.totalTokens
  return Object.keys(summary).length > 0 ? summary : undefined
}

export function asCodexThread(message: TaskActivityMessage): ThreadEntry {
  const label = message.source === 'codex-plan' ? 'Codex Plan' : message.source === 'codex-run' ? 'Codex Run' : 'Codex Chat'
  return {
    id: `codex-${message.id}`,
    at: message.createdAt,
    author: label,
    eventType: `${label} · ${message.role}`,
    summary: message.body,
    fields: [
      { key: 'run', value: message.runId },
      { key: 'status', value: message.status ?? 'event' }
    ],
    evidence: [],
    source: message.source,
    role: message.role,
    status: message.status,
    metadata: { ...(message.metadata ?? {}), runId: message.runId, conversationId: message.conversationId ?? message.runId }
  }
}

export function formatJsonMetadata(metadata: Record<string, unknown>): string {
  const compact = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined))
  return JSON.stringify(compact, null, 2)
}

export function formatChatTime(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function roleLabel(role: ChatMessageRole): string {
  if (role === 'assistant') return 'Codex'
  if (role === 'user') return 'You'
  if (role === 'thinking') return 'Thinking'
  return role
}

export function parseHistoryPatch(item: TaskHistoryItem, index: number): ThreadEntry {
  const baseId = `history-${item.at}-${index}`

  try {
    const parsed = JSON.parse(item.patch) as Record<string, unknown>
    const action = typeof parsed.action === 'string' ? parsed.action : 'updated'
    const status = typeof parsed.status === 'string' ? parsed.status : 'unknown'
    const fields: Array<{ key: string; value: string }> = [
      { key: 'action', value: action },
      { key: 'status', value: status }
    ]
    if (typeof parsed.id === 'string') {
      fields.push({ key: 'id', value: parsed.id })
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (['action', 'status', 'id'].includes(key)) continue
      if (value == null) continue
      fields.push({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })
    }

    return {
      id: baseId,
      at: item.at,
      author: 'System',
      eventType: 'Update',
      summary: `Task ${action}`,
      fields,
      evidence: [`Status changed to ${status}`],
      next: 'Review the latest changes in this task.',
      source: 'history'
    }
  } catch {
    return {
      id: baseId,
      at: item.at,
      author: 'System',
      eventType: 'Unstructured update',
      summary: 'History event could not be parsed.',
      fields: [],
      evidence: ['Non-JSON patch payload detected.'],
      source: 'history'
    }
  }
}

export function asCommentThread(comment: TaskComment): ThreadEntry {
  return {
    id: `comment-${comment.id}`,
    at: comment.createdAt,
    author: comment.authorName || 'Operator',
    eventType: 'Comment added',
    summary: 'Added a comment',
    fields: [],
    evidence: [comment.body],
    source: 'comment'
  }
}
