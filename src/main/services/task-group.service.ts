import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { TaskGroup } from '../../shared/types/entities.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { TaskGroupRepository } from '../../db/repositories/task-group-repo.js'
import { AuthService } from './auth.service.js'

export class TaskGroupService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: TaskGroupRepository,
    private readonly projectRepo: ProjectRepository
  ) {}

  async list(payload: { actorToken?: string; projectId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskGroup[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const projectId = payload?.projectId?.trim()
    if (!projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')

    const project = await this.projectRepo.get(projectId)
    if (!project) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')

    return okResponse(await this.repo.listByProject(projectId))
  }

  async create(payload: { actorToken?: string; projectId?: string; title?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskGroup>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const projectId = payload?.projectId?.trim()
    const title = payload?.title?.trim()
    if (!projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    if (!title) return errorResponse(ErrorCodes.Validation, 'Task group title required')

    const project = await this.projectRepo.get(projectId)
    if (!project) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')

    return okResponse(await this.repo.create({ projectId, title }))
  }
}
