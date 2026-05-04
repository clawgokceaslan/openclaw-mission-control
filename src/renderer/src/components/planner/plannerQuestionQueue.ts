import type { Project, TaskEntity } from '@shared/types/entities'
import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import { conversationIdOf, plannerQuestionPromptFromMessages, type PlannerQuestionPrompt } from '@renderer/screens/projects/detail/chat/chatUtils'
import { projectCodexSettings } from '@renderer/screens/projects/detail/projectDetailUtils'

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

export function plannerQuestionItemFromActivity(event: PlannerQuestionActivityEvent): PlannerQuestionQueueItem | null {
  const message = event.message
  if (!message) return null
  const metadata = asRecord(message.metadata)
  if (message.source !== 'codex-plan' || message.role !== 'assistant' || metadata?.codexBlock !== 'planner-question') return null
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
  const codex = projectCodexSettings(project)
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
