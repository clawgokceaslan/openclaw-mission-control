import { describe, expect, it } from 'vitest'
import { effectiveGatewayChatMode, normalizeLeadingChatCommand, shouldStartNewGatewayChatConversation } from './useProjectGatewayFlow'

describe('normalizeLeadingChatCommand', () => {
  it('leaves unsupported slash commands as plain chat text', () => {
    expect(normalizeLeadingChatCommand('/unknown Change direction')).toEqual({
      mode: null,
      message: '/unknown Change direction',
      hadCommand: false
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
  it('keeps ordinary new chat behavior for chat and plan messages', () => {
    expect(shouldStartNewGatewayChatConversation(true, 'chat')).toBe(true)
    expect(shouldStartNewGatewayChatConversation(true, 'plan')).toBe(true)
    expect(shouldStartNewGatewayChatConversation(false, 'chat')).toBe(false)
  })
})

describe('effectiveGatewayChatMode', () => {
  it('keeps plain messages in chat mode', () => {
    expect(effectiveGatewayChatMode('chat', true, false)).toBe('chat')
  })

  it('does not rewrite explicit plan or new chat messages', () => {
    expect(effectiveGatewayChatMode('plan', true, false)).toBe('plan')
    expect(effectiveGatewayChatMode('chat', true, true)).toBe('chat')
    expect(effectiveGatewayChatMode('chat', false, false)).toBe('chat')
  })
})
