import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type {
  PipelineStatusWatchToken,
  RunPipelineBatch,
  RunPipelineGraph,
  RunPipelineItem,
  RunPipelineItemStatus,
  RunPipelineStage,
  RunPipelineStatus
} from '../../shared/types/entities.js'

export interface CreateRunPipelineStageInput {
  name: string
  description?: string
  taskIds: string[]
  sourcePlanRecordId?: string
}

export interface CreateRunPipelineBatchInput {
  organizationId: string
  name: string
  projectIds: string[]
  sourcePlanBatchId?: string
  createdByName?: string
  stages: CreateRunPipelineStageInput[]
  taskProjectById: Map<string, string>
}

export class RunPipelineRepository extends BaseRepository<RunPipelineBatch> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(organizationId: string): Promise<RunPipelineBatch[]> {
    const rows = await this.db.prepare('SELECT * FROM run_pipeline_batches WHERE organization_id = @organizationId ORDER BY updated_at DESC').all({ organizationId })
    return rows.map((row: any) => this.mapBatch(row))
  }

  async listAll(): Promise<RunPipelineBatch[]> {
    const rows = await this.db.prepare('SELECT * FROM run_pipeline_batches ORDER BY updated_at DESC').all()
    return rows.map((row: any) => this.mapBatch(row))
  }

  async get(organizationId: string, id: string): Promise<RunPipelineGraph | undefined> {
    const batch = await this.db.prepare('SELECT * FROM run_pipeline_batches WHERE organization_id = @organizationId AND id = @id').get<any>({ organizationId, id })
    if (!batch) return undefined
    const stages = await this.db.prepare('SELECT * FROM run_pipeline_stages WHERE organization_id = @organizationId AND batch_id = @id ORDER BY stage_order ASC').all<any>({ organizationId, id })
    const items = await this.db.prepare('SELECT * FROM run_pipeline_items WHERE organization_id = @organizationId AND batch_id = @id ORDER BY item_order ASC').all<any>({ organizationId, id })
    return {
      batch: this.mapBatch(batch),
      stages: stages.map((row) => this.mapStage(row)),
      items: items.map((row) => this.mapItem(row))
    }
  }

  async getByGatewayRunId(runId: string): Promise<RunPipelineItem | undefined> {
    const row = await this.db.prepare('SELECT * FROM run_pipeline_items WHERE task_gateway_run_id = @runId LIMIT 1').get<any>({ runId })
    return row ? this.mapItem(row) : undefined
  }

  async create(input: CreateRunPipelineBatchInput): Promise<RunPipelineGraph> {
    const now = Date.now()
    const batchId = randomUUID()
    const stages: RunPipelineStage[] = []
    const items: RunPipelineItem[] = []
    await this.db.transaction(async () => {
      await this.db.prepare(`
        INSERT INTO run_pipeline_batches (
          id, organization_id, name, source_plan_batch_id, status, progress, current_stage_id,
          current_item_id, failure_policy, project_ids_json, created_by_name, completed_at, created_at, updated_at
        ) VALUES (
          @id, @organizationId, @name, @sourcePlanBatchId, 'pending', 0, NULL,
          NULL, 'stop_on_failure', @projectIdsJson, @createdByName, NULL, @createdAt, @updatedAt
        )
      `).run({
        id: batchId,
        organizationId: input.organizationId,
        name: input.name,
        sourcePlanBatchId: input.sourcePlanBatchId,
        projectIdsJson: this.toJson(input.projectIds) ?? '[]',
        createdByName: input.createdByName,
        createdAt: now,
        updatedAt: now
      })

      let itemOrder = 1
      for (const [stageIndex, stageInput] of input.stages.entries()) {
        const stage: RunPipelineStage = {
          id: randomUUID(),
          batchId,
          organizationId: input.organizationId,
          name: stageInput.name,
          description: stageInput.description,
          stageOrder: stageIndex + 1,
          sourcePlanRecordId: stageInput.sourcePlanRecordId,
          status: 'pending',
          progress: 0,
          createdAt: now,
          updatedAt: now
        }
        await this.db.prepare(`
          INSERT INTO run_pipeline_stages (
            id, batch_id, organization_id, name, description, stage_order, source_plan_record_id,
            status, progress, completed_at, created_at, updated_at
          ) VALUES (
            @id, @batchId, @organizationId, @name, @description, @stageOrder, @sourcePlanRecordId,
            @status, @progress, NULL, @createdAt, @updatedAt
          )
        `).run(stage)
        stages.push(stage)

        for (const taskId of stageInput.taskIds) {
          const item: RunPipelineItem = {
            id: randomUUID(),
            batchId,
            stageId: stage.id,
            organizationId: input.organizationId,
            taskId,
            projectId: input.taskProjectById.get(taskId) ?? input.projectIds[0] ?? '',
            itemOrder,
            attempt: 0,
            status: 'queued',
            progress: 0,
            createdAt: now,
            updatedAt: now
          }
          itemOrder += 1
          await this.db.prepare(`
            INSERT INTO run_pipeline_items (
              id, batch_id, stage_id, organization_id, task_id, project_id, item_order, attempt,
              task_gateway_run_id, status, progress, last_error, started_at, completed_at, created_at, updated_at
            ) VALUES (
              @id, @batchId, @stageId, @organizationId, @taskId, @projectId, @itemOrder, @attempt,
              NULL, @status, @progress, NULL, NULL, NULL, @createdAt, @updatedAt
            )
          `).run(item)
          items.push(item)
        }
      }
    })
    const graph = await this.get(input.organizationId, batchId)
    return graph ?? {
      batch: {
        id: batchId,
        organizationId: input.organizationId,
        name: input.name,
        sourcePlanBatchId: input.sourcePlanBatchId,
        status: 'pending',
        progress: 0,
        failurePolicy: 'stop_on_failure',
        projectIds: input.projectIds,
        createdByName: input.createdByName,
        createdAt: now,
        updatedAt: now
      },
      stages,
      items
    }
  }

  async setBatchState(organizationId: string, id: string, patch: {
    status?: RunPipelineStatus
    progress?: number
    currentStageId?: string | null
    currentItemId?: string | null
    completedAt?: number | null
  }): Promise<void> {
    const current = await this.db.prepare('SELECT * FROM run_pipeline_batches WHERE organization_id = @organizationId AND id = @id').get<any>({ organizationId, id })
    if (!current) return
    await this.db.prepare(`
      UPDATE run_pipeline_batches
      SET status = @status,
          progress = @progress,
          current_stage_id = @currentStageId,
          current_item_id = @currentItemId,
          completed_at = @completedAt,
          updated_at = @updatedAt
      WHERE organization_id = @organizationId AND id = @id
    `).run({
      organizationId,
      id,
      status: patch.status ?? current.status,
      progress: patch.progress ?? current.progress,
      currentStageId: patch.currentStageId === undefined ? current.current_stage_id : patch.currentStageId,
      currentItemId: patch.currentItemId === undefined ? current.current_item_id : patch.currentItemId,
      completedAt: patch.completedAt === undefined ? current.completed_at : patch.completedAt,
      updatedAt: Date.now()
    })
  }

  async setStageState(organizationId: string, id: string, patch: { status?: RunPipelineStatus; progress?: number; completedAt?: number | null }): Promise<void> {
    const current = await this.db.prepare('SELECT * FROM run_pipeline_stages WHERE organization_id = @organizationId AND id = @id').get<any>({ organizationId, id })
    if (!current) return
    await this.db.prepare(`
      UPDATE run_pipeline_stages
      SET status = @status, progress = @progress, completed_at = @completedAt, updated_at = @updatedAt
      WHERE organization_id = @organizationId AND id = @id
    `).run({
      organizationId,
      id,
      status: patch.status ?? current.status,
      progress: patch.progress ?? current.progress,
      completedAt: patch.completedAt === undefined ? current.completed_at : patch.completedAt,
      updatedAt: Date.now()
    })
  }

  async setItemState(organizationId: string, id: string, patch: {
    status?: RunPipelineItemStatus
    progress?: number
    attempt?: number
    taskGatewayRunId?: string | null
    lastError?: string | null
    startedAt?: number | null
    completedAt?: number | null
  }): Promise<void> {
    const current = await this.db.prepare('SELECT * FROM run_pipeline_items WHERE organization_id = @organizationId AND id = @id').get<any>({ organizationId, id })
    if (!current) return
    await this.db.prepare(`
      UPDATE run_pipeline_items
      SET status = @status,
          progress = @progress,
          attempt = @attempt,
          task_gateway_run_id = @taskGatewayRunId,
          last_error = @lastError,
          started_at = @startedAt,
          completed_at = @completedAt,
          updated_at = @updatedAt
      WHERE organization_id = @organizationId AND id = @id
    `).run({
      organizationId,
      id,
      status: patch.status ?? current.status,
      progress: patch.progress ?? current.progress,
      attempt: patch.attempt ?? current.attempt,
      taskGatewayRunId: patch.taskGatewayRunId === undefined ? current.task_gateway_run_id : patch.taskGatewayRunId,
      lastError: patch.lastError === undefined ? current.last_error : patch.lastError,
      startedAt: patch.startedAt === undefined ? current.started_at : patch.startedAt,
      completedAt: patch.completedAt === undefined ? current.completed_at : patch.completedAt,
      updatedAt: Date.now()
    })
  }

  async nextQueuedItem(organizationId: string, batchId: string): Promise<RunPipelineItem | undefined> {
    const row = await this.db.prepare(`
      SELECT item.*
      FROM run_pipeline_items item
      JOIN run_pipeline_stages stage ON stage.id = item.stage_id
      WHERE item.organization_id = @organizationId
        AND item.batch_id = @batchId
        AND item.status = 'queued'
      ORDER BY stage.stage_order ASC, item.item_order ASC
      LIMIT 1
    `).get<any>({ organizationId, batchId })
    return row ? this.mapItem(row) : undefined
  }

  async createStatusToken(input: Omit<PipelineStatusWatchToken, 'id' | 'createdAt'>): Promise<PipelineStatusWatchToken> {
    const row: PipelineStatusWatchToken = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now()
    }
    await this.db.prepare(`
      INSERT INTO pipeline_status_tokens (
        id, organization_id, token_hash, scope, scope_id, label, revoked_at, expires_at, created_at
      ) VALUES (
        @id, @organizationId, @tokenHash, @scope, @scopeId, @label, @revokedAt, @expiresAt, @createdAt
      )
    `).run(row)
    return row
  }

  async getStatusTokenByHash(tokenHash: string): Promise<PipelineStatusWatchToken | undefined> {
    const row = await this.db.prepare('SELECT * FROM pipeline_status_tokens WHERE token_hash = @tokenHash').get<any>({ tokenHash })
    return row ? this.mapToken(row) : undefined
  }

  async revokeStatusToken(organizationId: string, id: string): Promise<void> {
    await this.db.prepare('UPDATE pipeline_status_tokens SET revoked_at = @revokedAt WHERE organization_id = @organizationId AND id = @id').run({
      organizationId,
      id,
      revokedAt: Date.now()
    })
  }

  private mapBatch(row: any): RunPipelineBatch {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      sourcePlanBatchId: row.source_plan_batch_id ?? undefined,
      status: row.status,
      progress: row.progress,
      currentStageId: row.current_stage_id ?? undefined,
      currentItemId: row.current_item_id ?? undefined,
      failurePolicy: row.failure_policy,
      projectIds: this.parseJson<string[]>(row.project_ids_json) ?? [],
      createdByName: row.created_by_name ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined
    }
  }

  private mapStage(row: any): RunPipelineStage {
    return {
      id: row.id,
      batchId: row.batch_id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description ?? undefined,
      stageOrder: row.stage_order,
      sourcePlanRecordId: row.source_plan_record_id ?? undefined,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined
    }
  }

  private mapItem(row: any): RunPipelineItem {
    return {
      id: row.id,
      batchId: row.batch_id,
      stageId: row.stage_id,
      organizationId: row.organization_id,
      taskId: row.task_id,
      projectId: row.project_id,
      itemOrder: row.item_order,
      attempt: row.attempt,
      taskGatewayRunId: row.task_gateway_run_id ?? undefined,
      status: row.status,
      progress: row.progress,
      lastError: row.last_error ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapToken(row: any): PipelineStatusWatchToken {
    return {
      id: row.id,
      organizationId: row.organization_id,
      tokenHash: row.token_hash,
      scope: row.scope,
      scopeId: row.scope_id ?? undefined,
      label: row.label,
      revokedAt: row.revoked_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at
    }
  }
}
