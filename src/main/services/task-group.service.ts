import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { UpdateTaskGroupRequest } from '../../shared/contracts/ipc.js'
import type { TaskEntity, TaskGroup, TaskGroupQueueState } from '../../shared/types/entities.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { TaskRepository } from '../../db/repositories/task-repo.js'
import { TaskGroupRepository } from '../../db/repositories/task-group-repo.js'
import { AuthService } from './auth.service.js'
import { buildTaskGroupContextMarkdown, buildTaskGroupContract, taskGroupContextPath } from './task-group-contract.js'

const CONTRACT_QUEUE_IDLE: TaskGroupQueueState = { state: 'idle' }

function uniqueTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
}

export class TaskGroupService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: TaskGroupRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly taskRepo: TaskRepository
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

    const groupId = randomUUID()
    const groupContextMdPath = taskGroupContextPath(groupId)
    const queueDetails = {
      projectId,
      groupId,
      orderedTaskIds: [],
      activeTaskId: null,
      groupContextMdPath
    }
    const planningQueueState = { ...CONTRACT_QUEUE_IDLE, updatedAt: Date.now(), details: queueDetails }
    const executionQueueState = { ...CONTRACT_QUEUE_IDLE, updatedAt: Date.now(), details: queueDetails }
    const contractedContext = buildTaskGroupContract({
      projectId,
      groupId,
      title,
      orderedTaskIds: [],
      activeTaskId: null,
      groupContextMdPath,
      planningQueueState,
      executionQueueState,
      tasksById: new Map()
    })
    const group = await this.repo.create({
      id: groupId,
      projectId,
      title,
      groupContextMdPath,
      contractedContext,
      planningQueueState: { ...planningQueueState, details: { ...queueDetails, contractedContext } },
      executionQueueState: { ...executionQueueState, details: { ...queueDetails, contractedContext } }
    })
    await this.writeContextMarkdown(group, new Map())
    return okResponse(group)
  }

  async update(payload: UpdateTaskGroupRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskGroup>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const groupId = payload?.groupId?.trim()
    if (!groupId) return errorResponse(ErrorCodes.Validation, 'Task group id required')

    const current = await this.repo.get(groupId)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Task group not found')
    const project = await this.projectRepo.get(current.projectId)
    if (!project) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')

    const orderedTaskIds = Object.prototype.hasOwnProperty.call(payload, 'orderedTaskIds')
      ? uniqueTaskIds(payload.orderedTaskIds)
      : current.orderedTaskIds
    const tasksById = new Map<string, TaskEntity>()
    for (const taskId of orderedTaskIds) {
      const task = await this.taskRepo.get(taskId)
      if (!task) return errorResponse(ErrorCodes.Validation, `Task not found in group order: ${taskId}`)
      if (task.projectId !== current.projectId) return errorResponse(ErrorCodes.Validation, 'Task group cannot include tasks from another project')
      tasksById.set(task.id, task)
    }

    const requestedActiveTaskId = Object.prototype.hasOwnProperty.call(payload, 'activeTaskId')
      ? payload.activeTaskId
      : current.activeTaskId
    const activeTaskId = typeof requestedActiveTaskId === 'string' && orderedTaskIds.includes(requestedActiveTaskId)
      ? requestedActiveTaskId
      : orderedTaskIds[0] ?? null
    const title = payload.title?.trim() || current.title
    const groupContextMdPath = current.groupContextMdPath || taskGroupContextPath(current.groupId)
    const now = Date.now()
    const queueDetails = {
      projectId: current.projectId,
      groupId: current.groupId,
      orderedTaskIds,
      activeTaskId,
      groupContextMdPath
    }
    const planningQueueState = { state: 'idle' as const, updatedAt: now, details: queueDetails }
    const executionQueueState = { state: 'idle' as const, updatedAt: now, details: queueDetails }
    const contractedContext = buildTaskGroupContract({
      projectId: current.projectId,
      groupId: current.groupId,
      title,
      orderedTaskIds,
      activeTaskId,
      groupContextMdPath,
      planningQueueState,
      executionQueueState,
      tasksById
    })
    const updated = await this.repo.update(current.id, {
      title,
      orderedTaskIds,
      activeTaskId,
      groupContextMdPath,
      contractedContext,
      planningQueueState: { ...planningQueueState, details: { ...queueDetails, contractedContext } },
      executionQueueState: { ...executionQueueState, details: { ...queueDetails, contractedContext } }
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task group not found')
    await this.writeContextMarkdown(updated, tasksById)
    return okResponse(updated)
  }

  private async writeContextMarkdown(group: TaskGroup, tasksById: Map<string, TaskEntity>): Promise<void> {
    if (!group.groupContextMdPath) return
    await mkdir(dirname(group.groupContextMdPath), { recursive: true })
    await writeFile(group.groupContextMdPath, buildTaskGroupContextMarkdown({
      title: group.title,
      contractedContext: group.contractedContext,
      orderedTaskIds: group.orderedTaskIds,
      activeTaskId: group.activeTaskId,
      planningQueueState: group.planningQueueState,
      executionQueueState: group.executionQueueState,
      tasksById
    }), 'utf8')
  }
}
