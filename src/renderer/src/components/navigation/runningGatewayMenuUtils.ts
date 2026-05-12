import type { RunningGatewayConversationType, RunningGatewayGroupKey } from '@shared/contracts/ipc'

export function runningCodexConversationTypeLabel(type: RunningGatewayConversationType | string): string {
  if (type === 'plan') return 'Planlanıyor'
  if (type === 'run') return 'Çalışıyor'
  if (type === 'post-run') return 'Doğrulanıyor'
  if (type === 'chat') return 'Devam ediyor'
  return 'Çalışıyor'
}

export function runningCodexLiveStatusLabel(status: 'queued' | 'running'): string {
  return status === 'queued' ? 'Sırada' : 'Çalışıyor'
}

export function runningCodexGroupLabel(group: RunningGatewayGroupKey): string {
  if (group === 'planning') return 'Planla'
  if (group === 'postRunning') return 'Doğrula'
  if (group === 'running') return 'Çalıştır'
  return 'Tümü'
}

export function formatRunningGatewayActivitySummary(value: string, maxLength = 120): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
}
