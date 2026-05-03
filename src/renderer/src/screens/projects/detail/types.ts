import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import type { CodexCliModel, Gateway, OutputFormat } from '@shared/types/entities'

export type DetailViewMode = 'task' | 'subtask'
export type DetailTab = 'subtasks' | 'customFields' | 'checklist' | 'attachments' | 'details' | 'agent' | 'skills' | 'model'
export type ProjectPromptTab = 'context' | 'prompt' | 'planGuide' | 'output' | 'rules'
export type ProjectSettingsTab = 'statuses' | 'workspace' | 'projectGroup' | 'agents' | 'codex'
export type ProjectViewMode = 'list' | 'table' | 'board'
export type TextDraftRow = { id: string; title: string }
export type CustomFieldDraftRow = { id: string; field: AppSelectOption | null; value: string }
export type DataFormatRole = OutputFormat['formatRole']
export type TableColumnKind = 'index' | 'name' | 'assignee' | 'status' | 'due' | 'tags' | 'subtasks' | 'priority' | 'custom'
export type TableColumnConfig = {
  id: string
  kind: TableColumnKind
  label: string
  width: number
  required?: boolean
  customFieldId?: string
}
export type ProjectTableViewConfig = { columns?: TableColumnConfig[]; columnWidths?: Record<string, number> }
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
  metadata?: Record<string, unknown>
}

export type TaskActivityMessage = {
  id: string
  runId: string
  conversationId?: string
  source: 'codex-plan' | 'codex-run' | 'codex-chat'
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
  model?: string
}

export type ChatComposerMode = 'chat' | 'steer'
export type ChatAttachmentDraft = {
  id: string
  name: string
  size: number
  bytes: number[]
}
export type CodexRunFeedback = { kind: 'error' | 'success'; message: string }
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
