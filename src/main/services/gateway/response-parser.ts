export interface NormalizedOpenClawChatResponse {
  text: string
  role?: string
  messageId?: string
  responseId?: string
  raw: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function messagesFrom(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return []
  const direct = value.messages
  if (Array.isArray(direct)) return direct.filter(isRecord)
  const history = value.history
  if (Array.isArray(history)) return history.filter(isRecord)
  if (isRecord(history) && Array.isArray(history.messages)) return history.messages.filter(isRecord)
  const items = value.items
  if (Array.isArray(items)) return items.filter(isRecord)
  return []
}

function messageRole(message: Record<string, unknown>): string {
  return String(message.role ?? message.authorRole ?? message.type ?? '').toLowerCase()
}

function isAssistantMessage(message: Record<string, unknown>): boolean {
  const role = messageRole(message)
  const source = String(message.source ?? message.author ?? message.authorName ?? '').toLowerCase()
  return role.includes('assistant') || role.includes('agent') || role.includes('ai') || source.includes('assistant') || source.includes('agent') || source.includes('openclaw')
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!isRecord(part)) return ''
      const type = String(part.type ?? '').toLowerCase()
      if (type === 'thinking') return ''
      if (type === 'text' || type === 'output_text') {
        const text = part.text ?? part.content
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function normalizeMessage(message: Record<string, unknown>, raw: unknown): NormalizedOpenClawChatResponse {
  const openClawMeta = isRecord(message.__openclaw) ? message.__openclaw : undefined
  return {
    text: contentText(message.content ?? message.message ?? message.text ?? message.body),
    role: typeof message.role === 'string' ? message.role : undefined,
    messageId: typeof message.id === 'string' ? message.id : typeof openClawMeta?.id === 'string' ? openClawMeta.id : undefined,
    responseId: typeof message.responseId === 'string' ? message.responseId : undefined,
    raw
  }
}

export const OpenClawResponseParser = {
  normalize(value: unknown): NormalizedOpenClawChatResponse {
    if (isRecord(value) && isRecord(value.message)) {
      return normalizeMessage(value.message, value)
    }
    const message = [...messagesFrom(value)].reverse().find(isAssistantMessage)
    if (message) return normalizeMessage(message, value)
    return {
      text: '',
      raw: value
    }
  }
}
