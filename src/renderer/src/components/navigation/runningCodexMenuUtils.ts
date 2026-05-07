import type { RunningCodexConversationType, RunningCodexGroupKey } from '@shared/contracts/ipc'

export function runningCodexConversationTypeLabel(type: RunningCodexConversationType | string): string {
  if (type === 'plan') return 'Planning'
  if (type === 'run') return 'Run'
  if (type === 'steer') return 'Running'
  if (type === 'post-run') return 'Post Running'
  if (type === 'chat') return 'Running'
  return 'Running'
}

export function runningCodexLiveStatusLabel(status: 'queued' | 'running'): string {
  return status === 'queued' ? 'Queued' : 'Running'
}

export function runningCodexGroupLabel(group: RunningCodexGroupKey): string {
  if (group === 'planning') return 'Planning'
  if (group === 'postRunning') return 'Post Running'
  if (group === 'running') return 'Running'
  return 'All'
}

export function formatRunningCodexActivitySummary(value: string, maxLength = 120): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
}
