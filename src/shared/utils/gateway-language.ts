export const DEFAULT_GATEWAY_LANGUAGE = 'tr'

export const GATEWAY_LANGUAGE_OPTIONS = [
  {
    value: 'tr',
    label: 'Turkish',
    displayName: 'Turkish (Turkce)'
  },
  {
    value: 'en',
    label: 'English',
    displayName: 'English'
  }
] as const

export type GatewayLanguage = typeof GATEWAY_LANGUAGE_OPTIONS[number]['value']

export type GatewayLanguagePair = {
  inputLanguage: GatewayLanguage
  outputLanguage: GatewayLanguage
}

export function normalizeGatewayLanguage(value: unknown): GatewayLanguage {
  if (typeof value !== 'string') return DEFAULT_GATEWAY_LANGUAGE
  const normalized = value.trim().toLowerCase()
  return GATEWAY_LANGUAGE_OPTIONS.some((option) => option.value === normalized)
    ? normalized as GatewayLanguage
    : DEFAULT_GATEWAY_LANGUAGE
}

export function gatewayLanguageDisplayName(value: unknown): string {
  const normalized = normalizeGatewayLanguage(value)
  return GATEWAY_LANGUAGE_OPTIONS.find((option) => option.value === normalized)?.displayName ?? GATEWAY_LANGUAGE_OPTIONS[0].displayName
}

export function normalizeGatewayLanguagePair(inputLanguage?: unknown, outputLanguage?: unknown, fallback?: unknown): GatewayLanguagePair {
  const normalizedFallback = normalizeGatewayLanguage(fallback)
  return {
    inputLanguage: inputLanguage === undefined || inputLanguage === null || inputLanguage === ''
      ? normalizedFallback
      : normalizeGatewayLanguage(inputLanguage),
    outputLanguage: outputLanguage === undefined || outputLanguage === null || outputLanguage === ''
      ? normalizedFallback
      : normalizeGatewayLanguage(outputLanguage)
  }
}

export const GATEWAY_REASONING_EFFORT_OPTIONS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' }
] as const

export type GatewayReasoningEffort = typeof GATEWAY_REASONING_EFFORT_OPTIONS[number]['value']

export const DEFAULT_GATEWAY_REASONING_EFFORT: GatewayReasoningEffort = 'medium'

export function normalizeGatewayReasoningEffort(value: unknown): GatewayReasoningEffort {
  if (typeof value !== 'string') return DEFAULT_GATEWAY_REASONING_EFFORT
  const normalized = value.trim().toLowerCase()
  return GATEWAY_REASONING_EFFORT_OPTIONS.some((option) => option.value === normalized)
    ? normalized as GatewayReasoningEffort
    : DEFAULT_GATEWAY_REASONING_EFFORT
}

export function gatewayModelSupportsReasoning(model: unknown): boolean {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return false
  const record = model as Record<string, unknown>
  if (record.supportsReasoning === true || record.supports_reasoning === true) return true
  if (Array.isArray(record.reasoningEfforts) || Array.isArray(record.reasoning_efforts)) return true
  const id = typeof record.id === 'string' ? record.id.trim().toLowerCase() : ''
  return /^(gpt-5|o[1-9]|o\d|codex)/.test(id)
}

export function gatewayModelReasoningEfforts(model: unknown): GatewayReasoningEffort[] {
  if (!gatewayModelSupportsReasoning(model)) return []
  const record = model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, unknown> : {}
  const raw = Array.isArray(record.reasoningEfforts)
    ? record.reasoningEfforts
    : Array.isArray(record.reasoning_efforts)
      ? record.reasoning_efforts
      : []
  const normalized = raw
    .map((value) => normalizeGatewayReasoningEffort(value))
    .filter((value, index, items) => items.indexOf(value) === index)
  return normalized.length > 0 ? normalized : GATEWAY_REASONING_EFFORT_OPTIONS.map((option) => option.value)
}
