import type { RunningCodexConversationType, RunningCodexGroupKey } from '@shared/contracts/ipc'

export function runningCodexConversationTypeLabel(type: RunningCodexConversationType | string): string {
  if (type === 'plan') return 'Planning'
  if (type === 'run') return 'Working'
  if (type === 'steer') return 'Following Up'
  if (type === 'post-run') return 'Post Running'
  if (type === 'chat') return 'Following Up'
  return 'Working'
}

export function runningCodexLiveStatusLabel(status: 'queued' | 'running'): string {
  return status === 'queued' ? 'Queued' : 'Working'
}

export function runningCodexGroupLabel(group: RunningCodexGroupKey): string {
  if (group === 'planning') return 'Planning'
  if (group === 'postRunning') return 'Post Running'
  if (group === 'running') return 'Working'
  return 'All'
}

export function formatRunningCodexActivitySummary(value: string, maxLength = 120): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
}
