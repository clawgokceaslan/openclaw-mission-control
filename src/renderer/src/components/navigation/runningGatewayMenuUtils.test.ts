import { describe, expect, it } from 'vitest'
import { formatRunningGatewayActivitySummary, runningCodexConversationTypeLabel, runningCodexGroupLabel, runningCodexLiveStatusLabel } from './runningGatewayMenuUtils'

describe('running Codex menu helpers', () => {
  it('labels conversation types and live states clearly', () => {
    expect(runningCodexConversationTypeLabel('plan')).toBe('Planlanıyor')
    expect(runningCodexConversationTypeLabel('run')).toBe('Çalışıyor')
    expect(runningCodexConversationTypeLabel('chat')).toBe('Devam ediyor')
    expect(runningCodexConversationTypeLabel('steer')).toBe('Devam ediyor')
    expect(runningCodexConversationTypeLabel('post-run')).toBe('Doğrulanıyor')
    expect(runningCodexConversationTypeLabel('mystery')).toBe('Çalışıyor')
    expect(runningCodexLiveStatusLabel('queued')).toBe('Sırada')
    expect(runningCodexLiveStatusLabel('running')).toBe('Çalışıyor')
    expect(runningCodexGroupLabel('all')).toBe('Tümü')
    expect(runningCodexGroupLabel('planning')).toBe('Planla')
    expect(runningCodexGroupLabel('running')).toBe('Çalıştır')
    expect(runningCodexGroupLabel('postRunning')).toBe('Doğrula')
  })

  it('compacts long activity summaries', () => {
    const summary = formatRunningGatewayActivitySummary('  Working on a long\n\n   conversation summary that should be compacted for the menu  ', 40)

    expect(summary).toBe('Working on a long conversation summary…')
  })
})
