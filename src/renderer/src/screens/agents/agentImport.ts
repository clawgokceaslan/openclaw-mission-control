export const AGENT_IMPORT_EXAMPLE = `{
  "name": "Research Agent",
  "title": "Research specialist",
  "description": "Agent scope and boundaries",
  "prompt": "Agent-level operating prompt",
  "tags": ["research", "codex"],
  "config": {
    "executionMode": "exec"
  }
}`

export type AgentImportPatch = {
  name: string
  title?: string
  description?: string
  prompt?: string
  tags?: string[]
  config?: Record<string, unknown>
  warnings: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseAgentImportJson(value: string): { ok: true; patch: AgentImportPatch } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { ok: false, error: 'Enter valid JSON.' }
  }

  const source = asRecord(parsed)
  if (!source) return { ok: false, error: 'JSON must be an object.' }
  if (typeof source.name !== 'string' || !source.name.trim()) {
    return { ok: false, error: 'JSON must include a non-empty name.' }
  }

  const patch: AgentImportPatch = { name: source.name.trim(), warnings: [] }
  for (const key of ['title', 'description', 'prompt', 'trainingMarkdown'] as const) {
    if (source[key] !== undefined && typeof source[key] !== 'string') {
      return { ok: false, error: `${key} must be a string.` }
    }
  }

  if (typeof source.title === 'string') patch.title = source.title
  if (typeof source.description === 'string') patch.description = source.description
  if (typeof source.prompt === 'string') patch.prompt = source.prompt
  if (typeof source.trainingMarkdown === 'string') patch.prompt = source.trainingMarkdown

  if (source.status !== undefined || source.reasoningLevel !== undefined || source.steps !== undefined) {
    patch.warnings.push('status, steps, and reasoningLevel are legacy fields and were ignored.')
  }

  if (source.tags !== undefined) {
    if (!Array.isArray(source.tags)) {
      return { ok: false, error: 'tags must be an array.' }
    }
    const tags: string[] = []
    for (const [index, rawTag] of source.tags.entries()) {
      if (typeof rawTag === 'string') {
        const tag = rawTag.trim()
        if (tag) tags.push(tag)
        continue
      }
      const tagObject = asRecord(rawTag)
      const tagValue = tagObject && (typeof tagObject.id === 'string' ? tagObject.id : typeof tagObject.name === 'string' ? tagObject.name : '')
      if (tagValue) {
        tags.push(tagValue.trim())
        continue
      }
      return { ok: false, error: `tags[${index}] must be a string or an object with id or name.` }
    }
    patch.tags = Array.from(new Set(tags))
  }

  if (source.config !== undefined) {
    const config = asRecord(source.config)
    if (!config) return { ok: false, error: 'config must be an object.' }
    patch.config = { ...config }
  }

  return { ok: true, patch }
}
