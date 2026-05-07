import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'

export type GatewayHeaderRefreshMode = 'ignore' | 'debounced' | 'immediate'

type TaskActivityEventPayload = {
  message?: TaskActivityMessage
}

type TaskUpdatedEventPayload = {
  action?: string
}

const GATEWAY_ACTIVITY_SOURCES = new Set<TaskActivityMessage['source']>([
  'gateway-plan',
  'gateway-run',
  'gateway-chat'
])

const IMMEDIATE_TASK_UPDATE_ACTIONS = new Set([
  'activity_complete',
  'codex_plan_state',
  'plan_status_advanced',
  'ready_for_review'
])

function firstPayloadArg(args: unknown[]): unknown {
  return args[1] ?? args[0]
}

function isTaskActivityMessage(value: unknown): value is TaskActivityMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<TaskActivityMessage>
  return typeof message.source === 'string' && GATEWAY_ACTIVITY_SOURCES.has(message.source as TaskActivityMessage['source'])
}

export function gatewayHeaderRefreshModeFromTaskActivityArgs(args: unknown[]): GatewayHeaderRefreshMode {
  const payload = firstPayloadArg(args) as TaskActivityEventPayload | undefined
  const message = payload?.message
  if (!isTaskActivityMessage(message)) return 'ignore'

  const gatewayBlock = typeof message.metadata?.gatewayBlock === 'string' ? message.metadata.gatewayBlock : ''
  if (message.status === 'queued' || message.status === 'running') return 'immediate'
  if (gatewayBlock === 'run-complete' || gatewayBlock === 'post-run-start') return 'immediate'

  return 'debounced'
}

export function gatewayHeaderRefreshModeFromTaskUpdatedArgs(args: unknown[]): GatewayHeaderRefreshMode {
  const payload = firstPayloadArg(args) as TaskUpdatedEventPayload | undefined
  const action = typeof payload?.action === 'string' ? payload.action : ''
  return IMMEDIATE_TASK_UPDATE_ACTIONS.has(action) ? 'immediate' : 'debounced'
}
