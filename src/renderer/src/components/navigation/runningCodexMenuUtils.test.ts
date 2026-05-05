import { describe, expect, it } from 'vitest'
import { formatRunningCodexActivitySummary, runningCodexConversationTypeLabel, runningCodexLiveStatusLabel } from './runningCodexMenuUtils'

describe('running Codex menu helpers', () => {
  it('labels conversation types and live states clearly', () => {
    expect(runningCodexConversationTypeLabel('plan')).toBe('Plan')
    expect(runningCodexConversationTypeLabel('run')).toBe('Run')
    expect(runningCodexConversationTypeLabel('chat')).toBe('Chat')
    expect(runningCodexConversationTypeLabel('steer')).toBe('Steer chat')
    expect(runningCodexLiveStatusLabel('queued')).toBe('Queued')
    expect(runningCodexLiveStatusLabel('running')).toBe('Running')
  })

  it('compacts long activity summaries', () => {
    const summary = formatRunningCodexActivitySummary('  Working on a long\n\n   conversation summary that should be compacted for the menu  ', 40)

    expect(summary).toBe('Working on a long conversation summary…')
  })
})
