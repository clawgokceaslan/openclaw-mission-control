import { formatUsageSummary, parseCodexEvents, type CodexUsageSummary } from '@shared/utils/codex-events'
import type { TaskComment, TaskEntity } from '@shared/types/entities'
import type {
  ChatMessageRole,
  ChatMessageSource,
  ChatMessageStatus,
  TaskActivityMessage,
  TaskHistoryItem,
  ThreadEntry
} from '../types'

export const CHAT_INITIAL_MESSAGE_LIMIT = 80
export const CHAT_MESSAGE_LOAD_STEP = 80
export const CHAT_COMPOSER_MIN_HEIGHT = 72
export const CHAT_COMPOSER_MAX_HEIGHT = 270
export const CHAT_RUNNING_ACTIVITY_STALE_MS = 15 * 60 * 1000

export const CHAT_RUNNING_STATUS_LABELS = ['queued', 'running', 'completed', 'failed'] as const

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
  return message.metadata?.codexBlock === 'run-complete' || message.metadata?.stopped === true || message.role === 'error'
}

export function messageTimeOf(message: TaskActivityMessage): number {
  return message.updatedAt ?? message.createdAt
}

export function isFreshRunningMessage(message: TaskActivityMessage, now: number): boolean {
  if (message.status !== 'running' && message.metadata?.runStatus !== 'running') return false
  return now - messageTimeOf(message) <= CHAT_RUNNING_ACTIVITY_STALE_MS
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
