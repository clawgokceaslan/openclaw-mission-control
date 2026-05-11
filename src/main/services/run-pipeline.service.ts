import EventEmitter from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import type {
  PipelineStatusSnapshot,
  PipelineStatusWatchToken,
  RunPipelineGraph,
  RunPipelineItem,
  RunPipelineStatus
} from '../../shared/types/entities.js'
import { RunPipelineRepository } from '../../db/repositories/run-pipeline-repo.js'
import { PlanPipelineRepository } from '../../db/repositories/plan-pipeline-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { TaskRepository } from '../../db/repositories/task-repo.js'
import { AuthService } from './auth.service.js'
import { TaskService } from './task.service.js'

export interface CreateManualRunPipelinePayload {
  actorToken?: string
  name?: string
  projectIds?: string[]
  stages?: Array<{ name?: string; description?: string; taskIds?: string[] }>
}

export class RunPipelineService {
  private readonly launching = new Set<string>()

  constructor(
    private readonly auth: AuthService,
    private readonly repo: RunPipelineRepository,
    private readonly planRepo: PlanPipelineRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly taskRepo: TaskRepository,
    private readonly tasks: TaskService,
    private readonly eventBus: EventEmitter
  ) {
    this.eventBus.on(IPC_CHANNELS.events.taskActivity, (payload) => {
      void this.handleTaskActivity(payload)
    })
  }

  async list(payload: { actorToken?: string }): Promise<ServiceResponse<RunPipelineGraph[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const batches = await this.repo.list(actor.user.organizationId)
    const graphs = await Promise.all(batches.map((batch) => this.repo.get(actor.user.organizationId, batch.id)))
    return okResponse(graphs.filter((item): item is RunPipelineGraph => Boolean(item)))
  }

  async get(payload: { actorToken?: string; id?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Run pipeline id gerekli')
    const graph = await this.repo.get(actor.user.organizationId, payload.id)
    if (!graph) return errorResponse(ErrorCodes.NotFound, 'Run pipeline bulunamadı')
    return okResponse(graph)
  }

  async createManual(payload: CreateManualRunPipelinePayload): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const name = payload?.name?.trim()
    if (!name) return errorResponse(ErrorCodes.Validation, 'Pipeline adı gerekli')
    const projectIds = this.normalizeIds(payload?.projectIds)
    if (projectIds.length === 0) return errorResponse(ErrorCodes.Validation, 'En az bir proje seçilmeli')
    const stages = (payload?.stages ?? []).map((stage, index) => ({
      name: stage.name?.trim() || `Stage ${index + 1}`,
      description: stage.description?.trim(),
      taskIds: this.normalizeIds(stage.taskIds)
    })).filter((stage) => stage.taskIds.length > 0)
    if (stages.length === 0) return errorResponse(ErrorCodes.Validation, 'En az bir task içeren stage gerekli')
    const projectRows = await this.projectRepo.list(actor.user.organizationId)
    const validProjectIds = new Set(projectRows.map((project) => project.id))
    const invalidProjectIds = projectIds.filter((projectId) => !validProjectIds.has(projectId))
    if (invalidProjectIds.length > 0) return errorResponse(ErrorCodes.Validation, 'Geçersiz proje seçimi', { invalidProjectIds })
    const taskRows = await this.taskRepo.listAll(actor.user.organizationId)
    const taskProjectById = new Map(taskRows.filter((task) => projectIds.includes(task.projectId)).map((task) => [task.id, task.projectId]))
    const invalidTaskIds = stages.flatMap((stage) => stage.taskIds).filter((taskId) => !taskProjectById.has(taskId))
    if (invalidTaskIds.length > 0) return errorResponse(ErrorCodes.Validation, 'Geçersiz task seçimi', { invalidTaskIds })
    const graph = await this.repo.create({
      organizationId: actor.user.organizationId,
      name,
      projectIds,
      createdByName: actor.user.name || actor.user.email,
      stages,
      taskProjectById
    })
    this.emitUpdated(graph.batch.id)
    return okResponse(graph)
  }

  async createFromPlanBatch(payload: { actorToken?: string; planBatchId?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return this.createFromPlanBatchForActor(actor.user.organizationId, payload?.planBatchId, payload?.actorToken, actor.user.name || actor.user.email)
  }

  async createFromPlanBatchForActor(organizationId: string, planBatchId: string | undefined, actorToken?: string, createdByName?: string): Promise<ServiceResponse<RunPipelineGraph>> {
    if (!planBatchId) return errorResponse(ErrorCodes.Validation, 'Plan batch id gerekli')
    const existing = (await this.repo.list(organizationId)).find((batch) => batch.sourcePlanBatchId === planBatchId)
    if (existing) {
      const graph = await this.repo.get(organizationId, existing.id)
      return graph ? okResponse(graph) : errorResponse(ErrorCodes.NotFound, 'Run pipeline bulunamadı')
    }
    const batch = await this.planRepo.getBatch(organizationId, planBatchId)
    if (!batch) return errorResponse(ErrorCodes.NotFound, 'Plan batch bulunamadı')
    const records = await this.planRepo.listByBatch(organizationId, planBatchId)
    if (records.length === 0) return errorResponse(ErrorCodes.Validation, 'Plan batch stage içermiyor')
    const taskRows = await this.taskRepo.listAll(organizationId)
    const taskProjectById = new Map(taskRows.map((task) => [task.id, task.projectId]))
    const graph = await this.repo.create({
      organizationId,
      name: `${batch.name} çalıştırma`,
      projectIds: batch.projectIds,
      sourcePlanBatchId: batch.id,
      createdByName,
      stages: records.map((record) => ({
        name: record.groupName,
        description: record.groupDescription,
        taskIds: record.taskIds,
        sourcePlanRecordId: record.id
      })),
      taskProjectById
    })
    await this.planRepo.updateBatch({
      organizationId,
      id: batch.id,
      linkedRunPipelineId: graph.batch.id,
      runPipelineOnPlanComplete: batch.runPipelineOnPlanComplete
    })
    void actorToken
    this.emitUpdated(graph.batch.id)
    return okResponse(graph)
  }

  async start(payload: { actorToken?: string; id?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Run pipeline id gerekli')
    await this.repo.setBatchState(actor.user.organizationId, payload.id, { status: 'running', completedAt: null })
    this.emitUpdated(payload.id)
    await this.launchNext(actor.user.organizationId, payload.id, payload.actorToken)
    return this.get({ actorToken: payload.actorToken, id: payload.id })
  }

  async pause(payload: { actorToken?: string; id?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Run pipeline id gerekli')
    await this.repo.setBatchState(actor.user.organizationId, payload.id, { status: 'paused' })
    this.emitUpdated(payload.id)
    return this.get({ actorToken: payload.actorToken, id: payload.id })
  }

  async resume(payload: { actorToken?: string; id?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    return this.start(payload)
  }

  async cancel(payload: { actorToken?: string; id?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Run pipeline id gerekli')
    const graph = await this.repo.get(actor.user.organizationId, payload.id)
    if (!graph) return errorResponse(ErrorCodes.NotFound, 'Run pipeline bulunamadı')
    await this.repo.setBatchState(actor.user.organizationId, payload.id, { status: 'cancelled', currentItemId: null, currentStageId: null, completedAt: Date.now() })
    await Promise.all(graph.stages.filter((stage) => stage.status !== 'completed').map((stage) => this.repo.setStageState(actor.user.organizationId, stage.id, { status: 'cancelled' })))
    await Promise.all(graph.items.filter((item) => !['completed', 'skipped'].includes(item.status)).map((item) => this.repo.setItemState(actor.user.organizationId, item.id, { status: 'blocked', lastError: 'Pipeline cancelled' })))
    this.emitUpdated(payload.id)
    return this.get({ actorToken: payload.actorToken, id: payload.id })
  }

  async retryItem(payload: { actorToken?: string; id?: string; itemId?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id || !payload.itemId) return errorResponse(ErrorCodes.Validation, 'Pipeline ve item id gerekli')
    const graph = await this.repo.get(actor.user.organizationId, payload.id)
    const item = graph?.items.find((candidate) => candidate.id === payload.itemId)
    if (!graph || !item) return errorResponse(ErrorCodes.NotFound, 'Run item bulunamadı')
    await this.repo.setItemState(actor.user.organizationId, item.id, { status: 'queued', progress: 0, taskGatewayRunId: null, lastError: null, startedAt: null, completedAt: null })
    await this.repo.setStageState(actor.user.organizationId, item.stageId, { status: 'running', progress: 0, completedAt: null })
    await this.repo.setBatchState(actor.user.organizationId, payload.id, { status: 'running', currentItemId: null, currentStageId: null, completedAt: null })
    await this.launchNext(actor.user.organizationId, payload.id, payload.actorToken)
    return this.get({ actorToken: payload.actorToken, id: payload.id })
  }

  async skipItem(payload: { actorToken?: string; id?: string; itemId?: string }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id || !payload.itemId) return errorResponse(ErrorCodes.Validation, 'Pipeline ve item id gerekli')
    const graph = await this.repo.get(actor.user.organizationId, payload.id)
    const item = graph?.items.find((candidate) => candidate.id === payload.itemId)
    if (!graph || !item) return errorResponse(ErrorCodes.NotFound, 'Run item bulunamadı')
    await this.repo.setItemState(actor.user.organizationId, item.id, { status: 'skipped', progress: 100, completedAt: Date.now(), lastError: null })
    await this.repo.setBatchState(actor.user.organizationId, payload.id, { status: 'running', currentItemId: null, currentStageId: null })
    await this.recalculate(actor.user.organizationId, payload.id)
    await this.launchNext(actor.user.organizationId, payload.id, payload.actorToken)
    return this.get({ actorToken: payload.actorToken, id: payload.id })
  }

  async update(payload: { actorToken?: string; id?: string; status?: RunPipelineStatus }): Promise<ServiceResponse<RunPipelineGraph>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Run pipeline id gerekli')
    await this.repo.setBatchState(actor.user.organizationId, payload.id, { status: payload.status })
    this.emitUpdated(payload.id)
    return this.get({ actorToken: payload.actorToken, id: payload.id })
  }

  private async launchNext(organizationId: string, batchId: string, actorToken?: string): Promise<void> {
    if (this.launching.has(batchId)) return
    this.launching.add(batchId)
    try {
      const graph = await this.repo.get(organizationId, batchId)
      if (!graph || !['pending', 'running'].includes(graph.batch.status)) return
      const running = graph.items.find((item) => item.status === 'running')
      if (running) return
      const next = await this.repo.nextQueuedItem(organizationId, batchId)
      if (!next) {
        await this.completeIfDone(organizationId, batchId)
        return
      }
      await this.repo.setBatchState(organizationId, batchId, { status: 'running', currentStageId: next.stageId, currentItemId: next.id })
      await this.repo.setStageState(organizationId, next.stageId, { status: 'running' })
      await this.repo.setItemState(organizationId, next.id, { status: 'running', progress: 1, attempt: next.attempt + 1, startedAt: Date.now(), completedAt: null, lastError: null })
      const started = await this.tasks.runGatewayForTask({ actorToken, taskId: next.taskId })
      if (!started.ok) {
        await this.blockOnItemFailure(organizationId, batchId, next, started.error?.message ?? 'Task çalıştırılamadı')
        return
      }
      await this.repo.setItemState(organizationId, next.id, { taskGatewayRunId: started.data?.runId ?? null })
      this.emitUpdated(batchId)
    } finally {
      this.launching.delete(batchId)
    }
  }

  private async handleTaskActivity(payload: unknown): Promise<void> {
    const message = payload && typeof payload === 'object' ? (payload as { message?: { runId?: unknown; status?: unknown; body?: unknown } }).message : undefined
    const runId = typeof message?.runId === 'string' ? message.runId : ''
    if (!runId) return
    const item = await this.repo.getByGatewayRunId(runId)
    if (!item) return
    if (message?.status === 'completed') {
      await this.repo.setItemState(item.organizationId, item.id, { status: 'completed', progress: 100, completedAt: Date.now(), lastError: null })
      await this.recalculate(item.organizationId, item.batchId)
      const graph = await this.repo.get(item.organizationId, item.batchId)
      if (graph?.batch.status === 'running') await this.launchNext(item.organizationId, item.batchId)
      return
    }
    if (message?.status === 'failed') {
      await this.blockOnItemFailure(item.organizationId, item.batchId, item, typeof message.body === 'string' ? message.body : 'Task failed')
    }
  }

  private async blockOnItemFailure(organizationId: string, batchId: string, item: RunPipelineItem, error: string): Promise<void> {
    await this.repo.setItemState(organizationId, item.id, { status: 'failed', progress: 100, lastError: error, completedAt: Date.now() })
    await this.repo.setStageState(organizationId, item.stageId, { status: 'blocked' })
    await this.repo.setBatchState(organizationId, batchId, { status: 'blocked', currentItemId: item.id, currentStageId: item.stageId })
    this.emitUpdated(batchId)
  }

  private async recalculate(organizationId: string, batchId: string): Promise<void> {
    const graph = await this.repo.get(organizationId, batchId)
    if (!graph) return
    for (const stage of graph.stages) {
      const items = graph.items.filter((item) => item.stageId === stage.id)
      const done = items.filter((item) => item.status === 'completed' || item.status === 'skipped').length
      const failed = items.some((item) => item.status === 'failed' || item.status === 'blocked')
      const running = items.some((item) => item.status === 'running')
      const progress = items.length ? Math.round((done / items.length) * 100) : 0
      await this.repo.setStageState(organizationId, stage.id, {
        status: failed ? 'blocked' : done === items.length ? 'completed' : running ? 'running' : 'pending',
        progress,
        completedAt: done === items.length ? Date.now() : null
      })
    }
    await this.completeIfDone(organizationId, batchId)
  }

  private async completeIfDone(organizationId: string, batchId: string): Promise<void> {
    const graph = await this.repo.get(organizationId, batchId)
    if (!graph) return
    const done = graph.items.filter((item) => item.status === 'completed' || item.status === 'skipped').length
    const progress = graph.items.length ? Math.round((done / graph.items.length) * 100) : 0
    const hasFailure = graph.items.some((item) => item.status === 'failed' || item.status === 'blocked')
    const hasQueued = graph.items.some((item) => item.status === 'queued' || item.status === 'running')
    await this.repo.setBatchState(organizationId, batchId, {
      status: hasFailure ? 'blocked' : hasQueued ? graph.batch.status : 'completed',
      progress,
      currentItemId: hasQueued ? graph.batch.currentItemId ?? null : null,
      currentStageId: hasQueued ? graph.batch.currentStageId ?? null : null,
      completedAt: !hasQueued && !hasFailure ? Date.now() : graph.batch.completedAt ?? null
    })
    this.emitUpdated(batchId)
  }

  private emitUpdated(batchId: string): void {
    this.eventBus.emit(IPC_CHANNELS.events.runPipelineUpdated, { batchId, updatedAt: Date.now() })
  }

  private normalizeIds(input: string[] | undefined): string[] {
    if (!Array.isArray(input)) return []
    return Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)))
  }
}

export class PipelineStatusService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: RunPipelineRepository,
    private readonly planRepo: PlanPipelineRepository
  ) {}

  async snapshot(payload: { actorToken?: string; runPipelineId?: string }): Promise<ServiceResponse<PipelineStatusSnapshot>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const pipelines = await this.resolvePipelines(actor.user.organizationId, payload?.runPipelineId)
    const planBatches = payload?.runPipelineId ? [] : await this.planRepo.listBatches(actor.user.organizationId)
    const planRecords = payload?.runPipelineId ? [] : await this.planRepo.list(actor.user.organizationId)
    return okResponse({ generatedAt: Date.now(), scope: payload?.runPipelineId ? 'run_pipeline' : 'all', planBatches, planRecords, pipelines })
  }

  async createWatchToken(payload: { actorToken?: string; label?: string; runPipelineId?: string; expiresAt?: number | null }): Promise<ServiceResponse<{ token: string; record: PipelineStatusWatchToken }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const token = `ps_${randomBytes(24).toString('base64url')}`
    const record = await this.repo.createStatusToken({
      organizationId: actor.user.organizationId,
      tokenHash: this.hashToken(token),
      scope: payload?.runPipelineId ? 'run_pipeline' : 'all',
      scopeId: payload?.runPipelineId,
      label: payload?.label?.trim() || 'TV status board',
      expiresAt: payload?.expiresAt ?? undefined
    })
    return okResponse({ token, record })
  }

  async revokeWatchToken(payload: { actorToken?: string; id?: string }): Promise<ServiceResponse<{ revoked: boolean }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Token id gerekli')
    await this.repo.revokeStatusToken(actor.user.organizationId, payload.id)
    return okResponse({ revoked: true })
  }

  async publicSnapshot(payload: { token?: string }): Promise<ServiceResponse<PipelineStatusSnapshot>> {
    const token = payload?.token?.trim()
    if (!token) {
      const batches = await this.repo.listAll()
      const graphs = await Promise.all(batches.map((batch) => this.repo.get(batch.organizationId, batch.id)))
      const planBatches = await this.planRepo.listAllBatches()
      const planRecords = await this.planRepo.listAll()
      return okResponse({
        generatedAt: Date.now(),
        scope: 'all',
        planBatches,
        planRecords,
        pipelines: graphs.filter((item): item is RunPipelineGraph => Boolean(item))
      })
    }
    const record = await this.repo.getStatusTokenByHash(this.hashToken(token))
    if (!record || record.revokedAt) return errorResponse(ErrorCodes.Forbidden, 'Watch token invalid')
    if (record.expiresAt && record.expiresAt <= Date.now()) return errorResponse(ErrorCodes.Forbidden, 'Watch token expired')
    const pipelines = await this.resolvePipelines(record.organizationId, record.scope === 'run_pipeline' ? record.scopeId : undefined)
    const planBatches = record.scope === 'run_pipeline' ? [] : await this.planRepo.listBatches(record.organizationId)
    const planRecords = record.scope === 'run_pipeline' ? [] : await this.planRepo.list(record.organizationId)
    return okResponse({ generatedAt: Date.now(), scope: record.scope, planBatches, planRecords, pipelines })
  }

  private async resolvePipelines(organizationId: string, runPipelineId?: string): Promise<RunPipelineGraph[]> {
    if (runPipelineId) {
      const graph = await this.repo.get(organizationId, runPipelineId)
      return graph ? [graph] : []
    }
    const batches = await this.repo.list(organizationId)
    const graphs = await Promise.all(batches.map((batch) => this.repo.get(organizationId, batch.id)))
    return graphs.filter((item): item is RunPipelineGraph => Boolean(item))
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
