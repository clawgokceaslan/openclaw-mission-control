import type { TaskAttachment, TaskChecklistItem, TaskComment, TaskEntity, TaskSubtask } from '@shared/types/entities'
import { normalizeAttachments } from '@renderer/components/attachments/attachments'

export function getSubtaskCustomFieldValues(subtask: TaskSubtask | null): Record<string, unknown> {
  if (!subtask) return {}
  const payload = getSubtaskPayload(subtask)
  const values = payload.customFields
  return values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : {}
}

export function getSubtaskPayload(subtask: TaskSubtask): Record<string, unknown> {
  return subtask.payload && typeof subtask.payload === 'object' && !Array.isArray(subtask.payload)
    ? subtask.payload as Record<string, unknown>
    : {}
}

export function getSubtaskDescription(subtask: TaskSubtask): string {
  const payload = getSubtaskPayload(subtask)
  return typeof payload.description === 'string' ? payload.description : (subtask.description ?? '')
}

export function getSubtaskComments(subtask: TaskSubtask | null): TaskComment[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).comments
  if (!Array.isArray(value)) return []
  return value.filter((comment): comment is TaskComment => {
    if (!comment || typeof comment !== 'object') return false
    const candidate = comment as Partial<TaskComment>
    return typeof candidate.id === 'string' && typeof candidate.body === 'string' && typeof candidate.createdAt === 'number'
  }).map((comment) => ({
    id: comment.id,
    authorName: typeof comment.authorName === 'string' && comment.authorName.trim() ? comment.authorName : 'Operator',
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: typeof comment.updatedAt === 'number' ? comment.updatedAt : undefined
  }))
}

export function getSubtaskAttachments(subtask: TaskSubtask | null): TaskAttachment[] {
  if (!subtask) return []
  return normalizeAttachments(getSubtaskPayload(subtask).attachments)
}

export function getSubtaskChecklistItems(subtask: TaskSubtask | null): TaskChecklistItem[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).checklistItems
  return Array.isArray(value)
    ? value.filter((item): item is TaskChecklistItem => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<TaskChecklistItem>
      return typeof candidate.id === 'string' && typeof candidate.title === 'string'
    })
    : []
}

export function getSubtaskAgentId(subtask: TaskSubtask | null): string | undefined {
  if (!subtask) return undefined
  const payload = getSubtaskPayload(subtask)
  if (typeof payload.agentId === 'string' && payload.agentId.trim()) return payload.agentId
  if (typeof payload.assigneeId === 'string' && payload.assigneeId.trim()) return payload.assigneeId
  return subtask.assigneeId
}

export function getSubtaskSkillIds(subtask: TaskSubtask | null): string[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).skillIds
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

export function getSubtaskTagIds(subtask: TaskSubtask | null): string[] {
  if (!subtask) return []
  const value = getSubtaskPayload(subtask).tagIds
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

export function getTaskOutputFormatId(task: TaskEntity | null): string | undefined {
  const value = task?.payload?.outputFormatId
  return typeof value === 'string' && value ? value : undefined
}

export function getTaskInputFormatId(task: TaskEntity | null): string | undefined {
  const value = task?.payload?.inputFormatId
  return typeof value === 'string' && value ? value : undefined
}

export function getTaskAttachments(task: TaskEntity | null): TaskAttachment[] {
  return normalizeAttachments(task?.payload?.attachments)
}

export function getSubtaskOutputFormatId(subtask: TaskSubtask | null): string | undefined {
  if (!subtask) return undefined
  const value = getSubtaskPayload(subtask).outputFormatId
  return typeof value === 'string' && value ? value : undefined
}

export function getSubtaskInputFormatId(subtask: TaskSubtask | null): string | undefined {
  if (!subtask) return undefined
  const value = getSubtaskPayload(subtask).inputFormatId
  return typeof value === 'string' && value ? value : undefined
}
