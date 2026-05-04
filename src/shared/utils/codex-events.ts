export type CodexUsageSummary = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  totalTokens?: number
}

export type CodexCommandEvent = {
  kind: 'command'
  status: string
  command: string
  output?: string
  exitCode?: number
}

export type CodexMessageEvent = {
  kind: 'message'
  role: 'assistant' | 'user' | 'system' | 'tool' | 'thinking'
  text: string
  durationMs?: number
  startedAt?: number
  endedAt?: number
}

export type CodexStatusEvent = {
  kind: 'status'
  type: string
  label: string
  usage?: CodexUsageSummary
}

export type CodexParseIssue = {
  kind: 'raw' | 'malformed'
  text: string
}

export type CodexNormalizedEvent = CodexCommandEvent | CodexMessageEvent | CodexStatusEvent | CodexParseIssue

export type CodexParseResult = {
  events: CodexNormalizedEvent[]
  commands: CodexCommandEvent[]
  messages: CodexMessageEvent[]
  statuses: CodexStatusEvent[]
  usage?: CodexUsageSummary
  rawTail: string
  parsedCount: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finiteNumberFromString(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function parseTimestampValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1_000)
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) {
      return parsed > 1_000_000_000_000 ? Math.trunc(parsed) : Math.trunc(parsed * 1_000)
    }
    const asDate = Date.parse(value)
    return Number.isFinite(asDate) ? asDate : undefined
  }
  return undefined
}

function asDurationMs(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const direct = finiteNumber(record[key]) ?? finiteNumberFromString(record[key])
    if (direct !== undefined) return Math.max(0, Math.trunc(direct))
  }
  return undefined
}

function asMsFromSeconds(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(record[key]) ?? finiteNumberFromString(record[key])
    if (value !== undefined) return Math.max(0, Math.round(value * 1_000))
  }
  return undefined
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const direct = finiteNumber(record[key])
    if (direct !== undefined) return direct
  }
  return undefined
}

function normalizeUsage(value: unknown): CodexUsageSummary | undefined {
  const usage = asRecord(value)
  if (!usage) return undefined
  const outputDetails = asRecord(usage.output_tokens_details)
  const inputDetails = asRecord(usage.input_tokens_details)
  const summary: CodexUsageSummary = {
    inputTokens: pickNumber(usage, ['input_tokens', 'prompt_tokens']),
    cachedInputTokens: inputDetails ? pickNumber(inputDetails, ['cached_tokens']) : undefined,
    outputTokens: pickNumber(usage, ['output_tokens', 'completion_tokens']),
    reasoningOutputTokens: outputDetails ? pickNumber(outputDetails, ['reasoning_tokens']) : undefined,
    totalTokens: pickNumber(usage, ['total_tokens'])
  }
  const total = summary.totalTokens ?? ((summary.inputTokens ?? 0) + (summary.outputTokens ?? 0) || undefined)
  if (total !== undefined) summary.totalTokens = total
  return Object.values(summary).some((item) => item !== undefined) ? summary : undefined
}

function mergeUsage(current: CodexUsageSummary | undefined, next: CodexUsageSummary | undefined): CodexUsageSummary | undefined {
  if (!next) return current
  if (!current) return next
  return {
    inputTokens: next.inputTokens ?? current.inputTokens,
    cachedInputTokens: next.cachedInputTokens ?? current.cachedInputTokens,
    outputTokens: next.outputTokens ?? current.outputTokens,
    reasoningOutputTokens: next.reasoningOutputTokens ?? current.reasoningOutputTokens,
    totalTokens: next.totalTokens ?? current.totalTokens
  }
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }
  return objects
}

function jsonCandidates(raw: string): string[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const candidates = lines.filter((line) => line.startsWith('{') && line.endsWith('}'))
  const embedded = extractJsonObjects(raw)
  return Array.from(new Set([...candidates, ...embedded]))
}

function normalizeEvent(rawEvent: Record<string, unknown>): CodexNormalizedEvent[] {
  const type = typeof rawEvent.type === 'string' ? rawEvent.type : 'event'
  const item = asRecord(rawEvent.item)
  const itemType = typeof item?.type === 'string' ? item.type : ''
  const usage = normalizeUsage(rawEvent.usage ?? rawEvent.token_usage ?? item?.usage)

  if (itemType === 'command_execution' && item) {
    return [{
      kind: 'command',
      status: typeof item.status === 'string' ? item.status : type.replace(/^item\./, '') || 'running',
      command: typeof item.command === 'string' ? item.command : '',
      output: typeof item.aggregated_output === 'string' ? item.aggregated_output : undefined,
      exitCode: finiteNumber(item.exit_code)
    }]
  }

  if (itemType === 'agent_message' && typeof item?.text === 'string') {
    return [{ kind: 'message', role: 'assistant', text: item.text }]
  }

  if ((itemType === 'reasoning' || itemType === 'reasoning_summary') && item) {
    const text = typeof item.text === 'string' ? item.text : typeof item.summary === 'string' ? item.summary : ''
    const durationMs = asDurationMs(item, ['duration_ms', 'durationMs', 'duration']) ?? asMsFromSeconds(item, ['duration_sec', 'durationSeconds', 'duration_second'])
    const startedAt = parseTimestampValue(item.started_at) ?? parseTimestampValue(item.startedAt)
      ?? parseTimestampValue(item.start_time) ?? parseTimestampValue(item.startTime) ?? parseTimestampValue(item.event_started_at) ?? parseTimestampValue(item.eventStartedAt)
    const endedAt = parseTimestampValue(item.ended_at) ?? parseTimestampValue(item.endedAt)
      ?? parseTimestampValue(item.end_time) ?? parseTimestampValue(item.endTime) ?? parseTimestampValue(item.event_ended_at) ?? parseTimestampValue(item.eventEndedAt)
    return text ? [{
      kind: 'message',
      role: 'thinking',
      text,
      durationMs,
      startedAt,
      endedAt
    }] : []
  }

  if (['message', 'user_message', 'system_message', 'tool_message'].includes(itemType) && item) {
    const role = itemType === 'user_message' ? 'user' : itemType === 'system_message' ? 'system' : itemType === 'tool_message' ? 'tool' : 'assistant'
    const text = typeof item.text === 'string' ? item.text : typeof item.content === 'string' ? item.content : ''
    return text ? [{ kind: 'message', role, text }] : []
  }

  if (type === 'turn.completed' || usage) {
    return [{ kind: 'status', type, label: type === 'turn.completed' ? 'Turn completed' : type, usage }]
  }

  if (type === 'item.started' || type === 'item.completed') {
    return [{ kind: 'status', type, label: type.replace('.', ' ') }]
  }

  return [{ kind: 'raw', text: JSON.stringify(rawEvent).slice(0, 4000) }]
}

export function normalizeCodexEvent(rawEvent: unknown): CodexNormalizedEvent[] {
  const record = asRecord(rawEvent)
  return record ? normalizeEvent(record) : []
}

export function parseCodexEvents(raw: string): CodexParseResult {
  const events: CodexNormalizedEvent[] = []
  let parsedCount = 0
  let usage: CodexUsageSummary | undefined
  for (const candidate of jsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate)
      const record = asRecord(parsed)
      if (!record) continue
      parsedCount += 1
      const normalized = normalizeCodexEvent(record)
      for (const event of normalized) {
        events.push(event)
        if (event.kind === 'status') usage = mergeUsage(usage, event.usage)
      }
    } catch {
      events.push({ kind: 'malformed', text: candidate.slice(0, 600) })
    }
  }
  if (parsedCount === 0 && raw.trim()) {
    events.push({ kind: 'raw', text: raw.trim() })
  }
  const commands = events.filter((event): event is CodexCommandEvent => event.kind === 'command' && Boolean(event.command))
  const messages = events.filter((event): event is CodexMessageEvent => event.kind === 'message' && Boolean(event.text.trim()))
  const statuses = events.filter((event): event is CodexStatusEvent => event.kind === 'status')
  return { events, commands, messages, statuses, usage, rawTail: raw.trim().slice(-4000), parsedCount }
}

export function formatUsageSummary(usage: CodexUsageSummary | undefined): string {
  if (!usage) return ''
  const parts = [
    usage.inputTokens !== undefined ? `${usage.inputTokens.toLocaleString()} input` : '',
    usage.cachedInputTokens !== undefined ? `${usage.cachedInputTokens.toLocaleString()} cached` : '',
    usage.outputTokens !== undefined ? `${usage.outputTokens.toLocaleString()} output` : '',
    usage.reasoningOutputTokens !== undefined ? `${usage.reasoningOutputTokens.toLocaleString()} reasoning` : '',
    usage.totalTokens !== undefined ? `${usage.totalTokens.toLocaleString()} total` : ''
  ].filter(Boolean)
  return parts.join(' · ')
}
