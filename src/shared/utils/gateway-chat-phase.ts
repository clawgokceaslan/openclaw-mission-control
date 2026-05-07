export const GATEWAY_CHAT_PHASES = ['PLAN', 'RUN', 'POST-RUNNING', 'FOLLOW UP'] as const

export type GatewayChatPhase = typeof GATEWAY_CHAT_PHASES[number]

export type GatewayChatPhaseTone = 'plan' | 'run' | 'post-running' | 'follow-up'
export type GatewayLifecycleStatusKey =
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
export type GatewayLifecycleTone =
  | 'neutral'
  | 'planning'
  | 'planned'
  | 'working'
  | 'completed'
  | 'post-running'
  | 'following-up'
  | 'needs-input'
  | 'failed'
export type GatewayChatLifecycleRawStatus = 'queued' | 'running' | 'completed' | 'failed' | 'event' | undefined
export type GatewayLifecycleStatusMeta = {
  key: GatewayLifecycleStatusKey
  label: string
  tone: GatewayLifecycleTone
  active: boolean
  completed: boolean
}

type PhaseSource = 'gateway-plan' | 'gateway-run' | 'gateway-chat' | string

export type GatewayChatPhaseInput = {
  phase?: unknown
  source?: PhaseSource
  runId?: string
  conversationId?: string
  metadata?: Record<string, unknown>
}

const phaseLookup = new Map<string, GatewayChatPhase>([
  ['plan', 'PLAN'],
  ['planning', 'PLAN'],
  ['gateway-plan', 'PLAN'],
  ['run', 'RUN'],
  ['running', 'RUN'],
  ['gateway-run', 'RUN'],
  ['post-run', 'POST-RUNNING'],
  ['post-running', 'POST-RUNNING'],
  ['post running', 'POST-RUNNING'],
  ['post_running', 'POST-RUNNING'],
  ['follow-up', 'FOLLOW UP'],
  ['follow up', 'FOLLOW UP'],
  ['follow_up', 'FOLLOW UP'],
  ['chat', 'FOLLOW UP'],
  ['gateway-chat', 'FOLLOW UP']
])

export function normalizeGatewayChatPhase(value: unknown): GatewayChatPhase | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  return phaseLookup.get(normalized) ?? null
}

export function gatewayMetadataBlock(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata) return ''
  if (typeof metadata.gatewayBlock === 'string') return metadata.gatewayBlock
  if (typeof metadata.codexBlock === 'string') return metadata.codexBlock
  return ''
}

function isPostRunMessage(input: GatewayChatPhaseInput): boolean {
  const metadata = input.metadata ?? {}
  const gatewayBlock = gatewayMetadataBlock(metadata)
  const parentRunId = typeof metadata.parentRunId === 'string' ? metadata.parentRunId.trim() : ''
  return gatewayBlock === 'post-run-start'
    || gatewayBlock === 'post-run-prompt'
    || Boolean(parentRunId)
}

export function inferGatewayChatPhase(input: GatewayChatPhaseInput): GatewayChatPhase {
  const explicitPhase = normalizeGatewayChatPhase(input.phase)
  if (explicitPhase) return explicitPhase
  const metadataPhase = normalizeGatewayChatPhase(input.metadata?.phase)
  if (metadataPhase) return metadataPhase
  if (input.source === 'gateway-plan') return 'PLAN'
  if (input.source === 'gateway-run') return isPostRunMessage(input) ? 'POST-RUNNING' : 'RUN'
  return 'FOLLOW UP'
}

export function gatewayChatPhaseTone(phase: GatewayChatPhase): GatewayChatPhaseTone {
  if (phase === 'PLAN') return 'plan'
  if (phase === 'RUN') return 'run'
  if (phase === 'POST-RUNNING') return 'post-running'
  return 'follow-up'
}

const lifecycleStatusMeta: Record<GatewayLifecycleStatusKey, GatewayLifecycleStatusMeta> = {
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

export function gatewayLifecycleStatusMeta(status: GatewayLifecycleStatusKey): GatewayLifecycleStatusMeta {
  return lifecycleStatusMeta[status]
}

export function gatewayChatPhaseActionLabel(phase: GatewayChatPhase): string {
  if (phase === 'PLAN') return 'Plan'
  if (phase === 'RUN') return 'Run'
  if (phase === 'POST-RUNNING') return 'Post Run'
  return 'Follow-up'
}

export function gatewayChatLifecycleStatusKey(phase: GatewayChatPhase, status: GatewayChatLifecycleRawStatus, active: boolean): GatewayLifecycleStatusKey {
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

export function gatewayChatPhaseStatusLabel(phase: GatewayChatPhase, running: boolean): string {
  return gatewayLifecycleStatusMeta(gatewayChatLifecycleStatusKey(phase, 'event', running)).label
}
