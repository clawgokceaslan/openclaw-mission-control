export const CODEX_CHAT_PHASES = ['PLAN', 'RUN', 'POST-RUNNING', 'FOLLOW UP'] as const

export type CodexChatPhase = typeof CODEX_CHAT_PHASES[number]

export type CodexChatPhaseTone = 'plan' | 'run' | 'post-running' | 'follow-up'
export type CodexLifecycleStatusKey =
  | 'not-planned'
  | 'planning'
  | 'planned'
  | 'working'
  | 'work-completed'
  | 'post-running'
  | 'post-run-completed'
  | 'following-up'
  | 'followed-up'
  | 'needs-input'
  | 'failed'
export type CodexLifecycleTone =
  | 'neutral'
  | 'planning'
  | 'planned'
  | 'working'
  | 'completed'
  | 'post-running'
  | 'following-up'
  | 'needs-input'
  | 'failed'
export type CodexChatLifecycleRawStatus = 'queued' | 'running' | 'completed' | 'failed' | 'event' | undefined
export type CodexLifecycleStatusMeta = {
  key: CodexLifecycleStatusKey
  label: string
  tone: CodexLifecycleTone
  active: boolean
  completed: boolean
}

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

const lifecycleStatusMeta: Record<CodexLifecycleStatusKey, CodexLifecycleStatusMeta> = {
  'not-planned': { key: 'not-planned', label: 'Not Planned', tone: 'neutral', active: false, completed: false },
  planning: { key: 'planning', label: 'Planning', tone: 'planning', active: true, completed: false },
  planned: { key: 'planned', label: 'Planned', tone: 'planned', active: false, completed: true },
  working: { key: 'working', label: 'Working', tone: 'working', active: true, completed: false },
  'work-completed': { key: 'work-completed', label: 'Work Completed', tone: 'completed', active: false, completed: true },
  'post-running': { key: 'post-running', label: 'Post Running', tone: 'post-running', active: true, completed: false },
  'post-run-completed': { key: 'post-run-completed', label: 'Post Run Completed', tone: 'completed', active: false, completed: true },
  'following-up': { key: 'following-up', label: 'Following Up', tone: 'following-up', active: true, completed: false },
  'followed-up': { key: 'followed-up', label: 'Followed Up', tone: 'completed', active: false, completed: true },
  'needs-input': { key: 'needs-input', label: 'Needs Input', tone: 'needs-input', active: false, completed: false },
  failed: { key: 'failed', label: 'Failed', tone: 'failed', active: false, completed: false }
}

export function codexLifecycleStatusMeta(status: CodexLifecycleStatusKey): CodexLifecycleStatusMeta {
  return lifecycleStatusMeta[status]
}

export function codexChatPhaseActionLabel(phase: CodexChatPhase): string {
  if (phase === 'PLAN') return 'Plan'
  if (phase === 'RUN') return 'Run'
  if (phase === 'POST-RUNNING') return 'Post Run'
  return 'Follow-up'
}

export function codexChatLifecycleStatusKey(phase: CodexChatPhase, status: CodexChatLifecycleRawStatus, active: boolean): CodexLifecycleStatusKey {
  if (status === 'failed') return 'failed'
  if (active) {
    if (phase === 'PLAN') return 'planning'
    if (phase === 'RUN') return 'working'
    if (phase === 'POST-RUNNING') return 'post-running'
    return 'following-up'
  }
  if (phase === 'PLAN') return 'planned'
  if (phase === 'RUN') return 'work-completed'
  if (phase === 'POST-RUNNING') return 'post-run-completed'
  return 'followed-up'
}

export function codexChatPhaseStatusLabel(phase: CodexChatPhase, running: boolean): string {
  return codexLifecycleStatusMeta(codexChatLifecycleStatusKey(phase, 'event', running)).label
}
