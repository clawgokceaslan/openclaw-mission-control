export type GatewayUsageSummary = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  totalTokens?: number
}

export type GatewayCommandEvent = {
  kind: 'command'
  status: string
  command: string
  output?: string
  exitCode?: number
}

export type GatewayMessageEvent = {
  kind: 'message'
  role: 'assistant' | 'user' | 'system' | 'tool' | 'thinking'
  text: string
  messageId?: string
  append?: boolean
  durationMs?: number
  startedAt?: number
  endedAt?: number
}

export type GatewayStatusEvent = {
  kind: 'status'
  type: string
  label: string
  usage?: GatewayUsageSummary
}

export type GatewayParseIssue = {
  kind: 'raw' | 'malformed'
  text: string
}

export type GatewayNormalizedEvent = GatewayCommandEvent | GatewayMessageEvent | GatewayStatusEvent | GatewayParseIssue

export type GatewayParseResult = {
  events: GatewayNormalizedEvent[]
  commands: GatewayCommandEvent[]
  messages: GatewayMessageEvent[]
  statuses: GatewayStatusEvent[]
  usage?: GatewayUsageSummary
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

function normalizeUsage(value: unknown): GatewayUsageSummary | undefined {
  const usage = asRecord(value)
  if (!usage) return undefined
  const outputDetails = asRecord(usage.output_tokens_details)
  const inputDetails = asRecord(usage.input_tokens_details)
  const summary: GatewayUsageSummary = {
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

function mergeUsage(current: GatewayUsageSummary | undefined, next: GatewayUsageSummary | undefined): GatewayUsageSummary | undefined {
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

function textFromSummaryArray(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((item): string[] => {
    const record = asRecord(item)
    if (!record) return []
    if (typeof record.text === 'string' && record.text.trim()) return [record.text.trim()]
    if (typeof record.summary === 'string' && record.summary.trim()) return [record.summary.trim()]
    return []
  }).join('\n\n')
}

function commandTextFromValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' ').trim()
  return ''
}

function stringFromKeys(record: Record<string, unknown> | undefined, keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function textFromContentBlocks(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap((item): string[] => {
    const record = asRecord(item)
    if (!record) return []
    if (typeof record.text === 'string' && record.text.trim()) return [record.text]
    if (typeof record.content === 'string' && record.content.trim()) return [record.content]
    if (typeof record.input === 'string' && record.input.trim()) return [record.input]
    if (typeof record.name === 'string' && record.name.trim()) return [`Tool: ${record.name}`]
    return []
  }).join('\n\n')
}

function normalizedMessageRole(value: unknown): GatewayMessageEvent['role'] | undefined {
  if (value !== 'assistant' && value !== 'user' && value !== 'system' && value !== 'tool' && value !== 'thinking') return undefined
  return value
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

function normalizeEvent(rawEvent: Record<string, unknown>): GatewayNormalizedEvent[] {
  const type = typeof rawEvent.type === 'string' ? rawEvent.type : 'event'
  const payload = asRecord(rawEvent.payload)
  const payloadType = typeof payload?.type === 'string' ? payload.type : ''
  const message = asRecord(rawEvent.message)
  const messageRole = normalizedMessageRole(message?.role)
  if (message && messageRole) {
    const text = textFromContentBlocks(message.content) || stringFromKeys(message, ['text', 'message'])
    return text ? [{ kind: 'message', role: messageRole, text, messageId: stringFromKeys(message, ['id']) || undefined }] : []
  }
  if (type === 'assistant' || type === 'user' || type === 'system') {
    const text = textFromContentBlocks(rawEvent.content) || stringFromKeys(rawEvent, ['text', 'message', 'result'])
    return text ? [{ kind: 'message', role: type, text, messageId: stringFromKeys(rawEvent, ['id', 'message_id', 'messageId']) || undefined }] : []
  }
  if (type === 'content_block_delta' || type === 'message_delta') {
    const delta = asRecord(rawEvent.delta)
    const text = stringFromKeys(delta, ['text', 'partial_json']) || stringFromKeys(rawEvent, ['text', 'content', 'delta'])
    return text ? [{ kind: 'message', role: 'assistant', text, messageId: stringFromKeys(rawEvent, ['id', 'message_id', 'messageId']) || undefined, append: true }] : []
  }
  if (type === 'result') {
    const usage = normalizeUsage(rawEvent.usage)
    const text = stringFromKeys(rawEvent, ['result', 'message', 'text'])
    return [
      ...(text ? [{ kind: 'message' as const, role: 'assistant' as const, text }] : []),
      { kind: 'status' as const, type, label: 'Result completed', usage }
    ]
  }
  if (type === 'response_item' && payload) {
    return normalizeEvent({ type: 'item.completed', item: payload, id: rawEvent.id ?? payload.id, usage: rawEvent.usage ?? payload.usage })
  }
  if (type === 'event_msg' && payload) {
    if (payloadType === 'agent_message' && typeof payload.message === 'string') {
      return [{ kind: 'message', role: 'assistant', text: payload.message, messageId: stringFromKeys(payload, ['id', 'message_id', 'messageId', 'item_id', 'itemId']) || undefined }]
    }
    if (payloadType === 'agent_message_delta') {
      const text = stringFromKeys(payload, ['delta', 'message', 'text', 'content'])
      return text ? [{ kind: 'message', role: 'assistant', text, messageId: stringFromKeys(payload, ['id', 'message_id', 'messageId', 'item_id', 'itemId']) || undefined, append: true }] : []
    }
    if (payloadType === 'agent_reasoning' || payloadType === 'agent_reasoning_delta') {
      const text = stringFromKeys(payload, ['delta', 'message', 'text', 'summary'])
      return text ? [{ kind: 'message', role: 'thinking', text, messageId: stringFromKeys(payload, ['id', 'message_id', 'messageId', 'item_id', 'itemId']) || undefined, append: payloadType.endsWith('_delta') }] : []
    }
    if (payloadType === 'exec_command_begin' || payloadType === 'exec_command_end') {
      return [{
        kind: 'command',
        status: payloadType === 'exec_command_begin' ? 'running' : 'completed',
        command: commandTextFromValue(payload.command ?? payload.cmd ?? payload.argv),
        output: typeof payload.output === 'string' ? payload.output : typeof payload.stdout === 'string' ? payload.stdout : undefined,
        exitCode: finiteNumber(payload.exit_code ?? payload.exitCode)
      }]
    }
  }
  const item = asRecord(rawEvent.item)
  const itemType = typeof item?.type === 'string' ? item.type : ''
  const usage = normalizeUsage(rawEvent.usage ?? rawEvent.token_usage ?? item?.usage)
  const itemMessageId = stringFromKeys(item, ['id', 'message_id', 'messageId']) || stringFromKeys(rawEvent, ['id', 'item_id', 'itemId', 'message_id', 'messageId']) || undefined

  if (itemType === 'command_execution' && item) {
    return [{
      kind: 'command',
      status: typeof item.status === 'string' ? item.status : type.replace(/^item\./, '') || 'running',
      command: typeof item.command === 'string' ? item.command : '',
      output: typeof item.aggregated_output === 'string' ? item.aggregated_output : undefined,
      exitCode: finiteNumber(item.exit_code)
    }]
  }

  if ((itemType === 'agent_message' || itemType === 'assistant_message') && item) {
    const text = stringFromKeys(item, ['text', 'message', 'content'])
    return text ? [{ kind: 'message', role: 'assistant', text, messageId: itemMessageId }] : []
  }

  if (itemType === 'agent_message_delta' && item) {
    const text = stringFromKeys(item, ['delta', 'text_delta', 'textDelta', 'message', 'text', 'content'])
    return text ? [{ kind: 'message', role: 'assistant', text, messageId: itemMessageId, append: true }] : []
  }

  if ((itemType === 'reasoning' || itemType === 'reasoning_summary') && item) {
    const text = typeof item.text === 'string'
      ? item.text
      : typeof item.summary === 'string'
        ? item.summary
        : textFromSummaryArray(item.summary)
    const durationMs = asDurationMs(item, ['duration_ms', 'durationMs', 'duration']) ?? asMsFromSeconds(item, ['duration_sec', 'durationSeconds', 'duration_second'])
    const startedAt = parseTimestampValue(item.started_at) ?? parseTimestampValue(item.startedAt)
      ?? parseTimestampValue(item.start_time) ?? parseTimestampValue(item.startTime) ?? parseTimestampValue(item.event_started_at) ?? parseTimestampValue(item.eventStartedAt)
    const endedAt = parseTimestampValue(item.ended_at) ?? parseTimestampValue(item.endedAt)
      ?? parseTimestampValue(item.end_time) ?? parseTimestampValue(item.endTime) ?? parseTimestampValue(item.event_ended_at) ?? parseTimestampValue(item.eventEndedAt)
    return text ? [{
      kind: 'message',
      role: 'thinking',
      text,
      messageId: itemMessageId,
      durationMs,
      startedAt,
      endedAt
    }] : []
  }

  if ((itemType === 'reasoning_delta' || itemType === 'reasoning_summary_delta') && item) {
    const text = stringFromKeys(item, ['delta', 'text_delta', 'textDelta', 'text', 'summary'])
    return text ? [{ kind: 'message', role: 'thinking', text, messageId: itemMessageId, append: true }] : []
  }

  if (['message', 'user_message', 'system_message', 'tool_message'].includes(itemType) && item) {
    const role = itemType === 'user_message' ? 'user' : itemType === 'system_message' ? 'system' : itemType === 'tool_message' ? 'tool' : normalizedMessageRole(item.role) ?? 'assistant'
    const text = stringFromKeys(item, ['text', 'content', 'message'])
    return text ? [{ kind: 'message', role, text, messageId: itemMessageId }] : []
  }

  if (['message_delta', 'user_message_delta', 'system_message_delta', 'tool_message_delta'].includes(itemType) && item) {
    const role = itemType === 'user_message_delta' ? 'user' : itemType === 'system_message_delta' ? 'system' : itemType === 'tool_message_delta' ? 'tool' : normalizedMessageRole(item.role) ?? 'assistant'
    const text = stringFromKeys(item, ['delta', 'text_delta', 'textDelta', 'content_delta', 'contentDelta', 'text', 'content', 'message'])
    return text ? [{ kind: 'message', role, text, messageId: itemMessageId, append: true }] : []
  }

  if (type === 'turn.completed' || usage) {
    return [{ kind: 'status', type, label: type === 'turn.completed' ? 'Turn completed' : type, usage }]
  }

  if (type === 'item.started' || type === 'item.completed') {
    return [{ kind: 'status', type, label: type.replace('.', ' ') }]
  }

  return [{ kind: 'raw', text: JSON.stringify(rawEvent).slice(0, 4000) }]
}

export function normalizeCodexEvent(rawEvent: unknown): GatewayNormalizedEvent[] {
  const record = asRecord(rawEvent)
  return record ? normalizeEvent(record) : []
}

export function parseGatewayEvents(raw: string): GatewayParseResult {
  const events: GatewayNormalizedEvent[] = []
  let parsedCount = 0
  let usage: GatewayUsageSummary | undefined
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
  const commands = events.filter((event): event is GatewayCommandEvent => event.kind === 'command' && Boolean(event.command))
  const messages = events.filter((event): event is GatewayMessageEvent => event.kind === 'message' && Boolean(event.text.trim()))
  const statuses = events.filter((event): event is GatewayStatusEvent => event.kind === 'status')
  return { events, commands, messages, statuses, usage, rawTail: raw.trim().slice(-4000), parsedCount }
}

export function formatUsageSummary(usage: GatewayUsageSummary | undefined): string {
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
