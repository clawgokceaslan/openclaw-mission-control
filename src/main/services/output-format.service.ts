import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { AgentOutputFormatField, OutputFormat } from '../../shared/types/entities.js'
import { OutputFormatRepository } from '../../db/repositories/output-format-repo.js'
import { AuthService } from './auth.service.js'

type OutputFormatRole = OutputFormat['formatRole']

function normalizeFormatRole(value: unknown): OutputFormatRole {
  return value === 'input' ? 'input' : 'output'
}

function normalizeFields(value: unknown, _path = 'root'): { ok: true; fields: AgentOutputFormatField[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: true, fields: [] }
  const fields: AgentOutputFormatField[] = []
  const allowedTypes = new Set(['string', 'number', 'boolean', 'array', 'enum'])
  for (const [index, raw] of value.entries()) {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    const defaultValue = typeof item.defaultValue === 'string' ? item.defaultValue.trim() : ''
    const valueType = typeof item.valueType === 'string' && allowedTypes.has(item.valueType) ? item.valueType as AgentOutputFormatField['valueType'] : 'string'
    const enumValues = Array.isArray(item.enumValues)
      ? item.enumValues.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : []
    const children = normalizeFields(item.children, key || `${_path}.${index}`)
    if (!children.ok) return children
    if (!key && !description && !defaultValue && enumValues.length === 0 && children.fields.length === 0) continue
    fields.push({
      id: typeof item.id === 'string' && item.id ? item.id : `${Date.now()}-${index}`,
      key,
      description,
      defaultValue,
      valueType,
      required: item.required === true,
      enumValues,
      children: children.fields
    })
  }
  return { ok: true, fields }
}

function markdownCell(value: unknown): string {
  const text = String(value ?? '').trim()
  return text ? text.replace(/\|/g, '\\|').replace(/\n/g, '<br>') : '-'
}

function sampleValue(field: AgentOutputFormatField): unknown {
  const children = field.children ?? []
  if (children.length > 0) {
    const childObject = children.reduce<Record<string, unknown>>((acc, child) => {
      if (child.key.trim()) acc[child.key.trim()] = sampleValue(child)
      return acc
    }, {})
    return field.valueType === 'array' ? [childObject] : childObject
  }

  const defaultValue = field.defaultValue?.trim() ?? ''
  const description = field.description?.trim() ?? ''
  const valueType = field.valueType ?? 'string'
  if (valueType === 'enum') {
    const values = field.enumValues ?? []
    return defaultValue && values.includes(defaultValue) ? defaultValue : values[0] ?? ''
  }
  if (defaultValue) {
    if (valueType === 'number') {
      const numericValue = Number(defaultValue)
      return Number.isFinite(numericValue) ? numericValue : defaultValue
    }
    if (valueType === 'boolean') return defaultValue === 'true'
    if (valueType === 'array') return defaultValue.split(',').map((item) => item.trim()).filter(Boolean)
    return defaultValue
  }
  if (description) return description
  if (valueType === 'number') return 0
  if (valueType === 'boolean') return false
  if (valueType === 'array') return []
  return ''
}

function flattenFieldRows(fields: AgentOutputFormatField[], prefix = ''): Array<{ path: string; field: AgentOutputFormatField; sample: unknown }> {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.key || 'untitled'}` : field.key || 'untitled'
    return [
      { path, field, sample: sampleValue(field) },
      ...flattenFieldRows(field.children ?? [], path)
    ]
  })
}

function buildInstructionsMarkdown(input: { name: string; description?: string; formatRole?: OutputFormatRole; fields: AgentOutputFormatField[] }): string {
  const rows = flattenFieldRows(input.fields)
  const role = normalizeFormatRole(input.formatRole)
  const contractRows = rows.length > 0
    ? rows.map(({ path, field, sample }) => `| ${markdownCell(path)} | ${markdownCell(field.valueType ?? 'string')} | ${field.required ? 'yes' : 'no'} | ${markdownCell((field.enumValues ?? []).join(', '))} | ${markdownCell(typeof sample === 'object' ? JSON.stringify(sample) : sample)} | ${markdownCell(field.description)} |`).join('\n')
    : '| - | - | no | - | - | - |'

  return `# ${role === 'input' ? 'Input' : 'Output'} Data Format Instructions: ${input.name}

## Metadata
| Field | Value |
| --- | --- |
| Name | ${markdownCell(input.name)} |
| Description | ${markdownCell(input.description)} |
| Type | ${role}-data-format |

## Generation Rules
- ${role === 'input' ? 'Read and validate incoming data matching this format.' : 'Return only valid data matching the sample file format.'}
- Do not include Markdown fences or explanations.
- Include all required fields.
- Use only allowed values for enum fields.
- Preserve the sample file structure and field keys.

## Field Contract
| Path | Type | Required | Allowed Values | Default/Sample | Description |
| --- | --- | --- | --- | --- | --- |
${contractRows}
`
}

export class OutputFormatService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: OutputFormatRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<OutputFormat[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(actor.user.organizationId))
  }

  async create(payload: { actorToken?: string; name?: string; description?: string; formatRole?: OutputFormatRole; fields?: AgentOutputFormatField[] }, _meta?: Record<string, unknown>): Promise<ServiceResponse<OutputFormat>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Data format name required')
    const normalized = normalizeFields(payload.fields)
    if (!normalized.ok) return errorResponse(ErrorCodes.Validation, normalized.error)
    const formatRole = normalizeFormatRole(payload.formatRole)
    return okResponse(await this.repo.create(actor.user.organizationId, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      formatRole,
      fields: normalized.fields,
      instructionsMarkdown: buildInstructionsMarkdown({
        name: payload.name.trim(),
        description: payload.description?.trim() || undefined,
        formatRole,
        fields: normalized.fields
      })
    }))
  }

  async update(payload: { actorToken?: string; id?: string; name?: string; description?: string; formatRole?: OutputFormatRole; fields?: AgentOutputFormatField[] }, _meta?: Record<string, unknown>): Promise<ServiceResponse<OutputFormat>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Data format id required')
    if (!payload.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Data format name required')
    const normalized = normalizeFields(payload.fields)
    if (!normalized.ok) return errorResponse(ErrorCodes.Validation, normalized.error)
    const formatRole = normalizeFormatRole(payload.formatRole)
    const updated = await this.repo.update(actor.user.organizationId, payload.id, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      formatRole,
      fields: normalized.fields,
      instructionsMarkdown: buildInstructionsMarkdown({
        name: payload.name.trim(),
        description: payload.description?.trim() || undefined,
        formatRole,
        fields: normalized.fields
      })
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Data format not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Data format id required')
    await this.repo.remove(actor.user.organizationId, payload.id)
    return okResponse({ ok: true })
  }
}
