import { describe, expect, it } from 'vitest'
import { formatUsageSummary, parseCodexEvents } from './codex-events.js'

describe('parseCodexEvents', () => {
  it('normalizes command executions, agent messages, and usage', () => {
    const result = parseCodexEvents([
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          status: 'completed',
          command: 'npm test',
          aggregated_output: 'ok',
          exit_code: 0
        }
      }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 1200,
          input_tokens_details: { cached_tokens: 300 },
          output_tokens: 80,
          output_tokens_details: { reasoning_tokens: 25 },
          total_tokens: 1280
        }
      })
    ].join('\n'))

    expect(result.commands).toHaveLength(1)
    expect(result.commands[0]).toMatchObject({ command: 'npm test', status: 'completed', exitCode: 0 })
    expect(result.messages[0]).toMatchObject({ role: 'assistant', text: 'Done.' })
    expect(formatUsageSummary(result.usage)).toBe('1,200 input · 300 cached · 80 output · 25 reasoning · 1,280 total')
  })

  it('handles concatenated and malformed fragments gracefully', () => {
    const result = parseCodexEvents('prefix {"type":"item.started","item":{"type":"command_execution","command":"pwd"}} {"type":')

    expect(result.commands).toHaveLength(1)
    expect(result.commands[0]?.command).toBe('pwd')
    expect(result.events.some((event) => event.kind === 'malformed')).toBe(false)
  })

  it('preserves reasoning timing and unknown events', () => {
    const result = parseCodexEvents([
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'reasoning',
          text: 'Checking the implementation path.',
          duration_ms: 2400
        }
      }),
      JSON.stringify({ type: 'custom.event', payload: { line: 'raw log' } })
    ].join('\n'))

    expect(result.messages[0]).toMatchObject({
      role: 'thinking',
      text: 'Checking the implementation path.',
      durationMs: 2400
    })
    expect(result.events.some((event) => event.kind === 'raw' && event.text.includes('custom.event'))).toBe(true)
  })

  it('normalizes reasoning_summary with startedAt/endedAt variants and duration_sec', () => {
    const result = parseCodexEvents([
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'reasoning_summary',
          summary: 'Completed the work.',
          duration_sec: '5.2',
          startedAt: '1700000000000',
          endedAt: 1700000003000
        }
      }),
      JSON.stringify({ type: 'item.completed', item: { type: 'reasoning_summary', summary: '', duration_ms: 1200 } })
    ].join('\n'))

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      role: 'thinking',
      text: 'Completed the work.',
      durationMs: 5200
    })
    expect(result.messages[0]?.startedAt).toBe(1700000000000)
    expect(result.messages[0]?.endedAt).toBe(1700000003000)
  })
})
