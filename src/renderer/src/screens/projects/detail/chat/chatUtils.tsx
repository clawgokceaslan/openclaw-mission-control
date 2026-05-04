import { formatUsageSummary, parseCodexEvents, type CodexUsageSummary } from '@shared/utils/codex-events'
import type { TaskComment, TaskEntity } from '@shared/types/entities'
import type {
  ChatConversationSummary,
  ChatMessageRole,
  ChatMessageSource,
  ChatMessageStatus,
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

export const CHAT_INITIAL_MESSAGE_LIMIT = 80
export const CHAT_MESSAGE_LOAD_STEP = 80
export const CHAT_COMPOSER_MIN_HEIGHT = 72
export const CHAT_COMPOSER_MAX_HEIGHT = 270
export const CHAT_RUNNING_ACTIVITY_STALE_MS = 15 * 60 * 1000

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

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : undefined
  }
  return undefined
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
      current.title = nextTitle
      current.source = message.source
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
