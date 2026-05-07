import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import type { CodexCliModel, Gateway, OutputFormat } from '@shared/types/entities'
import type { GatewayChatPhase } from '@shared/utils/gateway-chat-phase'

export type DetailViewMode = 'task' | 'subtask'
export type DetailTab = 'subtasks' | 'customFields' | 'checklist' | 'attachments' | 'details' | 'agent' | 'skills' | 'model'
export type ProjectPromptTab = 'context' | 'prompt' | 'planGuide' | 'output' | 'rules' | 'postRun'
export type ProjectSettingsTab = 'statuses' | 'workspace' | 'projectGroup' | 'agents' | 'skills' | 'models' | 'language' | 'promptShape' | 'codex'
export type TextDraftRow = { id: string; title: string }
export type CustomFieldDraftRow = { id: string; field: AppSelectOption | null; value: string }
export type DataFormatRole = OutputFormat['formatRole']
export type GatewayModelsResponse = { gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }

export type TaskHistoryItem = {
  at: number
  patch: string
}

export type ThreadEntry = {
  id: string
  at: number
  author: string
  eventType: string
  summary: string
  fields: Array<{ key: string; value: string }>
  evidence: string[]
  next?: string
  source?: 'gateway-plan' | 'gateway-run' | 'comment' | 'history' | 'local' | 'gateway-chat'
  role?: 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'thinking'
  status?: 'queued' | 'running' | 'completed' | 'failed'
  phase?: GatewayChatPhase
  metadata?: Record<string, unknown>
}

export type TaskActivityMessage = {
  id: string
  runId: string
  conversationId?: string
  source: 'gateway-plan' | 'gateway-run' | 'gateway-chat'
  phase?: GatewayChatPhase
  role: 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'thinking'
  status?: 'queued' | 'running' | 'completed' | 'failed'
  body: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt?: number
}

export type ChatMessageSource = TaskActivityMessage['source']
export type ChatMessageRole = TaskActivityMessage['role']
export type ChatMessageStatus = NonNullable<TaskActivityMessage['status']>

export type ChatConversationSummary = {
  id: string
  title: string
  count: number
  status: ChatMessageStatus | 'event'
  at: number
  source: ChatMessageSource
  phase: GatewayChatPhase
  model?: string
}

export type GeneratedContextEntry = {
  id: string
  conversationId: string
  source: ChatMessageSource
  phase: GatewayChatPhase
  title: string
  status: ChatMessageStatus | 'event'
  at: number
  preview: string
  body: string
  metadata: Array<{ key: string; value: string }>
}

export type ChatComposerMode = 'chat' | 'steer'
export type ChatAttachmentDraft = {
  id: string
  name: string
  size: number
  bytes: number[]
}
export type GatewayRunFeedback = { kind: 'error' | 'success'; message: string }
export type PlannerClarificationMode = 'ask-first' | 'direct'
export type ChatOperationState = 'running' | 'success' | 'error'
export type ChatOperationFeedbackData = {
  state: ChatOperationState
  title: string
  message: string
}
export type SlashCommand = {
  id: 'plan' | 'run' | 'steer' | 'settings' | 'attach' | 'context'
  label: string
  hint: string
}
