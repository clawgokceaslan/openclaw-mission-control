import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { ProjectStatus, ProjectStatusCategory, StatusTemplate } from '../../shared/types/entities.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { StatusDraft, StatusRepository, defaultStatusDrafts } from '../../db/repositories/status-repo.js'
import { AuthService } from './auth.service.js'

type StatusInput = {
  id?: string
  name?: string
  category?: ProjectStatusCategory
  color?: string
  sortOrder?: number
  isDefault?: boolean
}

function normalizeItems(items: StatusInput[] | undefined): StatusDraft[] {
  if (!Array.isArray(items) || items.length === 0) return defaultStatusDrafts()
  return items.map((item, index) => ({
    id: item.id,
    name: item.name?.trim() || 'Untitled status',
    category: item.category ?? 'active',
    color: item.color,
    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
    isDefault: item.isDefault === true
  }))
}

export class StatusService {
  constructor(
    private readonly auth: AuthService,
    private readonly statuses: StatusRepository,
    private readonly projects: ProjectRepository
  ) {}

  private async requireProject(actorToken: string | undefined, projectId: string): Promise<ServiceResponse<{ orgId: string }>> {
    const actor = await this.auth.requireActor(actorToken)
    const project = await this.projects.get(projectId)
    if (!project) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse({ orgId: actor.user.organizationId })
  }

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<StatusTemplate[]>> {
    return this.listTemplates(payload, _meta)
  }

  async listTemplates(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<StatusTemplate[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.statuses.listTemplates(actor.user.organizationId))
  }

  async createTemplate(payload: { actorToken?: string; name?: string; items?: StatusInput[] }, _meta?: Record<string, unknown>): Promise<ServiceResponse<StatusTemplate>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const name = payload?.name?.trim() || 'Untitled workflow'
    try {
      return okResponse(await this.statuses.createTemplate(actor.user.organizationId, name, normalizeItems(payload?.items)))
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Unable to create template')
    }
  }

  async updateTemplate(payload: { actorToken?: string; id?: string; name?: string; items?: StatusInput[] }, _meta?: Record<string, unknown>): Promise<ServiceResponse<StatusTemplate>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Template id required')
    const actor = await this.auth.requireActor(payload.actorToken)
    try {
      const updated = await this.statuses.updateTemplate(actor.user.organizationId, payload.id, payload.name?.trim() || 'Untitled workflow', normalizeItems(payload.items))
      if (!updated) return errorResponse(ErrorCodes.NotFound, 'Template not found')
      return okResponse(updated)
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Unable to update template')
    }
  }

  async removeTemplate(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Template id required')
    const actor = await this.auth.requireActor(payload.actorToken)
    await this.statuses.removeTemplate(actor.user.organizationId, payload.id)
    return okResponse({ ok: true })
  }

  async getProjectStatuses(payload: { actorToken?: string; projectId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<ProjectStatus[]>> {
    if (!payload?.projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const access = await this.requireProject(payload.actorToken, payload.projectId)
    if (!access.ok || !access.data) return access as ServiceResponse<ProjectStatus[]>
    return okResponse(await this.statuses.ensureProjectDefaults(payload.projectId, access.data.orgId))
  }

  async updateProjectStatuses(payload: { actorToken?: string; projectId?: string; items?: StatusInput[]; mapping?: Record<string, string> }, _meta?: Record<string, unknown>): Promise<ServiceResponse<ProjectStatus[]>> {
    if (!payload?.projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const access = await this.requireProject(payload.actorToken, payload.projectId)
    if (!access.ok || !access.data) return access as ServiceResponse<ProjectStatus[]>
    try {
      return okResponse(await this.statuses.replaceProjectStatuses(payload.projectId, access.data.orgId, normalizeItems(payload.items), payload.mapping ?? {}))
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Unable to update project statuses')
    }
  }

  async applyTemplateToProject(payload: { actorToken?: string; projectId?: string; templateId?: string; mapping?: Record<string, string> }, _meta?: Record<string, unknown>): Promise<ServiceResponse<ProjectStatus[]>> {
    if (!payload?.projectId || !payload.templateId) return errorResponse(ErrorCodes.Validation, 'Project id and template id required')
    const access = await this.requireProject(payload.actorToken, payload.projectId)
    if (!access.ok || !access.data) return access as ServiceResponse<ProjectStatus[]>
    try {
      return okResponse(await this.statuses.applyTemplate(payload.projectId, access.data.orgId, payload.templateId, payload.mapping ?? {}))
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Unable to apply template')
    }
  }
}
