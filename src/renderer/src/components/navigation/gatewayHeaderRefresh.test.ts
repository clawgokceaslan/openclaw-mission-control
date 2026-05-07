import { describe, expect, it } from 'vitest'
import { gatewayHeaderRefreshModeFromTaskActivityArgs, gatewayHeaderRefreshModeFromTaskUpdatedArgs } from './gatewayHeaderRefresh'

describe('Codex header refresh event classification', () => {
  it('forces an immediate source recount when Codex work starts or enters post-run', () => {
    expect(gatewayHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'start',
        runId: 'run-1',
        source: 'gateway-chat',
        role: 'thinking',
        status: 'running',
        body: 'Codex is thinking...',
        createdAt: 1
      }
    }])).toBe('immediate')

    expect(gatewayHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'post-run',
        runId: 'post-run-1',
        conversationId: 'run-1',
        source: 'gateway-run',
        role: 'system',
        status: 'completed',
        body: 'Starting Codex post-run prompt.',
        metadata: { gatewayBlock: 'post-run-start' },
        createdAt: 2
      }
    }])).toBe('immediate')
  })

  it('keeps streaming Codex updates debounced but recounts terminal events immediately', () => {
    expect(gatewayHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'stream',
        runId: 'run-1',
        source: 'gateway-run',
        role: 'assistant',
        status: 'completed',
        body: 'Partial streamed output.',
        createdAt: 3
      }
    }])).toBe('debounced')

    expect(gatewayHeaderRefreshModeFromTaskActivityArgs([{
      message: {
        id: 'done',
        runId: 'run-1',
        source: 'gateway-run',
        role: 'system',
        status: 'completed',
        body: 'Codex run completed.',
        metadata: { gatewayBlock: 'run-complete' },
        createdAt: 4
      }
    }])).toBe('immediate')
  })

  it('uses taskUpdated lifecycle actions for final recounts', () => {
    expect(gatewayHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'activity_complete' }])).toBe('immediate')
    expect(gatewayHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'codex_plan_state' }])).toBe('immediate')
    expect(gatewayHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'ready_for_review' }])).toBe('immediate')
    expect(gatewayHeaderRefreshModeFromTaskUpdatedArgs([{ action: 'updated' }])).toBe('debounced')
  })

  it('ignores non-Codex activity messages', () => {
    expect(gatewayHeaderRefreshModeFromTaskActivityArgs([{
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
