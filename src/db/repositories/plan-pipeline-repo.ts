import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { PlanPipelineBatch, PlanPipelineRecord, PlanPipelineRunMode, PlanPipelineStatus } from '../../shared/types/entities.js'

export interface CreatePlanPipelineRecordInput {
  organizationId: string
  sourceDraftName: string
  groupName: string
  groupDescription?: string
  groupOrder: number
  projectIds: string[]
  taskIds: string[]
  status?: PlanPipelineStatus
  progress?: number
  retryCount?: number
  runMode: PlanPipelineRunMode
  summaryContext?: string
  lastError?: string
  createdByName?: string
  completedAt?: number
}

export interface CreatePlanPipelineBatchInput {
  organizationId: string
  name: string
  projectIds: string[]
  runPipelineOnPlanComplete?: boolean
  createdByName?: string
}

export interface UpdatePlanPipelineStateInput {
  id: string
  status?: PlanPipelineStatus
  progress?: number
  retryCount?: number
  summaryContext?: string | null
  lastError?: string | null
  completedAt?: number | null
}

export class PlanPipelineRepository extends BaseRepository<PlanPipelineRecord> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(organizationId: string): Promise<PlanPipelineRecord[]> {
    const rows = await this.db.prepare('SELECT * FROM plan_pipeline_records WHERE organization_id = @organizationId ORDER BY created_at DESC, group_order ASC').all({ organizationId })
    return rows.map((row: any) => this.map(row))
  }

  async listAll(): Promise<PlanPipelineRecord[]> {
    const rows = await this.db.prepare('SELECT * FROM plan_pipeline_records ORDER BY created_at DESC, group_order ASC').all()
    return rows.map((row: any) => this.map(row))
  }

  async listBatches(organizationId: string): Promise<PlanPipelineBatch[]> {
    const rows = await this.db.prepare('SELECT * FROM plan_pipeline_batches WHERE organization_id = @organizationId ORDER BY updated_at DESC').all({ organizationId })
    return rows.map((row: any) => this.mapBatch(row))
  }

  async listAllBatches(): Promise<PlanPipelineBatch[]> {
    const rows = await this.db.prepare('SELECT * FROM plan_pipeline_batches ORDER BY updated_at DESC').all()
    return rows.map((row: any) => this.mapBatch(row))
  }

  async getBatch(organizationId: string, id: string): Promise<PlanPipelineBatch | undefined> {
    const row = await this.db.prepare('SELECT * FROM plan_pipeline_batches WHERE organization_id = @organizationId AND id = @id').get<any>({ organizationId, id })
    return row ? this.mapBatch(row) : undefined
  }

  async listByBatch(organizationId: string, batchId: string): Promise<PlanPipelineRecord[]> {
    const rows = await this.db.prepare('SELECT * FROM plan_pipeline_records WHERE organization_id = @organizationId AND batch_id = @batchId ORDER BY group_order ASC').all({ organizationId, batchId })
    return rows.map((row: any) => this.map(row))
  }

  async createMany(inputs: CreatePlanPipelineRecordInput[], batchInput?: CreatePlanPipelineBatchInput): Promise<PlanPipelineRecord[]> {
    const created: PlanPipelineRecord[] = []
    const now = Date.now()
    const batchId = randomUUID()
    await this.db.transaction(async () => {
      if (batchInput) {
        await this.db.prepare(`
          INSERT INTO plan_pipeline_batches (
            id, organization_id, name, project_ids_json, status, run_pipeline_on_plan_complete,
            linked_run_pipeline_id, created_by_name, created_at, updated_at
          ) VALUES (
            @id, @organizationId, @name, @projectIdsJson, @status, @runPipelineOnPlanComplete,
            NULL, @createdByName, @createdAt, @updatedAt
          )
        `).run({
          id: batchId,
          organizationId: batchInput.organizationId,
          name: batchInput.name,
          projectIdsJson: this.toJson(batchInput.projectIds) ?? '[]',
          status: 'pending',
          runPipelineOnPlanComplete: batchInput.runPipelineOnPlanComplete ? 1 : 0,
          createdByName: batchInput.createdByName,
          createdAt: now,
          updatedAt: now
        })
      }
      for (const input of inputs) {
        const row: PlanPipelineRecord = {
          id: randomUUID(),
          organizationId: input.organizationId,
          batchId: batchInput ? batchId : undefined,
          sourceDraftName: input.sourceDraftName,
          groupName: input.groupName,
          groupDescription: input.groupDescription,
          groupOrder: input.groupOrder,
          projectIds: input.projectIds,
          taskIds: input.taskIds,
          status: input.status ?? 'pending',
          progress: input.progress ?? 0,
          retryCount: input.retryCount ?? 0,
          runMode: input.runMode,
          summaryContext: input.summaryContext,
          lastError: input.lastError,
          createdByName: input.createdByName,
          completedAt: input.completedAt,
          createdAt: now,
          updatedAt: now
        }
        await this.db.prepare(`
          INSERT INTO plan_pipeline_records (
            id, organization_id, batch_id, source_draft_name, group_name, group_description, group_order,
            project_ids_json, task_ids_json, status, progress, retry_count, run_mode,
            summary_context, last_error, created_by_name, completed_at, created_at, updated_at
          ) VALUES (
            @id, @organizationId, @batchId, @sourceDraftName, @groupName, @groupDescription, @groupOrder,
            @projectIdsJson, @taskIdsJson, @status, @progress, @retryCount, @runMode,
            @summaryContext, @lastError, @createdByName, @completedAt, @createdAt, @updatedAt
          )
        `).run({
          ...row,
          projectIdsJson: this.toJson(row.projectIds),
          taskIdsJson: this.toJson(row.taskIds)
        })
        created.push(row)
      }
    })
    return created
  }

  async updateBatch(input: {
    organizationId: string
    id: string
    runPipelineOnPlanComplete?: boolean
    linkedRunPipelineId?: string | null
    status?: PlanPipelineStatus
  }): Promise<PlanPipelineBatch | undefined> {
    const current = await this.getBatch(input.organizationId, input.id)
    if (!current) return undefined
    const next = {
      runPipelineOnPlanComplete: input.runPipelineOnPlanComplete ?? current.runPipelineOnPlanComplete,
      linkedRunPipelineId: input.linkedRunPipelineId === undefined ? current.linkedRunPipelineId ?? null : input.linkedRunPipelineId,
      status: input.status ?? current.status,
      updatedAt: Date.now()
    }
    await this.db.prepare(`
      UPDATE plan_pipeline_batches
      SET run_pipeline_on_plan_complete = @runPipelineOnPlanComplete,
          linked_run_pipeline_id = @linkedRunPipelineId,
          status = @status,
          updated_at = @updatedAt
      WHERE organization_id = @organizationId AND id = @id
    `).run({
      organizationId: input.organizationId,
      id: input.id,
      runPipelineOnPlanComplete: next.runPipelineOnPlanComplete ? 1 : 0,
      linkedRunPipelineId: next.linkedRunPipelineId,
      status: next.status,
      updatedAt: next.updatedAt
    })
    return this.getBatch(input.organizationId, input.id)
  }

  async updateState(input: UpdatePlanPipelineStateInput): Promise<PlanPipelineRecord | undefined> {
    const current = await this.db.prepare('SELECT * FROM plan_pipeline_records WHERE id = @id').get<any>({ id: input.id })
    if (!current) return undefined
    const next = {
      status: input.status ?? current.status,
      progress: input.progress ?? current.progress,
      retryCount: input.retryCount ?? current.retry_count,
      summaryContext: input.summaryContext === undefined ? current.summary_context : input.summaryContext,
      lastError: input.lastError === undefined ? current.last_error : input.lastError,
      completedAt: input.completedAt === undefined ? current.completed_at : input.completedAt,
      updatedAt: Date.now()
    }
    await this.db.prepare(`
      UPDATE plan_pipeline_records
      SET status = @status,
          progress = @progress,
          retry_count = @retryCount,
          summary_context = @summaryContext,
          last_error = @lastError,
          completed_at = @completedAt,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ id: input.id, ...next })
    if (current.batch_id) {
      await this.refreshBatchStatus(current.organization_id, current.batch_id)
    }
    const updated = await this.db.prepare('SELECT * FROM plan_pipeline_records WHERE id = @id').get<any>({ id: input.id })
    return updated ? this.map(updated) : undefined
  }

  private async refreshBatchStatus(organizationId: string, batchId: string): Promise<void> {
    const rows = await this.db.prepare('SELECT status FROM plan_pipeline_records WHERE organization_id = @organizationId AND batch_id = @batchId').all<any>({ organizationId, batchId })
    if (rows.length === 0) return
    const statuses = rows.map((row) => String(row.status))
    const status: PlanPipelineStatus = statuses.some((item) => item === 'blocked' || item === 'failed')
      ? 'blocked'
      : statuses.some((item) => item === 'running')
        ? 'running'
        : statuses.some((item) => item === 'paused')
          ? 'paused'
          : statuses.every((item) => item === 'completed' || item === 'skipped')
            ? 'completed'
            : 'pending'
    await this.db.prepare('UPDATE plan_pipeline_batches SET status = @status, updated_at = @updatedAt WHERE organization_id = @organizationId AND id = @batchId').run({
      organizationId,
      batchId,
      status,
      updatedAt: Date.now()
    })
  }

  private map(row: any): PlanPipelineRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      batchId: row.batch_id ?? undefined,
      sourceDraftName: row.source_draft_name,
      groupName: row.group_name,
      groupDescription: row.group_description ?? undefined,
      groupOrder: row.group_order,
      projectIds: this.parseJson<string[]>(row.project_ids_json) ?? [],
      taskIds: this.parseJson<string[]>(row.task_ids_json) ?? [],
      status: row.status,
      progress: row.progress,
      retryCount: row.retry_count,
      runMode: row.run_mode,
      summaryContext: row.summary_context ?? undefined,
      lastError: row.last_error ?? undefined,
      createdByName: row.created_by_name ?? undefined,
      completedAt: row.completed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapBatch(row: any): PlanPipelineBatch {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      projectIds: this.parseJson<string[]>(row.project_ids_json) ?? [],
      status: row.status,
      runPipelineOnPlanComplete: Boolean(row.run_pipeline_on_plan_complete),
      linkedRunPipelineId: row.linked_run_pipeline_id ?? undefined,
      createdByName: row.created_by_name ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
