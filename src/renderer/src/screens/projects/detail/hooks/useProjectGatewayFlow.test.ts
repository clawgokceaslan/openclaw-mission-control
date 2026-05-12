import { describe, expect, it } from 'vitest'
import { effectiveGatewayChatMode, normalizeLeadingChatCommand, shouldStartNewGatewayChatConversation } from './useProjectGatewayFlow'

describe('normalizeLeadingChatCommand', () => {
  it('parses steer commands and keeps the steer instruction body', () => {
    expect(normalizeLeadingChatCommand('/steer Change direction')).toEqual({
      mode: 'steer',
      message: 'Change direction',
      hadCommand: true
    })
  })

  it('keeps plan command behavior', () => {
    expect(normalizeLeadingChatCommand('  /plan revise scope')).toEqual({
      mode: 'plan',
      message: 'revise scope',
      hadCommand: true
    })
  })

  it('leaves ordinary chat messages unclassified', () => {
    expect(normalizeLeadingChatCommand('Continue normally')).toEqual({
      mode: null,
      message: 'Continue normally',
      hadCommand: false
    })
  })
})

describe('shouldStartNewGatewayChatConversation', () => {
  it('keeps steer messages on the selected conversation even from new-chat mode', () => {
    expect(shouldStartNewGatewayChatConversation(true, 'steer')).toBe(false)
  })

  it('keeps ordinary new chat behavior for chat and plan messages', () => {
    expect(shouldStartNewGatewayChatConversation(true, 'chat')).toBe(true)
    expect(shouldStartNewGatewayChatConversation(true, 'plan')).toBe(true)
    expect(shouldStartNewGatewayChatConversation(false, 'chat')).toBe(false)
  })
})

describe('effectiveGatewayChatMode', () => {
  it('does not rewrite plain messages to steer automatically', () => {
    expect(effectiveGatewayChatMode('chat', true, false)).toBe('chat')
  })

  it('does not rewrite explicit plan or new chat messages', () => {
    expect(effectiveGatewayChatMode('plan', true, false)).toBe('plan')
    expect(effectiveGatewayChatMode('chat', true, true)).toBe('chat')
    expect(effectiveGatewayChatMode('chat', false, false)).toBe('chat')
  })
})
