import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type {
  AddTaskCommentRequest,
  ExportTaskSnapshotRequest,
  ImportTaskJsonRequest,
  RemoveTaskCommentRequest,
  SetTaskSkillsRequest,
  SetTaskTagsRequest,
  UpdateTaskSubtaskRequest,
  UpdateTaskCommentRequest
} from '../../shared/contracts/ipc.js'
import type { Skill, Tag, TaskChecklistItem, TaskComment, TaskEntity, TaskJsonImportResult, TaskSubtask } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { TaskRepository, TaskSkillRepository, TaskSubtaskRepository, TaskTagRepository } from '../../db/repositories/task-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { CustomFieldRepository, TagRepository } from '../../db/repositories/custom-field-repo.js'
import { SkillRepository } from '../../db/repositories/skill-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { StatusRepository } from '../../db/repositories/status-repo.js'
import { WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'

type TaskPayload = Record<string, unknown> & {
  description?: string
  comments?: TaskComment[]
  checklist?: TaskChecklistItem[]
  customFields?: Record<string, unknown>
}

function asPayload(value: unknown): TaskPayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as TaskPayload) : {}
}

function asComments(value: unknown): TaskComment[] {
  if (!Array.isArray(value)) return []
  const comments: TaskComment[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const comment = raw as Record<string, unknown>
    if (typeof comment.body !== 'string' || !comment.body.trim()) continue
    comments.push({
      id: typeof comment.id === 'string' ? comment.id : randomUUID(),
      authorName: typeof comment.authorName === 'string' && comment.authorName.trim() ? comment.authorName : 'Operator',
      body: comment.body,
      createdAt: typeof comment.createdAt === 'number' ? comment.createdAt : Date.now()
    })
  }
  return comments
}

function asChecklistItems(value: unknown): TaskChecklistItem[] {
  if (!Array.isArray(value)) return []
  const items: TaskChecklistItem[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title) continue
    const now = Date.now()
    items.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : randomUUID(),
      title,
      checked: item.checked === true,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now
    })
  }
  return items
}

function enrichSubtask(item: TaskSubtask): TaskSubtask {
  const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
    ? item.payload as Record<string, unknown>
    : {}
  const description = typeof payload.description === 'string' ? payload.description : ''
  const assigneeId = typeof payload.assigneeId === 'string' ? payload.assigneeId : undefined
  const assigneeName = typeof payload.assigneeName === 'string' ? payload.assigneeName : undefined
  const dueAt = typeof payload.dueAt === 'number' ? payload.dueAt : undefined
  return {
    ...item,
    payload,
    description,
    assigneeId,
    assigneeName,
    dueAt
  }
}

function slugPart(value: string | undefined, fallback: string): string {
  const base = (value || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return base || fallback
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8)
}

function entityFolder(name: string | undefined, id: string, fallback: string): string {
  return `${slugPart(name, fallback)}__${shortHash(id)}`
}

function sanitizeFileName(name: string | undefined, fallback = 'attachment'): string {
  const normalized = (name || fallback).trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ')
  return normalized || fallback
}

export class TaskService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: TaskRepository,
    private readonly subtaskRepo: TaskSubtaskRepository,
    private readonly taskTagRepo: TaskTagRepository,
    private readonly taskSkillRepo: TaskSkillRepository,
    private readonly projects: ProjectRepository,
    private readonly tags: TagRepository,
    private readonly skills: SkillRepository,
    private readonly customFields: CustomFieldRepository,
    private readonly agents: AgentRepository,
    private readonly statuses: StatusRepository,
    private readonly workspaces: WorkspaceRepository
  ) {}

  private async findProjectOrg(projectId: string): Promise<string | undefined> {
    const project = await this.projects.get(projectId)
    return project?.organizationId
  }

  private async ensureTaskAccess(actorToken: string | undefined, taskId: string): Promise<ServiceResponse<{ actorOrgId: string; task: TaskEntity }>> {
    const actor = await this.auth.requireActor(actorToken)
    const task = await this.repo.get(taskId)
    if (!task) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    const orgId = await this.findProjectOrg(task.projectId)
    if (!orgId || orgId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse({ actorOrgId: actor.user.organizationId, task })
  }

  private async normalizeAgentId(actorOrgId: string, agentId: unknown): Promise<ServiceResponse<string | null>> {
    if (agentId === null || agentId === undefined || agentId === '') return okResponse(null)
    if (typeof agentId !== 'string') return errorResponse(ErrorCodes.Validation, 'Agent id is invalid')
    const agent = await this.agents.get(agentId)
    if (!agent) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (agent.organizationId !== actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Agent access denied')
    return okResponse(agent.id)
  }

  private async normalizeStatus(projectId: string, orgId: string, status: unknown): Promise<ServiceResponse<string>> {
    const statuses = await this.statuses.ensureProjectDefaults(projectId, orgId)
    const fallback = statuses.find((item) => item.category === 'not_started') ?? statuses[0]
    if (!fallback) return errorResponse(ErrorCodes.Validation, 'Project has no statuses')
    if (status === undefined || status === null || status === '') return okResponse(fallback.id)
    if (typeof status !== 'string') return errorResponse(ErrorCodes.Validation, 'Status is invalid')
    const legacy: Record<string, string> = {
      pending: 'not_started',
      running: 'active',
      failed: 'active',
      completed: 'done'
    }
    const legacyCategory = legacy[status]
    if (legacyCategory) {
      return okResponse((statuses.find((item) => item.category === legacyCategory) ?? fallback).id)
    }
    const found = statuses.find((item) => item.id === status)
    if (!found) return errorResponse(ErrorCodes.Validation, 'Status is not part of this project')
    return okResponse(found.id)
  }

  private async enrichTasks(tasks: TaskEntity[]): Promise<TaskEntity[]> {
    const ids = tasks.map((task) => task.id)
    const [tagsByTaskId, skillsByTaskId, subtasksByTaskId] = await Promise.all([
      this.taskTagRepo.listByTaskIds(ids),
      this.taskSkillRepo.listByTaskIds(ids),
      this.subtaskRepo.listByTaskIds(ids)
    ])
    return tasks.map((task) => {
      const payload = asPayload(task.payload)
      const comments = asComments(payload.comments)
      const checklistItems = asChecklistItems(payload.checklist)
      const description = typeof payload.description === 'string' ? payload.description : ''
      const customFieldValues = asPayload(payload.customFields)
      return {
        ...task,
        description,
        comments,
        commentCount: comments.length,
        tags: tagsByTaskId[task.id] ?? [],
        skills: skillsByTaskId[task.id] ?? [],
        subtasks: (subtasksByTaskId[task.id] ?? []).map(enrichSubtask),
        checklistItems,
        customFieldValues
      }
    })
  }

  async list(payload: { actorToken?: string; projectId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskEntity[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    let rows: TaskEntity[] = []
    if (payload?.projectId) {
      const orgId = await this.findProjectOrg(payload.projectId)
      if (!orgId || orgId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
      rows = await this.repo.list(payload.projectId)
    } else {
      rows = await this.repo.listAll(actor.user.organizationId)
    }
    return okResponse(await this.enrichTasks(rows))
  }

  async get(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskEntity>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskEntity>
    const [task] = await this.enrichTasks([access.data.task])
    return okResponse(task)
  }

  async create(
    payload: { actorToken?: string; projectId?: string; title?: string; status?: TaskEntity['status']; description?: string; agentId?: string | null },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<TaskEntity>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.projectId || !payload?.title) return errorResponse(ErrorCodes.Validation, 'ProjectId and title required')
    const projectOrg = await this.findProjectOrg(payload.projectId)
    if (!projectOrg || projectOrg !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const agentIdResponse = await this.normalizeAgentId(actor.user.organizationId, payload.agentId)
    if (!agentIdResponse.ok) return agentIdResponse as ServiceResponse<TaskEntity>
    const statusResponse = await this.normalizeStatus(payload.projectId, actor.user.organizationId, payload.status)
    if (!statusResponse.ok) return statusResponse as ServiceResponse<TaskEntity>
    const row = await this.repo.create({
      projectId: payload.projectId,
      title: payload.title,
      status: statusResponse.data ?? 'pending',
      agentId: agentIdResponse.data ?? undefined,
      payload: { description: payload.description ?? '', comments: [] },
      result: {}
    })
    const [task] = await this.enrichTasks([row])
    return okResponse(task)
  }

  async importJson(payload: ImportTaskJsonRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskJsonImportResult>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const targetTask = payload.taskId ? await this.repo.get(payload.taskId) : undefined
    const projectId = targetTask?.projectId ?? payload.projectId
    if (!projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const projectOrg = await this.findProjectOrg(projectId)
    if (!projectOrg || projectOrg !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    if (payload.taskId && !targetTask) return errorResponse(ErrorCodes.NotFound, 'Task not found')

    let imported
    try {
      imported = await new TaskJsonImportNormalizer(actor.user.organizationId, this.agents, this.tags, this.skills, this.customFields).normalize(payload.json)
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Invalid import JSON')
    }

    const statusResponse = await this.normalizeStatus(projectId, actor.user.organizationId, undefined)
    if (!statusResponse.ok) return errorResponse(statusResponse.error?.code ?? ErrorCodes.Validation, statusResponse.error?.message ?? 'Project has no statuses')
    const firstStatus = statusResponse.data ?? ''
    const rootPayload = {
      ...(targetTask?.payload ?? {}),
      description: imported.description,
      comments: imported.comments,
      customFields: imported.customFieldValues,
      checklist: imported.checklistItems,
      inputFormatId: '',
      outputFormatId: ''
    }

    const taskRow = targetTask
      ? await this.repo.update(targetTask.id, {
        title: imported.title,
        status: firstStatus,
        agentId: targetTask.agentId ?? null,
        payload: rootPayload
      })
      : await this.repo.create({
        projectId,
        title: imported.title,
        status: firstStatus,
        agentId: imported.agentId,
        payload: rootPayload,
        result: {}
      })
    if (!taskRow) return errorResponse(ErrorCodes.NotFound, 'Task not found')

    await this.taskTagRepo.setTaskTags(taskRow.id, imported.tagIds)
    if (!targetTask) await this.taskSkillRepo.setTaskSkills(taskRow.id, imported.skillIds)
    await this.subtaskRepo.removeByTask(taskRow.id)
    for (const subtask of imported.subtasks) {
      const created = await this.subtaskRepo.create({ taskId: taskRow.id, title: subtask.title, status: firstStatus })
      await this.subtaskRepo.update(created.id, {
        payload: {
          description: subtask.description,
          agentId: subtask.agentId ?? '',
          assigneeId: subtask.agentId ?? '',
          assigneeName: subtask.assigneeName,
          tagIds: subtask.tagIds,
          skillIds: subtask.skillIds,
          customFields: subtask.customFieldValues,
          checklistItems: subtask.checklistItems,
          comments: subtask.comments,
          inputFormatId: '',
          outputFormatId: '',
          ...(subtask.dueAt ? { dueAt: subtask.dueAt } : {})
        }
      })
    }

    const [task] = await this.enrichTasks([taskRow])
    return okResponse({ task, warnings: imported.warnings })
  }

  async exportSnapshot(payload: ExportTaskSnapshotRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ exportFolderPath: string; writtenFiles: string[]; skippedFiles: string[] }>> {
    if (!payload?.taskId || !payload.projectId) return errorResponse(ErrorCodes.Validation, 'Task and project id are required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<{ exportFolderPath: string; writtenFiles: string[]; skippedFiles: string[] }>
    const project = await this.projects.get(payload.projectId)
    if (!project || project.id !== access.data.task.projectId) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    if (!project.workspaceId) return errorResponse(ErrorCodes.Validation, 'Project has no workspace')
    const workspace = await this.workspaces.get(project.workspaceId)
    if (!workspace || workspace.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Workspace access denied')

    const exportFolderPath = join(
      workspace.rootPath,
      'Projects',
      entityFolder(project.name, project.id, 'project'),
      'Tasks',
      entityFolder(access.data.task.title, access.data.task.id, 'task'),
      'exports'
    )
    await mkdir(exportFolderPath, { recursive: true })
    const writtenFiles: string[] = []
    const skippedFiles: string[] = []
    const writeMarkdown = async (name: string, content?: string) => {
      if (!content?.trim()) return
      await writeFile(join(exportFolderPath, name), content, 'utf8')
      writtenFiles.push(name)
    }
    await writeMarkdown('Task.md', payload.taskMarkdown)
    await writeMarkdown('Agents.md', payload.agentMarkdown)
    await writeMarkdown('Skills.md', payload.skillsMarkdown)

    const usedNames = new Set<string>()
    const attachmentsDir = join(exportFolderPath, 'attachments')
    for (const attachment of payload.attachments ?? []) {
      if (!attachment.url?.startsWith('file://')) continue
      try {
        const baseName = sanitizeFileName(attachment.exportName || attachment.name)
        const uniqueName = usedNames.has(baseName)
          ? `${baseName.replace(/(\.[^.]*)?$/, '')}-${shortHash(`${attachment.ownerId ?? ''}:${attachment.url}`)}${baseName.includes('.') ? baseName.slice(baseName.lastIndexOf('.')) : ''}`
          : baseName
        usedNames.add(uniqueName)
        await mkdir(attachmentsDir, { recursive: true })
        await copyFile(fileURLToPath(attachment.url), join(attachmentsDir, uniqueName))
        writtenFiles.push(`attachments/${uniqueName}`)
      } catch {
        skippedFiles.push(attachment.name ?? attachment.url ?? 'attachment')
      }
    }
    return okResponse({ exportFolderPath, writtenFiles, skippedFiles })
  }

  async update(
    payload: {
      actorToken?: string
      id?: string
      status?: TaskEntity['status']
      title?: string
      agentId?: string | null
      description?: string
      customFieldValues?: Record<string, unknown>
      checklistItems?: TaskChecklistItem[]
      payload?: Record<string, unknown>
    },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<TaskEntity>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskEntity>
    const current = access.data.task
    const nextPayload = asPayload(current.payload)
    if (payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)) {
      Object.assign(nextPayload, payload.payload)
    }
    if (typeof payload.description === 'string') {
      nextPayload.description = payload.description
    }
    if (payload.customFieldValues && typeof payload.customFieldValues === 'object' && !Array.isArray(payload.customFieldValues)) {
      nextPayload.customFields = payload.customFieldValues
    }
    if (Array.isArray(payload.checklistItems)) {
      nextPayload.checklist = asChecklistItems(payload.checklistItems)
    }
    const hasAgentPatch = Object.prototype.hasOwnProperty.call(payload, 'agentId')
    let nextAgentId = current.agentId
    if (hasAgentPatch) {
      const agentIdResponse = await this.normalizeAgentId(access.data.actorOrgId, payload.agentId)
      if (!agentIdResponse.ok) return agentIdResponse as ServiceResponse<TaskEntity>
      nextAgentId = agentIdResponse.data
    }
    const nextStatusResponse = await this.normalizeStatus(current.projectId, access.data.actorOrgId, payload.status ?? current.status)
    if (!nextStatusResponse.ok) return nextStatusResponse as ServiceResponse<TaskEntity>
    const updated = await this.repo.update(payload.id, {
      title: payload.title ?? current.title,
      status: nextStatusResponse.data ?? current.status,
      agentId: nextAgentId,
      payload: nextPayload
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    const [task] = await this.enrichTasks([updated])
    return okResponse(task)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok) return access as ServiceResponse<{ ok: true }>
    await this.repo.remove(payload.id)
    return okResponse({ ok: true })
  }

  async history(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Array<{ at: number; patch: string }>>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok) return access as ServiceResponse<Array<{ at: number; patch: string }>>
    return okResponse(await this.repo.history(payload.id))
  }

  async subtasksCreate(
    payload: { actorToken?: string; taskId?: string; title?: string; status?: TaskSubtask['status'] },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<TaskSubtask>> {
    if (!payload?.taskId || !payload?.title?.trim()) return errorResponse(ErrorCodes.Validation, 'Task id and title required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskSubtask>
    const statusResponse = await this.normalizeStatus(access.data.task.projectId, access.data.actorOrgId, payload.status)
    if (!statusResponse.ok) return statusResponse as ServiceResponse<TaskSubtask>
    const created = await this.subtaskRepo.create({
      taskId: payload.taskId,
      title: payload.title.trim(),
      status: statusResponse.data ?? ''
    })
    return okResponse(created)
  }

  async subtasksUpdate(payload: UpdateTaskSubtaskRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskSubtask>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Subtask id required')
    const existing = await this.subtaskRepo.get(payload.id)
    if (!existing) return errorResponse(ErrorCodes.NotFound, 'Subtask not found')
    const access = await this.ensureTaskAccess(payload.actorToken, existing.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskSubtask>
    let nextStatus = payload.status
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      const statusResponse = await this.normalizeStatus(access.data.task.projectId, access.data.actorOrgId, payload.status)
      if (!statusResponse.ok) return statusResponse as ServiceResponse<TaskSubtask>
      nextStatus = statusResponse.data
    }
    let nextPayload = payload.payload
    if (nextPayload && Object.prototype.hasOwnProperty.call(nextPayload, 'agentId')) {
      const agentIdResponse = await this.normalizeAgentId(access.data.actorOrgId, nextPayload.agentId)
      if (!agentIdResponse.ok) return agentIdResponse as ServiceResponse<TaskSubtask>
      nextPayload = {
        ...nextPayload,
        agentId: agentIdResponse.data ?? '',
        assigneeId: agentIdResponse.data ?? ''
      }
    }
    const updated = await this.subtaskRepo.update(payload.id, {
      title: payload.title,
      status: nextStatus,
      sortOrder: payload.sortOrder,
      payload: nextPayload
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Subtask not found')
    return okResponse(enrichSubtask(updated))
  }

  async subtasksRemove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Subtask id required')
    const existing = await this.subtaskRepo.get(payload.id)
    if (!existing) return errorResponse(ErrorCodes.NotFound, 'Subtask not found')
    const access = await this.ensureTaskAccess(payload.actorToken, existing.taskId)
    if (!access.ok) return access as ServiceResponse<{ ok: true }>
    await this.subtaskRepo.remove(payload.id)
    return okResponse({ ok: true })
  }

  async tagsSet(payload: SetTaskTagsRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Tag[]>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<Tag[]>
    const orgId = access.data.actorOrgId
    const tagIds = Array.isArray(payload.tagIds) ? Array.from(new Set(payload.tagIds.filter(Boolean))) : []
    const allTags = await this.tags.list(orgId)
    const allowedTagIds = new Set(allTags.map((tag) => tag.id))
    const invalidTagIds = tagIds.filter((id) => !allowedTagIds.has(id))
    if (invalidTagIds.length > 0) {
      return errorResponse(ErrorCodes.Validation, 'Invalid tag selection', { invalidTagIds })
    }
    await this.taskTagRepo.setTaskTags(payload.taskId, tagIds)
    return okResponse(await this.taskTagRepo.listTaskTags(payload.taskId))
  }

  async skillsSet(payload: SetTaskSkillsRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Skill[]>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<Skill[]>
    const orgId = access.data.actorOrgId
    const skillIds = Array.isArray(payload.skillIds) ? Array.from(new Set(payload.skillIds.filter(Boolean))) : []
    const allSkills = await this.skills.list(orgId)
    const allowedSkillIds = new Set(allSkills.map((skill) => skill.id))
    const invalidSkillIds = skillIds.filter((id) => !allowedSkillIds.has(id))
    if (invalidSkillIds.length > 0) {
      return errorResponse(ErrorCodes.Validation, 'Invalid skill selection', { invalidSkillIds })
    }
    await this.taskSkillRepo.setTaskSkills(payload.taskId, skillIds)
    return okResponse(await this.taskSkillRepo.listTaskSkills(payload.taskId))
  }

  async commentAdd(payload: AddTaskCommentRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskComment[]>> {
    if (!payload?.taskId || !payload?.body?.trim()) return errorResponse(ErrorCodes.Validation, 'Task id and comment body required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskComment[]>
    const task = access.data.task
    const nextPayload = asPayload(task.payload)
    const comments = asComments(nextPayload.comments)
    comments.push({
      id: randomUUID(),
      authorName: payload.authorName?.trim() || 'Operator',
      body: payload.body.trim(),
      createdAt: Date.now()
    })
    nextPayload.comments = comments
    const updated = await this.repo.update(task.id, { payload: nextPayload })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    return okResponse(comments)
  }

  async commentUpdate(payload: UpdateTaskCommentRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskComment[]>> {
    if (!payload?.taskId || !payload?.commentId || !payload?.body?.trim()) {
      return errorResponse(ErrorCodes.Validation, 'Task id, comment id and body required')
    }
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskComment[]>
    const task = access.data.task
    const nextPayload = asPayload(task.payload)
    const comments = asComments(nextPayload.comments)
    const index = comments.findIndex((comment) => comment.id === payload.commentId)
    if (index < 0) return errorResponse(ErrorCodes.NotFound, 'Comment not found')
    comments[index] = {
      ...comments[index],
      body: payload.body.trim()
    }
    nextPayload.comments = comments
    const updated = await this.repo.update(task.id, { payload: nextPayload })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    return okResponse(comments)
  }

  async commentRemove(payload: RemoveTaskCommentRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskComment[]>> {
    if (!payload?.taskId || !payload?.commentId) {
      return errorResponse(ErrorCodes.Validation, 'Task id and comment id required')
    }
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskComment[]>
    const task = access.data.task
    const nextPayload = asPayload(task.payload)
    const comments = asComments(nextPayload.comments)
    const nextComments = comments.filter((comment) => comment.id !== payload.commentId)
    if (nextComments.length === comments.length) return errorResponse(ErrorCodes.NotFound, 'Comment not found')
    nextPayload.comments = nextComments
    const updated = await this.repo.update(task.id, { payload: nextPayload })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    return okResponse(nextComments)
  }
}
