import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { OutputFormat, Skill, TaskComment, TaskEntity, TaskJsonImportResult, TaskSubtask, TaskTemplate } from '@shared/types/entities'
import { prefixDataFormatTokens } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { invokeBridge } from '@renderer/utils/api'
import type { ProjectStatusColumn } from './status'

export type CreateTaskInput = {
  projectId: string
  title: string
  description: string
  status: TaskEntity['status']
  tagIds: string[]
  agentId?: string | null
  templateId?: string | null
  importJson?: string | null
  statusOrder?: number
}

export type CreateTaskWithTemplateContext = {
  actorToken: string | null
  userName?: string | null
  input: CreateTaskInput
  templates: TaskTemplate[]
  statusColumns: ProjectStatusColumn[]
  defaultStatus: TaskEntity['status']
  outputFormats: OutputFormat[]
}

export type CreateTaskWithTemplateResult = {
  task: TaskEntity
  warnings: string[]
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return structuredClone(value) as Record<string, unknown>
}

function normalizeComments(value: unknown): TaskComment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const comments = value.filter((comment): comment is TaskComment => {
    const candidate = comment as Partial<TaskComment>
    return typeof candidate.id === 'string' && typeof candidate.body === 'string' && typeof candidate.authorName === 'string'
  })
  return comments.length > 0 ? structuredClone(comments) : undefined
}

function hasPatch(value: Record<string, unknown>) {
  return Object.keys(value).length > 0
}

export async function createTaskWithTemplate(context: CreateTaskWithTemplateContext): Promise<CreateTaskWithTemplateResult> {
  const { actorToken, userName, input, templates, statusColumns, defaultStatus, outputFormats } = context
  const selectedTemplate = input.templateId ? templates.find((template) => template.id === input.templateId) : null
  const templatePayload = selectedTemplate?.template
  const warnings: string[] = []

  if (input.importJson?.trim()) {
    const importResponse = await invokeBridge<TaskJsonImportResult>(IPC_CHANNELS.tasks.importJson, {
      actorToken,
      projectId: input.projectId,
      json: input.importJson
    })
    if (!importResponse.ok || !importResponse.data?.task) {
      throw new Error(importResponse.error?.message ?? 'Task JSON import failed')
    }
    warnings.push(...(importResponse.data.warnings ?? []))
    return { task: importResponse.data.task, warnings }
  }

  const normalizeStatus = (value?: string | null) => {
    if (value && statusColumns.some((column) => column.status === value)) return value as TaskEntity['status']
    return defaultStatus
  }

  const templateCodex = templatePayload?.codex && typeof templatePayload.codex === 'object' && !Array.isArray(templatePayload.codex)
    ? templatePayload.codex as Record<string, unknown>
    : {}
  const templateGatewayId = typeof templateCodex.gatewayId === 'string' ? templateCodex.gatewayId.trim() : ''
  const templateModel = typeof templateCodex.model === 'string' ? templateCodex.model.trim() : ''
  const templateCodexPayload = templateGatewayId || templateModel
    ? { codex: { ...(templateGatewayId ? { gatewayId: templateGatewayId } : {}), ...(templateModel ? { model: templateModel } : {}) } }
    : undefined
  const createPayload: Record<string, unknown> = {
    ...(templateCodexPayload ?? {})
  }
  if (typeof input.statusOrder === 'number' && Number.isFinite(input.statusOrder)) {
    createPayload.statusOrder = { [normalizeStatus(input.status)]: input.statusOrder }
  }

  const createResponse = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.create, {
    actorToken,
    projectId: input.projectId,
    title: input.title.trim(),
    status: normalizeStatus(input.status),
    description: prefixDataFormatTokens(input.description, templatePayload?.inputFormatId, templatePayload?.outputFormatId, outputFormats),
    agentId: input.agentId ?? null,
    payload: createPayload
  })
  if (!createResponse.ok || !createResponse.data) {
    throw new Error(createResponse.error?.message ?? 'Task create failed')
  }

  const task = createResponse.data
  if (input.tagIds.length > 0) {
    const tagResponse = await invokeBridge(IPC_CHANNELS.tasks.tagsSet, {
      actorToken,
      taskId: task.id,
      tagIds: input.tagIds
    })
    if (!tagResponse.ok) warnings.push(tagResponse.error?.message ?? 'Task created, but tags could not be applied')
  }

  if (!templatePayload) return { task, warnings }

  const payloadPatch: Record<string, unknown> = {}
  if (Array.isArray(templatePayload.attachments)) payloadPatch.attachments = structuredClone(templatePayload.attachments)
  const comments = normalizeComments(templatePayload.comments)
  if (comments) payloadPatch.comments = comments
  payloadPatch.inputFormatId = ''
  payloadPatch.outputFormatId = ''
  if (templateCodexPayload?.codex) {
    payloadPatch.codex = templateCodexPayload.codex
  }
  if (typeof input.statusOrder === 'number' && Number.isFinite(input.statusOrder)) {
    payloadPatch.statusOrder = { [task.status]: input.statusOrder }
  }

  const hasTaskPatch = hasPatch(payloadPatch)
    || Boolean(templatePayload.customFieldValues && typeof templatePayload.customFieldValues === 'object' && !Array.isArray(templatePayload.customFieldValues))
    || Array.isArray(templatePayload.checklistItems)

  if (hasTaskPatch) {
    const updateResponse = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.update, {
      actorToken,
      id: task.id,
      payload: payloadPatch,
      customFieldValues: templatePayload.customFieldValues,
      checklistItems: templatePayload.checklistItems
    })
    if (!updateResponse.ok) warnings.push(updateResponse.error?.message ?? 'Task created, but template details could not be applied')
  }

  if (Array.isArray(templatePayload.skillIds) && templatePayload.skillIds.length > 0) {
    const skillResponse = await invokeBridge<Skill[]>(IPC_CHANNELS.tasks.skillsSet, {
      actorToken,
      taskId: task.id,
      skillIds: templatePayload.skillIds
    })
    if (!skillResponse.ok) warnings.push(skillResponse.error?.message ?? 'Task created, but template skills could not be applied')
  }

  if (Array.isArray(templatePayload.subtasks)) {
    for (const templateSubtask of templatePayload.subtasks) {
      const subtaskTitle = templateSubtask.title?.trim()
      if (!subtaskTitle) continue
      const subtaskResponse = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksCreate, {
        actorToken,
        taskId: task.id,
        title: subtaskTitle,
        status: normalizeStatus(templateSubtask.status)
      })
      if (!subtaskResponse.ok || !subtaskResponse.data) {
        warnings.push(subtaskResponse.error?.message ?? 'Task created, but a template subtask could not be applied')
        continue
      }
      const subtaskPayload = cloneRecord(templateSubtask.payload)
      subtaskPayload.description = prefixDataFormatTokens(
        typeof subtaskPayload.description === 'string' ? subtaskPayload.description : '',
        templateSubtask.inputFormatId,
        templateSubtask.outputFormatId,
        outputFormats
      )
      if (typeof templateSubtask.agentId === 'string') {
        subtaskPayload.agentId = templateSubtask.agentId
        subtaskPayload.assigneeId = templateSubtask.agentId
      }
      if (typeof templateSubtask.dueAt === 'number') subtaskPayload.dueAt = templateSubtask.dueAt
      subtaskPayload.inputFormatId = ''
      subtaskPayload.outputFormatId = ''
      const subtaskUpdateResponse = await invokeBridge<TaskSubtask>(IPC_CHANNELS.tasks.subtasksUpdate, {
        actorToken,
        id: subtaskResponse.data.id,
        payload: subtaskPayload
      })
      if (!subtaskUpdateResponse.ok) warnings.push(subtaskUpdateResponse.error?.message ?? 'Task created, but template subtask details could not be applied')
    }
  }

  if (Array.isArray(templatePayload.comments) && templatePayload.comments.length > 0 && !comments) {
    for (const templateComment of templatePayload.comments) {
      if (!templateComment.body?.trim()) continue
      const commentResponse = await invokeBridge<TaskComment[]>(IPC_CHANNELS.tasks.commentAdd, {
        actorToken,
        taskId: task.id,
        body: templateComment.body.trim(),
        authorName: templateComment.authorName || userName || 'Operator'
      })
      if (!commentResponse.ok) warnings.push(commentResponse.error?.message ?? 'Task created, but template comments could not be applied')
    }
  }

  return { task, warnings }
}
