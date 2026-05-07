export const DEFAULT_CODEX_LANGUAGE = 'tr'

export const CODEX_LANGUAGE_OPTIONS = [
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

export type CodexLanguage = typeof CODEX_LANGUAGE_OPTIONS[number]['value']

export type CodexLanguagePair = {
  inputLanguage: CodexLanguage
  outputLanguage: CodexLanguage
}

export function normalizeCodexLanguage(value: unknown): CodexLanguage {
  if (typeof value !== 'string') return DEFAULT_CODEX_LANGUAGE
  const normalized = value.trim().toLowerCase()
  return CODEX_LANGUAGE_OPTIONS.some((option) => option.value === normalized)
    ? normalized as CodexLanguage
    : DEFAULT_CODEX_LANGUAGE
}

export function codexLanguageDisplayName(value: unknown): string {
  const normalized = normalizeCodexLanguage(value)
  return CODEX_LANGUAGE_OPTIONS.find((option) => option.value === normalized)?.displayName ?? CODEX_LANGUAGE_OPTIONS[0].displayName
}

export function normalizeCodexLanguagePair(inputLanguage?: unknown, outputLanguage?: unknown, fallback?: unknown): CodexLanguagePair {
  const normalizedFallback = normalizeCodexLanguage(fallback)
  return {
    inputLanguage: inputLanguage === undefined || inputLanguage === null || inputLanguage === ''
      ? normalizedFallback
      : normalizeCodexLanguage(inputLanguage),
    outputLanguage: outputLanguage === undefined || outputLanguage === null || outputLanguage === ''
      ? normalizedFallback
      : normalizeCodexLanguage(outputLanguage)
  }
}

export const CODEX_REASONING_EFFORT_OPTIONS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' }
] as const

export type CodexReasoningEffort = typeof CODEX_REASONING_EFFORT_OPTIONS[number]['value']

export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = 'medium'

export function normalizeCodexReasoningEffort(value: unknown): CodexReasoningEffort {
  if (typeof value !== 'string') return DEFAULT_CODEX_REASONING_EFFORT
  const normalized = value.trim().toLowerCase()
  return CODEX_REASONING_EFFORT_OPTIONS.some((option) => option.value === normalized)
    ? normalized as CodexReasoningEffort
    : DEFAULT_CODEX_REASONING_EFFORT
}

export function codexModelSupportsReasoning(model: unknown): boolean {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return false
  const record = model as Record<string, unknown>
  if (record.supportsReasoning === true || record.supports_reasoning === true) return true
  if (Array.isArray(record.reasoningEfforts) || Array.isArray(record.reasoning_efforts)) return true
  const id = typeof record.id === 'string' ? record.id.trim().toLowerCase() : ''
  return /^(gpt-5|o[1-9]|o\d|codex)/.test(id)
}

export function codexModelReasoningEfforts(model: unknown): CodexReasoningEffort[] {
  if (!codexModelSupportsReasoning(model)) return []
  const record = model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, unknown> : {}
  const raw = Array.isArray(record.reasoningEfforts)
    ? record.reasoningEfforts
    : Array.isArray(record.reasoning_efforts)
      ? record.reasoning_efforts
      : []
  const normalized = raw
    .map((value) => normalizeCodexReasoningEffort(value))
    .filter((value, index, items) => items.indexOf(value) === index)
  return normalized.length > 0 ? normalized : CODEX_REASONING_EFFORT_OPTIONS.map((option) => option.value)
}
