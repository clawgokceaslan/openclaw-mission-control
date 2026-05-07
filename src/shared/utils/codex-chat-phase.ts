export const CODEX_CHAT_PHASES = ['PLAN', 'RUN', 'POST-RUNNING', 'FOLLOW UP'] as const

export type CodexChatPhase = typeof CODEX_CHAT_PHASES[number]

export type CodexChatPhaseTone = 'plan' | 'run' | 'post-running' | 'follow-up'

type PhaseSource = 'codex-plan' | 'codex-run' | 'codex-chat' | string

export type CodexChatPhaseInput = {
  phase?: unknown
  source?: PhaseSource
  runId?: string
  conversationId?: string
  metadata?: Record<string, unknown>
}

const phaseLookup = new Map<string, CodexChatPhase>([
  ['plan', 'PLAN'],
  ['planning', 'PLAN'],
  ['codex-plan', 'PLAN'],
  ['run', 'RUN'],
  ['running', 'RUN'],
  ['codex-run', 'RUN'],
  ['post-run', 'POST-RUNNING'],
  ['post-running', 'POST-RUNNING'],
  ['post running', 'POST-RUNNING'],
  ['post_running', 'POST-RUNNING'],
  ['follow-up', 'FOLLOW UP'],
  ['follow up', 'FOLLOW UP'],
  ['follow_up', 'FOLLOW UP'],
  ['chat', 'FOLLOW UP'],
  ['codex-chat', 'FOLLOW UP']
])

export function normalizeCodexChatPhase(value: unknown): CodexChatPhase | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  return phaseLookup.get(normalized) ?? null
}

function isPostRunMessage(input: CodexChatPhaseInput): boolean {
  const metadata = input.metadata ?? {}
  const codexBlock = typeof metadata.codexBlock === 'string' ? metadata.codexBlock : ''
  const parentRunId = typeof metadata.parentRunId === 'string' ? metadata.parentRunId.trim() : ''
  return codexBlock === 'post-run-start'
    || codexBlock === 'post-run-prompt'
    || Boolean(parentRunId)
}

export function inferCodexChatPhase(input: CodexChatPhaseInput): CodexChatPhase {
  const explicitPhase = normalizeCodexChatPhase(input.phase)
  if (explicitPhase) return explicitPhase
  const metadataPhase = normalizeCodexChatPhase(input.metadata?.phase)
  if (metadataPhase) return metadataPhase
  if (input.source === 'codex-plan') return 'PLAN'
  if (input.source === 'codex-run') return isPostRunMessage(input) ? 'POST-RUNNING' : 'RUN'
  return 'FOLLOW UP'
}

export function codexChatPhaseTone(phase: CodexChatPhase): CodexChatPhaseTone {
  if (phase === 'PLAN') return 'plan'
  if (phase === 'RUN') return 'run'
  if (phase === 'POST-RUNNING') return 'post-running'
  return 'follow-up'
}

export function codexChatPhaseStatusLabel(phase: CodexChatPhase, running: boolean): string {
  if (!running) return phase
  if (phase === 'PLAN') return 'PLANNING'
  if (phase === 'RUN') return 'RUNNING'
  return phase
}
