import { describe, expect, it } from 'vitest'
import { formatRunningCodexActivitySummary, runningCodexConversationTypeLabel, runningCodexGroupLabel, runningCodexLiveStatusLabel } from './runningCodexMenuUtils'

describe('running Codex menu helpers', () => {
  it('labels conversation types and live states clearly', () => {
    expect(runningCodexConversationTypeLabel('plan')).toBe('Planning')
    expect(runningCodexConversationTypeLabel('run')).toBe('Run')
    expect(runningCodexConversationTypeLabel('chat')).toBe('Running')
    expect(runningCodexConversationTypeLabel('steer')).toBe('Running')
    expect(runningCodexConversationTypeLabel('post-run')).toBe('Post Running')
    expect(runningCodexConversationTypeLabel('mystery')).toBe('Running')
    expect(runningCodexLiveStatusLabel('queued')).toBe('Queued')
    expect(runningCodexLiveStatusLabel('running')).toBe('Running')
    expect(runningCodexGroupLabel('all')).toBe('All')
    expect(runningCodexGroupLabel('planning')).toBe('Planning')
    expect(runningCodexGroupLabel('running')).toBe('Running')
    expect(runningCodexGroupLabel('postRunning')).toBe('Post Running')
  })

  it('compacts long activity summaries', () => {
    const summary = formatRunningCodexActivitySummary('  Working on a long\n\n   conversation summary that should be compacted for the menu  ', 40)

    expect(summary).toBe('Working on a long conversation summary…')
  })
})
