import type { RunningCodexConversationType } from '@shared/contracts/ipc'

export function runningCodexConversationTypeLabel(type: RunningCodexConversationType): string {
  if (type === 'plan') return 'Plan'
  if (type === 'run') return 'Run'
  if (type === 'steer') return 'Steer chat'
  return 'Chat'
}

export function runningCodexLiveStatusLabel(status: 'queued' | 'running'): string {
  return status === 'queued' ? 'Queued' : 'Running'
}

export function formatRunningCodexActivitySummary(value: string, maxLength = 120): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
}
