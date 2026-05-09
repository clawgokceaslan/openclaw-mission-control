import type { WebServerStatusState } from '@shared/contracts/ipc'

export function webServerStatusLabel(status: WebServerStatusState['status']): string {
  if (status === 'running') return 'Running'
  if (status === 'starting') return 'Starting'
  if (status === 'error') return 'Error'
  return 'Stopped'
}

export function webServerStatusTone(status: WebServerStatusState['status']): 'ok' | 'warn' | 'muted' {
  if (status === 'running') return 'ok'
  if (status === 'error') return 'warn'
  return 'muted'
}

export function webServerLanMessage(status: WebServerStatusState | null): string {
  if (!status) return 'Web server status is not loaded yet.'
  if (status.lanAddresses.length === 0) return 'No LAN IPv4 address was found on this machine.'
  if (!status.lanReachable) return 'LAN addresses are shown for reference only. The server is bound to localhost, so other devices cannot reach it.'
  return 'LAN URLs are available from devices on the same network.'
}

export function webServerPrimaryUrl(status: WebServerStatusState | null): string {
  return status?.localUrl || status?.url || ''
}
