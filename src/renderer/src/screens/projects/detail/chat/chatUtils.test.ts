import { describe, expect, it } from 'vitest'
import type { TaskActivityMessage } from '../types'
import {
  buildChatConversationSummaries,
  codexChangesSummary,
  hasNoChangesMessage,
  thinkingDurationLabel,
  userMessageCount
} from './chatUtils'

function message(overrides: Partial<TaskActivityMessage>): TaskActivityMessage {
  return {
    id: overrides.id ?? `message-${overrides.createdAt ?? 1}`,
    runId: overrides.runId ?? 'conversation-1',
    conversationId: overrides.conversationId ?? overrides.runId ?? 'conversation-1',
    source: overrides.source ?? 'codex-chat',
    role: overrides.role ?? 'assistant',
    status: overrides.status,
    body: overrides.body ?? 'body',
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt
  }
}

describe('chat conversation summaries', () => {
  it('counts only user-sent messages', () => {
    const messages = [
      message({ id: 'user-1', role: 'user', createdAt: 1 }),
      message({ id: 'thinking-1', role: 'thinking', status: 'running', createdAt: 2 }),
      message({ id: 'tool-1', role: 'tool', status: 'completed', createdAt: 3 }),
      message({ id: 'system-1', role: 'system', status: 'completed', createdAt: 4 }),
      message({ id: 'user-2', role: 'user', createdAt: 5 })
    ]

    expect(userMessageCount(messages)).toBe(2)
    expect(buildChatConversationSummaries(messages, 10)[0].count).toBe(2)
  })

  it('uses appended terminal activity to resolve stale conversations', () => {
    const now = 30 * 60 * 1000
    const summaries = buildChatConversationSummaries([
      message({ id: 'stopped-running', runId: 'stopped', conversationId: 'stopped', role: 'thinking', status: 'running', createdAt: 1 }),
      message({ id: 'stopped-terminal', runId: 'stopped', conversationId: 'stopped', role: 'system', status: 'completed', createdAt: 2, metadata: { codexBlock: 'run-complete', stopped: true } }),
      message({ id: 'completed-running', runId: 'completed', conversationId: 'completed', role: 'thinking', status: 'running', createdAt: 3 }),
      message({ id: 'completed-terminal', runId: 'completed', conversationId: 'completed', role: 'system', status: 'completed', createdAt: 4, metadata: { codexBlock: 'run-complete', manuallyResolved: true, resolution: 'completed' } }),
      message({ id: 'failed-running', runId: 'failed', conversationId: 'failed', role: 'thinking', status: 'running', createdAt: 5 }),
      message({ id: 'failed-terminal', runId: 'failed', conversationId: 'failed', role: 'error', status: 'failed', createdAt: 6, metadata: { codexBlock: 'run-complete', manuallyResolved: true, resolution: 'failed' } })
    ], now)

    const statusById = new Map(summaries.map((summary) => [summary.id, summary.status]))
    expect(statusById.get('stopped')).toBe('completed')
    expect(statusById.get('completed')).toBe('completed')
    expect(statusById.get('failed')).toBe('failed')
  })
})

describe('chat utils helpers', () => {
  it('detects explicit no-change tool messages', () => {
    const noChanges = message({
      id: 'changes-none',
      role: 'tool',
      body: 'No workspace changes detected.',
      metadata: { changeHasNoChanges: true, codexBlock: 'changes' }
    })

    expect(hasNoChangesMessage(noChanges)).toBe(true)
    expect(codexChangesSummary(noChanges)).toMatchObject({
      files: 0,
      blocks: 0,
      hasNoChanges: true,
      canRenderCard: false
    })
  })

  it('derives working duration from running started/ended timestamps', () => {
    const startedAt = 1_700_000_000_000
    const thinking = message({
      id: 'thinking-running',
      role: 'thinking',
      status: 'running',
      body: 'Inspecting dependencies',
      metadata: { thinkingStartedAt: startedAt }
    })

    expect(thinkingDurationLabel(thinking, startedAt + 5_500)).toBe('Working for 6 seconds')
  })

  it('derives completed thinking duration from duration_sec metadata', () => {
    const thinking = message({
      id: 'thinking-completed',
      role: 'thinking',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2_100,
      metadata: { thinkingDurationSec: '5' }
    })

    expect(thinkingDurationLabel(thinking)).toBe('Working for 5 seconds')
  })

  it('summarizes patch block counts when metadata is unavailable', () => {
    const changes = message({
      id: 'changes-diff',
      role: 'tool',
      body: [
        'Changes',
        '',
        '```diff',
        'diff --git a/src/a.ts b/src/a.ts',
        'index 111..222 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,2 +1,3 @@',
        '+const a = 1',
        '-const b = 2',
        '@@ -10,2 +11,3 @@',
        '+const c = 3',
        '-const d = 4',
        '```'
      ].join('\n'),
      metadata: { codexBlock: 'changes', unavailable: false }
    })

    expect(codexChangesSummary(changes)).toMatchObject({
      files: 1,
      blocks: 2,
      insertions: 2,
      deletions: 2,
      hasNoChanges: false,
      canRenderCard: true
    })
  })
})
