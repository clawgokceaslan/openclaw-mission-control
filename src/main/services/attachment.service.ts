import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { electronRuntime } from '../utils/electron-runtime.js'
import { AuthService } from './auth.service.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { TaskRepository, TaskSubtaskRepository } from '../../db/repositories/task-repo.js'
import { TaskTemplateRepository } from '../../db/repositories/task-template-repo.js'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

const ALLOWED_FILE_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'text/csv',
  'text/markdown',
  'text/plain'
])

const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'ogv', 'ogg', 'webm'])

export interface AttachmentUploadResult {
  url: string
  name: string
  type: string
  size: number
}

type AttachmentScope = 'task' | 'subtask' | 'template' | 'templateSubtask' | 'project'

function sanitizeFileName(name: string): string {
  const normalized = name.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ')
  return normalized || 'attachment'
}

function fileExtension(name: string): string {
  const extension = name.split('.').pop()?.trim().toLowerCase()
  return extension && extension !== name.toLowerCase() ? extension : ''
}

function isAllowedType(type: string, name: string): boolean {
  if (type.startsWith('image/') || type.startsWith('video/') || ALLOWED_FILE_TYPES.has(type)) return true
  if (type !== 'application/octet-stream') return false
  const extension = fileExtension(name)
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension)
}

function monthBucket(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
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

function documentsRoot(): string {
  return join(homedir(), 'Documents', 'OpenMissionControl')
}

export class AttachmentService {
  constructor(
    private readonly auth: AuthService,
    private readonly projects: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly tasks: TaskRepository,
    private readonly subtasks: TaskSubtaskRepository,
    private readonly templates: TaskTemplateRepository
  ) {}

  async upload(
    payload: {
      actorToken?: string
      name?: string
      type?: string
      dataBase64?: string
      scope?: AttachmentScope
      projectId?: string
      taskId?: string
      subtaskId?: string
      templateId?: string
      templateSubtaskId?: string
    },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<AttachmentUploadResult>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const app = electronRuntime.app
    if (!app) return errorResponse(ErrorCodes.Internal, 'Electron app runtime is unavailable')

    const name = sanitizeFileName(payload?.name ?? '')
    const type = payload?.type?.trim() || 'application/octet-stream'
    if (!isAllowedType(type, name)) return errorResponse(ErrorCodes.Validation, `Unsupported attachment type: ${type}`)
    if (!payload?.dataBase64) return errorResponse(ErrorCodes.Validation, 'Attachment data is required')

    let buffer: Buffer
    try {
      buffer = Buffer.from(payload.dataBase64, 'base64')
    } catch {
      return errorResponse(ErrorCodes.Validation, 'Attachment data is invalid')
    }
    if (buffer.length <= 0) return errorResponse(ErrorCodes.Validation, 'Attachment is empty')
    if (buffer.length > MAX_UPLOAD_BYTES) return errorResponse(ErrorCodes.Validation, 'Attachment exceeds 50 MB limit')

    const targetDir = await this.resolveTargetDir(actor.user.organizationId, payload)
    await mkdir(targetDir, { recursive: true })
    const targetPath = join(targetDir, `${randomUUID()}-${name}`)
    await writeFile(targetPath, buffer)

    return okResponse({
      url: pathToFileURL(targetPath).toString(),
      name,
      type,
      size: buffer.length
    })
  }

  private async resolveTargetDir(orgId: string, payload: {
    scope?: AttachmentScope
    projectId?: string
    taskId?: string
    subtaskId?: string
    templateId?: string
    templateSubtaskId?: string
  }): Promise<string> {
    if (payload.scope === 'template' || payload.scope === 'templateSubtask' || payload.templateId) {
      const template = payload.templateId ? await this.templates.get(orgId, payload.templateId) : undefined
      const templateFolder = template
        ? entityFolder(template.name, template.id, 'template')
        : entityFolder('template', payload.templateId ?? randomUUID(), 'template')
      if (payload.scope === 'templateSubtask' && payload.templateSubtaskId) {
        return join(documentsRoot(), 'Templates', templateFolder, 'Subtasks', entityFolder('subtask', payload.templateSubtaskId, 'subtask'), 'attachments')
      }
      return join(documentsRoot(), 'Templates', templateFolder, 'attachments')
    }

    const task = payload.taskId ? await this.tasks.get(payload.taskId) : undefined
    const subtask = payload.subtaskId ? await this.subtasks.get(payload.subtaskId) : undefined
    const parentTask = task ?? (subtask ? await this.tasks.get(subtask.taskId) : undefined)
    const project = payload.projectId
      ? await this.projects.get(payload.projectId)
      : parentTask
        ? await this.projects.get(parentTask.projectId)
        : undefined

    if (project?.organizationId === orgId && project.workspaceId) {
      const workspace = await this.workspaces.get(project.workspaceId)
      if (workspace?.organizationId === orgId) {
        const projectFolder = join(workspace.rootPath, 'Projects', entityFolder(project.name, project.id, 'project'))
        if (subtask && parentTask) {
          return join(projectFolder, 'Tasks', entityFolder(parentTask.title, parentTask.id, 'task'), 'Subtasks', entityFolder(subtask.title, subtask.id, 'subtask'), 'attachments')
        }
        if (parentTask) {
          return join(projectFolder, 'Tasks', entityFolder(parentTask.title, parentTask.id, 'task'), 'attachments')
        }
        return join(projectFolder, 'attachments')
      }
    }

    return join(documentsRoot(), '_staging', 'attachments', orgId, monthBucket())
  }
}
