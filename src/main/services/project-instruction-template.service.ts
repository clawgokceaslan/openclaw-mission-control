import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { ProjectInstructionTemplate, ProjectInstructionTemplatePayload } from '../../shared/types/entities.js'
import { STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE, STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE_ID } from '../../shared/constants/project-instruction-templates.js'
import { ProjectInstructionTemplateRepository } from '../../db/repositories/project-instruction-template-repo.js'
import { AuthService } from './auth.service.js'

function normalizeTemplate(value: unknown): ProjectInstructionTemplatePayload {
  const template = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    generalContext: typeof template.generalContext === 'string' ? template.generalContext : '',
    generalPrompt: typeof template.generalPrompt === 'string' ? template.generalPrompt : '',
    planGuide: typeof template.planGuide === 'string' ? template.planGuide : '',
    defaultOutput: typeof template.defaultOutput === 'string' ? template.defaultOutput : '',
    rules: typeof template.rules === 'string' ? template.rules : '',
    postRunPrompt: typeof template.postRunPrompt === 'string' ? template.postRunPrompt : ''
  }
}

function builtInTemplate(orgId: string): ProjectInstructionTemplate {
  const now = 0
  return {
    id: STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE_ID,
    organizationId: orgId,
    name: 'Standard Agentic Project Instructions',
    description: 'A complete default template covering context, prompt, plan guide, output expectations, and rules.',
    template: STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE,
    builtIn: true,
    createdAt: now,
    updatedAt: now
  }
}

export class ProjectInstructionTemplateService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: ProjectInstructionTemplateRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<ProjectInstructionTemplate[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const rows = await this.repo.list(actor.user.organizationId)
    return okResponse([builtInTemplate(actor.user.organizationId), ...rows])
  }

  async create(payload: { actorToken?: string; name?: string; description?: string; template?: ProjectInstructionTemplatePayload }, _meta?: Record<string, unknown>): Promise<ServiceResponse<ProjectInstructionTemplate>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Project instructions template name required')
    return okResponse(await this.repo.create(actor.user.organizationId, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      template: normalizeTemplate(payload.template)
    }))
  }

  async update(payload: { actorToken?: string; id?: string; name?: string; description?: string; template?: ProjectInstructionTemplatePayload }, _meta?: Record<string, unknown>): Promise<ServiceResponse<ProjectInstructionTemplate>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project instructions template id required')
    if (payload.id === STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE_ID) return errorResponse(ErrorCodes.Validation, 'Built-in templates cannot be updated. Save a custom copy instead.')
    if (!payload.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Project instructions template name required')
    const updated = await this.repo.update(actor.user.organizationId, payload.id, {
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      template: normalizeTemplate(payload.template)
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Project instructions template not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project instructions template id required')
    if (payload.id === STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE_ID) return errorResponse(ErrorCodes.Validation, 'Built-in templates cannot be removed')
    await this.repo.remove(actor.user.organizationId, payload.id)
    return okResponse({ ok: true })
  }
}
