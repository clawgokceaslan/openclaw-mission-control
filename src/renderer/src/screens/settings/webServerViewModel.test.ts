import { describe, expect, it } from 'vitest'
import type { WebServerStatusState } from '@shared/contracts/ipc'
import { webServerLanMessage, webServerPrimaryUrl, webServerStatusLabel, webServerStatusTone } from './webServerViewModel'

function status(overrides: Partial<WebServerStatusState>): WebServerStatusState {
  return {
    status: 'running',
    host: '127.0.0.1',
    preferredPort: 3000,
    actualPort: 3000,
    url: 'http://127.0.0.1:3000',
    localUrl: 'http://localhost:3000',
    lanAddresses: [],
    lanReachable: false,
    lastError: null,
    updatedAt: 1,
    ...overrides
  }
}

describe('webServerViewModel', () => {
  it('describes localhost LAN addresses as reference-only', () => {
    expect(webServerLanMessage(status({
      lanAddresses: [{ address: '192.168.1.10', url: null }],
      lanReachable: false
    }))).toContain('reference only')
  })

  it('prefers localhost URL for quick actions', () => {
    expect(webServerPrimaryUrl(status({ localUrl: 'http://localhost:3001', url: 'http://127.0.0.1:3001' }))).toBe('http://localhost:3001')
  })

  it('maps status labels and tones without snapshots', () => {
    expect(webServerStatusLabel('error')).toBe('Error')
    expect(webServerStatusTone('error')).toBe('warn')
    expect(webServerStatusTone('running')).toBe('ok')
  })
})
