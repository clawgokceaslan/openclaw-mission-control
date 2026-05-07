import { describe, expect, it } from 'vitest'
import { formatRunningGatewayActivitySummary, runningCodexConversationTypeLabel, runningCodexGroupLabel, runningCodexLiveStatusLabel } from './runningGatewayMenuUtils'

describe('running Codex menu helpers', () => {
  it('labels conversation types and live states clearly', () => {
    expect(runningCodexConversationTypeLabel('plan')).toBe('Planning')
    expect(runningCodexConversationTypeLabel('run')).toBe('Working')
    expect(runningCodexConversationTypeLabel('chat')).toBe('Following Up')
    expect(runningCodexConversationTypeLabel('steer')).toBe('Following Up')
    expect(runningCodexConversationTypeLabel('post-run')).toBe('Post Running')
    expect(runningCodexConversationTypeLabel('mystery')).toBe('Working')
    expect(runningCodexLiveStatusLabel('queued')).toBe('Queued')
    expect(runningCodexLiveStatusLabel('running')).toBe('Working')
    expect(runningCodexGroupLabel('all')).toBe('All')
    expect(runningCodexGroupLabel('planning')).toBe('Planning')
    expect(runningCodexGroupLabel('running')).toBe('Working')
    expect(runningCodexGroupLabel('postRunning')).toBe('Post Running')
  })

  it('compacts long activity summaries', () => {
    const summary = formatRunningGatewayActivitySummary('  Working on a long\n\n   conversation summary that should be compacted for the menu  ', 40)

    expect(summary).toBe('Working on a long conversation summary…')
  })
})
