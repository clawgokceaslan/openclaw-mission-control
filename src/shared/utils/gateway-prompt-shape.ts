export const GATEWAY_PROMPT_SHAPES = ['markdown', 'json', 'toon'] as const

export type GatewayPromptShape = typeof GATEWAY_PROMPT_SHAPES[number]

export const DEFAULT_GATEWAY_PROMPT_SHAPE: GatewayPromptShape = 'markdown'

export function normalizeGatewayPromptShape(value: unknown): GatewayPromptShape {
  if (typeof value !== 'string') return DEFAULT_GATEWAY_PROMPT_SHAPE
  const normalized = value.trim().toLowerCase()
  return GATEWAY_PROMPT_SHAPES.includes(normalized as GatewayPromptShape)
    ? normalized as GatewayPromptShape
    : DEFAULT_GATEWAY_PROMPT_SHAPE
}
