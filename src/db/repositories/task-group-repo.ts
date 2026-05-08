import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { TaskGroup, TaskGroupQueueState } from '../../shared/types/entities.js'

const DEFAULT_QUEUE_STATE: TaskGroupQueueState = { state: 'not_configured' }

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function normalizeQueueState(value: unknown): TaskGroupQueueState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_QUEUE_STATE
  const state = (value as { state?: unknown }).state
  if (typeof state !== 'string' || !state.trim()) return DEFAULT_QUEUE_STATE
  return value as TaskGroupQueueState
}

export class TaskGroupRepository extends BaseRepository<TaskGroup> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async listByProject(projectId: string): Promise<TaskGroup[]> {
    const rows = await this.db.prepare('SELECT * FROM task_groups WHERE project_id = @projectId ORDER BY updated_at DESC').all({ projectId })
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<TaskGroup | undefined> {
    const row = (await this.db.prepare('SELECT * FROM task_groups WHERE id = @id').get({ id })) as any
    return row ? this.map(row) : undefined
  }

  async create(input: {
    id?: string
    projectId: string
    title: string
    orderedTaskIds?: string[]
    activeTaskId?: string | null
    groupContextMdPath?: string
    contractedContext?: string
    planningQueueState?: TaskGroupQueueState
    executionQueueState?: TaskGroupQueueState
  }): Promise<TaskGroup> {
    const now = Date.now()
    const id = input.id?.trim() || randomUUID()
    const group: TaskGroup = {
      id,
      groupId: id,
      projectId: input.projectId,
      title: input.title,
      orderedTaskIds: input.orderedTaskIds ?? [],
      activeTaskId: input.activeTaskId ?? null,
      groupContextMdPath: input.groupContextMdPath ?? '',
      contractedContext: input.contractedContext ?? '',
      planningQueueState: input.planningQueueState ?? DEFAULT_QUEUE_STATE,
      executionQueueState: input.executionQueueState ?? DEFAULT_QUEUE_STATE,
      createdAt: now,
      updatedAt: now
    }

    await this.db
      .prepare(
        `INSERT INTO task_groups (
          id,
          project_id,
          title,
          ordered_task_ids_json,
          active_task_id,
          group_context_md_path,
          contracted_context,
          planning_queue_state_json,
          execution_queue_state_json,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @projectId,
          @title,
          @orderedTaskIdsJson,
          @activeTaskId,
          @groupContextMdPath,
          @contractedContext,
          @planningQueueStateJson,
          @executionQueueStateJson,
          @createdAt,
          @updatedAt
        )`
      )
      .run({
        id: group.id,
        projectId: group.projectId,
        title: group.title,
        orderedTaskIdsJson: this.toJson(group.orderedTaskIds),
        activeTaskId: group.activeTaskId,
        groupContextMdPath: group.groupContextMdPath,
        contractedContext: group.contractedContext,
        planningQueueStateJson: this.toJson(group.planningQueueState),
        executionQueueStateJson: this.toJson(group.executionQueueState),
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      })

    return group
  }

  private map(row: any): TaskGroup {
    const id = String(row.id)
    return {
      id,
      groupId: id,
      projectId: row.project_id,
      title: row.title,
      orderedTaskIds: normalizeStringArray(this.parseJson(row.ordered_task_ids_json)),
      activeTaskId: row.active_task_id ?? null,
      groupContextMdPath: row.group_context_md_path ?? '',
      contractedContext: row.contracted_context ?? '',
      planningQueueState: normalizeQueueState(this.parseJson(row.planning_queue_state_json)),
      executionQueueState: normalizeQueueState(this.parseJson(row.execution_queue_state_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
