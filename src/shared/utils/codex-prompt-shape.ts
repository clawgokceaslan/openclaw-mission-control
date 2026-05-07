export const CODEX_PROMPT_SHAPES = ['markdown', 'json', 'toon'] as const

export type CodexPromptShape = typeof CODEX_PROMPT_SHAPES[number]

export const DEFAULT_CODEX_PROMPT_SHAPE: CodexPromptShape = 'markdown'

export function normalizeCodexPromptShape(value: unknown): CodexPromptShape {
  if (typeof value !== 'string') return DEFAULT_CODEX_PROMPT_SHAPE
  const normalized = value.trim().toLowerCase()
  return CODEX_PROMPT_SHAPES.includes(normalized as CodexPromptShape)
    ? normalized as CodexPromptShape
    : DEFAULT_CODEX_PROMPT_SHAPE
}
