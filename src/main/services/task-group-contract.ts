import { join } from 'node:path'
import type { TaskEntity, TaskGroup, TaskGroupQueueState } from '../../shared/types/entities.js'

export function taskGroupContextPath(groupId: string): string {
  return join(process.cwd(), '.omc', 'task-groups', groupId, 'groupContext.md')
}

function taskPayload(task: TaskEntity | undefined): Record<string, unknown> {
  return task?.payload && typeof task.payload === 'object' && !Array.isArray(task.payload)
    ? task.payload as Record<string, unknown>
    : {}
}

function taskAcceptanceCriteria(task: TaskEntity | undefined): string {
  const agenticInputs = taskPayload(task).agenticInputs
  if (!agenticInputs || typeof agenticInputs !== 'object' || Array.isArray(agenticInputs)) return ''
  const value = (agenticInputs as Record<string, unknown>).acceptanceCriteria
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function taskDescription(task: TaskEntity | undefined): string {
  const payloadDescription = taskPayload(task).description
  const description = typeof task?.description === 'string' && task.description.trim()
    ? task.description
    : typeof payloadDescription === 'string'
      ? payloadDescription
      : ''
  return description.trim().replace(/\s+/g, ' ')
}

function taskLine(task: TaskEntity | undefined, id: string, index: number): string {
  const title = task?.title?.trim() || 'Bilinmeyen task'
  const status = task?.status?.trim() || 'unknown'
  const description = taskDescription(task)
  const acceptanceCriteria = taskAcceptanceCriteria(task)
  const details = [
    description ? `Açıklama: ${description.slice(0, 260)}` : '',
    acceptanceCriteria ? `Kabul: ${acceptanceCriteria.slice(0, 220)}` : ''
  ].filter(Boolean).join(' | ')
  return `${index + 1}. ${title} (${id}) - status: ${status}${details ? ` - ${details}` : ''}`
}

export function taskGroupQueueDetails(group: Pick<TaskGroup, 'projectId' | 'groupId' | 'orderedTaskIds' | 'groupContextMdPath' | 'contractedContext'>, activeTaskId: string | null): Record<string, unknown> {
  return {
    projectId: group.projectId,
    groupId: group.groupId,
    orderedTaskIds: group.orderedTaskIds,
    activeTaskId,
    groupContextMdPath: group.groupContextMdPath || taskGroupContextPath(group.groupId),
    contractedContext: group.contractedContext
  }
}

export function buildTaskGroupContract(input: {
  projectId: string
  groupId: string
  title: string
  orderedTaskIds: string[]
  activeTaskId: string | null
  groupContextMdPath: string
  planningQueueState: TaskGroupQueueState
  executionQueueState: TaskGroupQueueState
  tasksById: Map<string, TaskEntity>
}): string {
  return [
    `TaskGroup Contract: ${input.title}`,
    `projectId: ${input.projectId}`,
    `groupId: ${input.groupId}`,
    `orderedTaskIds: ${input.orderedTaskIds.join(', ')}`,
    `activeTaskId: ${input.activeTaskId ?? ''}`,
    `groupContextMdPath: ${input.groupContextMdPath}`,
    `planningQueueState: ${input.planningQueueState.state}`,
    `executionQueueState: ${input.executionQueueState.state}`,
    'Sayfa kapsamı: proje detayı grup yönetimi, Kanban grup görünümü, task oluşturma merkezi, planlama kuyruğu ve çalıştırma kuyruğu aynı contract alanlarını taşır.',
    'Context window contract: ham geçmiş yerine güncel hedef, karar, sıra, aktif task ve kuyruk durumu özetlenir.',
    'Ordered task özeti:',
    ...(input.orderedTaskIds.length > 0
      ? input.orderedTaskIds.map((taskId, index) => taskLine(input.tasksById.get(taskId), taskId, index))
      : ['Henüz gruba bağlı task yok.'])
  ].join('\n')
}

export function buildTaskGroupContextMarkdown(input: {
  title: string
  contractedContext: string
  orderedTaskIds: string[]
  activeTaskId: string | null
  planningQueueState: TaskGroupQueueState
  executionQueueState: TaskGroupQueueState
  tasksById: Map<string, TaskEntity>
}): string {
  return [
    `# ${input.title}`,
    '',
    '## Contracted Context',
    '',
    input.contractedContext,
    '',
    '## Queue State',
    '',
    `- planningQueueState: ${input.planningQueueState.state}`,
    `- executionQueueState: ${input.executionQueueState.state}`,
    `- activeTaskId: ${input.activeTaskId ?? ''}`,
    '',
    '## Ordered Tasks',
    '',
    ...(input.orderedTaskIds.length > 0
      ? input.orderedTaskIds.map((taskId, index) => `- ${taskLine(input.tasksById.get(taskId), taskId, index)}`)
      : ['- Henüz gruba bağlı task yok.']),
    ''
  ].join('\n')
}
