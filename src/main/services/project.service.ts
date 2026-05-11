import { AppError } from '../../shared/errors/index.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Project, ProjectGatewaySettings, TaskAttachment } from '../../shared/types/entities.js'
import type { ExportProjectWorkspaceRequest, MoveProjectWorkspaceRequest, UpdateProjectRequest } from '../../shared/contracts/ipc.js'
import { AuthService } from './auth.service.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { TaskRepository, TaskSubtaskRepository } from '../../db/repositories/task-repo.js'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeGatewayPromptShape } from '../../shared/utils/gateway-prompt-shape.js'
import { gatewayModelSupportsReasoning } from '../../shared/utils/gateway-language.js'

const GATEWAY_LANGUAGE_VALUES = new Set(['tr', 'en'])
const GATEWAY_REASONING_VALUES = new Set(['minimal', 'low', 'medium', 'high', 'xhigh'])

function normalizeGatewayLanguageValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return GATEWAY_LANGUAGE_VALUES.has(normalized) ? normalized : null
}

function normalizeGatewayReasoningValue(value: unknown): string {
  if (typeof value !== 'string') return 'medium'
  const normalized = value.trim().toLowerCase()
  return GATEWAY_REASONING_VALUES.has(normalized) ? normalized : 'medium'
}

export class ProjectService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly gateways: GatewayRepository,
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
    if ('gateway' in payload) {
      const currentGateway = current.metrics?.gateway && typeof current.metrics.gateway === 'object' && !Array.isArray(current.metrics.gateway)
        ? current.metrics.gateway as ProjectGatewaySettings
        : {}
      const gateway = await this.normalizeGatewaySettings(actor.user.organizationId, { ...currentGateway, ...(payload.gateway ?? {}) })
      if (!gateway.ok) return errorResponse(gateway.error?.code ?? ErrorCodes.Validation, gateway.error?.message ?? 'Gateway settings are invalid', gateway.error?.details)
      payload.metrics = {
        ...(current.metrics ?? {}),
        ...(payload.metrics ?? {}),
        gateway: gateway.data ?? {}
      }
      delete payload.gateway
    }
    const updated = await this.repo.update(payload.id, payload)
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    return okResponse(updated)
  }

  private async normalizeGatewaySettings(orgId: string, gatewaySettings: ProjectGatewaySettings | undefined): Promise<ServiceResponse<ProjectGatewaySettings>> {
    if (!gatewaySettings) return okResponse({})
    const gatewayId = typeof gatewaySettings.gatewayId === 'string' && gatewaySettings.gatewayId.trim() ? gatewaySettings.gatewayId.trim() : null
    const gateway = gatewayId ? await this.gateways.get(gatewayId) : null
    if (gatewayId) {
      if (!gateway || gateway.organizationId !== orgId) return errorResponse(ErrorCodes.Validation, 'Gateway is invalid')
    }
    const runtimeWorkspaceId = await this.normalizeWorkspaceId(orgId, gatewaySettings.runtimeWorkspaceId)
    if (!runtimeWorkspaceId.ok) return runtimeWorkspaceId as ServiceResponse<ProjectGatewaySettings>
    const runModel = typeof gatewaySettings.runModel === 'string' && gatewaySettings.runModel.trim() ? gatewaySettings.runModel.trim() : null
    const planModel = typeof gatewaySettings.planModel === 'string' && gatewaySettings.planModel.trim() ? gatewaySettings.planModel.trim() : null
    const defaultModel = typeof gatewaySettings.defaultModel === 'string' && gatewaySettings.defaultModel.trim() ? gatewaySettings.defaultModel.trim() : runModel
    const language = normalizeGatewayLanguageValue(gatewaySettings.language)
      ?? normalizeGatewayLanguageValue(gatewaySettings.outputLanguage)
      ?? normalizeGatewayLanguageValue(gatewaySettings.inputLanguage)
      ?? null
    const gatewayTemplate = gateway?.template && typeof gateway.template === 'object' && !Array.isArray(gateway.template) ? gateway.template as { models?: unknown[] } : {}
    const gatewayModels = Array.isArray(gatewayTemplate.models) ? gatewayTemplate.models : []
    const planModelRecord = gatewayModels.find((model) => model && typeof model === 'object' && !Array.isArray(model) && (model as { id?: unknown }).id === planModel)
    const runModelRecord = gatewayModels.find((model) => model && typeof model === 'object' && !Array.isArray(model) && (model as { id?: unknown }).id === runModel)
    const planReasoningEffort = (!planModelRecord || gatewayModelSupportsReasoning(planModelRecord)) ? normalizeGatewayReasoningValue(gatewaySettings.planReasoningEffort) : null
    const runReasoningEffort = (!runModelRecord || gatewayModelSupportsReasoning(runModelRecord)) ? normalizeGatewayReasoningValue(gatewaySettings.runReasoningEffort) : null
    const promptShape = normalizeGatewayPromptShape(gatewaySettings.promptShape)
    return okResponse({
      gatewayId,
      runtimeWorkspaceId: runtimeWorkspaceId.data ?? null,
      defaultModel,
      planModel,
      runModel,
      language,
      promptShape,
      planReasoningEffort,
      runReasoningEffort
    })
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

  async exportWorkspace(payload: ExportProjectWorkspaceRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ projectFolderPath: string; processedTasks: number; writtenFiles: string[]; skippedFiles: string[]; errors: string[] }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const project = await this.repo.get(payload.projectId)
    if (!project) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    if (!project.workspaceId) return errorResponse(ErrorCodes.Validation, 'Project has no workspace')
    const workspace = await this.workspaces.get(project.workspaceId)
    if (!workspace || workspace.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Workspace access denied')

    const projectFolderPath = projectFolder(workspace.rootPath, project)
    await mkdir(projectFolderPath, { recursive: true })
    const projectTasks = await this.tasks.list(project.id)
    const taskById = new Map(projectTasks.map((task) => [task.id, task]))
    const writtenFiles: string[] = []
    const skippedFiles: string[] = []
    const errors: string[] = []
    let processedTasks = 0

    for (const input of payload.tasks ?? []) {
      const task = taskById.get(input.taskId)
      if (!task) {
        errors.push(`Task not found: ${input.taskId}`)
        continue
      }
      processedTasks += 1
      const relativeExportDir = join('Tasks', entityFolder(task.title, task.id, 'task'), 'exports')
      const exportFolderPath = join(projectFolderPath, relativeExportDir)
      await mkdir(exportFolderPath, { recursive: true })
      const writeMarkdown = async (name: string, content?: string) => {
        if (!content?.trim()) return
        await writeFile(join(exportFolderPath, name), content, 'utf8')
        writtenFiles.push(join(relativeExportDir, name))
      }
      await writeMarkdown('Task.md', input.taskMarkdown)
      await writeMarkdown('Task.json', input.taskJson)
      await writeMarkdown('Task.toon', input.taskToon)
      await writeMarkdown('Agents.md', input.agentMarkdown)
      await writeMarkdown('Skills.md', input.skillsMarkdown)
      await writeMarkdown('Tools.md', input.toolsMarkdown)

      const usedNames = new Set<string>()
      const attachmentsDir = join(exportFolderPath, 'attachments')
      for (const attachment of input.attachments ?? []) {
        if (!attachment.url?.startsWith('file://')) continue
        try {
          const baseName = sanitizeFileName(attachment.exportName || attachment.name)
          const uniqueName = uniqueFileName(usedNames, baseName, attachment.ownerId ?? task.id)
          await mkdir(attachmentsDir, { recursive: true })
          await copyFile(fileURLToPath(attachment.url), join(attachmentsDir, uniqueName))
          writtenFiles.push(join(relativeExportDir, 'attachments', uniqueName))
        } catch {
          skippedFiles.push(attachment.name ?? attachment.url ?? 'attachment')
        }
      }
    }

    return okResponse({ projectFolderPath, processedTasks, writtenFiles, skippedFiles, errors })
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
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'attachment'
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

function uniqueFileName(usedNames: Set<string>, baseName: string, seed: string): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName)
    return baseName
  }
  const dot = baseName.lastIndexOf('.')
  let counter = 1
  while (counter < 1000) {
    const suffix = `${shortHash(seed)}-${counter}`
    const nextName = dot > 0 ? `${baseName.slice(0, dot)}-${suffix}${baseName.slice(dot)}` : `${baseName}-${suffix}`
    if (!usedNames.has(nextName)) {
      usedNames.add(nextName)
      return nextName
    }
    counter += 1
  }
  const fallback = `${baseName}-${usedNames.size + 1}`
  usedNames.add(fallback)
  return fallback
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
