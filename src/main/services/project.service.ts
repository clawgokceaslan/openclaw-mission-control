import { AppError } from '../../shared/errors/index.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Project, TaskAttachment } from '../../shared/types/entities.js'
import type { MoveProjectWorkspaceRequest, UpdateProjectRequest } from '../../shared/contracts/ipc.js'
import { AuthService } from './auth.service.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { TaskRepository, TaskSubtaskRepository } from '../../db/repositories/task-repo.js'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export class ProjectService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly tasks: TaskRepository,
    private readonly subtasks: TaskSubtaskRepository
  ) {}

  async list(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Project[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const rows = await this.repo.list(actor.user.organizationId)
    return okResponse(rows)
  }

  async get(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Project>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const actor = await this.auth.requireActor(payload.actorToken)
    const row = await this.repo.get(payload.id)
    if (!row) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (row.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse(row)
  }

  async create(
    payload: { actorToken?: string; name?: string; description?: string; workspaceId?: string | null },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<Project>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.name?.trim()) return errorResponse(ErrorCodes.Validation, 'Project name required')
    const workspaceId = await this.normalizeWorkspaceId(actor.user.organizationId, payload.workspaceId)
    if (!workspaceId.ok) return errorResponse(workspaceId.error?.code ?? ErrorCodes.Validation, workspaceId.error?.message ?? 'Workspace is invalid', workspaceId.error?.details)
    const created = await this.repo.create({
      organizationId: actor.user.organizationId,
      name: payload.name.trim(),
      description: payload.description,
      workspaceId: workspaceId.data ?? null,
      archived: false
    })
    return okResponse(created)
  }

  async update(payload: UpdateProjectRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Project>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    if ('workspaceId' in payload) {
      const workspaceId = await this.normalizeWorkspaceId(actor.user.organizationId, payload.workspaceId)
      if (!workspaceId.ok) return errorResponse(workspaceId.error?.code ?? ErrorCodes.Validation, workspaceId.error?.message ?? 'Workspace is invalid', workspaceId.error?.details)
      payload.workspaceId = workspaceId.data ?? null
    }
    const updated = await this.repo.update(payload.id, payload)
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    return okResponse(updated)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const current = await this.repo.get(payload.id)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.remove(payload.id)
    return okResponse({ ok: true })
  }

  async moveWorkspace(payload: MoveProjectWorkspaceRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ project: Project; movedFiles: number; projectFolderPath?: string }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const current = await this.repo.get(payload.projectId)
    if (!current) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (current.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')

    const workspaceId = await this.normalizeWorkspaceId(actor.user.organizationId, payload.workspaceId)
    if (!workspaceId.ok) return errorResponse(workspaceId.error?.code ?? ErrorCodes.Validation, workspaceId.error?.message ?? 'Workspace is invalid', workspaceId.error?.details)
    const workspace = workspaceId.data ? await this.workspaces.get(workspaceId.data) : undefined
    const projectFolderPath = workspace ? projectFolder(workspace.rootPath, current) : undefined
    if (projectFolderPath) await mkdir(projectFolderPath, { recursive: true })

    let movedFiles = 0
    if (workspace && projectFolderPath) {
      const tasks = await this.tasks.list(current.id)
      const subtasksByTask = await this.subtasks.listByTaskIds(tasks.map((task) => task.id))
      for (const task of tasks) {
        const nextPayload = await this.movePayloadAttachments(task.payload ?? {}, join(projectFolderPath, 'Tasks', entityFolder(task.title, task.id, 'task'), 'attachments'))
        movedFiles += nextPayload.moved
        if (nextPayload.changed) await this.tasks.update(task.id, { payload: nextPayload.payload })
        for (const subtask of subtasksByTask[task.id] ?? []) {
          const nextSubtaskPayload = await this.movePayloadAttachments(
            subtask.payload ?? {},
            join(projectFolderPath, 'Tasks', entityFolder(task.title, task.id, 'task'), 'Subtasks', entityFolder(subtask.title, subtask.id, 'subtask'), 'attachments')
          )
          movedFiles += nextSubtaskPayload.moved
          if (nextSubtaskPayload.changed) await this.subtasks.update(subtask.id, { payload: nextSubtaskPayload.payload })
        }
      }
    }

    const updated = await this.repo.update(current.id, { workspaceId: workspaceId.data ?? null })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    return okResponse({ project: updated, movedFiles, projectFolderPath })
  }

  private async normalizeWorkspaceId(orgId: string, workspaceId: unknown): Promise<ServiceResponse<string | null>> {
    if (workspaceId === undefined || workspaceId === null || workspaceId === '') return okResponse(null)
    if (typeof workspaceId !== 'string') return errorResponse(ErrorCodes.Validation, 'Workspace id is invalid')
    const workspace = await this.workspaces.get(workspaceId)
    if (!workspace) return errorResponse(ErrorCodes.NotFound, 'Workspace not found')
    if (workspace.organizationId !== orgId) return errorResponse(ErrorCodes.Forbidden, 'Workspace access denied')
    return okResponse(workspace.id)
  }

  private async movePayloadAttachments(payload: Record<string, unknown>, targetDir: string): Promise<{ payload: Record<string, unknown>; changed: boolean; moved: number }> {
    const rawAttachments = payload.attachments
    if (!Array.isArray(rawAttachments)) return { payload, changed: false, moved: 0 }
    await mkdir(targetDir, { recursive: true })
    let moved = 0
    let changed = false
    const attachments = await Promise.all(rawAttachments.map(async (raw): Promise<unknown> => {
      const attachment = normalizeAttachment(raw)
      if (!attachment?.url.startsWith('file://')) return raw
      try {
        const sourcePath = fileURLToPath(attachment.url)
        const targetPath = join(targetDir, `${randomUUID()}-${sanitizeFileName(attachment.name)}`)
        if (sourcePath === targetPath) return raw
        await mkdir(dirname(targetPath), { recursive: true })
        await moveFile(sourcePath, targetPath)
        moved += 1
        changed = true
        return { ...attachment, url: pathToFileURL(targetPath).toString() }
      } catch {
        return raw
      }
    }))
    return { payload: { ...payload, attachments }, changed, moved }
  }
}

function sanitizeFileName(name: string): string {
  return name.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ') || 'attachment'
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

function projectFolder(rootPath: string, project: Project): string {
  return join(rootPath, 'Projects', entityFolder(project.name, project.id, 'project'))
}

function normalizeAttachment(value: unknown): TaskAttachment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<TaskAttachment>
  if (typeof candidate.url !== 'string' || typeof candidate.name !== 'string') return null
  return {
    id: typeof candidate.id === 'string' ? candidate.id : randomUUID(),
    name: candidate.name,
    url: candidate.url,
    type: typeof candidate.type === 'string' ? candidate.type : 'application/octet-stream',
    size: typeof candidate.size === 'number' ? candidate.size : 0,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now()
  }
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code !== 'EXDEV') throw error
    await copyFile(sourcePath, targetPath)
    await unlink(sourcePath)
  }
}
