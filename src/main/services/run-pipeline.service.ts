import EventEmitter from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import type {
  PipelineStatusRunState,
  PipelineStatusRunSummary,
  PipelineStatusSnapshot,
  PipelineStatusWatchToken,
  PipelineStatusProjectSummary,
  PipelineStatusTaskSummary,
  PlanPipelineBatch,
  PlanPipelineRecord,
  RunPipelineGraph,
  RunPipelineItem,
  RunPipelineStatus,
  TaskEntity
} from '../../shared/types/entities.js'
import { inferGatewayChatPhase, type GatewayChatPhase } from '../../shared/utils/gateway-chat-phase.js'
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
    const graph = await this.repo.get(actor.user.organizationId, payload.id)
    if (!graph) return errorResponse(ErrorCodes.NotFound, 'Run pipeline bulunamadı')
    await this.repo.setBatchState(actor.user.organizationId, payload.id, { status: 'paused' })
    const active = graph.items.find((item) => item.status === 'running' && item.taskGatewayRunId)
    if (active?.taskGatewayRunId) {
      await this.repo.setItemState(actor.user.organizationId, active.id, { status: 'queued', progress: 0, taskGatewayRunId: null, lastError: 'Paused by user', startedAt: null, completedAt: null })
      await this.repo.setStageState(actor.user.organizationId, active.stageId, { status: 'paused' })
      await this.stopGatewayConversationBestEffort(payload.actorToken, active.taskId, active.taskGatewayRunId)
    }
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
    const active = graph.items.find((item) => item.status === 'running' && item.taskGatewayRunId)
    if (active?.taskGatewayRunId) {
      await this.stopGatewayConversationBestEffort(payload.actorToken, active.taskId, active.taskGatewayRunId)
    }
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
    const graph = await this.repo.get(item.organizationId, item.batchId)
    if (!graph || graph.batch.status === 'paused' || graph.batch.status === 'cancelled') return
    if (message?.status === 'completed') {
      await this.repo.setItemState(item.organizationId, item.id, { status: 'completed', progress: 100, completedAt: Date.now(), lastError: null })
      await this.recalculate(item.organizationId, item.batchId)
      const latestGraph = await this.repo.get(item.organizationId, item.batchId)
      if (latestGraph?.batch.status === 'running') await this.launchNext(item.organizationId, item.batchId)
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

  private async stopGatewayConversationBestEffort(actorToken: string | undefined, taskId: string, conversationId: string): Promise<void> {
    try {
      await this.tasks.stopGatewayConversation({ actorToken, taskId, conversationId })
    } catch {
      // Pausing or cancelling the pipeline state should still complete if the Codex process is already gone.
    }
  }

  private emitUpdated(batchId: string): void {
    this.eventBus.emit(IPC_CHANNELS.events.runPipelineUpdated, { batchId, updatedAt: Date.now() })
  }

  private normalizeIds(input: string[] | undefined): string[] {
    if (!Array.isArray(input)) return []
    return Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)))
  }
}

type PipelineActivityPhase = NonNullable<PipelineStatusTaskSummary['activityPhase']>
type PipelineActivityStatus = NonNullable<PipelineStatusTaskSummary['activityStatus']>
type TaskActivityMessageRecord = Record<string, unknown>

const RECENT_STANDALONE_RUN_MS = 6 * 60 * 60 * 1000

function phaseToPipelineActivityPhase(phase: GatewayChatPhase): PipelineActivityPhase {
  if (phase === 'PLAN') return 'plan'
  if (phase === 'RUN') return 'run'
  if (phase === 'POST-RUNNING') return 'post-running'
  return 'follow-up'
}

function pipelineActivityLabel(phase: PipelineActivityPhase, status: PipelineActivityStatus): string {
  if (status === 'planned') return 'Plan ready'
  if (status === 'needs-input') return 'Needs input'
  if (status === 'completed') {
    if (phase === 'plan') return 'Plan completed'
    if (phase === 'run') return 'Run completed'
    if (phase === 'post-running') return 'Post-run completed'
    return 'Follow-up completed'
  }
  if (status === 'failed') {
    if (phase === 'plan') return 'Plan failed'
    if (phase === 'run') return 'Run failed'
    if (phase === 'post-running') return 'Post-run failed'
    return 'Follow-up failed'
  }
  if (phase === 'plan') return status === 'queued' ? 'Planning queued' : 'Planning'
  if (phase === 'run') return status === 'queued' ? 'Run queued' : 'Running'
  if (phase === 'post-running') return status === 'queued' ? 'Post-run queued' : 'Post-run'
  return status === 'queued' ? 'Follow-up queued' : 'Follow-up'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function taskActivityMessages(task: TaskEntity): Record<string, unknown>[] {
  const messages = asRecord(task.payload).activityMessages
  return Array.isArray(messages)
    ? messages.filter((message): message is Record<string, unknown> => Boolean(message && typeof message === 'object' && !Array.isArray(message)))
    : []
}

function messageTime(message: TaskActivityMessageRecord): number {
  return typeof message.updatedAt === 'number'
    ? message.updatedAt
    : typeof message.createdAt === 'number'
      ? message.createdAt
      : 0
}

function messageString(message: TaskActivityMessageRecord, key: string): string {
  const value = message[key]
  return typeof value === 'string' ? value : ''
}

function messageMetadata(message: TaskActivityMessageRecord): Record<string, unknown> {
  return asRecord(message.metadata)
}

function isGatewayActivityMessage(message: TaskActivityMessageRecord): boolean {
  const source = messageString(message, 'source')
  return source === 'gateway-plan' || source === 'gateway-run' || source === 'gateway-chat'
}

function isFreshRuntimeMessage(message: TaskActivityMessageRecord, now: number): boolean {
  const status = typeof message.status === 'string' ? message.status : ''
  if (status !== 'running' && status !== 'queued') return false
  const at = messageTime(message)
  return at > 0 && now - at <= 15 * 60 * 1000
}

function normalizeRunState(status: unknown): PipelineStatusRunState {
  if (typeof status !== 'string') return 'event'
  const value = status.trim().toLowerCase()
  if (
    value === 'pending'
    || value === 'queued'
    || value === 'running'
    || value === 'completed'
    || value === 'failed'
    || value === 'blocked'
    || value === 'paused'
    || value === 'cancelled'
    || value === 'skipped'
    || value === 'planned'
    || value === 'needs-input'
  ) {
    return value
  }
  if (value === 'waiting') return 'queued'
  if (value === 'needs-clarification') return 'needs-input'
  return 'event'
}

function taskRunStatusFromMessages(messages: TaskActivityMessageRecord[], now: number): PipelineStatusRunState {
  const latest = [...messages].sort((a, b) => messageTime(b) - messageTime(a))[0]
  if (!latest) return 'event'
  const latestStatus = normalizeRunState(latest.status)
  if ((latestStatus === 'running' || latestStatus === 'queued') && isFreshRuntimeMessage(latest, now)) return latestStatus
  const hasFailed = messages.some((message) => {
    const metadata = messageMetadata(message)
    return normalizeRunState(message.status) === 'failed'
      || messageString(message, 'role') === 'error'
      || normalizeRunState(metadata.runStatus) === 'failed'
  })
  if (hasFailed) return 'failed'
  const hasCompleted = messages.some((message) => normalizeRunState(message.status) === 'completed')
  if (hasCompleted) return 'completed'
  return latestStatus
}

function compactProgressText(message: TaskActivityMessageRecord | undefined, fallback: string): string {
  const rawBody = typeof message?.body === 'string' ? message.body.trim() : ''
  if (!rawBody || message?.role === 'user') return fallback
  const firstLine = rawBody.split(/\r?\n/).find(Boolean) ?? rawBody
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine
}

function taskRunStatusItems(task: TaskEntity, projectName: string | undefined, now: number): PipelineStatusRunSummary[] {
  const groups = new Map<string, TaskActivityMessageRecord[]>()
  for (const message of taskActivityMessages(task)) {
    if (!isGatewayActivityMessage(message)) continue
    const runId = messageString(message, 'runId')
    const conversationId = messageString(message, 'conversationId') || runId || messageString(message, 'id')
    const key = conversationId || runId || `${task.id}:${messageTime(message)}`
    groups.set(key, [...(groups.get(key) ?? []), message])
  }
  return Array.from(groups.entries()).map(([conversationId, messages]) => {
    const ordered = [...messages].sort((a, b) => messageTime(a) - messageTime(b))
    const latest = ordered[ordered.length - 1]
    const phase = phaseToPipelineActivityPhase(inferGatewayChatPhase(latest))
    const status = taskRunStatusFromMessages(ordered, now)
    const updatedAt = Math.max(...ordered.map(messageTime), task.updatedAt)
    const startedAt = Math.min(...ordered.map(messageTime).filter((time) => time > 0))
    const fallback = pipelineActivityLabel(phase, status === 'planned' || status === 'needs-input' || status === 'queued' || status === 'running' || status === 'completed' || status === 'failed' ? status : 'event')
    const errorMessage = [...ordered].reverse().find((message) => normalizeRunState(message.status) === 'failed' || messageString(message, 'role') === 'error')
    return {
      id: `task:${task.id}:${conversationId}`,
      source: 'single-task',
      sourceId: conversationId,
      title: task.title,
      phase,
      status,
      startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
      completedAt: status === 'completed' || status === 'failed' ? updatedAt : undefined,
      updatedAt,
      taskId: task.id,
      projectId: task.projectId,
      projectName,
      taskTitle: task.title,
      conversationId,
      runId: messageString(latest, 'runId') || conversationId,
      progressText: compactProgressText(latest, fallback),
      error: errorMessage ? compactProgressText(errorMessage, 'Task run failed') : undefined
    }
  }).filter((item) => (
    item.status === 'running'
    || item.status === 'queued'
    || now - item.updatedAt <= RECENT_STANDALONE_RUN_MS
  )).sort((a, b) => b.updatedAt - a.updatedAt)
}

function runtimeSummaryForTask(task: TaskEntity, now: number): Pick<PipelineStatusTaskSummary, 'activityPhase' | 'activityStatus' | 'conversationId' | 'runId' | 'lastActivityAt' | 'activityLabel'> | null {
  const activeMessage = taskActivityMessages(task)
    .filter((message) => isFreshRuntimeMessage(message, now))
    .sort((a, b) => messageTime(b) - messageTime(a))[0]
  if (activeMessage) {
    const phase = phaseToPipelineActivityPhase(inferGatewayChatPhase(activeMessage))
    const status = activeMessage.status === 'queued' ? 'queued' : 'running'
    const runId = typeof activeMessage.runId === 'string' ? activeMessage.runId : undefined
    const conversationId = typeof activeMessage.conversationId === 'string' ? activeMessage.conversationId : runId
    return {
      activityPhase: phase,
      activityStatus: status,
      conversationId,
      runId,
      lastActivityAt: messageTime(activeMessage),
      activityLabel: pipelineActivityLabel(phase, status)
    }
  }

  const planState = asRecord(asRecord(task.payload).gatewayPlanState)
  if (planState.state === 'planned' || planState.state === 'needs-clarification') {
    const status = planState.state === 'planned' ? 'planned' : 'needs-input'
    return {
      activityPhase: 'plan',
      activityStatus: status,
      conversationId: typeof planState.conversationId === 'string' ? planState.conversationId : undefined,
      runId: typeof planState.runId === 'string' ? planState.runId : undefined,
      lastActivityAt: typeof planState.askedAt === 'number' ? planState.askedAt : task.updatedAt,
      activityLabel: pipelineActivityLabel('plan', status)
    }
  }
  return null
}

function buildPlanPipelineStatusItems(planBatches: PlanPipelineBatch[], planRecords: PlanPipelineRecord[]): PipelineStatusRunSummary[] {
  const recordsByBatch = new Map<string, PlanPipelineRecord[]>()
  for (const record of planRecords) {
    if (!record.batchId) continue
    recordsByBatch.set(record.batchId, [...(recordsByBatch.get(record.batchId) ?? []), record])
  }
  const batchItems = planBatches.map((batch) => {
    const records = recordsByBatch.get(batch.id) ?? []
    const progress = records.length ? Math.round(records.reduce((sum, record) => sum + record.progress, 0) / records.length) : 0
    const failedRecord = records.find((record) => record.lastError)
    return {
      id: `plan-pipeline:${batch.id}`,
      source: 'plan-pipeline' as const,
      sourceId: batch.id,
      title: batch.name,
      phase: 'plan' as const,
      status: normalizeRunState(batch.status),
      startedAt: batch.createdAt,
      completedAt: records.find((record) => record.completedAt)?.completedAt,
      updatedAt: batch.updatedAt,
      planBatchId: batch.id,
      taskCount: records.reduce((sum, record) => sum + record.taskIds.length, 0),
      progress,
      progressText: `${records.length} stage · ${progress}%`,
      error: failedRecord?.lastError
    }
  })
  const orphanRecordItems = planRecords.filter((record) => !record.batchId).map((record) => ({
    id: `plan-record:${record.id}`,
    source: 'plan-pipeline' as const,
    sourceId: record.id,
    title: record.sourceDraftName || record.groupName,
    phase: 'plan' as const,
    status: normalizeRunState(record.status),
    startedAt: record.createdAt,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
    planRecordId: record.id,
    taskCount: record.taskIds.length,
    progress: record.progress,
    progressText: `${record.groupName} · ${record.progress}%`,
    error: record.lastError
  }))
  return [...batchItems, ...orphanRecordItems]
}

function buildRunPipelineStatusItems(pipelines: RunPipelineGraph[], taskSummaries: PipelineStatusTaskSummary[]): PipelineStatusRunSummary[] {
  const taskById = new Map(taskSummaries.map((task) => [task.id, task]))
  return pipelines.map((pipeline) => {
    const activeItem = pipeline.items.find((item) => item.id === pipeline.batch.currentItemId)
    const failedItem = pipeline.items.find((item) => item.lastError)
    const activeTask = activeItem ? taskById.get(activeItem.taskId) : undefined
    const progressText = activeItem
      ? `${activeTask?.title ?? activeItem.taskId} · ${activeItem.progress}%`
      : `${pipeline.items.length} task · ${pipeline.batch.progress}%`
    return {
      id: `run-pipeline:${pipeline.batch.id}`,
      source: 'run-pipeline',
      sourceId: pipeline.batch.id,
      title: pipeline.batch.name,
      phase: 'run',
      status: normalizeRunState(pipeline.batch.status),
      startedAt: pipeline.batch.createdAt,
      completedAt: pipeline.batch.completedAt,
      updatedAt: pipeline.batch.updatedAt,
      runPipelineId: pipeline.batch.id,
      runItemId: activeItem?.id,
      taskId: activeItem?.taskId,
      projectId: activeItem?.projectId,
      projectName: activeTask?.projectName,
      taskTitle: activeTask?.title,
      taskCount: pipeline.items.length,
      progress: pipeline.batch.progress,
      progressText,
      error: failedItem?.lastError
    } satisfies PipelineStatusRunSummary
  })
}

function statusItemRank(status: PipelineStatusRunState): number {
  if (status === 'running') return 0
  if (status === 'queued' || status === 'pending') return 1
  if (status === 'needs-input' || status === 'planned' || status === 'paused' || status === 'blocked') return 2
  if (status === 'failed' || status === 'cancelled') return 3
  if (status === 'completed' || status === 'skipped') return 4
  return 5
}

function buildStatusItems(input: {
  planBatches: PlanPipelineBatch[]
  planRecords: PlanPipelineRecord[]
  pipelines: RunPipelineGraph[]
  taskSummaries: PipelineStatusTaskSummary[]
  taskRunSummaries: PipelineStatusRunSummary[]
}): PipelineStatusRunSummary[] {
  return [
    ...input.taskRunSummaries,
    ...buildPlanPipelineStatusItems(input.planBatches, input.planRecords),
    ...buildRunPipelineStatusItems(input.pipelines, input.taskSummaries)
  ].sort((a, b) => statusItemRank(a.status) - statusItemRank(b.status) || b.updatedAt - a.updatedAt).slice(0, 48)
}

export class PipelineStatusService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: RunPipelineRepository,
    private readonly planRepo: PlanPipelineRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly taskRepo: TaskRepository
  ) {}

  async snapshot(payload: { actorToken?: string; runPipelineId?: string }): Promise<ServiceResponse<PipelineStatusSnapshot>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const pipelines = await this.resolvePipelines(actor.user.organizationId, payload?.runPipelineId)
    const planBatches = payload?.runPipelineId ? [] : await this.planRepo.listBatches(actor.user.organizationId)
    const planRecords = payload?.runPipelineId ? [] : await this.planRepo.list(actor.user.organizationId)
    const summaries = await this.resolveSummaries([actor.user.organizationId], this.pipelineTaskIds(pipelines, planRecords))
    const statusItems = buildStatusItems({ planBatches, planRecords, pipelines, taskSummaries: summaries.taskSummaries, taskRunSummaries: summaries.taskRunSummaries })
    return okResponse({
      generatedAt: Date.now(),
      scope: payload?.runPipelineId ? 'run_pipeline' : 'all',
      planBatches,
      planRecords,
      pipelines,
      statusItems,
      taskSummaries: summaries.taskSummaries,
      activeTasks: summaries.activeTasks,
      projectSummaries: summaries.projectSummaries
    })
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
      const organizationIds = Array.from(new Set([
        ...batches.map((batch) => batch.organizationId),
        ...planBatches.map((batch) => batch.organizationId),
        ...planRecords.map((record) => record.organizationId)
      ]))
      const pipelines = graphs.filter((item): item is RunPipelineGraph => Boolean(item))
      const summaries = await this.resolveSummaries(organizationIds, this.pipelineTaskIds(pipelines, planRecords))
      const statusItems = buildStatusItems({ planBatches, planRecords, pipelines, taskSummaries: summaries.taskSummaries, taskRunSummaries: summaries.taskRunSummaries })
      return okResponse({
        generatedAt: Date.now(),
        scope: 'all',
        planBatches,
        planRecords,
        pipelines,
        statusItems,
        taskSummaries: summaries.taskSummaries,
        activeTasks: summaries.activeTasks,
        projectSummaries: summaries.projectSummaries
      })
    }
    const record = await this.repo.getStatusTokenByHash(this.hashToken(token))
    if (!record || record.revokedAt) return errorResponse(ErrorCodes.Forbidden, 'Watch token invalid')
    if (record.expiresAt && record.expiresAt <= Date.now()) return errorResponse(ErrorCodes.Forbidden, 'Watch token expired')
    const pipelines = await this.resolvePipelines(record.organizationId, record.scope === 'run_pipeline' ? record.scopeId : undefined)
    const planBatches = record.scope === 'run_pipeline' ? [] : await this.planRepo.listBatches(record.organizationId)
    const planRecords = record.scope === 'run_pipeline' ? [] : await this.planRepo.list(record.organizationId)
    const summaries = await this.resolveSummaries([record.organizationId], this.pipelineTaskIds(pipelines, planRecords))
    const statusItems = buildStatusItems({ planBatches, planRecords, pipelines, taskSummaries: summaries.taskSummaries, taskRunSummaries: summaries.taskRunSummaries })
    return okResponse({
      generatedAt: Date.now(),
      scope: record.scope,
      planBatches,
      planRecords,
      pipelines,
      statusItems,
      taskSummaries: summaries.taskSummaries,
      activeTasks: summaries.activeTasks,
      projectSummaries: summaries.projectSummaries
    })
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

  private pipelineTaskIds(pipelines: RunPipelineGraph[], planRecords: Array<{ taskIds: string[] }>): Set<string> {
    return new Set([
      ...pipelines.flatMap((pipeline) => pipeline.items.map((item) => item.taskId)),
      ...planRecords.flatMap((record) => record.taskIds)
    ])
  }

  private async resolveSummaries(organizationIds: string[], pipelineTaskIds = new Set<string>()): Promise<{ taskSummaries: PipelineStatusTaskSummary[]; activeTasks: PipelineStatusTaskSummary[]; taskRunSummaries: PipelineStatusRunSummary[]; projectSummaries: PipelineStatusProjectSummary[] }> {
    const uniqueOrganizationIds = Array.from(new Set(organizationIds.filter(Boolean)))
    const projects = (await Promise.all(uniqueOrganizationIds.map((organizationId) => this.projectRepo.list(organizationId)))).flat()
    const tasks = (await Promise.all(uniqueOrganizationIds.map((organizationId) => this.taskRepo.listAll(organizationId)))).flat()
    const projectById = new Map(projects.map((project) => [project.id, project]))
    const now = Date.now()
    const taskSummaries = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      projectName: projectById.get(task.projectId)?.name,
      updatedAt: task.updatedAt,
      ...(runtimeSummaryForTask(task, now) ?? {})
    }))
    const taskRunSummaries = tasks
      .filter((task) => !pipelineTaskIds.has(task.id))
      .flatMap((task) => taskRunStatusItems(task, projectById.get(task.projectId)?.name, now))
    return {
      projectSummaries: projects.map((project) => ({
        id: project.id,
        name: project.name
      })),
      taskSummaries,
      taskRunSummaries,
      activeTasks: taskSummaries
        .filter((task) => task.activityStatus && !pipelineTaskIds.has(task.id))
        .sort((a, b) => (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt))
        .slice(0, 18)
    }
  }
}
