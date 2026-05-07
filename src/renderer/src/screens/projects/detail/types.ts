import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import type { CodexCliModel, Gateway, OutputFormat } from '@shared/types/entities'
import type { CodexChatPhase } from '@shared/utils/codex-chat-phase'

export type DetailViewMode = 'task' | 'subtask'
export type DetailTab = 'subtasks' | 'customFields' | 'checklist' | 'attachments' | 'details' | 'agent' | 'skills' | 'model'
export type ProjectPromptTab = 'context' | 'prompt' | 'planGuide' | 'output' | 'rules' | 'postRun'
export type ProjectSettingsTab = 'statuses' | 'workspace' | 'projectGroup' | 'agents' | 'skills' | 'models' | 'language' | 'promptShape' | 'codex'
export type TextDraftRow = { id: string; title: string }
export type CustomFieldDraftRow = { id: string; field: AppSelectOption | null; value: string }
export type DataFormatRole = OutputFormat['formatRole']
export type CodexModelsResponse = { gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }

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
  source?: 'codex-plan' | 'codex-run' | 'comment' | 'history' | 'local' | 'codex-chat'
  role?: 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'thinking'
  status?: 'queued' | 'running' | 'completed' | 'failed'
  phase?: CodexChatPhase
  metadata?: Record<string, unknown>
}

export type TaskActivityMessage = {
  id: string
  runId: string
  conversationId?: string
  source: 'codex-plan' | 'codex-run' | 'codex-chat'
  phase?: CodexChatPhase
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
  phase: CodexChatPhase
  model?: string
}

export type GeneratedContextEntry = {
  id: string
  conversationId: string
  source: ChatMessageSource
  phase: CodexChatPhase
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
export type CodexRunFeedback = { kind: 'error' | 'success'; message: string }
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
