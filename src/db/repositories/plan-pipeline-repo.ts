import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { PlanPipelineRecord, PlanPipelineRunMode, PlanPipelineStatus } from '../../shared/types/entities.js'

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

  async createMany(inputs: CreatePlanPipelineRecordInput[]): Promise<PlanPipelineRecord[]> {
    const created: PlanPipelineRecord[] = []
    const now = Date.now()
    await this.db.transaction(async () => {
      for (const input of inputs) {
        const row: PlanPipelineRecord = {
          id: randomUUID(),
          organizationId: input.organizationId,
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
            id, organization_id, source_draft_name, group_name, group_description, group_order,
            project_ids_json, task_ids_json, status, progress, retry_count, run_mode,
            summary_context, last_error, created_by_name, completed_at, created_at, updated_at
          ) VALUES (
            @id, @organizationId, @sourceDraftName, @groupName, @groupDescription, @groupOrder,
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
    const updated = await this.db.prepare('SELECT * FROM plan_pipeline_records WHERE id = @id').get<any>({ id: input.id })
    return updated ? this.map(updated) : undefined
  }

  private map(row: any): PlanPipelineRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
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
}
