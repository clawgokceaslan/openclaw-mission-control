import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { ProjectGroup } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { GroupRepository } from '../../db/repositories/group-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'

export class ProjectGroupService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: GroupRepository,
    private readonly projectRepo: ProjectRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<ProjectGroup[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.buildGroupSummaries(actor.user.organizationId))
  }

  async create(
    payload: { actorToken?: string; name?: string; description?: string; projectIds?: string[]; settings?: Record<string, unknown> },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<ProjectGroup>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const name = payload?.name?.trim()
    if (!name) return errorResponse(ErrorCodes.Validation, 'Project group name required')

    const normalizedProjectIds = this.normalizeProjectIds(payload?.projectIds)
    const validationError = await this.validateProjectSelection(actor.user.organizationId, normalizedProjectIds)
    if (validationError) return validationError

    const description = payload?.description?.trim()
    const settings = {
      ...(payload?.settings ?? {}),
      ...(description ? { description } : {})
    }

    const created = await this.repo.create({
      organizationId: actor.user.organizationId,
      name,
      settings
    })

    await this.repo.replaceMembershipsForGroup(created.id, normalizedProjectIds)
    const groups = await this.buildGroupSummaries(actor.user.organizationId)
    const target = groups.find((item) => item.id === created.id) ?? created
    return okResponse(target)
  }

  async update(
    payload: { actorToken?: string; id?: string; name?: string; description?: string; projectIds?: string[]; settings?: Record<string, unknown> },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<ProjectGroup>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project group id required')
    const allGroups = await this.repo.list(actor.user.organizationId)
    const row = allGroups.find((item) => item.id === payload.id)
    if (!row) return errorResponse(ErrorCodes.NotFound, 'Project group not found')

    const allMemberships = await this.repo.listMembershipsByOrganization(actor.user.organizationId)
    const currentProjectIds = allMemberships
      .filter((membership) => membership.projectGroupId === payload.id)
      .map((membership) => membership.projectId)
    const normalizedProjectIds = Array.isArray(payload?.projectIds)
      ? this.normalizeProjectIds(payload.projectIds)
      : currentProjectIds
    const validationError = await this.validateProjectSelection(actor.user.organizationId, normalizedProjectIds, payload.id)
    if (validationError) return validationError

    const nextSettings = {
      ...(payload?.settings ?? row.settings ?? {})
    }
    if (typeof payload?.description === 'string') {
      const normalizedDescription = payload.description.trim()
      if (normalizedDescription) {
        nextSettings.description = normalizedDescription
      } else {
        delete nextSettings.description
      }
    }

    const updated = await this.repo.update(payload.id, {
      name: payload?.name?.trim() || row.name,
      settings: nextSettings
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Project group not found')

    if (Array.isArray(payload?.projectIds)) {
      await this.repo.replaceMembershipsForGroup(payload.id, normalizedProjectIds)
    }
    const groups = await this.buildGroupSummaries(actor.user.organizationId)
    const target = groups.find((item) => item.id === payload.id) ?? updated
    return okResponse(target)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project group id required')
    const all = await this.repo.list(actor.user.organizationId)
    if (!all.find((item) => item.id === payload.id)) return errorResponse(ErrorCodes.NotFound, 'Project group not found')
    await this.repo.removeMembershipsForGroup(payload.id)
    await this.repo.remove(payload.id)
    return okResponse({ ok: true })
  }

  private normalizeProjectIds(input: string[] | undefined): string[] {
    if (!Array.isArray(input)) return []
    const deduped = new Set<string>()
    for (const item of input) {
      if (typeof item !== 'string') continue
      const normalized = item.trim()
      if (!normalized) continue
      deduped.add(normalized)
    }
    return Array.from(deduped)
  }

  private async validateProjectSelection(
    organizationId: string,
    projectIds: string[],
    currentGroupId?: string
  ): Promise<ServiceResponse<ProjectGroup> | null> {
    const allProjects = await this.projectRepo.list(organizationId)
    const projectIdSet = new Set(allProjects.map((project) => project.id))
    const invalidProjectIds = projectIds.filter((projectId) => !projectIdSet.has(projectId))
    if (invalidProjectIds.length > 0) {
      return errorResponse(ErrorCodes.Validation, 'Invalid project selection', { invalidProjectIds })
    }

    const allMemberships = await this.repo.listMembershipsByOrganization(organizationId)
    const conflicts = allMemberships.filter(
      (membership) => projectIds.includes(membership.projectId) && membership.projectGroupId !== currentGroupId
    )
    if (conflicts.length > 0) {
      return errorResponse(ErrorCodes.Conflict, 'Some projects are already grouped', {
        conflicts: conflicts.map((membership) => ({
          projectId: membership.projectId,
          projectGroupId: membership.projectGroupId
        }))
      })
    }

    return null
  }

  private async buildGroupSummaries(organizationId: string): Promise<ProjectGroup[]> {
    const groups = await this.repo.list(organizationId)
    const memberships = await this.repo.listMembershipsByOrganization(organizationId)
    const projectIdsByGroupId = new Map<string, string[]>()

    for (const membership of memberships) {
      const next = projectIdsByGroupId.get(membership.projectGroupId) ?? []
      next.push(membership.projectId)
      projectIdsByGroupId.set(membership.projectGroupId, next)
    }

    return groups.map((group) => {
      const projectIds = projectIdsByGroupId.get(group.id) ?? []
      return {
        ...group,
        projectIds,
        projectCount: projectIds.length
      }
    })
  }
}
