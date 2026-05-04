import type { AgentStep } from '@shared/types/entities'

export const AGENT_IMPORT_EXAMPLE = `{
  "name": "Research Agent",
  "title": "Research specialist",
  "description": "Agent scope and boundaries",
  "prompt": "Agent-level operating prompt",
  "tags": ["research", "codex"],
  "steps": [
    {
      "title": "Map context",
      "description": "Read task inputs and relevant project files.",
      "prompt": "Identify the implementation surface before editing."
    }
  ],
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
  steps?: AgentStep[]
  config?: Record<string, unknown>
  warnings: string[]
}

function createImportedStep(raw: Record<string, unknown>, index: number): AgentStep {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-import-${index}`,
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : index
  }
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

  if (source.status !== undefined || source.reasoningLevel !== undefined) {
    patch.warnings.push('status and reasoningLevel are legacy fields and were ignored.')
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

  if (source.steps !== undefined) {
    if (!Array.isArray(source.steps)) {
      return { ok: false, error: 'steps must be an array.' }
    }
    const importedSteps: AgentStep[] = []
    for (const [index, rawStep] of source.steps.entries()) {
      const step = asRecord(rawStep)
      if (!step) return { ok: false, error: `steps[${index}] must be an object.` }
      for (const key of ['title', 'description', 'prompt'] as const) {
        if (step[key] !== undefined && typeof step[key] !== 'string') {
          return { ok: false, error: `steps[${index}].${key} must be a string.` }
        }
      }
      if (step.sortOrder !== undefined && typeof step.sortOrder !== 'number') {
        return { ok: false, error: `steps[${index}].sortOrder must be a number.` }
      }
      importedSteps.push(createImportedStep(step, index))
    }
    patch.steps = importedSteps
  }

  if (source.config !== undefined) {
    const config = asRecord(source.config)
    if (!config) return { ok: false, error: 'config must be an object.' }
    patch.config = { ...config }
  }

  return { ok: true, patch }
}
