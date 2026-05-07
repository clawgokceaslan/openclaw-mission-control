import type { Project, TaskEntity } from '@shared/types/entities'
import { gatewayMetadataBlock } from '@shared/utils/gateway-chat-phase'
import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import { asRecord, conversationIdOf, plannerQuestionPromptFromMessages, type PlannerQuestionPrompt } from '@renderer/screens/projects/detail/chat/chatUtils'
import { projectGatewaySettings } from '@renderer/screens/projects/detail/projectDetailUtils'

export type PlannerQuestionQueueItem = {
  id: string
  projectId: string
  taskId: string
  taskTitle: string
  conversationId: string
  createdAt: number
  prompt: PlannerQuestionPrompt
  gatewayId?: string
  model?: string
  language?: string
  reasoningEffort?: string
}

export type PlannerQuestionActivityEvent = {
  projectId?: string
  taskId?: string
  message?: TaskActivityMessage
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function activityMessagesFromTaskPayload(task: TaskEntity): TaskActivityMessage[] {
  const messages = task.payload?.activityMessages
  if (!Array.isArray(messages)) return []
  return messages.filter((message): message is TaskActivityMessage => {
    const record = asRecord(message)
    return Boolean(
      record
      && typeof record.id === 'string'
      && typeof record.runId === 'string'
      && typeof record.source === 'string'
      && typeof record.role === 'string'
      && typeof record.body === 'string'
      && typeof record.createdAt === 'number'
    )
  })
}

function isPlannerQuestionMessage(message: TaskActivityMessage): boolean {
  const metadata = asRecord(message.metadata)
  return message.source === 'gateway-plan' && message.role === 'assistant' && gatewayMetadataBlock(metadata) === 'planner-question'
}

function isClarificationAnswerFor(message: TaskActivityMessage, conversationId: string, after: number): boolean {
  if (message.createdAt <= after) return false
  if (message.role !== 'user') return false
  if (conversationIdOf(message) !== conversationId) return false
  return asRecord(message.metadata)?.clarification === true
}

export function plannerQuestionItemFromActivity(event: PlannerQuestionActivityEvent): PlannerQuestionQueueItem | null {
  const message = event.message
  if (!message) return null
  const metadata = asRecord(message.metadata)
  if (message.source !== 'gateway-plan' || message.role !== 'assistant' || gatewayMetadataBlock(metadata) !== 'planner-question') return null
  const prompt = plannerQuestionPromptFromMessages([message])
  if (!prompt) return null
  const conversationId = prompt.conversationId
  const projectId = stringValue(metadata.projectId) ?? event.projectId
  const taskId = stringValue(metadata.taskId) ?? event.taskId
  if (!projectId || !taskId || !conversationId) return null
  return {
    id: message.id,
    projectId,
    taskId,
    taskTitle: stringValue(metadata.taskTitle) ?? 'Task',
    conversationId,
    createdAt: message.createdAt,
    prompt,
    gatewayId: stringValue(metadata.gatewayId),
    model: stringValue(metadata.model),
    language: stringValue(metadata.language),
    reasoningEffort: stringValue(metadata.reasoningEffort)
  }
}

export function enqueuePlannerQuestion(queue: PlannerQuestionQueueItem[], item: PlannerQuestionQueueItem): PlannerQuestionQueueItem[] {
  if (queue.some((current) => current.id === item.id)) return queue
  return [...queue, item].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function unansweredPlannerQuestionsFromTasks(tasks: TaskEntity[]): PlannerQuestionQueueItem[] {
  return tasks
    .flatMap((task) => {
      const messages = activityMessagesFromTaskPayload(task)
      return messages.flatMap((message): PlannerQuestionQueueItem[] => {
        if (!isPlannerQuestionMessage(message)) return []
        const conversationId = conversationIdOf(message)
        if (!conversationId) return []
        if (messages.some((candidate) => isClarificationAnswerFor(candidate, conversationId, message.createdAt))) return []
        const item = plannerQuestionItemFromActivity({ projectId: task.projectId, taskId: task.id, message })
        if (!item) return []
        return [{
          ...item,
          projectId: item.projectId || task.projectId,
          taskId: item.taskId || task.id,
          taskTitle: item.taskTitle && item.taskTitle !== 'Task' ? item.taskTitle : task.title || 'Task'
        }]
      })
    })
    .reduce<PlannerQuestionQueueItem[]>((queue, item) => enqueuePlannerQuestion(queue, item), [])
}

export function removeAnsweredPlannerQuestions(queue: PlannerQuestionQueueItem[], message: TaskActivityMessage): PlannerQuestionQueueItem[] {
  const metadata = asRecord(message.metadata)
  if (message.role !== 'user' || metadata?.clarification !== true) return queue
  const conversationId = conversationIdOf(message)
  if (!conversationId) return queue
  return queue.filter((item) => item.conversationId !== conversationId || item.createdAt >= message.createdAt)
}

export function resolvePlannerQuestionConfig(input: {
  item: PlannerQuestionQueueItem
  task?: TaskEntity | null
  project?: Project | null
  globalLanguage?: string | null
}): { projectId: string; taskId: string; taskTitle: string; gatewayId: string; model: string; language: string; reasoningEffort: string } {
  const project = input.project ?? null
  const task = input.task ?? null
  const codex = projectGatewaySettings(project)
  return {
    projectId: input.item.projectId || task?.projectId || project?.id || '',
    taskId: input.item.taskId || task?.id || '',
    taskTitle: input.item.taskTitle && input.item.taskTitle !== 'Task' ? input.item.taskTitle : task?.title || input.item.taskTitle || 'Task',
    gatewayId: input.item.gatewayId || codex.gatewayId || '',
    model: input.item.model || codex.planModel || codex.defaultModel || '',
    language: input.item.language || codex.language || codex.outputLanguage || codex.inputLanguage || input.globalLanguage || 'tr',
    reasoningEffort: input.item.reasoningEffort || codex.planReasoningEffort || 'medium'
  }
}
