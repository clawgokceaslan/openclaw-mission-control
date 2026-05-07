import { describe, expect, it } from 'vitest'
import { formatUsageSummary, parseGatewayEvents } from './gateway-events.js'

describe('parseGatewayEvents', () => {
  it('normalizes command executions, agent messages, and usage', () => {
    const result = parseGatewayEvents([
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
    const result = parseGatewayEvents('prefix {"type":"item.started","item":{"type":"command_execution","command":"pwd"}} {"type":')

    expect(result.commands).toHaveLength(1)
    expect(result.commands[0]?.command).toBe('pwd')
    expect(result.events.some((event) => event.kind === 'malformed')).toBe(false)
  })

  it('preserves reasoning timing and unknown events', () => {
    const result = parseGatewayEvents([
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
    const result = parseGatewayEvents([
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

  it('normalizes richer codex session event shapes without losing readable text', () => {
    const result = parseGatewayEvents([
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [
            { type: 'summary_text', text: 'Inspecting chat transcript grouping.' },
            { type: 'summary_text', text: 'Preparing readable work blocks.' }
          ]
        }
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'I found the event stream shape.'
        }
      })
    ].join('\n'))

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toMatchObject({
      role: 'thinking',
      text: 'Inspecting chat transcript grouping.\n\nPreparing readable work blocks.'
    })
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'I found the event stream shape.'
    })
  })
})
