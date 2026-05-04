import { describe, expect, it } from 'vitest'
import { AGENT_IMPORT_EXAMPLE, parseAgentImportJson } from './agentImport'

describe('parseAgentImportJson', () => {
  it('accepts the new agent schema with tags, prompt, steps, and config', () => {
    const result = parseAgentImportJson(AGENT_IMPORT_EXAMPLE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.name).toBe('Research Agent')
    expect(result.patch.prompt).toContain('Agent-level')
    expect(result.patch.tags).toEqual(['research', 'codex'])
    expect(result.patch.steps?.[0]).toMatchObject({ title: 'Map context', sortOrder: 0 })
    expect(result.patch.config).toEqual({ executionMode: 'exec' })
  })

  it('rejects invalid tag shapes with a tag-specific error', () => {
    const result = parseAgentImportJson(JSON.stringify({ name: 'Agent', tags: [42] }))

    expect(result).toEqual({ ok: false, error: 'tags[0] must be a string or an object with id or name.' })
  })

  it('rejects invalid step shapes with a step-specific error', () => {
    const result = parseAgentImportJson(JSON.stringify({ name: 'Agent', steps: [{ prompt: 42 }] }))

    expect(result).toEqual({ ok: false, error: 'steps[0].prompt must be a string.' })
  })

  it('ignores legacy status and reasoningLevel fields instead of returning active fields', () => {
    const result = parseAgentImportJson(JSON.stringify({ name: 'Agent', status: 'idle', reasoningLevel: 'high' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch).not.toHaveProperty('status')
    expect(result.patch).not.toHaveProperty('reasoningLevel')
    expect(result.patch.warnings).toEqual(['status and reasoningLevel are legacy fields and were ignored.'])
  })
})
