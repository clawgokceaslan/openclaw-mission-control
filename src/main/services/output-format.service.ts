import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { AgentOutputFormatField, OutputFormat } from '../../shared/types/entities.js'
import { OutputFormatRepository } from '../../db/repositories/output-format-repo.js'
import { AuthService } from './auth.service.js'

function normalizeFields(value: unknown, path = 'root'): { ok: true; fields: AgentOutputFormatField[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: true, fields: [] }
  const seen = new Set<string>()
  const fields: AgentOutputFormatField[] = []
  const allowedTypes = new Set(['string', 'number', 'boolean', 'array'])
  for (const [index, raw] of value.entries()) {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    const defaultValue = typeof item.defaultValue === 'string' ? item.defaultValue.trim() : ''
    const valueType = typeof item.valueType === 'string' && allowedTypes.has(item.valueType) ? item.valueType as AgentOutputFormatField['valueType'] : 'string'
    const children = normalizeFields(item.children, key || `${path}.${index}`)
    if (!children.ok) return children
    if (!key && !description && !defaultValue && children.fields.length === 0) continue
    if (!key) return { ok: false, error: 'Output format key is required when description, default value, or child fields are provided.' }
    if (seen.has(key)) return { ok: false, error: `Duplicate output format key at ${path}: ${key}` }
    seen.add(key)
    fields.push({
      id: typeof item.id === 'string' && item.id ? item.id : `${Date.now()}-${index}`,
      key,
      description,
      defaultValue,
      valueType,
      required: item.required === true,
      children: children.fields
    })
  }
  return { ok: true, fields }
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

  async create(payload: { actorToken?: string; name?: string; description?: string; fields?: AgentOutputFormatField[] }, _meta?: Record<string, unknown>): Promise<ServiceResponse<OutputFormat>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Output format name required')
    const normalized = normalizeFields(payload.fields)
    if (!normalized.ok) return errorResponse(ErrorCodes.Validation, normalized.error)
    return okResponse(await this.repo.create(actor.user.organizationId, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      fields: normalized.fields
    }))
  }

  async update(payload: { actorToken?: string; id?: string; name?: string; description?: string; fields?: AgentOutputFormatField[] }, _meta?: Record<string, unknown>): Promise<ServiceResponse<OutputFormat>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Output format id required')
    if (!payload.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Output format name required')
    const normalized = normalizeFields(payload.fields)
    if (!normalized.ok) return errorResponse(ErrorCodes.Validation, normalized.error)
    const updated = await this.repo.update(actor.user.organizationId, payload.id, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      fields: normalized.fields
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Output format not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Output format id required')
    await this.repo.remove(actor.user.organizationId, payload.id)
    return okResponse({ ok: true })
  }
}
