import { describe, expect, it } from 'vitest'
import { AGENT_IMPORT_EXAMPLE, parseAgentImportJson } from './agentImport'

describe('parseAgentImportJson', () => {
  it('accepts the new agent schema with tags, prompt, and config', () => {
    const result = parseAgentImportJson(AGENT_IMPORT_EXAMPLE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.name).toBe('Research Agent')
    expect(result.patch.prompt).toContain('Agent-level')
    expect(result.patch.tags).toEqual(['research', 'codex'])
    expect(result.patch.config).toEqual({ executionMode: 'exec' })
  })

  it('rejects invalid tag shapes with a tag-specific error', () => {
    const result = parseAgentImportJson(JSON.stringify({ name: 'Agent', tags: [42] }))

    expect(result).toEqual({ ok: false, error: 'tags[0] must be a string or an object with id or name.' })
  })

  it('ignores legacy status, steps, and reasoningLevel fields while applying active fields', () => {
    const result = parseAgentImportJson(JSON.stringify({
      name: 'Agent',
      status: 'idle',
      reasoningLevel: 'high',
      steps: [{ title: 'Obsolete step' }]
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch).not.toHaveProperty('status')
    expect(result.patch).not.toHaveProperty('reasoningLevel')
    expect(result.patch).not.toHaveProperty('steps')
    expect(result.patch.warnings).toEqual(['status, steps, and reasoningLevel are legacy fields and were ignored.'])
  })
})
