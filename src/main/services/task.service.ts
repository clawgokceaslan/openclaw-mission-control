import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import EventEmitter from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { appendFile, copyFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type {
  AddTaskCommentRequest,
  CodexChatResolveRequest,
  CodexChatStopRequest,
  CodexChatSendRequest,
  ExportTaskSnapshotRequest,
  ImportTaskJsonRequest,
  PlanTaskCodexRequest,
  RemoveTaskCommentRequest,
  RunTaskCodexRequest,
  SetTaskSkillsRequest,
  SetTaskTagsRequest,
  TaskPlannerContextRequest,
  TaskPlannerJsonRequest,
  UpdateTaskSubtaskRequest,
  UpdateTaskCommentRequest
} from '../../shared/contracts/ipc.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import type { ProjectStatus, Skill, Tag, TaskChecklistItem, TaskComment, TaskEntity, TaskJsonImportResult, TaskSubtask } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { TaskRepository, TaskSkillRepository, TaskSubtaskRepository, TaskTagRepository } from '../../db/repositories/task-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { CustomFieldRepository, TagRepository } from '../../db/repositories/custom-field-repo.js'
import { SkillRepository } from '../../db/repositories/skill-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { StatusRepository } from '../../db/repositories/status-repo.js'
import { AppSettingsRepository, WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { DEFAULT_AGENT_KEY } from './app-settings.service.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'
import type { NormalizedTaskJsonImport } from './task-json-import.js'
import { safeConsole } from '../utils/safe-output.js'
import { maybeShowCodexChatCompletionNotification } from '../utils/codex-notifications.js'
import { formatUsageSummary, parseCodexEvents, type CodexNormalizedEvent, type CodexUsageSummary } from '../../shared/utils/codex-events.js'

const execFileAsync = promisify(execFile)

type TaskPayload = Record<string, unknown> & {
  description?: string
  comments?: TaskComment[]
  checklist?: TaskChecklistItem[]
  customFields?: Record<string, unknown>
}

type PlannerBridgeContext = {
  actorToken?: string
  projectId: string
  taskId: string
  finishFilePath?: string
  terminalTitle?: string
  workspaceRunPath?: string
  runId?: string
  conversationId?: string
  gatewayId?: string
  model?: string
  mode?: 'plan' | 'execute'
  exportWorkspacePath?: string
  runtimeWorkspacePath?: string
}

type PlannerLaunchResult = {
  runFolderPath: string
  runtimeWorkspacePath: string
  model: string
  gatewayId: string
  command: string
  bridgeUrl: string
  executionMode?: 'terminal' | 'exec'
  runId?: string
  conversationId?: string
  pid?: number
  eventsPath?: string
  finalMessagePath?: string
}

type CodexTerminalRun = {
  finishFilePath: string
  terminalTitle: string
}

type ActiveCodexChatRun = {
  child: ChildProcess
  taskId: string
  conversationId: string
  runId: string
  stopRequested?: boolean
}

type ProjectPromptSnapshot = {
  generalContext: string
  generalPrompt: string
  planGuide: string
  defaultOutput: string
  rules: string
}

export type PlannerQuestionItem = {
  id: string
  question: string
  why?: string
}

export type PlannerQuestionPayload = {
  summary: string
  questions: PlannerQuestionItem[]
}

type CodexExecutionMode = 'terminal' | 'exec'

type TaskActivityMessage = {
  id: string
  runId: string
  conversationId?: string
  source: 'codex-plan' | 'codex-run'
    | 'codex-chat'
    | 'comment'
    | 'history'
  role: 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'thinking'
  status?: 'queued' | 'running' | 'completed' | 'failed'
  body: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt?: number
}

function asPayload(value: unknown): TaskPayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as TaskPayload) : {}
}

function asComments(value: unknown): TaskComment[] {
  if (!Array.isArray(value)) return []
  const comments: TaskComment[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const comment = raw as Record<string, unknown>
    if (typeof comment.body !== 'string' || !comment.body.trim()) continue
    comments.push({
      id: typeof comment.id === 'string' ? comment.id : randomUUID(),
      authorName: typeof comment.authorName === 'string' && comment.authorName.trim() ? comment.authorName : 'Operator',
      body: comment.body,
      createdAt: typeof comment.createdAt === 'number' ? comment.createdAt : Date.now()
    })
  }
  return comments
}

function asChecklistItems(value: unknown): TaskChecklistItem[] {
  if (!Array.isArray(value)) return []
  const items: TaskChecklistItem[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title) continue
    const now = Date.now()
    items.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : randomUUID(),
      title,
      checked: item.checked === true,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now
    })
  }
  return items
}

function payloadStringList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function customFieldEntries(values: Record<string, unknown> | undefined, customFields: Array<{ id: string; name: string; type?: string }>): Array<{ name: string; value: unknown }> {
  if (!values) return []
  return Object.entries(values).flatMap(([fieldId, value]) => {
    const field = customFields.find((item) => item.id === fieldId)
    const name = field?.name ?? fieldId
    return name ? [{ name, value }] : []
  })
}

function taskPlannerJson(task: TaskEntity, customFields: Array<{ id: string; name: string; type?: string }>): Record<string, unknown> {
  const taskPayload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload)
    ? task.payload as Record<string, unknown>
    : {}
  const taskAgenticInputs = taskPayload.agenticInputs && typeof taskPayload.agenticInputs === 'object' && !Array.isArray(taskPayload.agenticInputs)
    ? taskPayload.agenticInputs as Record<string, unknown>
    : {}
  const acceptanceCriteria = typeof taskAgenticInputs.acceptanceCriteria === 'string' ? taskAgenticInputs.acceptanceCriteria : ''
  const subtasks = (task.subtasks ?? []).map((subtask) => {
    const payload = subtask.payload && typeof subtask.payload === 'object' && !Array.isArray(subtask.payload)
      ? subtask.payload as Record<string, unknown>
      : {}
    const customFieldValues = payload.customFields && typeof payload.customFields === 'object' && !Array.isArray(payload.customFields)
      ? payload.customFields as Record<string, unknown>
      : {}
    return {
      title: subtask.title,
      description: typeof payload.description === 'string' ? payload.description : subtask.description ?? '',
      status: subtask.status,
      tags: payloadStringList(payload, 'tagIds'),
      checklist: asChecklistItems(payload.checklistItems),
      customFields: customFieldEntries(customFieldValues, customFields),
      comments: asComments(payload.comments),
      ...(typeof payload.dueAt === 'number' ? { dueAt: payload.dueAt } : {})
    }
  })
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    tags: (task.tags ?? []).map((tag) => tag.name || tag.id),
    agenticInputs: {
      acceptanceCriteria
    },
    checklist: task.checklistItems ?? [],
    customFields: customFieldEntries(task.customFieldValues, customFields),
    comments: task.comments ?? [],
    subtasks
  }
}

function enrichSubtask(item: TaskSubtask): TaskSubtask {
  const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
    ? item.payload as Record<string, unknown>
    : {}
  const description = typeof payload.description === 'string' ? payload.description : ''
  const assigneeId = typeof payload.assigneeId === 'string' ? payload.assigneeId : undefined
  const assigneeName = typeof payload.assigneeName === 'string' ? payload.assigneeName : undefined
  const dueAt = typeof payload.dueAt === 'number' ? payload.dueAt : undefined
  return {
    ...item,
    payload,
    description,
    assigneeId,
    assigneeName,
    dueAt
  }
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

function sanitizeFileName(name: string | undefined, fallback = 'attachment'): string {
  const normalized = (name || fallback).trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ')
  return normalized || fallback
}

function zipBufferFromPayload(value: unknown): Buffer | null {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return Buffer.from(value)
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return zipBufferFromPayload((value as { data: number[] }).data)
  }
  return null
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function terminalTitle(value: string): string {
  return value.replace(/[\r\n]/g, ' ').slice(0, 200)
}

async function closeTerminalWindowByTitle(title: string): Promise<void> {
  if (process.platform !== 'darwin' || !title.trim()) return
  await execFileAsync('osascript', [
    '-e',
    'tell application "Terminal"',
    '-e',
    'repeat with terminalWindow in windows',
    '-e',
    'repeat with terminalTab in tabs of terminalWindow',
    '-e',
    `if custom title of terminalTab is ${appleScriptString(title)} then`,
    '-e',
    'close terminalWindow',
    '-e',
    'return',
    '-e',
    'end if',
    '-e',
    'end repeat',
    '-e',
    'end repeat',
    '-e',
    'end tell'
  ], { timeout: 5_000 }).catch(() => undefined)
}

function closeTerminalWindowByTitleShell(titleVariable = 'TERMINAL_TITLE'): string {
  return [
    'if [ -n "${' + titleVariable + ':-}" ]; then',
    '  (sleep 1; /usr/bin/osascript \\',
    '    -e \'tell application "Terminal"\' \\',
    '    -e \'repeat with terminalWindow in windows\' \\',
    '    -e \'repeat with terminalTab in tabs of terminalWindow\' \\',
    '    -e "if custom title of terminalTab is \\""${' + titleVariable + '}"\\" then" \\',
    '    -e \'close terminalWindow\' \\',
    '    -e \'return\' \\',
    '    -e \'end if\' \\',
    '    -e \'end repeat\' \\',
    '    -e \'end repeat\' \\',
    '    -e \'end tell\' >/dev/null 2>&1) &',
    'fi'
  ].join('\n')
}

function projectPromptSnapshot(project: { generalContext?: string | null; generalPrompt?: string | null; defaultOutput?: string | null; metrics?: Record<string, unknown> | null }): ProjectPromptSnapshot {
  const metrics = project.metrics && typeof project.metrics === 'object' && !Array.isArray(project.metrics) ? project.metrics : {}
  const rules = (metrics as Record<string, unknown>).projectRules
  const planGuide = (metrics as Record<string, unknown>).projectPlanGuide
  return {
    generalContext: project.generalContext ?? '',
    generalPrompt: project.generalPrompt ?? '',
    planGuide: typeof planGuide === 'string' ? planGuide : '',
    defaultOutput: project.defaultOutput ?? '',
    rules: typeof rules === 'string' ? rules : ''
  }
}

function codexTrustedProjectConfig(path: string): string {
  return `projects.${JSON.stringify(path)}.trust_level="trusted"`
}

function codexCliConfig(value: unknown): { codexPath: string; executionMode: CodexExecutionMode } {
  const template = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    codexPath: typeof template.codexPath === 'string' && template.codexPath.trim() ? template.codexPath.trim() : 'codex',
    executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal'
  }
}

function taskActivityMessagesFromPayload(payload: unknown): TaskActivityMessage[] {
  const source = asPayload(payload).activityMessages
  if (!Array.isArray(source)) return []
  return source.filter((item): item is TaskActivityMessage => {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Partial<TaskActivityMessage>
    return typeof candidate.id === 'string'
      && typeof candidate.runId === 'string'
      && typeof candidate.body === 'string'
      && typeof candidate.createdAt === 'number'
  })
}

function projectCodexRuntimeWorkspaceId(project: { metrics?: Record<string, unknown> }): string | null {
  const codex = project.metrics?.codex
  if (!codex || typeof codex !== 'object' || Array.isArray(codex)) return null
  const runtimeWorkspaceId = (codex as Record<string, unknown>).runtimeWorkspaceId
  return typeof runtimeWorkspaceId === 'string' && runtimeWorkspaceId.trim() ? runtimeWorkspaceId.trim() : null
}

function initialCodexPrompt(exportWorkspacePath: string, runtimeWorkspacePath: string, projectId: string, taskId: string, omcInstructionsPath: string): string {
  return [
    `Open Mission Control runtime workspace is ${runtimeWorkspacePath}.`,
    `The exported task files are in ${exportWorkspacePath}.`,
    `The Open Mission Control project id is ${projectId} and task id is ${taskId}.`,
    `Before making changes, read the run-specific .omc CLI instructions at ${omcInstructionsPath} in the runtime workspace.`,
    `Read ${exportWorkspacePath}/Task.md, ${exportWorkspacePath}/Agents.md, ${exportWorkspacePath}/Skills.md, and ${exportWorkspacePath}/attachments/ if present.`,
    'Apply the Project Rules section in Task.md before making implementation decisions.',
    'Apply the Plan Guide section in Task.md when planning or interpreting the task execution strategy.',
    'Execute the task described in Task.md.',
    'Respect subtask status instructions: bypass subtasks marked completed/done/closed.',
    'Do not use MCP in this flow.',
    'Use the local .omc CLI ready-for-review operation only after implementation and checks are complete.',
    'When the implementation is complete, summarize the changed files and remaining checks in Codex.',
    'Do not ask for the ZIP; all exported files are already available in the export directory.'
  ].join(' ')
}

export const PLANNER_GENERIC_TEXT_REJECT_LIST = [
  'Test yap',
  'Run tests',
  'Fix bugs',
  'Fix issue',
  'Implement feature',
  'Implement UI',
  'Check everything'
]

const PLANNED_SUBTASK_REQUIRED_DESCRIPTION_SECTIONS = [
  'Objective',
  'Task context',
  'Exact work',
  'Files/areas',
  'Done when'
]

function plannerJsonGuidance() {
  return {
    planningPolicy: {
      subtaskRewrite: 'Refactor the entire subtasks array on every planning update, including completed/done/closed subtasks. Treat current subtasks as input context, not immutable history.',
      granularity: 'extreme',
      primaryExecutionPlan: 'Subtasks are the primary execution plan that will later be exported into Task.md for Codex Run.',
      noGenericWork: 'No generic tasks or checklist items such as Test yap, Run tests, Fix bugs, Implement feature, Implement UI, or Check everything.'
    },
    subtaskPolicy: [
      'Create one subtask per meaningful operation, file/module group, UI state, backend/data-flow change, migration, verification step, and edge-case handling area.',
      'Every subtask must include a detailed markdown description with Objective, Task context, Exact work, Files/areas, and Done when sections.',
      'Every subtask must include unchecked checklist items that are specific to that subtask.',
      'Checklist verification items must name concrete commands, screens, behaviors, or file areas.'
    ],
    plannedSubtaskTemplate: {
      title: 'Specific action-oriented subtask title',
      description: '## Objective\n...\n\n## Task context\n...\n\n## Exact work\n...\n\n## Files/areas\n...\n\n## Done when\n...',
      checklist: [
        { title: 'Specific implementation or verification item for this subtask', checked: false }
      ]
    },
    genericTextRejectList: PLANNER_GENERIC_TEXT_REJECT_LIST
  }
}

export function initialPlannerPrompt(projectId: string, taskId: string, helperPath: string, contextPath: string, plannedTaskPath: string): string {
  const questionsPath = plannedTaskPath.replace(/planned-task\.json$/i, 'questions.json')
  return [
    'You are planning an Open Mission Control task inside Codex TUI.',
    'Do not use MCP for this flow. Use the local helper CLI in this workspace.',
    `First run: node ${helperPath} context > ${contextPath}`,
    `The project id is ${projectId} and the source task id is ${taskId}.`,
    'Plan the current task from its task-detail data: title, description, custom fields, checklist, comments, tags, and subtasks.',
    'Apply the project context, prompt, Plan Guide, default output, and Project Rules from the context JSON before producing the planned task.',
    `If critical details are missing and guessing would weaken the plan, write ${questionsPath} with { "summary": "...", "questions": [{ "id": "...", "question": "...", "why": "..." }] } and run: node ${helperPath} ask ${questionsPath}`,
    'The AI must produce the clarification questions itself. After ask succeeds, do not write planned-task.json, do not validate, and do not update the task.',
    'Refactor the entire subtasks array. Completed, done, and closed subtasks are input context and may be rewritten in the planned task JSON.',
    'Use extreme decomposition: split every meaningful operation, file/module group, UI state, backend/data-flow change, migration, verification step, and edge-case handling area into its own subtask.',
    'No generic test tasks or generic checklist items. Do not write vague items like Test yap, Run tests, Fix bugs, Implement feature, Implement UI, or Check everything.',
    'For every subtask, consider its title, description, custom fields, checklist, comments, tags, status, and due date.',
    'Every planned subtask description must include Objective, Task context, Exact work, Files/areas, and Done when sections.',
    'Every planned subtask must include concrete unchecked checklist items. Verification checklist items must name exact commands, screens, behaviors, or file areas.',
    `Use ${contextPath} currentTaskJson as the starting JSON shape and revise it into the planned task JSON.`,
    `Write the planned JSON to ${plannedTaskPath}.`,
    `After writing, run: node ${helperPath} validate ${plannedTaskPath}`,
    `After validation succeeds, update the scoped source task by running: node ${helperPath} update ${plannedTaskPath}`,
    'Do not create a new task in this planning flow.',
    `If you need to create a new task instead, ask the user first, then run: node ${helperPath} create ${plannedTaskPath}`,
    `After the update succeeds, run: node ${helperPath} finish`
  ].join(' ')
}

function plannerClarificationPrompt(input: {
  conversationId: string
  clarificationMessage?: string
  transcript: TaskActivityMessage[]
}): string {
  if (!input.clarificationMessage?.trim() && input.transcript.length === 0) return ''
  const transcript = input.transcript
    .slice(-32)
    .map((item) => `${item.role.toUpperCase()}: ${item.body}`)
    .join('\n\n')
  return [
    `This planning run continues plan conversation ${input.conversationId}.`,
    input.clarificationMessage?.trim()
      ? `User clarification answer:\n${input.clarificationMessage.trim()}`
      : '',
    transcript ? `Recent plan conversation transcript:\n${transcript}` : '',
    'Use the user clarification as the highest-priority answer to the planner questions, then re-run context and continue planning.'
  ].filter(Boolean).join('\n\n')
}

type PromptComment = {
  authorName: string
  body: string
  createdAt: number
}

function promptCommentsFromUnknown(value: unknown): PromptComment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): PromptComment[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const comment = raw as Record<string, unknown>
    const body = typeof comment.body === 'string' ? comment.body.trim() : ''
    if (!body) return []
    return [{
      authorName: typeof comment.authorName === 'string' && comment.authorName.trim() ? comment.authorName.trim() : 'Operator',
      body,
      createdAt: typeof comment.createdAt === 'number' && Number.isFinite(comment.createdAt) ? comment.createdAt : 0
    }]
  })
}

function formatPromptComment(comment: PromptComment): string {
  const date = new Date(comment.createdAt)
  const dateLabel = Number.isNaN(date.getTime()) ? 'unknown date' : date.toISOString()
  return `- ${comment.authorName}, ${dateLabel}: ${comment.body}`
}

function subtaskCommentSectionsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): string[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const subtask = raw as Record<string, unknown>
    const title = typeof subtask.title === 'string' && subtask.title.trim() ? subtask.title.trim() : 'Untitled subtask'
    const payload = asPayload(subtask.payload)
    const comments = promptCommentsFromUnknown(Array.isArray(subtask.comments) ? subtask.comments : payload.comments)
    if (comments.length === 0) return []
    return [`Subtask: ${title}\n${comments.map(formatPromptComment).join('\n')}`]
  })
}

function importantTaskCommentsSection(task: TaskEntity, context?: unknown): string {
  const sections: string[] = []
  const contextRecord = asPayload(context)
  const currentTaskJson = asPayload(contextRecord.currentTaskJson)
  const taskCommentsSource = Array.isArray(currentTaskJson.comments) ? currentTaskJson.comments : task.comments
  const taskComments = promptCommentsFromUnknown(taskCommentsSource)
  if (taskComments.length > 0) {
    sections.push(`Task comments:\n${taskComments.map(formatPromptComment).join('\n')}`)
  }

  const subtaskSource = Array.isArray(currentTaskJson.subtasks) ? currentTaskJson.subtasks : task.subtasks
  const subtaskSections = subtaskCommentSectionsFromUnknown(subtaskSource)
  if (subtaskSections.length > 0) {
    sections.push(`Subtask comments:\n${subtaskSections.join('\n\n')}`)
  }

  return sections.length > 0 ? `Important task comments:\n${sections.join('\n\n')}` : ''
}

function compactPlannerText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}\s/.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
}

function isGenericPlannerText(value: string): boolean {
  const text = compactPlannerText(value)
  if (!text) return true
  const words = text.split(' ').filter(Boolean)
  const generic = PLANNER_GENERIC_TEXT_REJECT_LIST.map(compactPlannerText)
  if (generic.includes(text)) return true
  if (words.length <= 2 && ['test', 'verify', 'validate', 'check', 'fix', 'implement', 'update', 'review'].some((word) => text.includes(word))) return true
  if (words.length <= 4 && [
    'test yap',
    'run tests',
    'fix bugs',
    'fix issue',
    'implement feature',
    'implement ui',
    'check everything',
    'edge cases',
    'handle edge cases',
    'make changes',
    'update code'
  ].includes(text)) return true
  return false
}

function hasPlannerDescriptionSection(description: string, section: string): boolean {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('/', '\\s*/\\s*')
  return new RegExp(`(^|\\n)\\s{0,3}(#{1,6}\\s*)?${escaped}\\s*:?`, 'iu').test(description)
}

export function validatePlannerTaskJsonQuality(normalized: NormalizedTaskJsonImport): string[] {
  const issues: string[] = []
  if (!normalized.description.trim()) issues.push('Task description is required for planner updates.')
  if (!normalized.agenticInputs.acceptanceCriteria?.trim()) issues.push('agenticInputs.acceptanceCriteria is required for planner updates.')
  if (normalized.subtasks.length === 0) issues.push('At least one planned subtask is required.')

  normalized.subtasks.forEach((subtask, index) => {
    const label = `subtasks[${index}]`
    if (!subtask.title.trim()) issues.push(`${label}.title is required.`)
    if (isGenericPlannerText(subtask.title)) issues.push(`${label}.title is too generic.`)
    if (!subtask.description.trim()) {
      issues.push(`${label}.description is required.`)
    } else {
      for (const section of PLANNED_SUBTASK_REQUIRED_DESCRIPTION_SECTIONS) {
        if (!hasPlannerDescriptionSection(subtask.description, section)) issues.push(`${label}.description must include a "${section}" section.`)
      }
    }
    if (subtask.checklistItems.length === 0) {
      issues.push(`${label}.checklist must include concrete unchecked items.`)
    }
    subtask.checklistItems.forEach((item, itemIndex) => {
      const itemLabel = `${label}.checklist[${itemIndex}]`
      if (!item.title.trim()) issues.push(`${itemLabel}.title is required.`)
      if (isGenericPlannerText(item.title)) issues.push(`${itemLabel}.title is too generic.`)
      if (item.checked) issues.push(`${itemLabel}.checked must be false for planned work.`)
    })
  })

  return issues
}

export function codexChatPrompt(input: {
  task: TaskEntity
  message: string
  transcript: TaskActivityMessage[]
  context?: unknown
  mode?: 'chat' | 'plan' | 'steer'
  attachments?: Array<{ name: string; path: string }>
}): string {
  const transcript = input.transcript
    .slice(-24)
    .map((item) => `${item.role.toUpperCase()}: ${item.body}`)
    .join('\n\n')
  const modeInstruction = input.mode === 'plan'
    ? 'The user invoked /plan. Stay in planning mode: reason about the work, propose a clear plan, and do not make code or file changes unless the user explicitly asks.'
    : input.mode === 'steer'
      ? 'The user is steering an existing Codex conversation. Treat the user steer instruction and task comments as high-signal guidance for continuing the existing conversation.'
      : 'Continue the task chat normally. Primary instruction is the user follow-up prompt; use task details as supporting context.'
  const attachments = input.attachments?.length
    ? `Attached files for this message:\n${input.attachments.map((item) => `- ${item.name}: ${item.path}`).join('\n')}`
    : ''
  const contextRecord = input.context && typeof input.context === 'object' && !Array.isArray(input.context) ? input.context as Record<string, unknown> : {}
  const projectRecord = contextRecord.project && typeof contextRecord.project === 'object' && !Array.isArray(contextRecord.project) ? contextRecord.project as Record<string, unknown> : {}
  const projectRules = typeof projectRecord.rules === 'string' && projectRecord.rules.trim() ? `Project Rules:\n${projectRecord.rules.trim()}` : ''
  const projectPlanGuide = typeof projectRecord.planGuide === 'string' && projectRecord.planGuide.trim() ? `Project Plan Guide:\n${projectRecord.planGuide.trim()}` : ''
  const userPromptLabel = input.mode === 'steer'
    ? 'User steer instruction'
    : input.mode === 'plan'
      ? 'User prompt'
      : 'User follow-up'
  const importantComments = importantTaskCommentsSection(input.task, input.context)
  return [
    'You are continuing an Open Mission Control task chat.',
    modeInstruction,
    `${userPromptLabel}:\n${input.message}`,
    importantComments,
    `Task id: ${input.task.id}`,
    `Task title: ${input.task.title}`,
    input.task.description ? `Task description:\n${input.task.description}` : '',
    input.context ? `Current task context JSON:\n${JSON.stringify(input.context, null, 2)}` : '',
    input.mode === 'plan' ? projectPlanGuide : '',
    projectRules,
    transcript ? `Recent chat transcript:\n${transcript}` : '',
    attachments,
    'Respond with concrete next steps or implementation notes. If you make changes, summarize files and checks.',
    'Do not use MCP in this flow.'
  ].filter(Boolean).join('\n\n')
}

type CodexThinkingSegment = {
  text: string
  durationMs?: number
  startedAt?: number
  endedAt?: number
}

type CodexActivityStreamContext = {
  taskId: string
  runId: string
  conversationId?: string
  source: TaskActivityMessage['source']
  eventsPath: string
}

type CodexActivityAppender = (message: Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => Promise<TaskActivityMessage | null>

type CodexActivityStreamer = {
  writeStdout: (chunk: string) => void
  writeStderr: (chunk: string) => void
  flush: () => Promise<void>
  hasAssistantMessage: () => boolean
  latestUsage: () => CodexUsageSummary | undefined
}

const ACTIVITY_MESSAGE_LIMIT = 300
const ACTIVITY_BODY_LIMIT = 18_000
const ACTIVITY_METADATA_STRING_LIMIT = 2_000
const CODEX_COMMAND_OUTPUT_LIMIT = 4_000
const CODEX_RAW_OUTPUT_LIMIT = 2_000
const CODEX_DIFF_PATCH_LIMIT = 10_000
const CODEX_STREAM_FLUSH_MS = 850
const CODEX_STREAM_BATCH_LIMIT = 8

function truncateCodexText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false }
  return { text: `${value.slice(0, limit)}\n\n[truncated ${value.length - limit} chars]`, truncated: true }
}

function compactMetadata(value: unknown): unknown {
  if (typeof value === 'string') return truncateCodexText(value, ACTIVITY_METADATA_STRING_LIMIT).text
  if (Array.isArray(value)) return value.slice(0, 20).map(compactMetadata)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, compactMetadata(item)]))
  }
  return value
}

function compactActivityMessage(
  message: Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
): Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number } {
  const body = truncateCodexText(message.body, ACTIVITY_BODY_LIMIT)
  const metadata = message.metadata ? Object.fromEntries(Object.entries(message.metadata).map(([key, value]) => [key, compactMetadata(value)])) : undefined
  return {
    ...message,
    body: body.text,
    metadata: metadata || body.truncated
      ? { ...(metadata ?? {}), truncated: metadata?.truncated === true || body.truncated }
      : undefined
  }
}

function codexCommandBody(event: Extract<CodexNormalizedEvent, { kind: 'command' }>): { body: string; truncated: boolean } {
  const parts = [
    `Command: ${event.command}`,
    `Status: ${event.status}${event.exitCode === undefined ? '' : ` (exit ${event.exitCode})`}`
  ]
  if (event.output?.trim()) {
    const output = truncateCodexText(event.output.trim(), CODEX_COMMAND_OUTPUT_LIMIT)
    parts.push('', '```text', output.text, '```')
    return { body: parts.join('\n'), truncated: output.truncated }
  }
  return { body: parts.join('\n'), truncated: false }
}

function codexEventStatus(event: CodexNormalizedEvent): TaskActivityMessage['status'] {
  if (event.kind === 'command') {
    if (event.exitCode !== undefined && event.exitCode !== 0) return 'failed'
    return event.status === 'failed' ? 'failed' : event.status === 'running' ? 'running' : 'completed'
  }
  return 'completed'
}

function createCodexActivityStreamer(context: CodexActivityStreamContext, append: CodexActivityAppender): CodexActivityStreamer {
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let queue = Promise.resolve()
  let assistantSeen = false
  let usage: CodexUsageSummary | undefined
  let pendingMessages: Array<Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }> = []
  let pendingRawLogs: string[] = []
  let flushTimer: NodeJS.Timeout | undefined

  const flushPending = async (drainAll = false) => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    const rawLogs = pendingRawLogs
    pendingRawLogs = []
    if (rawLogs.length > 0) {
      const joined = rawLogs.join('\n')
      const truncated = truncateCodexText(joined, CODEX_RAW_OUTPUT_LIMIT)
      pendingMessages.push({
        runId: context.runId,
        conversationId: context.conversationId,
        source: context.source,
        role: 'tool',
        status: 'completed',
        body: truncated.text,
        metadata: { codexBlock: 'log', runStatus: 'running', eventsPath: context.eventsPath, truncated: truncated.truncated || joined.length > truncated.text.length, logLines: rawLogs.length }
      })
    }
    const messages = pendingMessages.splice(0, drainAll ? pendingMessages.length : CODEX_STREAM_BATCH_LIMIT)
    for (const message of messages) await append(compactActivityMessage(message))
    if (!drainAll && (pendingMessages.length > 0 || pendingRawLogs.length > 0)) scheduleFlush(0)
  }

  const enqueueFlush = () => {
    queue = queue.then(() => flushPending()).catch((error) => {
      safeConsole.warn('[codex-stream] failed to append activity event', error instanceof Error ? error.message : String(error))
    })
  }

  const scheduleFlush = (delay = CODEX_STREAM_FLUSH_MS) => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      enqueueFlush()
    }, delay)
    flushTimer.unref?.()
  }

  const pushMessage = (message: Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => {
    pendingMessages.push(message)
    if (pendingMessages.length >= CODEX_STREAM_BATCH_LIMIT) {
      enqueueFlush()
      return
    }
    scheduleFlush()
  }

  const appendEvent = (event: CodexNormalizedEvent) => {
    if (event.kind === 'status') {
      usage = event.usage ?? usage
      return
    }

    if (event.kind === 'command') {
      if (!event.command.trim()) return
      if ((event.status === 'started' || event.status === 'running') && !event.output?.trim()) return
      const formatted = codexCommandBody(event)
      pushMessage({
        runId: context.runId,
        conversationId: context.conversationId,
        source: context.source,
        role: 'tool',
        status: codexEventStatus(event),
        body: formatted.body,
        metadata: {
          codexBlock: 'command',
          runStatus: 'running',
          command: event.command,
          commandStatus: event.status,
          exitCode: event.exitCode,
          eventsPath: context.eventsPath,
          truncated: formatted.truncated
        }
      })
      return
    }

    if (event.kind === 'message') {
      const body = event.text.trim()
      if (!body) return
      if (event.role === 'assistant') assistantSeen = true
      pushMessage({
        runId: context.runId,
        conversationId: context.conversationId,
        source: context.source,
        role: event.role,
        status: 'completed',
        body,
        metadata: {
          codexBlock: event.role === 'thinking' ? 'thinking' : event.role === 'assistant' ? 'assistant' : 'message',
          runStatus: 'running',
          eventsPath: context.eventsPath,
          thinkingDurationMs: event.durationMs,
          thinkingStartedAt: event.startedAt,
          thinkingEndedAt: event.endedAt
        }
      })
      return
    }

    const body = truncateCodexText(event.text.trim(), CODEX_RAW_OUTPUT_LIMIT)
    if (!body.text) return
    pushMessage({
      runId: context.runId,
      conversationId: context.conversationId,
      source: context.source,
      role: 'tool',
      status: event.kind === 'malformed' ? 'failed' : 'completed',
      body: body.text,
      metadata: {
        codexBlock: event.kind === 'raw' ? 'log' : event.kind,
        runStatus: 'running',
        eventsPath: context.eventsPath,
        truncated: body.truncated
      }
    })
  }

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const parsed = parseCodexEvents(trimmed)
    for (const event of parsed.events) appendEvent(event)
  }

  const drainLines = (buffer: string, flush: boolean): string => {
    const lines = buffer.split(/\r?\n/)
    const rest = flush ? '' : lines.pop() ?? ''
    for (const line of lines) processLine(line)
    if (flush && rest.trim()) processLine(rest)
    return rest
  }

  const processRawStderr = (line: string) => {
    const body = line.trim()
    if (!body) return
    pendingRawLogs.push(body)
    if (pendingRawLogs.length >= CODEX_STREAM_BATCH_LIMIT) {
      enqueueFlush()
      return
    }
    scheduleFlush()
  }

  const drainRawLines = (buffer: string, flush: boolean): string => {
    const lines = buffer.split(/\r?\n/)
    const rest = flush ? '' : lines.pop() ?? ''
    for (const line of lines) processRawStderr(line)
    if (flush && rest.trim()) processRawStderr(rest)
    return rest
  }

  return {
    writeStdout: (chunk: string) => {
      void appendFile(context.eventsPath, chunk, 'utf8')
      stdoutBuffer = drainLines(`${stdoutBuffer}${chunk}`, false)
    },
    writeStderr: (chunk: string) => {
      void appendFile(context.eventsPath, chunk, 'utf8')
      stderrBuffer = drainRawLines(`${stderrBuffer}${chunk}`, false)
    },
    flush: async () => {
      stdoutBuffer = drainLines(stdoutBuffer, true)
      stderrBuffer = drainRawLines(stderrBuffer, true)
      await queue
      await flushPending(true)
    },
    hasAssistantMessage: () => assistantSeen,
    latestUsage: () => usage
  }
}

function parseGitNumstat(value: string): { files: number; insertions: number; deletions: number; fileStats: Array<{ path: string; insertions: number; deletions: number }> } {
  return value.trim().split(/\r?\n/).filter(Boolean).reduce((summary, line) => {
    const [insertions, deletions, ...pathParts] = line.split(/\s+/)
    const fileStat = {
      path: pathParts.join(' '),
      insertions: insertions === '-' ? 0 : Number(insertions) || 0,
      deletions: deletions === '-' ? 0 : Number(deletions) || 0
    }
    return {
      files: summary.files + 1,
      insertions: summary.insertions + fileStat.insertions,
      deletions: summary.deletions + fileStat.deletions,
      fileStats: fileStat.path ? [...summary.fileStats, fileStat] : summary.fileStats
    }
  }, { files: 0, insertions: 0, deletions: 0, fileStats: [] as Array<{ path: string; insertions: number; deletions: number }> })
}

function parsePatchPath(chunk: string): string | null {
  const plusLine = chunk.split(/\r?\n/).find((line) => line.startsWith('+++ '))
  if (plusLine) return plusLine.replace(/^\+\+\+\s+b\//, '').replace(/^\+\+\+\s+/, '').trim()
  const diffLine = chunk.split(/\r?\n/).find((line) => line.startsWith('diff --git '))
  const match = diffLine?.match(/\sb\/(.+)$/)
  return match?.[1]?.trim() || null
}

function parseGitPatchStats(value: string): {
  files: number
  blocks: number
  fileStats: Array<{ path: string; insertions: number; deletions: number; blocks: number }>
} {
  const chunks = value.split(/(?=^diff --git\s)/m).map((chunk) => chunk.trim()).filter(Boolean)
  const fileStats = chunks.map((chunk) => {
    const lines = chunk.split(/\r?\n/)
    const path = parsePatchPath(chunk) || `change-${chunks.indexOf(chunk) + 1}`
    const insertions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    const blocks = lines.filter((line) => line.startsWith('@@ ')).length
    return { path, insertions, deletions, blocks }
  })
  return {
    files: fileStats.length,
    blocks: fileStats.reduce((total, entry) => total + entry.blocks, 0),
    fileStats
  }
}

function mergeChangeFileStats(
  numstatStats: { files: number; insertions: number; deletions: number; fileStats: Array<{ path: string; insertions: number; deletions: number }> },
  patchStats: { files: number; blocks: number; fileStats: Array<{ path: string; insertions: number; deletions: number; blocks: number }> }
): {
  files: number
  insertions: number
  deletions: number
  blocks: number
  fileStats: Array<{ path: string; insertions: number; deletions: number; blocks: number }>
} {
  const pathMap = new Map<string, { path: string; insertions: number; deletions: number; blocks: number }>()
  for (const item of numstatStats.fileStats) {
    pathMap.set(item.path, {
      path: item.path,
      insertions: item.insertions,
      deletions: item.deletions,
      blocks: 0
    })
  }
  for (const item of patchStats.fileStats) {
    const current = pathMap.get(item.path)
    if (!current) {
      pathMap.set(item.path, item)
      continue
    }
    current.blocks = Math.max(current.blocks, item.blocks)
  }
  const merged = Array.from(pathMap.values())
  return {
    files: Math.max(numstatStats.files, patchStats.files, merged.length),
    insertions: merged.reduce((sum, item) => sum + item.insertions, 0),
    deletions: merged.reduce((sum, item) => sum + item.deletions, 0),
    blocks: Math.max(patchStats.blocks, merged.reduce((sum, item) => sum + item.blocks, 0)),
    fileStats: merged
  }
}

async function codexWorkspaceChanges(runtimeWorkspacePath: string, changesPath?: string): Promise<{
  body: string
  truncated: boolean
  unavailable?: boolean
  changesPath?: string
  metadata?: Record<string, unknown>
}> {
  try {
    const statusResult = await execFileAsync('git', ['status', '--short', '--untracked-files=all', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 2 * 1024 * 1024
    })
    const statResult = await execFileAsync('git', ['diff', '--stat', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 2 * 1024 * 1024
    })
    const numstatResult = await execFileAsync('git', ['diff', '--numstat', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 2 * 1024 * 1024
    })
    const patchResult = await execFileAsync('git', ['diff', '--patch', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 8 * 1024 * 1024
    })
    const status = String(statusResult.stdout).trim()
    const stat = String(statResult.stdout).trim()
    const numstat = String(numstatResult.stdout).trim()
    const patch = String(patchResult.stdout).trim()
    if (!status && !stat && !patch) return {
      body: 'No workspace changes detected.',
      truncated: false,
      metadata: {
        changeHasNoChanges: true,
        changeStatus: status,
        changeStat: stat,
        changeFiles: 0,
        changeInsertions: 0,
        changeDeletions: 0,
        changeFileStats: [],
        changeBlocks: 0,
        patchPreviewLanguage: 'text'
      }
    }
    if (changesPath && patch) await writeFile(changesPath, patch, 'utf8').catch(() => undefined)
    const truncatedPatch = truncateCodexText(patch, CODEX_DIFF_PATCH_LIMIT)
    const numstatSummary = parseGitNumstat(numstat)
    const patchSummary = parseGitPatchStats(patch)
    const mergedSummary = mergeChangeFileStats(numstatSummary, patchSummary)
    return {
      body: [
        'Changes',
        '',
        status ? ['Status', '````text', status, '````'].join('\n') : '',
        stat ? ['Stat', '````text', stat, '````'].join('\n') : '',
        truncatedPatch.text ? ['', '````diff', truncatedPatch.text, '````'].join('\n') : ''
      ].filter(Boolean).join('\n'),
      truncated: truncatedPatch.truncated,
      changesPath: changesPath && patch ? changesPath : undefined,
      metadata: {
        changeStatus: status,
        changeStat: stat,
        changeFiles: mergedSummary.files,
        changeInsertions: mergedSummary.insertions,
        changeDeletions: mergedSummary.deletions,
        changeBlocks: mergedSummary.blocks,
        changeFileStats: mergedSummary.fileStats,
        changeHasNoChanges: mergedSummary.files === 0 && mergedSummary.blocks === 0,
        patchPreviewLanguage: 'diff'
      }
    }
  } catch (error) {
    return {
      body: `Workspace changes could not be inspected.\n\n\`\`\`\`text\n${error instanceof Error ? error.message : String(error)}\n\`\`\`\``,
      truncated: false,
      unavailable: true,
      metadata: {
        changeFiles: 0,
        changeInsertions: 0,
        changeDeletions: 0,
        patchPreviewLanguage: 'text'
      }
    }
  }
}

function summarizeCodexExecEvents(
  raw: string,
  options?: { startedAt?: number; endedAt?: number }
): {
  thinking: string
  thinkingSegments: CodexThinkingSegment[]
  tools: string
  rawTail: string
  usage?: CodexUsageSummary
} {
  const parsed = parseCodexEvents(raw)
  const commandRows = parsed.commands.slice(-12).map((event) => {
    const output = event.output?.trim()
      ? `\n${event.output.trim().split(/\r?\n/).slice(-8).join('\n')}`
      : ''
    const exit = event.exitCode === undefined ? '' : ` (exit ${event.exitCode})`
    return `- ${event.status}: ${event.command}${exit}${output}`
  })
  const messageRows = parsed.messages
    .filter((event) => event.role === 'assistant' || event.role === 'thinking')
    .slice(-5)
    .map((event) => `- ${event.role}: ${event.text.trim()}`)
  const issueRows = parsed.events
    .filter((event): event is { kind: 'malformed' | 'raw'; text: string } => event.kind === 'malformed' || event.kind === 'raw')
    .slice(-6)
    .map((event) => `- ${event.text}`)
  const thinkingSegments = parsed.messages
    .filter((event) => event.role === 'thinking')
    .slice(-10)
    .map((event) => ({
      text: event.text.trim(),
      durationMs: event.durationMs,
      startedAt: event.startedAt,
      endedAt: event.endedAt
    }))
    .filter((event) => event.text)
  const completed = parsed.statuses.some((event) => event.type === 'turn.completed')
  const usageLine = formatUsageSummary(parsed.usage)
  const thinking = completed
    ? `Codex completed its turn${usageLine ? ` (${usageLine})` : ''}.`
    : parsed.commands.length > 0
      ? `Codex ran ${parsed.commands.length} command${parsed.commands.length === 1 ? '' : 's'}.`
      : parsed.messages.length > 0
        ? 'Codex produced a response.'
        : 'Codex processed the request.'
  const toolSections = [
    commandRows.length ? `Commands\n${commandRows.join('\n')}` : '',
    messageRows.length ? `Messages\n${messageRows.join('\n')}` : '',
    usageLine ? `Usage\n- ${usageLine}` : '',
    issueRows.length ? `Raw / malformed\n${issueRows.join('\n')}` : ''
  ].filter(Boolean)
  const fallbackDurationMs = typeof options?.startedAt === 'number' && typeof options?.endedAt === 'number'
    ? Math.max(0, options.endedAt - options.startedAt)
    : undefined
  const normalizedThinkingSegments = [...thinkingSegments]
  if (normalizedThinkingSegments.length === 1 && fallbackDurationMs && !normalizedThinkingSegments[0].durationMs) {
    const segment = normalizedThinkingSegments[0]
    normalizedThinkingSegments[0] = {
      ...segment,
      durationMs: fallbackDurationMs,
      startedAt: typeof segment.startedAt === 'number' ? segment.startedAt : options?.startedAt,
      endedAt: typeof segment.endedAt === 'number' ? segment.endedAt : options?.endedAt
    }
  }
  return {
    thinking,
    thinkingSegments: normalizedThinkingSegments,
    tools: toolSections.join('\n\n'),
    rawTail: parsed.rawTail,
    usage: parsed.usage
  }
}

function safeAttachmentName(name: string, index: number): string {
  const base = name.trim().replace(/[/\\]/g, '-').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
  return base || `attachment-${index + 1}`
}

function attachmentBytes(value: ArrayBuffer | Uint8Array | number[] | undefined): Buffer {
  if (!value) return Buffer.alloc(0)
  if (Array.isArray(value)) return Buffer.from(value)
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(new Uint8Array(value))
}

function readRequestBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('error', reject)
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function sanitizeOmcLogValue(value: unknown): unknown {
  const seen = new WeakSet<object>()
  const sensitiveKeys = new Set(['authorization', 'token', 'actortoken', 'bridgetoken', 'password'])
  try {
    const json = JSON.stringify(value, (key, rawValue) => {
      if (sensitiveKeys.has(key.toLowerCase())) return '[redacted]'
      if (rawValue && typeof rawValue === 'object') {
        if (seen.has(rawValue)) return '[circular]'
        seen.add(rawValue)
      }
      return rawValue
    })
    if (!json) return value
    if (json.length > 8000) return `${json.slice(0, 8000)}... [truncated]`
    return JSON.parse(json)
  } catch {
    return '[unserializable]'
  }
}

function logPlannerApiBridgeEvent(event: string, data: Record<string, unknown>): void {
  safeConsole.info(`[omc-cli-bridge] ${event}`, sanitizeOmcLogValue(data))
}

export function normalizePlannerQuestionPayload(value: unknown): ServiceResponse<PlannerQuestionPayload> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return errorResponse(ErrorCodes.Validation, 'Planner question payload must be an object')
  }
  const record = value as Record<string, unknown>
  const summary = typeof record.summary === 'string' && record.summary.trim()
    ? record.summary.trim()
    : 'Planner needs clarification before updating this task.'
  const questions = Array.isArray(record.questions)
    ? record.questions.flatMap((raw, index): PlannerQuestionItem[] => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
        const questionRecord = raw as Record<string, unknown>
        const question = typeof questionRecord.question === 'string' ? questionRecord.question.trim() : ''
        if (!question) return []
        const rawId = typeof questionRecord.id === 'string' ? questionRecord.id.trim() : ''
        const why = typeof questionRecord.why === 'string' && questionRecord.why.trim() ? questionRecord.why.trim() : undefined
        return [{ id: rawId || `question-${index + 1}`, question, why }]
      })
    : []
  if (questions.length === 0) return errorResponse(ErrorCodes.Validation, 'Planner ask requires at least one question')
  return okResponse({ summary, questions })
}

function plannerQuestionBody(payload: PlannerQuestionPayload): string {
  return [
    'Planner paused for clarification.',
    '',
    payload.summary,
    '',
    'Questions:',
    ...payload.questions.flatMap((item, index) => {
      const lines = [`${index + 1}. ${item.question}`]
      if (item.why) lines.push(`   Why: ${item.why}`)
      return lines
    })
  ].join('\n')
}

function omcTaskPlannerClientScript(): string {
  return `#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const command = process.argv[2] || 'help';
const inputPath = process.argv[3];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const sessionPath = resolve(scriptDir, 'session.json');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readInputJson() {
  if (inputPath) return readJson(inputPath);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new Error('JSON input file or stdin JSON is required.');
  return JSON.parse(raw);
}

async function callApi(path, method, body) {
  const session = await readJson(sessionPath);
  const response = await fetch(session.bridgeUrl + path, {
    method,
    headers: {
      authorization: 'Bearer ' + session.bridgeToken,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { ok: false, error: { message: text || 'Invalid API response' } };
  }
  if (!response.ok || payload.ok === false) {
    const message = payload.error?.message || payload.error || 'Open Mission Control API call failed.';
    throw new Error(message);
  }
  return payload.data ?? payload;
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n');
}

try {
  if (command === 'context') {
    print(await callApi('/context', 'GET'));
  } else if (command === 'validate') {
    print(await callApi('/validate-task-json', 'POST', { json: await readInputJson() }));
  } else if (command === 'create') {
    print(await callApi('/create-task', 'POST', { json: await readInputJson() }));
  } else if (command === 'update') {
    print(await callApi('/update-task', 'POST', { json: await readInputJson() }));
  } else if (command === 'ask') {
    print(await callApi('/planner-question', 'POST', await readInputJson()));
  } else if (command === 'ready-for-review') {
    print(await callApi('/ready-for-review', 'POST', {}));
  } else if (command === 'finish') {
    print(await callApi('/finish', 'POST', {}));
  } else {
    const session = await readJson(sessionPath).catch(() => null);
    const runBase = session?.runId ? '.omc/runs/' + session.runId : '.omc/runs/<runId>';
    print({
      usage: [
        'node ' + runBase + '/omc-task-client.mjs context',
        'node ' + runBase + '/omc-task-client.mjs validate ' + runBase + '/planned-task.json',
        'node ' + runBase + '/omc-task-client.mjs create ' + runBase + '/planned-task.json',
        'node ' + runBase + '/omc-task-client.mjs update ' + runBase + '/planned-task.json',
        'node ' + runBase + '/omc-task-client.mjs ask ' + runBase + '/questions.json',
        'node ' + runBase + '/omc-task-client.mjs ready-for-review',
        'node ' + runBase + '/omc-task-client.mjs finish'
      ]
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`
}

function plannerRunId(taskId: string): string {
  return `${slugPart(taskId, 'task')}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

function plannerRunRelativePath(runId: string, fileName: string): string {
  return `.omc/runs/${runId}/${fileName}`
}

export function omcCliInstructions(context: {
  mode: 'plan' | 'execute'
  projectId: string
  taskId: string
  runId: string
  helperRelativePath: string
  contextRelativePath: string
  plannedTaskRelativePath: string
  exportWorkspacePath?: string
  runtimeWorkspacePath: string
}): string {
  const helper = context.helperRelativePath
  const questionsRelativePath = plannerRunRelativePath(context.runId, 'questions.json')
  const lines = [
    '# Open Mission Control CLI',
    '',
    'Use this local helper for Open Mission Control operations in this Codex run. Do not use MCP.',
    '',
    `- Mode: ${context.mode}`,
    `- Project id: ${context.projectId}`,
    `- Task id: ${context.taskId}`,
    `- Runtime workspace: ${context.runtimeWorkspacePath}`,
    `- Run folder: .omc/runs/${context.runId}`,
    ...(context.exportWorkspacePath ? [`- Export workspace: ${context.exportWorkspacePath}`] : []),
    '',
    '## Commands',
    '',
    `- Context: \`node ${helper} context > ${context.contextRelativePath}\``,
    `- Validate task JSON: \`node ${helper} validate ${context.plannedTaskRelativePath}\``,
    `- Create task from JSON: \`node ${helper} create ${context.plannedTaskRelativePath}\``,
    `- Update scoped task from JSON: \`node ${helper} update ${context.plannedTaskRelativePath}\``,
    `- Ask user clarification questions: \`node ${helper} ask ${questionsRelativePath}\``,
    `- Move task to review: \`node ${helper} ready-for-review\``,
    `- Finish without status change: \`node ${helper} finish\``,
    '',
    '## Rules',
    '',
    '- Run context before planning or when you need project/task metadata.',
    '- Run validate before create or update.',
    '- Planning runs should write planned-task.json, validate it, update the scoped task, then finish.',
    '- If missing information would materially reduce plan quality, do not guess. Write questions.json with { summary, questions: [{ id, question, why }] } and run ask instead.',
    '- After running ask, do not write planned-task.json, do not validate, and do not update the task. Stop and wait for the user answer in chat.',
    '- Planning runs must refactor the entire subtasks array, including completed/done/closed subtasks. Existing subtasks are context, not protected history.',
    '- Planning granularity is extreme: split each operation, file/module group, UI state, backend/data-flow change, migration, verification step, and edge-case handling area into its own subtask.',
    '- No generic test tasks or generic checklist items. Avoid Test yap, Run tests, Fix bugs, Implement feature, Implement UI, and Check everything.',
    '- Every planned subtask needs Objective, Task context, Exact work, Files/areas, and Done when sections plus concrete unchecked checklist items.',
    '- Execution runs should edit project files first, run appropriate checks, then use ready-for-review only when the implementation is complete.',
    '- The helper is scoped to this project and task through session.json; do not edit session.json.'
  ]
  return `${lines.join('\n')}\n`
}

async function ensureWorkspaceOmcIgnored(runtimeWorkspacePath: string): Promise<boolean> {
  const gitignorePath = join(runtimeWorkspacePath, '.gitignore')
  let current: string
  try {
    current = await readFile(gitignorePath, 'utf8')
  } catch {
    return false
  }
  const alreadyIgnored = current.split(/\r?\n/).some((line) => line.trim() === '.omc/' || line.trim() === '.omc')
  if (alreadyIgnored) return true
  const next = `${current}${current.endsWith('\n') || !current ? '' : '\n'}.omc/\n`
  await writeFile(gitignorePath, next, 'utf8')
  return true
}

async function cleanupOldPlannerRuns(runtimeWorkspacePath: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const runsPath = join(runtimeWorkspacePath, '.omc', 'runs')
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await readdir(runsPath, { withFileTypes: true })
  } catch {
    return
  }
  const cutoff = Date.now() - maxAgeMs
  await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const path = join(runsPath, entry.name)
      try {
        const info = await stat(path)
        if (info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true })
      } catch { }
    }))
}

export class TaskService {
  private readonly codexTerminalRuns = new Map<string, CodexTerminalRun>()
  private readonly activeCodexChatRuns = new Map<string, ActiveCodexChatRun>()
  private readonly pausedPlannerRunIds = new Set<string>()

  constructor(
    private readonly auth: AuthService,
    private readonly repo: TaskRepository,
    private readonly subtaskRepo: TaskSubtaskRepository,
    private readonly taskTagRepo: TaskTagRepository,
    private readonly taskSkillRepo: TaskSkillRepository,
    private readonly projects: ProjectRepository,
    private readonly tags: TagRepository,
    private readonly skills: SkillRepository,
    private readonly customFields: CustomFieldRepository,
    private readonly agents: AgentRepository,
    private readonly statuses: StatusRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly gateways: GatewayRepository,
    private readonly appSettings: AppSettingsRepository,
    private readonly eventBus?: EventEmitter
  ) { }

  private async findProjectOrg(projectId: string): Promise<string | undefined> {
    const project = await this.projects.get(projectId)
    return project?.organizationId
  }

  private emitTaskUpdated(projectId: string, taskId: string, action: string): void {
    this.eventBus?.emit(IPC_CHANNELS.events.taskUpdated, { projectId, taskId, action, updatedAt: Date.now() })
  }

  private async setTaskCodexPlanState(taskId: string, codexPlanState: Record<string, unknown>): Promise<void> {
    const task = await this.repo.get(taskId)
    if (!task) return
    const payload = asPayload(task.payload)
    await this.repo.update(task.id, { payload: { ...payload, codexPlanState } })
    this.emitTaskUpdated(task.projectId, task.id, 'codex_plan_state')
  }

  private async finishPlannerBridgeRuntime(context: PlannerBridgeContext): Promise<void> {
    if (context.finishFilePath) await writeFile(context.finishFilePath, `finished ${new Date().toISOString()}\n`, 'utf8').catch(() => undefined)
    if (context.workspaceRunPath) {
      setTimeout(() => {
        void rm(context.workspaceRunPath ?? '', { recursive: true, force: true })
      }, 2_000).unref?.()
    }
    if (context.terminalTitle) {
      setTimeout(() => {
        void closeTerminalWindowByTitle(context.terminalTitle ?? '')
      }, 1_500).unref?.()
    }
  }

  private async appendPlannerQuestionActivity(
    context: PlannerBridgeContext,
    payload: PlannerQuestionPayload
  ): Promise<ServiceResponse<{ conversationId: string; questionCount: number }>> {
    const access = await this.ensureTaskAccess(context.actorToken, context.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<{ conversationId: string; questionCount: number }>
    if (context.projectId && context.projectId !== access.data.task.projectId) return errorResponse(ErrorCodes.Validation, 'Project id does not match task')
    const runId = context.runId ?? plannerRunId(context.taskId)
    const conversationId = context.conversationId?.trim() || runId
    if (context.runId) this.pausedPlannerRunIds.add(context.runId)
    await this.setTaskCodexPlanState(context.taskId, {
      state: 'needs-clarification',
      askedAt: Date.now(),
      conversationId,
      runId,
      model: context.model ?? null
    })
    await this.appendTaskActivityMessage(context.taskId, {
      runId,
      conversationId,
      source: 'codex-plan',
      role: 'assistant',
      status: 'completed',
      body: plannerQuestionBody(payload),
      metadata: { codexBlock: 'planner-question', summary: payload.summary, questions: payload.questions }
    })
    await this.appendTaskActivityMessage(context.taskId, {
      runId,
      conversationId,
      source: 'codex-plan',
      role: 'system',
      status: 'completed',
      body: 'Planner paused for clarification.',
      metadata: { codexBlock: 'run-complete', plannerPaused: true, questionCount: payload.questions.length }
    })
    return okResponse({ conversationId, questionCount: payload.questions.length })
  }

  private async appendTaskActivityMessage(
    taskId: string,
    message: Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
  ): Promise<TaskActivityMessage | null> {
    const task = await this.repo.get(taskId)
    if (!task) return null
    const now = Date.now()
    const compactMessage = compactActivityMessage(message)
    const nextMessage: TaskActivityMessage = {
      id: message.id ?? `codex-activity-${randomUUID()}`,
      runId: compactMessage.runId,
      conversationId: compactMessage.conversationId,
      source: compactMessage.source,
      role: compactMessage.role,
      status: compactMessage.status,
      body: compactMessage.body,
      metadata: compactMessage.metadata,
      createdAt: compactMessage.createdAt ?? now,
      updatedAt: now
    }
    const payload = asPayload(task.payload)
    const activityMessages = [...taskActivityMessagesFromPayload(payload), nextMessage].slice(-ACTIVITY_MESSAGE_LIMIT)
    await this.repo.update(task.id, { payload: { ...payload, activityMessages } })
    this.eventBus?.emit(IPC_CHANNELS.events.taskActivity, {
      projectId: task.projectId,
      taskId: task.id,
      message: nextMessage,
      updatedAt: now
    })
    this.emitTaskUpdated(task.projectId, task.id, 'activity')
    return nextMessage
  }

  private async ensureTaskAccess(actorToken: string | undefined, taskId: string): Promise<ServiceResponse<{ actorOrgId: string; task: TaskEntity }>> {
    const actor = await this.auth.requireActor(actorToken)
    const task = await this.repo.get(taskId)
    if (!task) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    const orgId = await this.findProjectOrg(task.projectId)
    if (!orgId || orgId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse({ actorOrgId: actor.user.organizationId, task })
  }

  private async normalizeAgentId(actorOrgId: string, agentId: unknown): Promise<ServiceResponse<string | null>> {
    if (agentId === null || agentId === undefined || agentId === '') return okResponse(null)
    if (typeof agentId !== 'string') return errorResponse(ErrorCodes.Validation, 'Agent id is invalid')
    const agent = await this.agents.get(agentId)
    if (!agent) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (agent.organizationId !== actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Agent access denied')
    return okResponse(agent.id)
  }

  private async normalizeStatus(projectId: string, orgId: string, status: unknown): Promise<ServiceResponse<string>> {
    const statuses = await this.statuses.ensureProjectDefaults(projectId, orgId)
    const fallback = statuses.find((item) => item.category === 'not_started') ?? statuses[0]
    if (!fallback) return errorResponse(ErrorCodes.Validation, 'Project has no statuses')
    if (status === undefined || status === null || status === '') return okResponse(fallback.id)
    if (typeof status !== 'string') return errorResponse(ErrorCodes.Validation, 'Status is invalid')
    const legacy: Record<string, string> = {
      pending: 'not_started',
      running: 'active',
      failed: 'active',
      completed: 'done'
    }
    const legacyCategory = legacy[status]
    if (legacyCategory) {
      return okResponse((statuses.find((item) => item.category === legacyCategory) ?? fallback).id)
    }
    const found = statuses.find((item) => item.id === status)
    const foundByName = found ?? statuses.find((item) => item.name.trim().toLocaleLowerCase('tr') === status.trim().toLocaleLowerCase('tr'))
    if (!foundByName) return errorResponse(ErrorCodes.Validation, 'Status is not part of this project')
    return okResponse(foundByName.id)
  }

  private reviewTargetStatus(statuses: ProjectStatus[]): ProjectStatus | undefined {
    const review = statuses.find((item) => item.name.trim().toLocaleLowerCase('tr') === 'review')
    if (review) return review
    const done = statuses.find((item) => item.category === 'done')
    if (done) {
      const beforeDone = statuses
        .filter((item) => item.id !== done.id && item.sortOrder < done.sortOrder)
        .sort((a, b) => b.sortOrder - a.sortOrder)[0]
      if (beforeDone) return beforeDone
    }
    return statuses.find((item) => item.category === 'active') ?? done ?? statuses[0]
  }

  private async signalCodexTerminalRun(taskId: string): Promise<void> {
    const run = this.codexTerminalRuns.get(taskId)
    if (!run) return
    this.codexTerminalRuns.delete(taskId)
    await writeFile(run.finishFilePath, `finished ${new Date().toISOString()}\n`, 'utf8').catch(() => undefined)
    setTimeout(() => {
      void closeTerminalWindowByTitle(run.terminalTitle)
    }, 1_500).unref?.()
  }

  private async enrichTasks(tasks: TaskEntity[]): Promise<TaskEntity[]> {
    const ids = tasks.map((task) => task.id)
    const [tagsByTaskId, skillsByTaskId, subtasksByTaskId] = await Promise.all([
      this.taskTagRepo.listByTaskIds(ids),
      this.taskSkillRepo.listByTaskIds(ids),
      this.subtaskRepo.listByTaskIds(ids)
    ])
    return tasks.map((task) => {
      const payload = asPayload(task.payload)
      const comments = asComments(payload.comments)
      const checklistItems = asChecklistItems(payload.checklist)
      const description = typeof payload.description === 'string' ? payload.description : ''
      const customFieldValues = asPayload(payload.customFields)
      return {
        ...task,
        description,
        comments,
        commentCount: comments.length,
        tags: tagsByTaskId[task.id] ?? [],
        skills: skillsByTaskId[task.id] ?? [],
        subtasks: (subtasksByTaskId[task.id] ?? []).map(enrichSubtask),
        checklistItems,
        customFieldValues
      }
    })
  }

  async list(payload: { actorToken?: string; projectId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskEntity[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    let rows: TaskEntity[] = []
    if (payload?.projectId) {
      const orgId = await this.findProjectOrg(payload.projectId)
      if (!orgId || orgId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
      rows = await this.repo.list(payload.projectId)
    } else {
      rows = await this.repo.listAll(actor.user.organizationId)
    }
    return okResponse(await this.enrichTasks(rows))
  }

  async get(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskEntity>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskEntity>
    const [task] = await this.enrichTasks([access.data.task])
    return okResponse(task)
  }

  private async payloadWithAppendStatusOrder(projectId: string, status: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const nextPayload = { ...payload }
    const currentStatusOrder = asPayload(nextPayload.statusOrder)
    const currentOrder = currentStatusOrder[status]
    if (typeof currentOrder === 'number' && Number.isFinite(currentOrder)) return nextPayload
    const rows = await this.repo.list(projectId)
    nextPayload.statusOrder = {
      ...currentStatusOrder,
      [status]: rows.filter((task) => task.status === status).length
    }
    return nextPayload
  }

  async create(
    payload: { actorToken?: string; projectId?: string; title?: string; status?: TaskEntity['status']; description?: string; agentId?: string | null; payload?: Record<string, unknown> },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<TaskEntity>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.projectId || !payload?.title) return errorResponse(ErrorCodes.Validation, 'ProjectId and title required')
    const projectOrg = await this.findProjectOrg(payload.projectId)
    if (!projectOrg || projectOrg !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const agentIdResponse = await this.normalizeAgentId(actor.user.organizationId, payload.agentId)
    if (!agentIdResponse.ok) return agentIdResponse as ServiceResponse<TaskEntity>
    const statusResponse = await this.normalizeStatus(payload.projectId, actor.user.organizationId, payload.status)
    if (!statusResponse.ok) return statusResponse as ServiceResponse<TaskEntity>
    const status = statusResponse.data ?? 'pending'
    const createPayload = await this.payloadWithAppendStatusOrder(payload.projectId, status, {
      ...(payload.payload ?? {}),
      description: payload.description ?? '',
      comments: []
    })
    const row = await this.repo.create({
      projectId: payload.projectId,
      title: payload.title,
      status,
      agentId: agentIdResponse.data ?? undefined,
      payload: createPayload,
      result: {}
    })
    const [task] = await this.enrichTasks([row])
    return okResponse(task)
  }

  async importJson(payload: ImportTaskJsonRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskJsonImportResult>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const targetTask = payload.taskId ? await this.repo.get(payload.taskId) : undefined
    const projectId = targetTask?.projectId ?? payload.projectId
    if (!projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const projectOrg = await this.findProjectOrg(projectId)
    if (!projectOrg || projectOrg !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    if (payload.taskId && !targetTask) return errorResponse(ErrorCodes.NotFound, 'Task not found')

    let imported
    try {
      imported = await new TaskJsonImportNormalizer(actor.user.organizationId, this.agents, this.tags, this.skills, this.customFields).normalize(payload.json)
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Invalid import JSON')
    }

    const statusResponse = await this.normalizeStatus(projectId, actor.user.organizationId, imported.status || undefined)
    if (!statusResponse.ok) return errorResponse(statusResponse.error?.code ?? ErrorCodes.Validation, statusResponse.error?.message ?? 'Project has no statuses')
    const rootStatus = statusResponse.data ?? ''
    const rootPayload = {
      ...(targetTask?.payload ?? {}),
      description: imported.description,
      comments: imported.comments,
      customFields: imported.customFieldValues,
      checklist: imported.checklistItems,
      ...(imported.agenticInputs.acceptanceCriteria ? { agenticInputs: imported.agenticInputs } : {}),
      inputFormatId: '',
      outputFormatId: ''
    }
    const createPayload = targetTask
      ? rootPayload
      : await this.payloadWithAppendStatusOrder(projectId, rootStatus, rootPayload)

    const taskRow = targetTask
      ? await this.repo.update(targetTask.id, {
        title: imported.title,
        status: rootStatus,
        agentId: targetTask.agentId ?? null,
        payload: rootPayload
      })
      : await this.repo.create({
        projectId,
        title: imported.title,
        status: rootStatus,
        agentId: imported.agentId,
        payload: createPayload,
        result: {}
      })
    if (!taskRow) return errorResponse(ErrorCodes.NotFound, 'Task not found')

    await this.taskTagRepo.setTaskTags(taskRow.id, imported.tagIds)
    if (!targetTask) await this.taskSkillRepo.setTaskSkills(taskRow.id, imported.skillIds)
    await this.subtaskRepo.removeByTask(taskRow.id)
    for (const subtask of imported.subtasks) {
      const subtaskStatusResponse = await this.normalizeStatus(projectId, actor.user.organizationId, subtask.status || rootStatus)
      if (!subtaskStatusResponse.ok) return errorResponse(subtaskStatusResponse.error?.code ?? ErrorCodes.Validation, subtaskStatusResponse.error?.message ?? 'Subtask status is invalid')
      const created = await this.subtaskRepo.create({ taskId: taskRow.id, title: subtask.title, status: subtaskStatusResponse.data ?? rootStatus })
      await this.subtaskRepo.update(created.id, {
        payload: {
          description: subtask.description,
          agentId: subtask.agentId ?? '',
          assigneeId: subtask.agentId ?? '',
          assigneeName: subtask.assigneeName,
          tagIds: subtask.tagIds,
          skillIds: subtask.skillIds,
          customFields: subtask.customFieldValues,
          checklistItems: subtask.checklistItems,
          comments: subtask.comments,
          inputFormatId: '',
          outputFormatId: '',
          ...(subtask.dueAt ? { dueAt: subtask.dueAt } : {})
        }
      })
    }

    const [task] = await this.enrichTasks([taskRow])
    this.emitTaskUpdated(projectId, task.id, targetTask ? 'updated' : 'created')
    return okResponse({ task, warnings: imported.warnings })
  }

  async plannerContext(payload: TaskPlannerContextRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Record<string, unknown>>> {
    if (!payload?.projectId || !payload.taskId) return errorResponse(ErrorCodes.Validation, 'Project and task id are required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<Record<string, unknown>>
    const project = await this.projects.get(payload.projectId)
    if (!project || project.id !== access.data.task.projectId) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const [task] = await this.enrichTasks([access.data.task])
    const defaultAgentId = await this.appSettings.get<string | null>(access.data.actorOrgId, DEFAULT_AGENT_KEY)
    const defaultAgent = defaultAgentId ? await this.agents.get(defaultAgentId) : undefined
    const effectiveDefaultAgent = defaultAgent?.organizationId === access.data.actorOrgId ? defaultAgent : undefined
    const taskForContext = !task.agentId && effectiveDefaultAgent ? { ...task, agentId: effectiveDefaultAgent.id } : task
    const [tags, skills, customFields, statuses] = await Promise.all([
      this.tags.list(access.data.actorOrgId),
      this.skills.list(access.data.actorOrgId),
      this.customFields.list(access.data.actorOrgId),
      this.statuses.ensureProjectDefaults(project.id, access.data.actorOrgId)
    ])

    return okResponse({
      project: {
        id: project.id,
        name: project.name,
        description: project.description ?? '',
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? '',
        planGuide: projectPromptSnapshot(project).planGuide,
        rules: projectPromptSnapshot(project).rules
      },
      task: taskForContext,
      effectiveAgent: effectiveDefaultAgent ? {
        id: effectiveDefaultAgent.id,
        name: effectiveDefaultAgent.name,
        inherited: !task.agentId
      } : null,
      currentTaskJson: taskPlannerJson(taskForContext, customFields),
      allowed: {
        tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
        skills: skills.map((skill) => ({ id: skill.id, name: skill.name, slug: skill.slug })),
        customFields: customFields.map((field) => ({ id: field.id, name: field.name, type: field.type, description: field.description ?? '' })),
        statuses: statuses.map((status) => ({ id: status.id, name: status.name, category: status.category }))
      },
      jsonFormat: {
        root: ['title', 'description', 'status', 'tags', 'agenticInputs', 'checklist', 'comments', 'customFields', 'subtasks'],
        subtask: ['title', 'description', 'status', 'tags', 'checklist', 'comments', 'customFields', 'dueAt'],
        note: 'Use tag names or ids. agenticInputs accepts { acceptanceCriteria }. customFields is an array of { name, value }. checklist is an array of { title, checked }. comments is an array of { body, authorName }. omc_update_task_from_json updates the scoped source task.',
        ...plannerJsonGuidance()
      }
    })
  }

  async plannerValidateJson(payload: TaskPlannerJsonRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Record<string, unknown>>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.projectId && !payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Project or task id required')
    const projectId = payload.taskId ? (await this.repo.get(payload.taskId))?.projectId : payload.projectId
    if (!projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    const projectOrg = await this.findProjectOrg(projectId)
    if (!projectOrg || projectOrg !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    try {
      const normalized = await new TaskJsonImportNormalizer(actor.user.organizationId, this.agents, this.tags, this.skills, this.customFields).normalize(payload.json)
      const qualityIssues = validatePlannerTaskJsonQuality(normalized)
      if (qualityIssues.length > 0) {
        return errorResponse(ErrorCodes.Validation, `Planner JSON quality check failed: ${qualityIssues[0]}`, { issues: qualityIssues })
      }
      return okResponse({
        valid: true,
        normalized: {
          title: normalized.title,
          description: normalized.description,
          tagIds: normalized.tagIds,
          checklistCount: normalized.checklistItems.length,
          commentCount: normalized.comments.length,
          subtaskCount: normalized.subtasks.length,
          warnings: normalized.warnings
        }
      })
    } catch (error) {
      return errorResponse(ErrorCodes.Validation, error instanceof Error ? error.message : 'Invalid task JSON')
    }
  }

  async plannerCreateFromJson(payload: TaskPlannerJsonRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskJsonImportResult>> {
    if (!payload?.projectId) return errorResponse(ErrorCodes.Validation, 'Project id required')
    return this.importJson({ actorToken: payload.actorToken, projectId: payload.projectId, json: payload.json })
  }

  async plannerUpdateFromJson(payload: TaskPlannerJsonRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskJsonImportResult>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const validation = await this.plannerValidateJson(payload)
    if (!validation.ok) return validation as ServiceResponse<TaskJsonImportResult>
    return this.importJson({ actorToken: payload.actorToken, taskId: payload.taskId, json: payload.json })
  }

  async markTaskReadyForReview(payload: { actorToken?: string; projectId?: string; taskId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ taskId: string; statusId: string; statusName: string }>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as unknown as ServiceResponse<{ taskId: string; statusId: string; statusName: string }>
    if (payload.projectId && payload.projectId !== access.data.task.projectId) return errorResponse(ErrorCodes.Validation, 'Project id does not match task')
    const statuses = await this.statuses.ensureProjectDefaults(access.data.task.projectId, access.data.actorOrgId)
    const target = this.reviewTargetStatus(statuses)
    if (!target) return errorResponse(ErrorCodes.Validation, 'Project has no statuses')
    const updated = await this.repo.update(access.data.task.id, { status: target.id })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    await this.subtaskRepo.updateStatusesByTask(access.data.task.id, target.id)
    this.emitTaskUpdated(access.data.task.projectId, access.data.task.id, 'ready_for_review')
    await this.signalCodexTerminalRun(access.data.task.id)
    return okResponse({ taskId: access.data.task.id, statusId: target.id, statusName: target.name })
  }

  async exportSnapshot(payload: ExportTaskSnapshotRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ exportFolderPath: string; writtenFiles: string[]; skippedFiles: string[] }>> {
    if (!payload?.taskId || !payload.projectId) return errorResponse(ErrorCodes.Validation, 'Task and project id are required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<{ exportFolderPath: string; writtenFiles: string[]; skippedFiles: string[] }>
    const project = await this.projects.get(payload.projectId)
    if (!project || project.id !== access.data.task.projectId) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    if (!project.workspaceId) return errorResponse(ErrorCodes.Validation, 'Project has no workspace')
    const workspace = await this.workspaces.get(project.workspaceId)
    if (!workspace || workspace.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Workspace access denied')

    const exportFolderPath = join(
      workspace.rootPath,
      'Projects',
      entityFolder(project.name, project.id, 'project'),
      'Tasks',
      entityFolder(access.data.task.title, access.data.task.id, 'task'),
      'exports'
    )
    await mkdir(exportFolderPath, { recursive: true })
    const writtenFiles: string[] = []
    const skippedFiles: string[] = []
    const writeMarkdown = async (name: string, content?: string) => {
      if (!content?.trim()) return
      await writeFile(join(exportFolderPath, name), content, 'utf8')
      writtenFiles.push(name)
    }
    await writeMarkdown('Task.md', payload.taskMarkdown)
    await writeMarkdown('Agents.md', payload.agentMarkdown)
    await writeMarkdown('Skills.md', payload.skillsMarkdown)

    const usedNames = new Set<string>()
    const attachmentsDir = join(exportFolderPath, 'attachments')
    for (const attachment of payload.attachments ?? []) {
      if (!attachment.url?.startsWith('file://')) continue
      try {
        const baseName = sanitizeFileName(attachment.exportName || attachment.name)
        const uniqueName = usedNames.has(baseName)
          ? `${baseName.replace(/(\.[^.]*)?$/, '')}-${shortHash(`${attachment.ownerId ?? ''}:${attachment.url}`)}${baseName.includes('.') ? baseName.slice(baseName.lastIndexOf('.')) : ''}`
          : baseName
        usedNames.add(uniqueName)
        await mkdir(attachmentsDir, { recursive: true })
        await copyFile(fileURLToPath(attachment.url), join(attachmentsDir, uniqueName))
        writtenFiles.push(`attachments/${uniqueName}`)
      } catch {
        skippedFiles.push(attachment.name ?? attachment.url ?? 'attachment')
      }
    }
    return okResponse({ exportFolderPath, writtenFiles, skippedFiles })
  }

  async runCodex(payload: RunTaskCodexRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ runFolderPath: string; workspacePath: string; exportWorkspacePath: string; runtimeWorkspacePath: string; model: string; gatewayId: string; command: string; executionMode?: CodexExecutionMode; runId?: string; pid?: number; eventsPath?: string; finalMessagePath?: string }>> {
    if (!payload?.taskId || !payload.projectId) return errorResponse(ErrorCodes.Validation, 'Task and project id are required')
    if (!payload.gatewayId?.trim()) return errorResponse(ErrorCodes.Validation, 'Codex gateway is required')
    if (!payload.model?.trim()) return errorResponse(ErrorCodes.Validation, 'Codex model is required')
    const zipBuffer = zipBufferFromPayload(payload.zipBytes)
    if (!zipBuffer?.length) return errorResponse(ErrorCodes.Validation, 'Task ZIP bytes are required')

    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<{ runFolderPath: string; workspacePath: string; exportWorkspacePath: string; runtimeWorkspacePath: string; model: string; gatewayId: string; command: string; executionMode?: CodexExecutionMode; runId?: string; pid?: number; eventsPath?: string; finalMessagePath?: string }>
    const project = await this.projects.get(payload.projectId)
    if (!project || project.id !== access.data.task.projectId) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const gateway = await this.gateways.get(payload.gatewayId)
    if (!gateway || gateway.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Validation, 'Codex gateway is invalid')
    const runtimeWorkspaceId = projectCodexRuntimeWorkspaceId(project)
    if (!runtimeWorkspaceId) return errorResponse(ErrorCodes.Validation, 'Project Codex runtime workspace is required')
    const runtimeWorkspace = await this.workspaces.get(runtimeWorkspaceId)
    if (!runtimeWorkspace || runtimeWorkspace.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Validation, 'Project Codex runtime workspace is invalid')
    const projectPrompt = projectPromptSnapshot(project)

    const runFolderPath = await mkdtemp(join(tmpdir(), 'open-mission-control-codex-run-'))
    let bridge: { url: string; close: () => Promise<void> } | null = null
    let workspaceRunPathForCleanup: string | null = null
    let preserveRunFolderOnError = false
    try {
      const exportWorkspacePath = join(runFolderPath, 'workspace')
      const runtimeWorkspacePath = runtimeWorkspace.rootPath
      await mkdir(exportWorkspacePath, { recursive: true })
      await mkdir(runtimeWorkspacePath, { recursive: true })
      await cleanupOldPlannerRuns(runtimeWorkspacePath)
      const gitignoreUpdated = await ensureWorkspaceOmcIgnored(runtimeWorkspacePath)
      const zipName = sanitizeFileName(payload.zipName, 'task.zip')
      await writeFile(join(runFolderPath, zipName.endsWith('.zip') ? zipName : `${zipName}.zip`), zipBuffer)

      const files = unzipSync(new Uint8Array(zipBuffer))
      const workspaceRoot = resolve(exportWorkspacePath)
      for (const [relativePath, bytes] of Object.entries(files)) {
        const targetPath = resolve(exportWorkspacePath, relativePath)
        if (targetPath !== workspaceRoot && !targetPath.startsWith(`${workspaceRoot}${sep}`)) {
          throw new Error(`Unsafe ZIP entry: ${relativePath}`)
        }
        if (relativePath.endsWith('/')) {
          await mkdir(targetPath, { recursive: true })
          continue
        }
        await mkdir(dirname(targetPath), { recursive: true })
        await writeFile(targetPath, Buffer.from(bytes))
      }

      const { codexPath, executionMode } = codexCliConfig(gateway.template)
      const model = payload.model.trim()
      const taskId = access.data.task.id
      const wrapperPath = join(runFolderPath, 'run-codex.sh')
      const finishFilePath = join(runFolderPath, 'codex-finished.signal')
      const runTerminalTitle = terminalTitle(`OMC Codex ${access.data.task.id}`)
      const runId = plannerRunId(access.data.task.id)
      const helperRelativePath = plannerRunRelativePath(runId, 'omc-task-client.mjs')
      const sessionRelativePath = plannerRunRelativePath(runId, 'session.json')
      const contextRelativePath = plannerRunRelativePath(runId, 'context.json')
      const plannedTaskRelativePath = plannerRunRelativePath(runId, 'planned-task.json')
      const instructionsRelativePath = plannerRunRelativePath(runId, 'OMC_CLI.md')
      const prompt = initialCodexPrompt(exportWorkspacePath, runtimeWorkspacePath, project.id, access.data.task.id, instructionsRelativePath)
      const workspaceRunPath = join(runtimeWorkspacePath, '.omc', 'runs', runId)
      workspaceRunPathForCleanup = workspaceRunPath
      const bridgeToken = randomUUID()
      bridge = await this.startPlannerBridge({
        actorToken: payload.actorToken,
        projectId: project.id,
        taskId: access.data.task.id,
        finishFilePath,
        terminalTitle: runTerminalTitle,
        workspaceRunPath,
        runId,
        mode: 'execute',
        exportWorkspacePath,
        runtimeWorkspacePath
      }, bridgeToken)
      const clientScriptPath = join(runtimeWorkspacePath, helperRelativePath)
      const sessionPath = join(runtimeWorkspacePath, sessionRelativePath)
      await mkdir(workspaceRunPath, { recursive: true })
      await writeFile(clientScriptPath, omcTaskPlannerClientScript(), 'utf8')
      await chmod(clientScriptPath, 0o700)
      await writeFile(sessionPath, JSON.stringify({
        runId,
        mode: 'execute',
        projectId: project.id,
        taskId: access.data.task.id,
        gatewayId: gateway.id,
        model,
        runtimeWorkspacePath,
        exportWorkspacePath,
        workspaceRunPath,
        projectPrompt,
        bridgeUrl: bridge.url,
        bridgeToken,
        createdAt: new Date().toISOString()
      }, null, 2), 'utf8')
      await writeFile(join(runtimeWorkspacePath, instructionsRelativePath), omcCliInstructions({
        mode: 'execute',
        projectId: project.id,
        taskId: access.data.task.id,
        runId,
        helperRelativePath,
        contextRelativePath,
        plannedTaskRelativePath,
        exportWorkspacePath,
        runtimeWorkspacePath
      }), 'utf8')
      const codexCommand = [
        shellQuote(codexPath),
        '--cd', shellQuote(runtimeWorkspacePath),
        '--add-dir', shellQuote(exportWorkspacePath),
        '--model', shellQuote(model),
        '--sandbox', 'workspace-write',
        '--dangerously-bypass-approvals-and-sandbox',
        '-c', shellQuote(codexTrustedProjectConfig(runtimeWorkspacePath)),
        '-c', shellQuote(codexTrustedProjectConfig(exportWorkspacePath)),
        shellQuote(prompt)
      ].join(' ')
      const execEventsPath = join(runFolderPath, 'codex-events.jsonl')
      const execFinalMessagePath = join(runFolderPath, 'final-message.md')
      const execArgs = [
        'exec',
        '--json',
        '--output-last-message', execFinalMessagePath,
        '--cd', runtimeWorkspacePath,
        '--model', model,
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '--color', 'never',
        prompt
      ]
      const execCommand = [shellQuote(codexPath), ...execArgs.map(shellQuote)].join(' ')
      const loginShellCommand = [
        'set -e',
        `cd ${shellQuote(runtimeWorkspacePath)}`,
        'echo "Open Mission Control Codex run"',
        `echo "Runtime workspace: ${runtimeWorkspacePath.replace(/"/g, '\\"')}"`,
        `echo "Export files: ${exportWorkspacePath.replace(/"/g, '\\"')}"`,
        'echo "Export directory files:"',
        `ls -la ${shellQuote(exportWorkspacePath)}`,
        `echo "OMC CLI instructions: ${instructionsRelativePath}"`,
        gitignoreUpdated ? 'echo ".omc/ is ignored by this workspace .gitignore."' : 'echo "No .gitignore found or .omc/ ignore could not be added; .omc/ is ephemeral and can be ignored manually."',
        codexCommand
      ].join('\n')
      const wrapper = [
        '#!/bin/zsh',
        'set -e',
        `RUN_DIR=${shellQuote(runFolderPath)}`,
        `FINISH_FILE=${shellQuote(finishFilePath)}`,
        `TERMINAL_TITLE=${shellQuote(runTerminalTitle)}`,
        `RUNTIME_WORKSPACE=${shellQuote(runtimeWorkspacePath)}`,
        `HELPER_PATH=${shellQuote(helperRelativePath)}`,
        'cleanup() {',
        '  local status=$?',
        '  (cd "$RUNTIME_WORKSPACE" && node "$HELPER_PATH" finish >/dev/null 2>&1) || true',
        '  rm -rf "$RUN_DIR"',
        closeTerminalWindowByTitleShell(),
        '  return "$status"',
        '}',
        'trap cleanup EXIT',
        'printf \'\\033]0;%s\\007\' "$TERMINAL_TITLE"',
        `/bin/zsh -lic ${shellQuote(`${loginShellCommand}\n`)}`
      ].join('\n')
      await writeFile(wrapperPath, wrapper, 'utf8')
      await chmod(wrapperPath, 0o700)
      const terminalCommand = `/bin/zsh ${shellQuote(wrapperPath)}`
      await writeFile(join(runFolderPath, 'run-meta.json'), JSON.stringify({
        taskId: payload.taskId,
        projectId: payload.projectId,
        gatewayId: gateway.id,
        model,
        codexPath,
        runFolderPath,
        runId,
        workspacePath: runtimeWorkspacePath,
        runtimeWorkspaceId,
        runtimeWorkspacePath,
        exportWorkspacePath,
        workspaceRunPath,
        clientScriptPath,
        sessionPath,
        helperRelativePath,
        instructionsRelativePath,
        gitignoreUpdated,
        bridgeUrl: bridge.url,
        zipName: payload.zipName,
        projectPrompt,
        finishFilePath,
        terminalTitle: runTerminalTitle,
        executionMode,
        command: codexCommand,
        execCommand,
        eventsPath: execEventsPath,
        finalMessagePath: execFinalMessagePath,
        terminalCommand
      }, null, 2), 'utf8')

      preserveRunFolderOnError = true
      if (executionMode === 'exec') {
        await this.appendTaskActivityMessage(taskId, {
          runId,
          source: 'codex-run',
          role: 'system',
          status: 'running',
          body: `Started Codex exec run with ${model}.`,
          metadata: { gatewayId: gateway.id, model, executionMode, runtimeWorkspacePath, exportWorkspacePath, runFolderPath }
        })
        await this.appendTaskActivityMessage(taskId, {
          runId,
          source: 'codex-run',
          role: 'user',
          status: 'running',
          body: prompt,
          metadata: { command: execCommand }
        })
        await this.appendTaskActivityMessage(taskId, {
          runId,
          source: 'codex-run',
          role: 'thinking',
          status: 'running',
          body: 'Codex is working through the task...',
          metadata: { executionMode, eventsPath: execEventsPath }
        })
        const executionStartedAt = Date.now()
        const child = spawn(codexPath, execArgs, {
          cwd: runtimeWorkspacePath,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        const streamer = createCodexActivityStreamer({
          taskId,
          runId,
          source: 'codex-run',
          eventsPath: execEventsPath
        }, (message) => this.appendTaskActivityMessage(taskId, message))
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => streamer.writeStdout(chunk))
        child.stderr.on('data', (chunk: string) => streamer.writeStderr(chunk))
        child.on('error', (error) => {
          void this.appendTaskActivityMessage(taskId, {
            runId,
            source: 'codex-run',
            role: 'error',
            status: 'failed',
            body: error.message,
            metadata: { command: execCommand }
          })
          void bridge?.close()
        })
        child.on('close', (code, signal) => {
          void (async () => {
            await streamer.flush()
            const finalMessage = await readFile(execFinalMessagePath, 'utf8').catch(() => '')
            const eventRaw = await readFile(execEventsPath, 'utf8').catch(() => '')
            const eventSummary = summarizeCodexExecEvents(eventRaw, { startedAt: executionStartedAt, endedAt: Date.now() })
            const usage = eventSummary.usage ?? streamer.latestUsage()
            const changes = await codexWorkspaceChanges(runtimeWorkspacePath, join(runFolderPath, 'changes.diff'))
            await this.appendTaskActivityMessage(taskId, {
              runId,
              source: 'codex-run',
              role: 'tool',
              status: changes.unavailable ? 'failed' : 'completed',
              body: changes.body,
              metadata: { codexBlock: 'changes', code, signal, eventsPath: execEventsPath, changesPath: changes.changesPath, usage, truncated: changes.truncated, unavailable: changes.unavailable, ...(changes.metadata ?? {}) }
            })
            await this.appendTaskActivityMessage(taskId, {
              runId,
              source: 'codex-run',
              role: 'system',
              status: code === 0 ? 'completed' : 'failed',
              body: code === 0 ? 'Codex run completed.' : `Codex run failed with code ${code ?? 'unknown'}.`,
              metadata: { codexBlock: 'run-complete', code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage }
            })
            if (code === 0) {
              if (!streamer.hasAssistantMessage()) {
                await this.appendTaskActivityMessage(taskId, {
                  runId,
                  source: 'codex-run',
                  role: 'assistant',
                  status: 'completed',
                  body: finalMessage.trim() || 'Codex exec completed.',
                  metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage, codexBlock: 'final-fallback' }
                })
              }
              await this.markTaskReadyForReview({ actorToken: payload.actorToken, projectId: project.id, taskId }).catch(() => undefined)
            } else {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                source: 'codex-run',
                role: 'error',
                status: 'failed',
                body: finalMessage.trim() || `Codex exec exited with code ${code ?? 'unknown'}.`,
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage, rawTail: eventSummary.rawTail }
              })
            }
            await bridge?.close()
            if (workspaceRunPathForCleanup) {
              setTimeout(() => {
                void rm(workspaceRunPathForCleanup ?? '', { recursive: true, force: true })
              }, 2_000).unref?.()
            }
          })()
        })

        return okResponse({
          runFolderPath,
          workspacePath: runtimeWorkspacePath,
          runtimeWorkspacePath,
          exportWorkspacePath,
          model,
          gatewayId: gateway.id,
          command: execCommand,
          executionMode,
          runId,
          pid: child.pid,
          eventsPath: execEventsPath,
          finalMessagePath: execFinalMessagePath
        })
      }

      if (process.platform !== 'darwin') return errorResponse(ErrorCodes.Validation, 'External Codex run currently requires macOS Terminal.app.')
      this.codexTerminalRuns.set(access.data.task.id, { finishFilePath, terminalTitle: runTerminalTitle })
      await this.appendTaskActivityMessage(access.data.task.id, {
        runId,
        source: 'codex-run',
        role: 'system',
        status: 'running',
        body: `Started Codex terminal run with ${model}.`,
        metadata: { gatewayId: gateway.id, model, executionMode, runtimeWorkspacePath, exportWorkspacePath, runFolderPath }
      })
      await this.appendTaskActivityMessage(access.data.task.id, {
        runId,
        source: 'codex-run',
        role: 'user',
        status: 'running',
        body: prompt,
        metadata: { command: codexCommand }
      })
      await this.appendTaskActivityMessage(access.data.task.id, {
        runId,
        source: 'codex-run',
        role: 'thinking',
        status: 'running',
        body: 'Codex terminal is running this task...',
        metadata: { executionMode, runtimeWorkspacePath, runFolderPath }
      })
      await execFileAsync('osascript', [
        '-e',
        'tell application "Terminal"',
        '-e',
        'activate',
        '-e',
        `do script ${appleScriptString(terminalCommand)}`,
        '-e',
        'end tell'
      ], { timeout: 10_000 })

      const cleanupTimer = setTimeout(() => {
        void bridge?.close()
        void rm(runFolderPath, { recursive: true, force: true })
      }, 8 * 60 * 60 * 1000)
      cleanupTimer.unref?.()

      return okResponse({
        runFolderPath,
        workspacePath: runtimeWorkspacePath,
        runtimeWorkspacePath,
        exportWorkspacePath,
        model,
        gatewayId: gateway.id,
        command: codexCommand,
        executionMode,
        runId
      })
    } catch (error) {
      await bridge?.close()
      this.codexTerminalRuns.delete(payload.taskId)
      if (!preserveRunFolderOnError) {
        await rm(runFolderPath, { recursive: true, force: true })
        if (workspaceRunPathForCleanup) await rm(workspaceRunPathForCleanup, { recursive: true, force: true })
      }
      return errorResponse(ErrorCodes.Internal, error instanceof Error ? error.message : 'Unable to launch Codex terminal')
    }
  }

  private async startPlannerBridge(context: PlannerBridgeContext, bridgeToken: string): Promise<{ url: string; close: () => Promise<void> }> {
    const server = createServer(async (request, response) => {
      const requestStartedAt = Date.now()
      logPlannerApiBridgeEvent('http-request', {
        method: request.method,
        url: request.url,
        remoteAddress: request.socket.remoteAddress,
        projectId: context.projectId,
        taskId: context.taskId
      })
      try {
        const authHeader = request.headers.authorization ?? ''
        if (authHeader !== `Bearer ${bridgeToken}`) {
          sendJson(response, 401, { ok: false, error: { message: 'Unauthorized' } })
          logPlannerApiBridgeEvent('http-response', {
            method: request.method,
            url: request.url,
            statusCode: 401,
            ok: false,
            durationMs: Date.now() - requestStartedAt,
            projectId: context.projectId,
            taskId: context.taskId
          })
          return
        }

        const toolStartedAt = Date.now()
        const path = request.url ?? ''
        let result: ServiceResponse<unknown>
        let action = path
        let closeBridgeAfterResponse = false

        if (request.method === 'GET' && path === '/health') {
          result = okResponse({ name: 'openmissioncontrol-planner-api' })
        } else if (request.method === 'GET' && path === '/context') {
          const contextResponse = await this.plannerContext({ actorToken: context.actorToken, projectId: context.projectId, taskId: context.taskId })
          result = contextResponse.ok
            ? okResponse({
              ...(contextResponse.data ?? {}),
              omc: {
                mode: context.mode ?? 'plan',
                runId: context.runId ?? null,
                conversationId: context.conversationId ?? context.runId ?? null,
                runtimeWorkspacePath: context.runtimeWorkspacePath ?? null,
                exportWorkspacePath: context.exportWorkspacePath ?? null,
                workspaceRunPath: context.workspaceRunPath ?? null
              }
            })
            : contextResponse
        } else if (request.method === 'POST' && path === '/validate-task-json') {
          const body = await readRequestBody(request) as Record<string, unknown>
          result = await this.plannerValidateJson({ actorToken: context.actorToken, projectId: context.projectId, taskId: context.taskId, json: body.json })
        } else if (request.method === 'POST' && path === '/create-task') {
          const body = await readRequestBody(request) as Record<string, unknown>
          result = await this.plannerCreateFromJson({ actorToken: context.actorToken, projectId: context.projectId, taskId: context.taskId, json: body.json })
        } else if (request.method === 'POST' && path === '/update-task') {
          const body = await readRequestBody(request) as Record<string, unknown>
          result = await this.plannerUpdateFromJson({ actorToken: context.actorToken, projectId: context.projectId, taskId: context.taskId, json: body.json })
          if (result.ok && (context.mode ?? 'plan') === 'plan') {
            await this.setTaskCodexPlanState(context.taskId, {
              state: 'planned',
              plannedAt: Date.now(),
              conversationId: context.conversationId ?? context.runId ?? null,
              runId: context.runId ?? null,
              model: context.model ?? null
            })
          }
        } else if (request.method === 'POST' && path === '/planner-question') {
          const body = await readRequestBody(request)
          const normalized = normalizePlannerQuestionPayload(body)
          if (!normalized.ok || !normalized.data) {
            result = normalized
          } else {
            result = await this.appendPlannerQuestionActivity(context, normalized.data)
            if (result.ok) {
              await this.finishPlannerBridgeRuntime(context)
              closeBridgeAfterResponse = true
            }
          }
        } else if (request.method === 'POST' && path === '/ready-for-review') {
          result = await this.markTaskReadyForReview({ actorToken: context.actorToken, projectId: context.projectId, taskId: context.taskId })
          if (result.ok && context.workspaceRunPath) {
            setTimeout(() => {
              void rm(context.workspaceRunPath ?? '', { recursive: true, force: true })
            }, 2_000).unref?.()
          }
          closeBridgeAfterResponse = true
        } else if (request.method === 'POST' && path === '/finish') {
          await this.finishPlannerBridgeRuntime(context)
          result = okResponse({ closed: true })
          closeBridgeAfterResponse = true
        } else {
          result = errorResponse(ErrorCodes.NotFound, 'Not found')
        }

        sendJson(response, result.ok ? 200 : result.error?.code === ErrorCodes.NotFound ? 404 : 400, result)
        logPlannerApiBridgeEvent('api-response', {
          action,
          ok: result.ok,
          statusCode: result.ok ? 200 : result.error?.code === ErrorCodes.NotFound ? 404 : 400,
          durationMs: Date.now() - toolStartedAt,
          projectId: context.projectId,
          taskId: context.taskId,
          data: result.ok ? result.data : undefined,
          error: result.ok ? undefined : result.error
        })
        if (closeBridgeAfterResponse) {
          setTimeout(() => {
            server.close(() => undefined)
          }, 250).unref?.()
        }
      } catch (error) {
        logPlannerApiBridgeEvent('api-error', {
          method: request.method,
          url: request.url,
          statusCode: 500,
          durationMs: Date.now() - requestStartedAt,
          projectId: context.projectId,
          taskId: context.taskId,
          error: error instanceof Error ? error.message : String(error)
        })
        sendJson(response, 500, { ok: false, error: { message: error instanceof Error ? error.message : 'Planner bridge failed' } })
      }
    })
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', () => resolveListen())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      throw new Error('Unable to start planner bridge')
    }
    logPlannerApiBridgeEvent('started', {
      bridgeUrl: `http://127.0.0.1:${address.port}`,
      projectId: context.projectId,
      taskId: context.taskId
    })
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise((resolveClose) => server.close(() => resolveClose()))
    }
  }

  async planWithCodex(payload: PlanTaskCodexRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<PlannerLaunchResult>> {
    if (!payload?.taskId || !payload.projectId) return errorResponse(ErrorCodes.Validation, 'Task and project id are required')
    if (!payload.gatewayId?.trim()) return errorResponse(ErrorCodes.Validation, 'Codex gateway is required')
    if (!payload.model?.trim()) return errorResponse(ErrorCodes.Validation, 'Codex model is required')

    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) {
      return errorResponse(access.error?.code ?? ErrorCodes.Forbidden, access.error?.message ?? 'Access denied', access.error?.details)
    }
    const project = await this.projects.get(payload.projectId)
    if (!project || project.id !== access.data.task.projectId) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const gateway = await this.gateways.get(payload.gatewayId)
    if (!gateway || gateway.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Validation, 'Codex gateway is invalid')
    const runtimeWorkspaceId = projectCodexRuntimeWorkspaceId(project)
    if (!runtimeWorkspaceId) return errorResponse(ErrorCodes.Validation, 'Project Codex runtime workspace is required')
    const runtimeWorkspace = await this.workspaces.get(runtimeWorkspaceId)
    if (!runtimeWorkspace || runtimeWorkspace.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Validation, 'Project Codex runtime workspace is invalid')
    const projectPrompt = projectPromptSnapshot(project)

    const runFolderPath = await mkdtemp(join(tmpdir(), 'open-mission-control-codex-planner-'))
    let bridge: { url: string; close: () => Promise<void> } | null = null
    let preserveRunFolderOnError = false
    let workspaceRunPathForCleanup: string | null = null
    try {
      const runtimeWorkspacePath = runtimeWorkspace.rootPath
      await mkdir(runtimeWorkspacePath, { recursive: true })
      await cleanupOldPlannerRuns(runtimeWorkspacePath)
      const gitignoreUpdated = await ensureWorkspaceOmcIgnored(runtimeWorkspacePath)
      const bridgeToken = randomUUID()
      const finishFilePath = join(runFolderPath, 'planner-finished.signal')
      const runTerminalTitle = terminalTitle(`OMC Planner ${access.data.task.id}`)
      const runId = plannerRunId(access.data.task.id)
      const conversationId = payload.conversationId?.trim() || runId
      const clarificationMessage = payload.clarificationMessage?.trim() ?? ''
      const model = payload.model.trim()
      const helperRelativePath = plannerRunRelativePath(runId, 'omc-task-client.mjs')
      const sessionRelativePath = plannerRunRelativePath(runId, 'session.json')
      const contextRelativePath = plannerRunRelativePath(runId, 'context.json')
      const plannedTaskRelativePath = plannerRunRelativePath(runId, 'planned-task.json')
      const instructionsRelativePath = plannerRunRelativePath(runId, 'OMC_CLI.md')
      const workspaceRunPath = join(runtimeWorkspacePath, '.omc', 'runs', runId)
      workspaceRunPathForCleanup = workspaceRunPath
      bridge = await this.startPlannerBridge({
        actorToken: payload.actorToken,
        projectId: project.id,
        taskId: access.data.task.id,
        finishFilePath,
        terminalTitle: runTerminalTitle,
        workspaceRunPath,
        runId,
        conversationId,
        gatewayId: gateway.id,
        model,
        mode: 'plan',
        runtimeWorkspacePath
      }, bridgeToken)

      const clientScriptPath = join(runtimeWorkspacePath, helperRelativePath)
      const sessionPath = join(runtimeWorkspacePath, sessionRelativePath)
      await mkdir(workspaceRunPath, { recursive: true })
      await writeFile(clientScriptPath, omcTaskPlannerClientScript(), 'utf8')
      await chmod(clientScriptPath, 0o700)
      await writeFile(sessionPath, JSON.stringify({
        runId,
        conversationId,
        mode: 'plan',
        projectId: project.id,
        taskId: access.data.task.id,
        gatewayId: gateway.id,
        model,
        runtimeWorkspacePath,
        workspaceRunPath,
        projectPrompt,
        bridgeUrl: bridge.url,
        bridgeToken,
        createdAt: new Date().toISOString()
      }, null, 2), 'utf8')
      await writeFile(join(runtimeWorkspacePath, instructionsRelativePath), omcCliInstructions({
        mode: 'plan',
        projectId: project.id,
        taskId: access.data.task.id,
        runId,
        helperRelativePath,
        contextRelativePath,
        plannedTaskRelativePath,
        runtimeWorkspacePath
      }), 'utf8')

      const { codexPath, executionMode } = codexCliConfig(gateway.template)
      const taskId = access.data.task.id
      const transcript = taskActivityMessagesFromPayload(access.data.task.payload)
        .filter((item) => (item.conversationId || item.runId) === conversationId)
      const prompt = [
        `Read ${instructionsRelativePath} first.`,
        initialPlannerPrompt(project.id, access.data.task.id, helperRelativePath, contextRelativePath, plannedTaskRelativePath),
        plannerClarificationPrompt({ conversationId, clarificationMessage, transcript })
      ].join(' ')
      const codexCommand = [
        shellQuote(codexPath),
        '--cd', shellQuote(runtimeWorkspacePath),
        '--model', shellQuote(model),
        '--sandbox', 'workspace-write',
        '--dangerously-bypass-approvals-and-sandbox',
        '-c', shellQuote(codexTrustedProjectConfig(runtimeWorkspacePath)),
        shellQuote(prompt)
      ].join(' ')
      const execEventsPath = join(runFolderPath, 'codex-events.jsonl')
      const execFinalMessagePath = join(runFolderPath, 'final-message.md')
      const execArgs = [
        'exec',
        '--json',
        '--output-last-message', execFinalMessagePath,
        '--cd', runtimeWorkspacePath,
        '--model', model,
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '--color', 'never',
        prompt
      ]
      const execCommand = [shellQuote(codexPath), ...execArgs.map(shellQuote)].join(' ')
      const wrapperPath = join(runFolderPath, 'run-codex-planner.sh')
      const wrapper = [
        '#!/bin/zsh',
        'set -e',
        `RUN_DIR=${shellQuote(runFolderPath)}`,
        `FINISH_FILE=${shellQuote(finishFilePath)}`,
        `TERMINAL_TITLE=${shellQuote(runTerminalTitle)}`,
        `RUNTIME_WORKSPACE=${shellQuote(runtimeWorkspacePath)}`,
        `HELPER_PATH=${shellQuote(helperRelativePath)}`,
        'cleanup() {',
        '  local status=$?',
        '  (cd "$RUNTIME_WORKSPACE" && node "$HELPER_PATH" finish >/dev/null 2>&1) || true',
        '  rm -rf "$RUN_DIR"',
        closeTerminalWindowByTitleShell(),
        '  return "$status"',
        '}',
        'trap cleanup EXIT',
        `cd ${shellQuote(runtimeWorkspacePath)}`,
        'printf \'\\033]0;%s\\007\' "$TERMINAL_TITLE"',
        'echo "Open Mission Control Codex task planner"',
        `echo "Project: ${project.name.replace(/"/g, '\\"')}"`,
        `echo "Source task: ${access.data.task.title.replace(/"/g, '\\"')}"`,
        'echo "Open Mission Control helper API is scoped to this project and task."',
        `echo "Helper: ${helperRelativePath}"`,
        `echo "OMC CLI instructions: ${instructionsRelativePath}"`,
        `echo "Run folder: .omc/runs/${runId}"`,
        gitignoreUpdated ? 'echo ".omc/ is ignored by this workspace .gitignore."' : 'echo "No .gitignore found or .omc/ ignore could not be added; .omc/ is ephemeral and can be ignored manually."',
        codexCommand
      ].join('\n')
      await writeFile(wrapperPath, wrapper, 'utf8')
      await chmod(wrapperPath, 0o700)
      const terminalCommand = `/bin/zsh ${shellQuote(wrapperPath)}`
      await writeFile(join(runFolderPath, 'run-meta.json'), JSON.stringify({
        taskId: access.data.task.id,
        projectId: project.id,
        gatewayId: gateway.id,
        model,
        codexPath,
        runFolderPath,
        runId,
        conversationId,
        runtimeWorkspaceId,
        runtimeWorkspacePath,
        workspaceRunPath,
        clientScriptPath,
        sessionPath,
        helperRelativePath,
        sessionRelativePath,
        contextRelativePath,
        plannedTaskRelativePath,
        instructionsRelativePath,
        gitignoreUpdated,
        bridgeUrl: bridge.url,
        projectPrompt,
        finishFilePath,
        terminalTitle: runTerminalTitle,
        executionMode,
        command: codexCommand,
        execCommand,
        eventsPath: execEventsPath,
        finalMessagePath: execFinalMessagePath,
        terminalCommand
      }, null, 2), 'utf8')

      preserveRunFolderOnError = true
      if (executionMode === 'exec') {
        await this.appendTaskActivityMessage(taskId, {
          runId,
          conversationId,
          source: 'codex-plan',
          role: 'system',
          status: 'running',
          body: `Started Codex exec planner with ${model}.`,
          metadata: { gatewayId: gateway.id, model, executionMode, runtimeWorkspacePath, runFolderPath }
        })
        await this.appendTaskActivityMessage(taskId, {
          runId,
          conversationId,
          source: 'codex-plan',
          role: 'user',
          status: 'running',
          body: clarificationMessage || prompt,
          metadata: { command: execCommand, clarification: Boolean(clarificationMessage) }
        })
        await this.appendTaskActivityMessage(taskId, {
          runId,
          conversationId,
          source: 'codex-plan',
          role: 'thinking',
          status: 'running',
          body: 'Codex is planning the task...',
          metadata: { executionMode, eventsPath: execEventsPath }
        })
        const executionStartedAt = Date.now()
        const child = spawn(codexPath, execArgs, {
          cwd: runtimeWorkspacePath,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        const streamer = createCodexActivityStreamer({
          taskId,
          runId,
          conversationId,
          source: 'codex-plan',
          eventsPath: execEventsPath
        }, (message) => this.appendTaskActivityMessage(taskId, message))
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => streamer.writeStdout(chunk))
        child.stderr.on('data', (chunk: string) => streamer.writeStderr(chunk))
        child.on('error', (error) => {
          void this.appendTaskActivityMessage(taskId, {
            runId,
            conversationId,
            source: 'codex-plan',
            role: 'error',
            status: 'failed',
            body: error.message,
            metadata: { command: execCommand }
          })
          void bridge?.close()
        })
        child.on('close', (code, signal) => {
          void (async () => {
            await streamer.flush()
            if (this.pausedPlannerRunIds.delete(runId)) {
              await bridge?.close()
              if (workspaceRunPathForCleanup) {
                setTimeout(() => {
                  void rm(workspaceRunPathForCleanup ?? '', { recursive: true, force: true })
                }, 2_000).unref?.()
              }
              return
            }
            const finalMessage = await readFile(execFinalMessagePath, 'utf8').catch(() => '')
            const eventRaw = await readFile(execEventsPath, 'utf8').catch(() => '')
            const eventSummary = summarizeCodexExecEvents(eventRaw, { startedAt: executionStartedAt, endedAt: Date.now() })
            const usage = eventSummary.usage ?? streamer.latestUsage()
            const changes = await codexWorkspaceChanges(runtimeWorkspacePath, join(runFolderPath, 'changes.diff'))
            await this.appendTaskActivityMessage(taskId, {
              runId,
              conversationId,
              source: 'codex-plan',
              role: 'tool',
              status: changes.unavailable ? 'failed' : 'completed',
              body: changes.body,
              metadata: { codexBlock: 'changes', code, signal, eventsPath: execEventsPath, changesPath: changes.changesPath, usage, truncated: changes.truncated, unavailable: changes.unavailable, ...(changes.metadata ?? {}) }
            })
            await this.appendTaskActivityMessage(taskId, {
              runId,
              conversationId,
              source: 'codex-plan',
              role: 'system',
              status: code === 0 ? 'completed' : 'failed',
              body: code === 0 ? 'Codex planner completed.' : `Codex planner failed with code ${code ?? 'unknown'}.`,
              metadata: { codexBlock: 'run-complete', code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage }
            })
            if (code === 0) {
              if (!streamer.hasAssistantMessage()) {
                await this.appendTaskActivityMessage(taskId, {
                  runId,
                  conversationId,
                  source: 'codex-plan',
                  role: 'assistant',
                  status: 'completed',
                  body: finalMessage.trim() || 'Codex planner completed.',
                  metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage, codexBlock: 'final-fallback' }
                })
              }
            } else {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                conversationId,
                source: 'codex-plan',
                role: 'error',
                status: 'failed',
                body: finalMessage.trim() || `Codex planner exited with code ${code ?? 'unknown'}.`,
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage, rawTail: eventSummary.rawTail }
              })
            }
            await bridge?.close()
            if (workspaceRunPathForCleanup) {
              setTimeout(() => {
                void rm(workspaceRunPathForCleanup ?? '', { recursive: true, force: true })
              }, 2_000).unref?.()
            }
          })()
        })

        return okResponse({
          runFolderPath,
          runtimeWorkspacePath,
          model,
          gatewayId: gateway.id,
          command: execCommand,
          bridgeUrl: bridge.url,
          executionMode,
          runId,
          conversationId,
          pid: child.pid,
          eventsPath: execEventsPath,
          finalMessagePath: execFinalMessagePath
        })
      }

      if (process.platform !== 'darwin') return errorResponse(ErrorCodes.Validation, 'Codex task planning currently requires macOS Terminal.app.')
      await this.appendTaskActivityMessage(taskId, {
        runId,
        conversationId,
        source: 'codex-plan',
        role: 'system',
        status: 'running',
        body: `Started Codex terminal planner with ${model}.`,
        metadata: { gatewayId: gateway.id, model, executionMode, runtimeWorkspacePath, runFolderPath }
      })
      await this.appendTaskActivityMessage(taskId, {
        runId,
        conversationId,
        source: 'codex-plan',
        role: 'user',
        status: 'running',
        body: clarificationMessage || prompt,
        metadata: { command: codexCommand, clarification: Boolean(clarificationMessage) }
      })
      await this.appendTaskActivityMessage(taskId, {
        runId,
        conversationId,
        source: 'codex-plan',
        role: 'thinking',
        status: 'running',
        body: 'Codex terminal is planning this task...',
        metadata: { executionMode, runtimeWorkspacePath, runFolderPath }
      })
      await execFileAsync('osascript', [
        '-e',
        'tell application "Terminal"',
        '-e',
        'activate',
        '-e',
        `do script ${appleScriptString(terminalCommand)}`,
        '-e',
        'end tell'
      ], { timeout: 10_000 })

      const cleanupTimer = setTimeout(() => {
        void bridge?.close()
        void rm(runFolderPath, { recursive: true, force: true })
      }, 8 * 60 * 60 * 1000)
      cleanupTimer.unref?.()

      return okResponse({
        runFolderPath,
        runtimeWorkspacePath,
        model,
        gatewayId: gateway.id,
        command: codexCommand,
        bridgeUrl: bridge.url,
        executionMode,
        runId,
        conversationId
      })
    } catch (error) {
      await bridge?.close()
      if (!preserveRunFolderOnError) {
        await rm(runFolderPath, { recursive: true, force: true })
        if (workspaceRunPathForCleanup) await rm(workspaceRunPathForCleanup, { recursive: true, force: true })
      }
      return errorResponse(ErrorCodes.Internal, error instanceof Error ? error.message : 'Unable to launch Codex task planner')
    }
  }

  async codexChatSend(payload: CodexChatSendRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ runId: string; conversationId: string; executionMode: CodexExecutionMode; command: string; pid?: number; runFolderPath: string; runtimeWorkspacePath: string }>> {
    if (!payload?.taskId || !payload.projectId) return errorResponse(ErrorCodes.Validation, 'Task and project id are required')
    const message = payload.message?.trim()
    if (!message) return errorResponse(ErrorCodes.Validation, 'Message is required')
    if (!payload.gatewayId?.trim()) return errorResponse(ErrorCodes.Validation, 'Codex gateway is required')
    if (!payload.model?.trim()) return errorResponse(ErrorCodes.Validation, 'Codex model is required')

    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return errorResponse(access.error?.code ?? ErrorCodes.Forbidden, access.error?.message ?? 'Access denied', access.error?.details)
    const project = await this.projects.get(payload.projectId)
    if (!project || project.id !== access.data.task.projectId) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    const gateway = await this.gateways.get(payload.gatewayId)
    if (!gateway || gateway.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Validation, 'Codex gateway is invalid')
    const runtimeWorkspaceId = projectCodexRuntimeWorkspaceId(project)
    if (!runtimeWorkspaceId) return errorResponse(ErrorCodes.Validation, 'Project Codex runtime workspace is required')
    const runtimeWorkspace = await this.workspaces.get(runtimeWorkspaceId)
    if (!runtimeWorkspace || runtimeWorkspace.organizationId !== access.data.actorOrgId) return errorResponse(ErrorCodes.Validation, 'Project Codex runtime workspace is invalid')

    const taskId = access.data.task.id
    const taskTitle = access.data.task.title
    const runId = plannerRunId(taskId)
    const requestedMode = payload.mode === 'plan' ? 'plan' : payload.mode === 'steer' ? 'steer' : 'chat'
    if (requestedMode === 'steer' && !payload.conversationId?.trim()) {
      return errorResponse(ErrorCodes.Validation, 'Conversation id is required for steer messages')
    }
    const hasPlanPrefix = message.toLowerCase().startsWith('/plan')
    const normalizedMessage = hasPlanPrefix
      ? message.replace(/^\/plan\s*/i, '').trim()
      : message
    const mode = hasPlanPrefix ? 'plan' : requestedMode
    if (!normalizedMessage) return errorResponse(ErrorCodes.Validation, 'Message is required')
    const conversationId = payload.conversationId?.trim() || `${mode}-${runId}`
    const transcript = taskActivityMessagesFromPayload(access.data.task.payload)
      .filter((item) => !item.conversationId || item.conversationId === conversationId)
    const context = payload.includeTaskContext === false
      ? undefined
      : (await this.plannerContext({ actorToken: payload.actorToken, projectId: project.id, taskId })).data
    const { codexPath, executionMode } = codexCliConfig(gateway.template)
    const model = payload.model.trim()
    const runtimeWorkspacePath = runtimeWorkspace.rootPath
    const runFolderPath = await mkdtemp(join(tmpdir(), 'open-mission-control-codex-chat-'))
    const attachmentRoot = join(runFolderPath, 'attachments')
    const attachments: Array<{ name: string; path: string }> = []
    if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
      await mkdir(attachmentRoot, { recursive: true })
      for (const [index, attachment] of payload.attachments.entries()) {
        if (!attachment || typeof attachment.name !== 'string') continue
        const fileName = safeAttachmentName(attachment.name, index)
        const filePath = join(attachmentRoot, fileName)
        await writeFile(filePath, attachmentBytes(attachment.bytes))
        attachments.push({ name: attachment.name, path: filePath })
      }
    }
    const eventsPath = join(runFolderPath, 'codex-events.jsonl')
    const finalMessagePath = join(runFolderPath, 'final-message.md')
    const prompt = codexChatPrompt({ task: access.data.task, message: normalizedMessage, transcript, context, mode, attachments })
    const activitySource: TaskActivityMessage['source'] = mode === 'plan' ? 'codex-plan' : 'codex-chat'
    const execArgs = [
      'exec',
      '--json',
      '--output-last-message', finalMessagePath,
      '--cd', runtimeWorkspacePath,
      '--model', model,
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--color', 'never',
      prompt
    ]
    const execCommand = [shellQuote(codexPath), ...execArgs.map(shellQuote)].join(' ')

    await mkdir(runtimeWorkspacePath, { recursive: true })
    await this.appendTaskActivityMessage(taskId, {
      runId,
      conversationId,
      source: activitySource,
      role: 'user',
      status: 'completed',
      body: mode === 'plan' ? `/plan ${normalizedMessage}` : normalizedMessage,
      metadata: { gatewayId: gateway.id, model, mode, attachments }
    })
    await this.appendTaskActivityMessage(taskId, {
      runId,
      conversationId,
      source: activitySource,
      role: 'thinking',
      status: 'running',
      body: mode === 'plan'
        ? executionMode === 'exec' ? 'Codex is revising the plan...' : 'Opening Codex terminal to revise the plan...'
        : executionMode === 'exec' ? 'Codex is thinking...' : 'Opening Codex terminal...',
      metadata: { executionMode, runtimeWorkspacePath }
    })

    if (executionMode === 'terminal') {
      if (process.platform !== 'darwin') return errorResponse(ErrorCodes.Validation, 'Codex terminal chat currently requires macOS Terminal.app.')
      const wrapperPath = join(runFolderPath, 'run-codex-chat.sh')
      const codexCommand = [
        shellQuote(codexPath),
        '--cd', shellQuote(runtimeWorkspacePath),
        '--model', shellQuote(model),
        '--sandbox', 'workspace-write',
        '--dangerously-bypass-approvals-and-sandbox',
        '-c', shellQuote(codexTrustedProjectConfig(runtimeWorkspacePath)),
        shellQuote(prompt)
      ].join(' ')
      await writeFile(wrapperPath, ['#!/bin/zsh', 'set -e', `cd ${shellQuote(runtimeWorkspacePath)}`, codexCommand].join('\n'), 'utf8')
      await chmod(wrapperPath, 0o700)
      const terminalCommand = `/bin/zsh ${shellQuote(wrapperPath)}`
      await execFileAsync('osascript', [
        '-e', 'tell application "Terminal"',
        '-e', 'activate',
        '-e', `do script ${appleScriptString(terminalCommand)}`,
        '-e', 'end tell'
      ], { timeout: 10_000 })
      await this.appendTaskActivityMessage(taskId, {
        runId,
        conversationId,
        source: activitySource,
        role: 'system',
        status: 'running',
        body: 'Codex terminal chat launched.',
        metadata: { command: codexCommand, runFolderPath }
      })
      return okResponse({ runId, conversationId, executionMode, command: codexCommand, runFolderPath, runtimeWorkspacePath })
    }

    const executionStartedAt = Date.now()
    const child = spawn(codexPath, execArgs, { cwd: runtimeWorkspacePath, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const activeRun: ActiveCodexChatRun = { child, taskId, conversationId, runId }
    this.activeCodexChatRuns.set(runId, activeRun)
    const streamer = createCodexActivityStreamer({
      taskId,
      runId,
      conversationId,
      source: activitySource,
      eventsPath
    }, (message) => this.appendTaskActivityMessage(taskId, message))
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => streamer.writeStdout(chunk))
    child.stderr.on('data', (chunk: string) => streamer.writeStderr(chunk))
    child.on('error', (error) => {
      void this.appendTaskActivityMessage(taskId, {
        runId,
        conversationId,
        source: activitySource,
        role: 'error',
        status: 'failed',
        body: error.message,
        metadata: { command: execCommand }
      })
    })
    child.on('close', (code, signal) => {
      void (async () => {
        this.activeCodexChatRuns.delete(runId)
        await streamer.flush()
        if (activeRun.stopRequested) {
          await this.appendTaskActivityMessage(taskId, {
            runId,
            conversationId,
            source: activitySource,
            role: 'system',
            status: 'completed',
            body: 'Codex chat stopped.',
            metadata: { code, signal, eventsPath, stopped: true, codexBlock: 'run-complete' }
          })
          await this.appendTaskActivityMessage(taskId, {
            runId,
            conversationId,
            source: activitySource,
            role: 'assistant',
            status: 'completed',
            body: 'Stopped by user.',
            metadata: { code, signal, eventsPath, stopped: true }
          })
          return
        }
        const eventRaw = await readFile(eventsPath, 'utf8').catch(() => '')
        const eventSummary = summarizeCodexExecEvents(eventRaw, { startedAt: executionStartedAt, endedAt: Date.now() })
        const finalMessage = await readFile(finalMessagePath, 'utf8').catch(() => '')
        const usage = eventSummary.usage ?? streamer.latestUsage()
        const changes = await codexWorkspaceChanges(runtimeWorkspacePath, join(runFolderPath, 'changes.diff'))
        await this.appendTaskActivityMessage(taskId, {
          runId,
          conversationId,
          source: activitySource,
          role: 'tool',
          status: changes.unavailable ? 'failed' : 'completed',
          body: changes.body,
          metadata: { codexBlock: 'changes', code, signal, eventsPath, changesPath: changes.changesPath, usage, truncated: changes.truncated, unavailable: changes.unavailable, ...(changes.metadata ?? {}) }
        })
        await this.appendTaskActivityMessage(taskId, {
          runId,
          conversationId,
          source: activitySource,
          role: 'system',
          status: code === 0 ? 'completed' : 'failed',
          body: code === 0 ? 'Codex chat completed.' : `Codex chat failed with code ${code ?? 'unknown'}.`,
          metadata: { codexBlock: 'run-complete', code, signal, eventsPath, finalMessagePath, usage }
        })
        if (code === 0) {
          if (!streamer.hasAssistantMessage()) {
            await this.appendTaskActivityMessage(taskId, {
              runId,
              conversationId,
              source: activitySource,
              role: 'assistant',
              status: 'completed',
              body: finalMessage.trim() || (mode === 'plan' ? 'Codex plan revision completed.' : 'Codex chat completed.'),
              metadata: { code, signal, eventsPath, finalMessagePath, usage, codexBlock: 'final-fallback' }
            })
          }
        } else {
          await this.appendTaskActivityMessage(taskId, {
            runId,
            conversationId,
            source: activitySource,
            role: 'error',
            status: 'failed',
            body: finalMessage.trim() || `Codex chat exited with code ${code ?? 'unknown'}.`,
            metadata: { code, signal, eventsPath, finalMessagePath, usage, rawTail: eventSummary.rawTail }
          })
        }
        maybeShowCodexChatCompletionNotification({
          taskTitle,
          projectId: project.id,
          taskId,
          conversationId,
          mode,
          executionMode,
          success: code === 0,
          exitCode: code
        })
      })()
    })

    return okResponse({ runId, conversationId, executionMode, command: execCommand, pid: child.pid, runFolderPath, runtimeWorkspacePath })
  }

  async codexChatStop(payload: CodexChatStopRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ stopped: number }>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id is required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return errorResponse(access.error?.code ?? ErrorCodes.Forbidden, access.error?.message ?? 'Access denied', access.error?.details)
    const conversationId = payload.conversationId?.trim()
    const matches = Array.from(this.activeCodexChatRuns.values()).filter((run) => {
      if (run.taskId !== access.data?.task.id) return false
      return conversationId ? run.conversationId === conversationId : true
    })
    for (const run of matches) {
      run.stopRequested = true
      run.child.kill('SIGTERM')
    }
    if (matches.length === 0 && conversationId) {
      await this.appendTaskActivityMessage(access.data.task.id, {
        runId: conversationId,
        conversationId,
        source: 'codex-chat',
        role: 'system',
        status: 'completed',
        body: 'No running Codex chat was found. Marked as stopped.',
        metadata: { stopped: true, notFound: true, codexBlock: 'run-complete' }
      })
    }
    return okResponse({ stopped: matches.length })
  }

  async codexChatResolve(payload: CodexChatResolveRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ resolved: true; resolution: 'stopped' | 'completed' | 'failed' }>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id is required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return errorResponse(access.error?.code ?? ErrorCodes.Forbidden, access.error?.message ?? 'Access denied', access.error?.details)
    const conversationId = payload.conversationId?.trim()
    if (!conversationId) return errorResponse(ErrorCodes.Validation, 'Conversation id is required')
    const resolution = payload.resolution
    if (resolution !== 'stopped' && resolution !== 'completed' && resolution !== 'failed') {
      return errorResponse(ErrorCodes.Validation, 'Resolution must be stopped, completed, or failed')
    }

    const activeMatches = Array.from(this.activeCodexChatRuns.values()).filter((run) => (
      run.taskId === access.data?.task.id && run.conversationId === conversationId
    ))
    for (const run of activeMatches) {
      run.stopRequested = true
      run.child.kill('SIGTERM')
    }

    const conversationMessages = taskActivityMessagesFromPayload(asPayload(access.data.task.payload))
      .filter((message) => message.conversationId === conversationId || message.runId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt)
    const lastSource = [...conversationMessages].reverse().find((message) => message.source.startsWith('codex-'))?.source ?? 'codex-chat'
    const status = resolution === 'failed' ? 'failed' : 'completed'
    const body = resolution === 'stopped'
      ? 'Codex chat manually marked as stopped.'
      : resolution === 'failed'
        ? 'Codex chat manually marked as failed.'
        : 'Codex chat manually marked as completed.'

    await this.appendTaskActivityMessage(access.data.task.id, {
      runId: conversationId,
      conversationId,
      source: lastSource,
      role: resolution === 'failed' ? 'error' : 'system',
      status,
      body,
      metadata: {
        codexBlock: 'run-complete',
        manuallyResolved: true,
        resolution,
        stopped: resolution === 'stopped'
      }
    })

    return okResponse({ resolved: true, resolution })
  }

  async update(
    payload: {
      actorToken?: string
      id?: string
      status?: TaskEntity['status']
      title?: string
      agentId?: string | null
      description?: string
      customFieldValues?: Record<string, unknown>
      checklistItems?: TaskChecklistItem[]
      payload?: Record<string, unknown>
    },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<TaskEntity>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskEntity>
    const current = access.data.task
    const nextPayload = asPayload(current.payload)
    if (payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)) {
      Object.assign(nextPayload, payload.payload)
    }
    if (typeof payload.description === 'string') {
      nextPayload.description = payload.description
    }
    if (payload.customFieldValues && typeof payload.customFieldValues === 'object' && !Array.isArray(payload.customFieldValues)) {
      nextPayload.customFields = payload.customFieldValues
    }
    if (Array.isArray(payload.checklistItems)) {
      nextPayload.checklist = asChecklistItems(payload.checklistItems)
    }
    const hasAgentPatch = Object.prototype.hasOwnProperty.call(payload, 'agentId')
    let nextAgentId = current.agentId
    if (hasAgentPatch) {
      const agentIdResponse = await this.normalizeAgentId(access.data.actorOrgId, payload.agentId)
      if (!agentIdResponse.ok) return agentIdResponse as ServiceResponse<TaskEntity>
      nextAgentId = agentIdResponse.data
    }
    const nextStatusResponse = await this.normalizeStatus(current.projectId, access.data.actorOrgId, payload.status ?? current.status)
    if (!nextStatusResponse.ok) return nextStatusResponse as ServiceResponse<TaskEntity>
    const updated = await this.repo.update(payload.id, {
      title: payload.title ?? current.title,
      status: nextStatusResponse.data ?? current.status,
      agentId: nextAgentId,
      payload: nextPayload
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    const [task] = await this.enrichTasks([updated])
    return okResponse(task)
  }

  async remove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok) return access as ServiceResponse<{ ok: true }>
    await this.repo.remove(payload.id)
    return okResponse({ ok: true })
  }

  async history(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Array<{ at: number; patch: string }>>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.id)
    if (!access.ok) return access as ServiceResponse<Array<{ at: number; patch: string }>>
    return okResponse(await this.repo.history(payload.id))
  }

  async subtasksCreate(
    payload: { actorToken?: string; taskId?: string; title?: string; status?: TaskSubtask['status'] },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse<TaskSubtask>> {
    if (!payload?.taskId || !payload?.title?.trim()) return errorResponse(ErrorCodes.Validation, 'Task id and title required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskSubtask>
    const statusResponse = await this.normalizeStatus(access.data.task.projectId, access.data.actorOrgId, payload.status)
    if (!statusResponse.ok) return statusResponse as ServiceResponse<TaskSubtask>
    const created = await this.subtaskRepo.create({
      taskId: payload.taskId,
      title: payload.title.trim(),
      status: statusResponse.data ?? ''
    })
    return okResponse(created)
  }

  async subtasksUpdate(payload: UpdateTaskSubtaskRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskSubtask>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Subtask id required')
    const existing = await this.subtaskRepo.get(payload.id)
    if (!existing) return errorResponse(ErrorCodes.NotFound, 'Subtask not found')
    const access = await this.ensureTaskAccess(payload.actorToken, existing.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskSubtask>
    let nextStatus = payload.status
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      const statusResponse = await this.normalizeStatus(access.data.task.projectId, access.data.actorOrgId, payload.status)
      if (!statusResponse.ok) return statusResponse as ServiceResponse<TaskSubtask>
      nextStatus = statusResponse.data
    }
    let nextPayload = payload.payload
    if (nextPayload && Object.prototype.hasOwnProperty.call(nextPayload, 'agentId')) {
      const agentIdResponse = await this.normalizeAgentId(access.data.actorOrgId, nextPayload.agentId)
      if (!agentIdResponse.ok) return agentIdResponse as ServiceResponse<TaskSubtask>
      nextPayload = {
        ...nextPayload,
        agentId: agentIdResponse.data ?? '',
        assigneeId: agentIdResponse.data ?? ''
      }
    }
    const updated = await this.subtaskRepo.update(payload.id, {
      title: payload.title,
      status: nextStatus,
      sortOrder: payload.sortOrder,
      payload: nextPayload
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Subtask not found')
    return okResponse(enrichSubtask(updated))
  }

  async subtasksRemove(payload: { actorToken?: string; id?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<{ ok: true }>> {
    if (!payload?.id) return errorResponse(ErrorCodes.Validation, 'Subtask id required')
    const existing = await this.subtaskRepo.get(payload.id)
    if (!existing) return errorResponse(ErrorCodes.NotFound, 'Subtask not found')
    const access = await this.ensureTaskAccess(payload.actorToken, existing.taskId)
    if (!access.ok) return access as ServiceResponse<{ ok: true }>
    await this.subtaskRepo.remove(payload.id)
    return okResponse({ ok: true })
  }

  async tagsSet(payload: SetTaskTagsRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Tag[]>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<Tag[]>
    const orgId = access.data.actorOrgId
    const tagIds = Array.isArray(payload.tagIds) ? Array.from(new Set(payload.tagIds.filter(Boolean))) : []
    const allTags = await this.tags.list(orgId)
    const allowedTagIds = new Set(allTags.map((tag) => tag.id))
    const invalidTagIds = tagIds.filter((id) => !allowedTagIds.has(id))
    if (invalidTagIds.length > 0) {
      return errorResponse(ErrorCodes.Validation, 'Invalid tag selection', { invalidTagIds })
    }
    await this.taskTagRepo.setTaskTags(payload.taskId, tagIds)
    return okResponse(await this.taskTagRepo.listTaskTags(payload.taskId))
  }

  async skillsSet(payload: SetTaskSkillsRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<Skill[]>> {
    if (!payload?.taskId) return errorResponse(ErrorCodes.Validation, 'Task id required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<Skill[]>
    const orgId = access.data.actorOrgId
    const skillIds = Array.isArray(payload.skillIds) ? Array.from(new Set(payload.skillIds.filter(Boolean))) : []
    const allSkills = await this.skills.list(orgId)
    const allowedSkillIds = new Set(allSkills.map((skill) => skill.id))
    const invalidSkillIds = skillIds.filter((id) => !allowedSkillIds.has(id))
    if (invalidSkillIds.length > 0) {
      return errorResponse(ErrorCodes.Validation, 'Invalid skill selection', { invalidSkillIds })
    }
    await this.taskSkillRepo.setTaskSkills(payload.taskId, skillIds)
    return okResponse(await this.taskSkillRepo.listTaskSkills(payload.taskId))
  }

  async commentAdd(payload: AddTaskCommentRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskComment[]>> {
    if (!payload?.taskId || !payload?.body?.trim()) return errorResponse(ErrorCodes.Validation, 'Task id and comment body required')
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskComment[]>
    const task = access.data.task
    const nextPayload = asPayload(task.payload)
    const comments = asComments(nextPayload.comments)
    comments.push({
      id: randomUUID(),
      authorName: payload.authorName?.trim() || 'Operator',
      body: payload.body.trim(),
      createdAt: Date.now()
    })
    nextPayload.comments = comments
    const updated = await this.repo.update(task.id, { payload: nextPayload })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    return okResponse(comments)
  }

  async commentUpdate(payload: UpdateTaskCommentRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskComment[]>> {
    if (!payload?.taskId || !payload?.commentId || !payload?.body?.trim()) {
      return errorResponse(ErrorCodes.Validation, 'Task id, comment id and body required')
    }
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskComment[]>
    const task = access.data.task
    const nextPayload = asPayload(task.payload)
    const comments = asComments(nextPayload.comments)
    const index = comments.findIndex((comment) => comment.id === payload.commentId)
    if (index < 0) return errorResponse(ErrorCodes.NotFound, 'Comment not found')
    comments[index] = {
      ...comments[index],
      body: payload.body.trim()
    }
    nextPayload.comments = comments
    const updated = await this.repo.update(task.id, { payload: nextPayload })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    return okResponse(comments)
  }

  async commentRemove(payload: RemoveTaskCommentRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<TaskComment[]>> {
    if (!payload?.taskId || !payload?.commentId) {
      return errorResponse(ErrorCodes.Validation, 'Task id and comment id required')
    }
    const access = await this.ensureTaskAccess(payload.actorToken, payload.taskId)
    if (!access.ok || !access.data) return access as ServiceResponse<TaskComment[]>
    const task = access.data.task
    const nextPayload = asPayload(task.payload)
    const comments = asComments(nextPayload.comments)
    const nextComments = comments.filter((comment) => comment.id !== payload.commentId)
    if (nextComments.length === comments.length) return errorResponse(ErrorCodes.NotFound, 'Comment not found')
    nextPayload.comments = nextComments
    const updated = await this.repo.update(task.id, { payload: nextPayload })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Task not found')
    return okResponse(nextComments)
  }
}
