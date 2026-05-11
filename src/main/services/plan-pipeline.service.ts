import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { PlanPipelineBatch, PlanPipelineRecord, PlanPipelineRunMode, PlanPipelineStatus } from '../../shared/types/entities.js'
import { PlanPipelineRepository } from '../../db/repositories/plan-pipeline-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { TaskRepository } from '../../db/repositories/task-repo.js'
import { AuthService } from './auth.service.js'

export interface CreatePlanPipelineGroupPayload {
  name?: string
  description?: string
  taskIds?: string[]
}

export interface CreatePlanPipelinePayload {
  actorToken?: string
  sourceDraftName?: string
  projectIds?: string[]
  runMode?: PlanPipelineRunMode
  createdByName?: string
  runPipelineOnPlanComplete?: boolean
  groups?: CreatePlanPipelineGroupPayload[]
}

export interface UpdatePlanPipelineBatchPayload {
  actorToken?: string
  id?: string
  runPipelineOnPlanComplete?: boolean
}

export interface UpdatePlanPipelineStatePayload {
  actorToken?: string
  id?: string
  status?: PlanPipelineStatus
  progress?: number
  retryCount?: number
  summaryContext?: string | null
  lastError?: string | null
  completedAt?: number | null
}

export class PlanPipelineService {
  private runPipelineCreator?: (organizationId: string, planBatchId: string, actorToken?: string, createdByName?: string) => Promise<ServiceResponse<{ batch: { id: string } }>>

  constructor(
    private readonly auth: AuthService,
    private readonly repo: PlanPipelineRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly taskRepo: TaskRepository
  ) {}

  setRunPipelineCreator(creator: (organizationId: string, planBatchId: string, actorToken?: string, createdByName?: string) => Promise<ServiceResponse<{ batch: { id: string } }>>): void {
    this.runPipelineCreator = creator
  }

  async list(payload: { actorToken?: string }): Promise<ServiceResponse<PlanPipelineRecord[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(actor.user.organizationId))
  }

  async listBatches(payload: { actorToken?: string }): Promise<ServiceResponse<PlanPipelineBatch[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.listBatches(actor.user.organizationId))
  }

  async createFromGroups(payload: CreatePlanPipelinePayload): Promise<ServiceResponse<PlanPipelineRecord[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const sourceDraftName = payload?.sourceDraftName?.trim()
    if (!sourceDraftName) return errorResponse(ErrorCodes.Validation, 'Pipeline adı gerekli')

    const projectIds = this.normalizeIds(payload?.projectIds)
    if (projectIds.length === 0) return errorResponse(ErrorCodes.Validation, 'En az bir proje seçilmeli')

    const groups = Array.isArray(payload?.groups) ? payload.groups : []
    if (groups.length === 0) return errorResponse(ErrorCodes.Validation, 'En az bir grup gerekli')

    const normalizedGroups = groups.map((group, index) => ({
      name: group.name?.trim() ?? '',
      description: group.description?.trim(),
      taskIds: this.normalizeIds(group.taskIds),
      order: index + 1
    }))
    const emptyGroups = normalizedGroups.filter((group) => !group.name || group.taskIds.length === 0)
    if (emptyGroups.length > 0) {
      return errorResponse(ErrorCodes.Validation, 'Her grup ad ve en az bir task içermeli', { groups: emptyGroups.map((group) => group.order) })
    }

    const allProjects = await this.projectRepo.list(actor.user.organizationId)
    const projectIdSet = new Set(allProjects.map((project) => project.id))
    const invalidProjectIds = projectIds.filter((projectId) => !projectIdSet.has(projectId))
    if (invalidProjectIds.length > 0) return errorResponse(ErrorCodes.Validation, 'Geçersiz proje seçimi', { invalidProjectIds })

    const allTasks = await this.taskRepo.list(actor.user.organizationId)
    const scopedTaskIdSet = new Set(allTasks.filter((task) => projectIds.includes(task.projectId)).map((task) => task.id))
    const selectedTaskIds = normalizedGroups.flatMap((group) => group.taskIds)
    const duplicateTaskIds = selectedTaskIds.filter((taskId, index) => selectedTaskIds.indexOf(taskId) !== index)
    if (duplicateTaskIds.length > 0) return errorResponse(ErrorCodes.Validation, 'Bir task yalnızca tek grupta yer alabilir', { duplicateTaskIds: Array.from(new Set(duplicateTaskIds)) })
    const invalidTaskIds = selectedTaskIds.filter((taskId) => !scopedTaskIdSet.has(taskId))
    if (invalidTaskIds.length > 0) return errorResponse(ErrorCodes.Validation, 'Geçersiz task seçimi', { invalidTaskIds })

    const createdByName = payload?.createdByName?.trim() || actor.user.name || actor.user.email
    const created = await this.repo.createMany(normalizedGroups.map((group) => ({
      organizationId: actor.user.organizationId,
      sourceDraftName,
      groupName: group.name,
      groupDescription: group.description,
      groupOrder: group.order,
      projectIds,
      taskIds: group.taskIds,
      runMode: payload?.runMode === 'silent' ? 'silent' : 'questioned',
      createdByName
    })), {
      organizationId: actor.user.organizationId,
      name: sourceDraftName,
      projectIds,
      runPipelineOnPlanComplete: Boolean(payload?.runPipelineOnPlanComplete),
      createdByName
    })

    return okResponse(created)
  }

  async updateBatch(payload: UpdatePlanPipelineBatchPayload): Promise<ServiceResponse<PlanPipelineBatch>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Plan batch id gerekli')
    const updated = await this.repo.updateBatch({
      organizationId: actor.user.organizationId,
      id: payload.id,
      runPipelineOnPlanComplete: Boolean(payload.runPipelineOnPlanComplete)
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Plan batch bulunamadı')
    return okResponse(updated)
  }

  async updateState(payload: UpdatePlanPipelineStatePayload): Promise<ServiceResponse<PlanPipelineRecord>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Pipeline id gerekli')
    const progress = typeof payload.progress === 'number' ? Math.min(100, Math.max(0, Math.round(payload.progress))) : undefined
    const updated = await this.repo.updateState({
      id: payload.id,
      status: payload.status,
      progress,
      retryCount: typeof payload.retryCount === 'number' ? Math.max(0, Math.round(payload.retryCount)) : undefined,
      summaryContext: payload.summaryContext,
      lastError: payload.lastError,
      completedAt: payload.completedAt
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Pipeline kaydı bulunamadı')
    if (updated.batchId) {
      await this.prepareRunPipelineIfBatchCompleted(actor.user.organizationId, updated.batchId, payload.actorToken, actor.user.name || actor.user.email)
    }
    return okResponse(updated)
  }

  private async prepareRunPipelineIfBatchCompleted(organizationId: string, batchId: string, actorToken?: string, createdByName?: string): Promise<void> {
    if (!this.runPipelineCreator) return
    const batch = await this.repo.getBatch(organizationId, batchId)
    if (!batch || !batch.runPipelineOnPlanComplete || batch.linkedRunPipelineId || batch.status !== 'completed') return
    const created = await this.runPipelineCreator(organizationId, batch.id, actorToken, createdByName)
    if (created.ok && created.data?.batch?.id) {
      await this.repo.updateBatch({
        organizationId,
        id: batch.id,
        runPipelineOnPlanComplete: batch.runPipelineOnPlanComplete,
        linkedRunPipelineId: created.data.batch.id,
        status: batch.status
      })
    }
  }

  private normalizeIds(input: string[] | undefined): string[] {
    if (!Array.isArray(input)) return []
    return Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)))
  }
}
