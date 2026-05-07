import { describe, expect, it } from 'vitest'
import { codexHeaderRefreshModeFromTaskActivityArgs, codexHeaderRefreshModeFromTaskUpdatedArgs } from './codexHeaderRefresh'

describe('Codex header refresh event classification', () => {
  it('forces an immediate source recount when Codex work starts or enters post-run', () => {
    expect(codexHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'start',
        runId: 'run-1',
        source: 'codex-chat',
        role: 'thinking',
        status: 'running',
        body: 'Codex is thinking...',
        createdAt: 1
      }
    }])).toBe('immediate')

    expect(codexHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'post-run',
        runId: 'post-run-1',
        conversationId: 'run-1',
        source: 'codex-run',
        role: 'system',
        status: 'completed',
        body: 'Starting Codex post-run prompt.',
        metadata: { codexBlock: 'post-run-start' },
        createdAt: 2
      }
    }])).toBe('immediate')
  })

  it('keeps streaming Codex updates debounced but recounts terminal events immediately', () => {
    expect(codexHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'stream',
        runId: 'run-1',
        source: 'codex-run',
        role: 'assistant',
        status: 'completed',
        body: 'Partial streamed output.',
        createdAt: 3
      }
    }])).toBe('debounced')

    expect(codexHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'done',
        runId: 'run-1',
        source: 'codex-run',
        role: 'system',
        status: 'completed',
        body: 'Codex run completed.',
        metadata: { codexBlock: 'run-complete' },
        createdAt: 4
      }
    }])).toBe('immediate')
  })

  it('uses taskUpdated lifecycle actions for final recounts', () => {
    expect(codexHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'activity_complete' }])).toBe('immediate')
    expect(codexHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'codex_plan_state' }])).toBe('immediate')
    expect(codexHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'ready_for_review' }])).toBe('immediate')
    expect(codexHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'updated' }])).toBe('debounced')
  })

  it('ignores non-Codex activity messages', () => {
    expect(codexHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'comment',
        runId: 'local-1',
        source: 'comment',
        role: 'system',
        status: 'completed',
        body: 'Comment changed.',
        createdAt: 5
      }
    }])).toBe('ignore')
  })
})
