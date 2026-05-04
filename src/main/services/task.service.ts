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
  ListPlannedCodexTasksRequest,
  PaginatedResponse,
  PlanTaskCodexRequest,
  PlannedCodexTaskRow,
  ProjectExportAttachmentInput,
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
import type { Agent, ProjectStatus, Skill, Tag, TaskChecklistItem, TaskComment, TaskEntity, TaskJsonImportResult, TaskSubtask } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { TaskRepository, TaskSkillRepository, TaskSubtaskRepository, TaskTagRepository } from '../../db/repositories/task-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { CustomFieldRepository, TagRepository } from '../../db/repositories/custom-field-repo.js'
import { SkillRepository } from '../../db/repositories/skill-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { StatusRepository } from '../../db/repositories/status-repo.js'
import { AppSettingsRepository, WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { CODEX_LANGUAGE_KEY, DEFAULT_AGENT_KEY } from './app-settings.service.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'
import type { NormalizedTaskJsonImport } from './task-json-import.js'
import { safeConsole } from '../utils/safe-output.js'
import { showCodexNotification } from '../utils/codex-notifications.js'
import { formatUsageSummary, parseCodexEvents, type CodexNormalizedEvent, type CodexUsageSummary } from '../../shared/utils/codex-events.js'
import { codexLanguageDisplayName, normalizeCodexLanguage, normalizeCodexReasoningEffort, type CodexLanguagePair } from '../../shared/utils/codex-language.js'

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
  language?: string
  inputLanguage?: string
  outputLanguage?: string
  mode?: 'plan' | 'execute'
  executionMode?: CodexExecutionMode
  reasoningEffort?: string
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
  postRunPrompt: string
}

export type PlannerQuestionOption = {
  id: string
  label: string
  description?: string
}

export type PlannerQuestionItem = {
  id: string
  question: string
  why?: string
  options?: PlannerQuestionOption[]
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function projectCodexMetrics(projectMetrics: Record<string, unknown> | undefined): Record<string, unknown> {
  return asRecord(projectMetrics?.codex)
}

function taskCodexMetrics(task: TaskEntity): Record<string, unknown> {
  return asRecord(asPayload(task.payload).codex)
}

function taskCodexPlanConversationId(task: TaskEntity): string | undefined {
  const planState = asRecord(asPayload(task.payload).codexPlanState)
  const conversationId = planState.conversationId
  return typeof conversationId === 'string' && conversationId.trim() ? conversationId : undefined
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
  const postRunPrompt = (metrics as Record<string, unknown>).projectPostRunPrompt
  return {
    generalContext: project.generalContext ?? '',
    generalPrompt: project.generalPrompt ?? '',
    planGuide: typeof planGuide === 'string' ? planGuide : '',
    defaultOutput: project.defaultOutput ?? '',
    rules: typeof rules === 'string' ? rules : '',
    postRunPrompt: typeof postRunPrompt === 'string' ? postRunPrompt : ''
  }
}

function projectCodexLanguageValue(project: { metrics?: Record<string, unknown> | null }, key: 'language' | 'inputLanguage' | 'outputLanguage'): string | undefined {
  const codex = project.metrics?.codex
  if (!codex || typeof codex !== 'object' || Array.isArray(codex)) return undefined
  const value = (codex as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

async function resolveCodexLanguageSetting(
  repo: AppSettingsRepository,
  organizationId: string,
  project: { metrics?: Record<string, unknown> | null },
  requested?: { language?: string; inputLanguage?: string; outputLanguage?: string }
): Promise<string> {
  const stored = await repo.get<string | null>(organizationId, CODEX_LANGUAGE_KEY).catch(() => null)
  return normalizeCodexLanguage(
    requested?.language?.trim()
      || projectCodexLanguageValue(project, 'language')
      || requested?.outputLanguage
      || requested?.inputLanguage
      || projectCodexLanguageValue(project, 'outputLanguage')
      || projectCodexLanguageValue(project, 'inputLanguage')
      || stored
      || undefined
  )
}

function codexLanguageInstruction(language?: string | CodexLanguagePair): string {
  const selectedLanguage = typeof language === 'object' && language
    ? normalizeCodexLanguage(language.outputLanguage)
    : normalizeCodexLanguage(language)
  return [
    `Selected Codex language: ${codexLanguageDisplayName(selectedLanguage)}.`,
    'Interpret user, task, and project text in this selected language when ambiguous.',
    'Write all user-facing replies, plans, planner questions, task updates, subtask titles/descriptions, checklist items, final summaries, and verification notes in this selected language.'
  ].join(' ')
}

function projectCodexReasoningEffort(project: { metrics?: Record<string, unknown> | null }, mode: 'plan' | 'run', requested?: string): string {
  if (requested) return normalizeCodexReasoningEffort(requested)
  const codex = project.metrics?.codex
  if (!codex || typeof codex !== 'object' || Array.isArray(codex)) return 'medium'
  const record = codex as Record<string, unknown>
  return normalizeCodexReasoningEffort(mode === 'plan' ? record.planReasoningEffort : record.runReasoningEffort)
}

function codexReasoningConfigArg(reasoningEffort: string): string {
  return `model_reasoning_effort="${normalizeCodexReasoningEffort(reasoningEffort)}"`
}

function projectDefaultAgentId(project: { metrics?: Record<string, unknown> | null }): string {
  const value = project.metrics?.defaultAgentId
  return typeof value === 'string' ? value : ''
}

function projectDefaultSkillIds(project: { metrics?: Record<string, unknown> | null }): string[] {
  const value = project.metrics?.defaultSkillIds
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

type ProjectInstructionAudience = 'plan' | 'run' | 'chat'

function projectInstructionsSection(projectPrompt?: Partial<ProjectPromptSnapshot> | null, options?: { audience?: ProjectInstructionAudience }): string {
  const audience = options?.audience ?? 'run'
  const rows = audience === 'plan'
    ? [
        projectPrompt?.planGuide?.trim() ? `Plan Guide:\n${projectPrompt.planGuide.trim()}` : ''
      ].filter(Boolean)
    : audience === 'chat'
      ? [
          projectPrompt?.generalContext?.trim() ? `General Context:\n${projectPrompt.generalContext.trim()}` : '',
          projectPrompt?.generalPrompt?.trim() ? `General Prompt:\n${projectPrompt.generalPrompt.trim()}` : '',
          projectPrompt?.defaultOutput?.trim() ? `Default Output:\n${projectPrompt.defaultOutput.trim()}` : '',
          projectPrompt?.rules?.trim() ? `Project Rules:\n${projectPrompt.rules.trim()}` : ''
        ].filter(Boolean)
      : [
          projectPrompt?.generalContext?.trim() ? `General Context:\n${projectPrompt.generalContext.trim()}` : '',
          projectPrompt?.generalPrompt?.trim() ? `General Prompt:\n${projectPrompt.generalPrompt.trim()}` : '',
          projectPrompt?.planGuide?.trim() ? `Plan Guide:\n${projectPrompt.planGuide.trim()}` : '',
          projectPrompt?.defaultOutput?.trim() ? `Default Output:\n${projectPrompt.defaultOutput.trim()}` : '',
          projectPrompt?.rules?.trim() ? `Project Rules:\n${projectPrompt.rules.trim()}` : ''
        ].filter(Boolean)
  return rows.length > 0
    ? `High-priority Project Instructions:\n${rows.join('\n\n')}`
    : 'High-priority Project Instructions: none configured.'
}

function projectInstructionsFromPlannerContext(context?: unknown): ProjectPromptSnapshot {
  const contextRecord = context && typeof context === 'object' && !Array.isArray(context) ? context as Record<string, unknown> : {}
  const projectRecord = contextRecord.project && typeof contextRecord.project === 'object' && !Array.isArray(contextRecord.project) ? contextRecord.project as Record<string, unknown> : {}
  return {
    generalContext: typeof projectRecord.generalContext === 'string' ? projectRecord.generalContext : '',
    generalPrompt: typeof projectRecord.generalPrompt === 'string' ? projectRecord.generalPrompt : '',
    planGuide: typeof projectRecord.planGuide === 'string' ? projectRecord.planGuide : '',
    defaultOutput: typeof projectRecord.defaultOutput === 'string' ? projectRecord.defaultOutput : '',
    rules: typeof projectRecord.rules === 'string' ? projectRecord.rules : '',
    postRunPrompt: typeof projectRecord.postRunPrompt === 'string' ? projectRecord.postRunPrompt : ''
  }
}

function projectSettingsSectionFromPlannerContext(context?: unknown): string {
  const contextRecord = context && typeof context === 'object' && !Array.isArray(context) ? context as Record<string, unknown> : {}
  const settings = contextRecord.projectSettings && typeof contextRecord.projectSettings === 'object' && !Array.isArray(contextRecord.projectSettings)
    ? contextRecord.projectSettings as Record<string, unknown>
    : {}
  const codex = settings.codex && typeof settings.codex === 'object' && !Array.isArray(settings.codex)
    ? settings.codex as Record<string, unknown>
    : {}
  const defaultSkills = Array.isArray(settings.defaultSkills)
    ? settings.defaultSkills.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
        const record = item as Record<string, unknown>
        return typeof record.name === 'string' ? record.name : typeof record.id === 'string' ? record.id : ''
      }).filter(Boolean)
    : []
  const rows = [
    settings.language ? `- Language: ${codexLanguageDisplayName(settings.language)}` : '',
    settings.defaultAgentId ? `- Default agent id: ${String(settings.defaultAgentId)}` : '',
    defaultSkills.length > 0 ? `- Default skills: ${defaultSkills.join(', ')}` : '',
    codex.gatewayId ? `- Gateway: ${String(codex.gatewayId)}` : '',
    codex.runtimeWorkspaceId ? `- Runtime workspace id: ${String(codex.runtimeWorkspaceId)}` : '',
    codex.planModel ? `- Plan model: ${String(codex.planModel)} (${normalizeCodexReasoningEffort(codex.planReasoningEffort)} reasoning)` : '',
    (codex.runModel || codex.defaultModel) ? `- Run model: ${String(codex.runModel ?? codex.defaultModel)} (${normalizeCodexReasoningEffort(codex.runReasoningEffort)} reasoning)` : ''
  ].filter(Boolean)
  return rows.length > 0 ? `High-priority Project settings:\n${rows.join('\n')}` : ''
}

function routedProjectContextForPrompt(context: unknown, audience: ProjectInstructionAudience): unknown {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return context
  const record = { ...(context as Record<string, unknown>) }
  const project = record.project && typeof record.project === 'object' && !Array.isArray(record.project)
    ? { ...(record.project as Record<string, unknown>) }
    : null
  if (!project) return record
  if (audience === 'plan') {
    project.generalContext = ''
    project.generalPrompt = ''
    project.defaultOutput = ''
    project.rules = ''
    project.postRunPrompt = ''
  } else if (audience === 'chat') {
    project.planGuide = ''
    project.postRunPrompt = ''
  }
  record.project = project
  return record
}

function effectiveAgentSection(agent?: (Partial<Agent> & { inherited?: boolean }) | null): string {
  if (!agent?.id && !agent?.name) return 'Effective agent: none assigned.'
  const parts = [
    agent.name ? `name=${agent.name}` : '',
    agent.id ? `id=${agent.id}` : '',
    agent.title ? `title=${agent.title}` : '',
    agent.description ? `description=available` : '',
    agent.tags?.length ? `tags=${agent.tags.map((tag) => tag.name).filter(Boolean).join(',')}` : '',
    agent.trainingMarkdown?.trim() ? 'generalPrompt=available' : '',
    agent.inherited ? 'source=default inherited agent' : 'source=task/project agent'
  ].filter(Boolean)
  return `Effective agent: ${parts.join(', ')}. Apply this agent's instructions as execution guidance; full active settings are available in Agents.md when exported.`
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

export function initialCodexPrompt(
  exportWorkspacePath: string,
  runtimeWorkspacePath: string,
  projectId: string,
  taskId: string,
  omcInstructionsPath: string,
  options: { language?: string; languages?: CodexLanguagePair; projectPrompt?: ProjectPromptSnapshot; effectiveAgent?: (Partial<Agent> & { inherited?: boolean }) | null } = {}
): string {
  const language = typeof options.languages === 'object' ? options.languages.outputLanguage : options.language
  return [
    `Open Mission Control runtime workspace is ${runtimeWorkspacePath}.`,
    `The exported task files are in ${exportWorkspacePath}.`,
    `The Open Mission Control project id is ${projectId} and task id is ${taskId}.`,
    codexLanguageInstruction(language),
    projectInstructionsSection(options.projectPrompt, { audience: 'run' }),
    effectiveAgentSection(options.effectiveAgent),
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

type PlannerClarificationMode = 'ask-first' | 'direct'

function normalizePlannerClarificationMode(value: unknown): PlannerClarificationMode {
  return value === 'ask-first' ? 'ask-first' : 'direct'
}

export function plannerJsonGuidance() {
  return {
    planningPolicy: {
      clarificationMode: 'Plan launch chooses either ask-first or direct. ask-first must ask questions before task JSON updates; direct must not ask questions.',
      subtaskRewrite: 'Refactor the entire subtasks array on every planning update, including completed/done/closed subtasks. Treat current subtasks as input context, not immutable history.',
      granularity: 'balanced',
      subtaskCount: 'Use 1-3 subtasks for small tasks, 3-8 subtasks for typical tasks, and at most 12 subtasks for very large tasks.',
      primaryExecutionPlan: 'Subtasks are the primary execution plan that will later be exported into Task.md for Codex Run.',
      noGenericWork: 'No generic tasks or checklist items such as Test yap, Run tests, Fix bugs, Implement feature, Implement UI, or Check everything.',
      overrideProjectGuide: 'These planner rules are non-negotiable and override weaker or conflicting project plan guide instructions, including any instruction that says user input is not needed.'
    },
    subtaskPolicy: [
      'Create subtasks for cohesive implementation areas, independent workflows, separate ownership boundaries, or meaningful verification paths.',
      'Subtasks must be ordered in the sequence the execution agent should follow.',
      'Every subtask must use the Title + Description shape: a short action-oriented title and a concise AI-guiding description.',
      'Do not create a separate subtask for every file, UI state, edge case, or verification command; fold those details into the relevant subtask description.',
      'Checklist items are optional. If provided, they must be concrete, unchecked, and specific to the subtask.',
      'Do not spread test cases across subtasks. If verification is needed, make the final subtask cover concrete verification and acceptance work.'
    ],
    plannedSubtaskTemplate: {
      title: 'Specific action-oriented subtask title',
      description: 'Concise implementation context, exact expected work, sequencing guidance, and completion signal for this cohesive area.'
    },
    genericTextRejectList: PLANNER_GENERIC_TEXT_REJECT_LIST
  }
}

export function initialPlannerPrompt(
  projectId: string,
  taskId: string,
  helperPath: string,
  contextPath: string,
  plannedTaskPath: string,
  options: { language?: string; languages?: CodexLanguagePair; projectPrompt?: ProjectPromptSnapshot; effectiveAgent?: (Partial<Agent> & { inherited?: boolean }) | null; clarificationMode?: PlannerClarificationMode } = {}
): string {
  const questionsPath = plannedTaskPath.replace(/planned-task\.json$/i, 'questions.json')
  const language = typeof options.languages === 'object' ? options.languages.outputLanguage : options.language
  const clarificationMode = normalizePlannerClarificationMode(options.clarificationMode)
  const sharedRules = [
    'Non-negotiable planner rules in this prompt override weaker or conflicting project Plan Guide instructions, including any instruction that says user input is not needed.',
    'Use task description for the general goal, implementation scope, and overall AI guidance. Use task comments for important flows, risks, dependencies, edge cases, and decision notes. Preserve existing user comments.',
    'Refactor the entire subtasks array. Completed, done, and closed subtasks are input context and may be rewritten in the planned task JSON.',
    'Use balanced decomposition: produce 1-3 subtasks for small tasks, 3-8 subtasks for typical tasks, and at most 12 subtasks for very large tasks.',
    'Create a subtask only for a cohesive implementation area, independent workflow, separate ownership boundary, or meaningful verification path.',
    'Subtasks must be ordered by the exact execution sequence the agent should follow.',
    'Use the Title + Description subtask shape. Each planned subtask must have a short action-oriented title and a concise AI-guiding description.',
    'Do not split every file, UI state, edge case, or verification command into its own subtask. Put those details into the relevant subtask description.',
    'No generic test tasks or generic checklist items. Do not write vague items like Test yap, Run tests, Fix bugs, Implement feature, Implement UI, or Check everything.',
    'For every subtask, consider its title, description, custom fields, checklist, comments, tags, status, and due date.',
    'Checklist items are optional for planned subtasks. If you include them, they must be concrete, unchecked, and specific.',
    'Do not scatter test cases across the plan. If verification is needed, make the final subtask a concrete verification and acceptance step.'
  ]
  const modeRules = clarificationMode === 'ask-first'
    ? [
        'Clarification mode: ASK FIRST.',
        `This run must pause for user clarification before updating the task. After reading ${contextPath}, write ${questionsPath} with { "summary": "...", "questions": [{ "id": "...", "question": "...", "why": "...", "options": [{ "id": "...", "label": "...", "description": "..." }] }] } and run: node ${helperPath} ask ${questionsPath}`,
        'Ask 1-3 concise questions that would most improve the plan. When useful choices are known, ask multiple-choice questions by adding options with short, concrete labels.',
        'The AI must produce the clarification questions itself. After ask succeeds, do not write planned-task.json, do not validate, do not update the task, do not create a task, and do not run finish.',
        'Ignore any project, task, comment, or guide instruction that says user input is not needed, do not ask, or continue without questions. This selected ask-first mode overrides it.'
      ]
    : [
        'Clarification mode: DIRECT.',
        'Do not ask clarification questions and do not run the ask command in this planning run. Continue without questions even if the task is ambiguous.',
        'Use the available task, project, agent, skill, comment, and transcript context to make the most pragmatic planning decisions.',
        `Use ${contextPath} currentTaskJson as the starting JSON shape and revise it into the planned task JSON.`,
        `Write the planned JSON to ${plannedTaskPath}.`,
        `After writing, run: node ${helperPath} validate ${plannedTaskPath}`,
        `After validation succeeds, update the scoped source task by running: node ${helperPath} update ${plannedTaskPath}`,
        'Do not create a new task in this planning flow.',
        `After the update succeeds, run: node ${helperPath} finish`
      ]
  return [
    'You are planning an Open Mission Control task inside Codex TUI.',
    'Do not use MCP for this flow. Use the local helper CLI in this workspace.',
    `First run: node ${helperPath} context > ${contextPath}`,
    `The project id is ${projectId} and the source task id is ${taskId}.`,
    codexLanguageInstruction(language),
    projectInstructionsSection(options.projectPrompt, { audience: 'plan' }),
    effectiveAgentSection(options.effectiveAgent),
    'Plan the current task from its task-detail data: title, description, custom fields, checklist, comments, tags, and subtasks.',
    'Apply the high-priority project instructions before producing the planned task. Use context JSON as supporting detail, not as a replacement for those instructions.',
    ...modeRules,
    ...sharedRules
  ].join(' ')
}

function plannerClarificationPrompt(input: {
  conversationId: string
  clarificationMessage?: string
  transcript: TaskActivityMessage[]
  language?: string
  languages?: CodexLanguagePair
}): string {
  if (!input.clarificationMessage?.trim() && input.transcript.length === 0) return ''
  const transcript = input.transcript
    .slice(-32)
    .map((item) => `${item.role.toUpperCase()}: ${item.body}`)
    .join('\n\n')
  return [
    `This planning run continues plan conversation ${input.conversationId}.`,
    codexLanguageInstruction(input.language ?? input.languages),
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
  followUpContext?: string
  attachments?: Array<{ name: string; path: string }>
  language?: string
  languages?: CodexLanguagePair
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
  const projectInstructions = projectInstructionsFromPlannerContext(input.context)
  const effectiveAgent = contextRecord.effectiveAgent && typeof contextRecord.effectiveAgent === 'object' && !Array.isArray(contextRecord.effectiveAgent)
    ? contextRecord.effectiveAgent as Partial<Agent> & { inherited?: boolean }
    : null
  const language = typeof input.languages === 'object' ? input.languages.outputLanguage : input.language
  const instructionAudience: ProjectInstructionAudience = input.mode === 'plan' ? 'plan' : 'chat'
  const routedContext = routedProjectContextForPrompt(input.context, instructionAudience)
  const userPromptLabel = input.mode === 'steer'
    ? 'User steer instruction'
    : input.mode === 'plan'
      ? 'User prompt'
      : 'User follow-up'
  const followUpContext = input.followUpContext?.trim()
    ? `Latest run output context:\n${input.followUpContext.trim()}`
    : ''
  const importantComments = importantTaskCommentsSection(input.task, input.context)
  return [
    'You are continuing an Open Mission Control task chat.',
    modeInstruction,
    codexLanguageInstruction(language),
    projectSettingsSectionFromPlannerContext(input.context),
    `${userPromptLabel}:\n${input.message}`,
    followUpContext,
    projectInstructionsSection(projectInstructions, { audience: instructionAudience }),
    effectiveAgentSection(effectiveAgent),
    importantComments,
    `Task id: ${input.task.id}`,
    `Task title: ${input.task.title}`,
    input.task.description ? `Task description:\n${input.task.description}` : '',
    routedContext ? `Current task context JSON:\n${JSON.stringify(routedContext, null, 2)}` : '',
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

type CodexActivityDraft = Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
type CodexActivityAppender = (messages: CodexActivityDraft[]) => Promise<TaskActivityMessage[]>

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
  let pendingMessages: CodexActivityDraft[] = []
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
    if (messages.length > 0) await append(messages.map(compactActivityMessage))
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

  const pushMessage = (message: CodexActivityDraft) => {
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

function combineGitNumstatStats(...stats: Array<{ fileStats: Array<{ path: string; insertions: number; deletions: number }> }>): { files: number; insertions: number; deletions: number; fileStats: Array<{ path: string; insertions: number; deletions: number }> } {
  const pathMap = new Map<string, { path: string; insertions: number; deletions: number }>()
  for (const stat of stats) {
    for (const item of stat.fileStats) {
      const current = pathMap.get(item.path) ?? { path: item.path, insertions: 0, deletions: 0 }
      current.insertions += item.insertions
      current.deletions += item.deletions
      pathMap.set(item.path, current)
    }
  }
  const fileStats = Array.from(pathMap.values())
  return {
    files: fileStats.length,
    insertions: fileStats.reduce((sum, item) => sum + item.insertions, 0),
    deletions: fileStats.reduce((sum, item) => sum + item.deletions, 0),
    fileStats
  }
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

function isOmcRuntimePath(path: string): boolean {
  return path === '.omc' || path.startsWith('.omc/') || path.includes('/.omc/')
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true
  if (buffer.includes(0)) return false
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue
    if (byte >= 32 && byte <= 126) continue
    if (byte >= 128) continue
    suspicious += 1
  }
  return suspicious / sample.length < 0.08
}

function countTextLines(buffer: Buffer): number {
  if (buffer.length === 0) return 0
  let lines = 1
  for (const byte of buffer) {
    if (byte === 10) lines += 1
  }
  return buffer[buffer.length - 1] === 10 ? Math.max(0, lines - 1) : lines
}

async function untrackedWorkspaceFileStats(runtimeWorkspacePath: string, value: string): Promise<{
  summary: string
  fileStats: Array<{ path: string; insertions: number; deletions: number; blocks: number; untracked?: boolean; binary?: boolean }>
}> {
  const paths = value.trim().split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !isOmcRuntimePath(line))
  const fileStats: Array<{ path: string; insertions: number; deletions: number; blocks: number; untracked?: boolean; binary?: boolean }> = []
  for (const relativePath of paths) {
    const absolutePath = resolve(runtimeWorkspacePath, relativePath)
    if (absolutePath !== runtimeWorkspacePath && !absolutePath.startsWith(`${resolve(runtimeWorkspacePath)}${sep}`)) continue
    try {
      const info = await stat(absolutePath)
      if (!info.isFile()) continue
      const buffer = await readFile(absolutePath)
      const isText = isLikelyTextBuffer(buffer)
      fileStats.push({
        path: relativePath,
        insertions: isText ? countTextLines(buffer) : 0,
        deletions: 0,
        blocks: 0,
        untracked: true,
        binary: !isText
      })
    } catch {
      fileStats.push({ path: relativePath, insertions: 0, deletions: 0, blocks: 0, untracked: true })
    }
  }
  return {
    summary: fileStats.map((item) => `?? ${item.path}${item.binary ? ' (binary)' : item.insertions ? ` (+${item.insertions})` : ''}`).join('\n'),
    fileStats
  }
}

export async function codexWorkspaceChanges(runtimeWorkspacePath: string, changesPath?: string): Promise<{
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
    const cachedStatResult = await execFileAsync('git', ['diff', '--cached', '--stat', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 2 * 1024 * 1024
    })
    const numstatResult = await execFileAsync('git', ['diff', '--numstat', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 2 * 1024 * 1024
    })
    const cachedNumstatResult = await execFileAsync('git', ['diff', '--cached', '--numstat', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 2 * 1024 * 1024
    })
    const patchResult = await execFileAsync('git', ['diff', '--patch', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 8 * 1024 * 1024
    })
    const cachedPatchResult = await execFileAsync('git', ['diff', '--cached', '--patch', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 8 * 1024 * 1024
    })
    const untrackedResult = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '--', '.', ':(exclude).omc/**'], {
      cwd: runtimeWorkspacePath,
      maxBuffer: 2 * 1024 * 1024
    })
    const status = String(statusResult.stdout).trim()
    const stat = [String(cachedStatResult.stdout).trim(), String(statResult.stdout).trim()].filter(Boolean).join('\n')
    const numstat = String(numstatResult.stdout).trim()
    const cachedNumstat = String(cachedNumstatResult.stdout).trim()
    const patch = [String(cachedPatchResult.stdout).trim(), String(patchResult.stdout).trim()].filter(Boolean).join('\n')
    const untracked = await untrackedWorkspaceFileStats(runtimeWorkspacePath, String(untrackedResult.stdout))
    if (!status && !stat && !patch && untracked.fileStats.length === 0) return {
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
    const numstatSummary = combineGitNumstatStats(parseGitNumstat(cachedNumstat), parseGitNumstat(numstat))
    const patchSummary = parseGitPatchStats(patch)
    const mergedSummary = mergeChangeFileStats(numstatSummary, {
      files: patchSummary.files + untracked.fileStats.length,
      blocks: patchSummary.blocks,
      fileStats: [...patchSummary.fileStats, ...untracked.fileStats]
    })
    const statWithUntracked = [stat, untracked.summary ? `Untracked files counted from file contents:\n${untracked.summary}` : ''].filter(Boolean).join('\n\n')
    return {
      body: [
        'Changes',
        '',
        status ? ['Status', '````text', status, '````'].join('\n') : '',
        statWithUntracked ? ['Stat', '````text', statWithUntracked, '````'].join('\n') : '',
        truncatedPatch.text ? ['', '````diff', truncatedPatch.text, '````'].join('\n') : ''
      ].filter(Boolean).join('\n'),
      truncated: truncatedPatch.truncated,
      changesPath: changesPath && patch ? changesPath : undefined,
      metadata: {
        changeStatus: status,
        changeStat: statWithUntracked,
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

type CodexOutputChangeKind = 'created' | 'edited' | 'deleted'

type CodexOutputChangeFile = {
  path: string
  kind: CodexOutputChangeKind
  insertions: number
  deletions: number
  blocks: number
  binary?: boolean
}

const CODEX_OUTPUT_PATH_RE = /(?:`([^`\r\n]+)`|(?:[A-Za-z0-9_.@+-]+\/)+[A-Za-z0-9_.@+-]+(?:\.[A-Za-z0-9_+-]+)?)/g

function codexOutputText(rawEvents: string, finalMessage: string): string {
  const lines: string[] = []
  if (finalMessage.trim()) lines.push(finalMessage)
  for (const line of rawEvents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const collect = (value: unknown, depth = 0) => {
        if (depth > 5) return
        if (typeof value === 'string') {
          if (value.trim()) lines.push(value)
          return
        }
        if (Array.isArray(value)) {
          value.forEach((item) => collect(item, depth + 1))
          return
        }
        if (value && typeof value === 'object') {
          for (const item of Object.values(value as Record<string, unknown>)) collect(item, depth + 1)
        }
      }
      collect(parsed)
    } catch {
      lines.push(trimmed)
    }
  }
  return lines.join('\n')
}

function cleanCodexOutputPath(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`,.:;]+$/g, '')
    .replace(/^[ab]\//, '')
    .replace(/^\.\//, '')
}

function isCodexOutputFilePath(value: string): boolean {
  const path = cleanCodexOutputPath(value)
  if (!path || path === '/dev/null' || isOmcRuntimePath(path)) return false
  if (path.includes('://')) return false
  if (path.startsWith('-') || path.startsWith('+')) return false
  return path.includes('/') || /\.[A-Za-z0-9_+-]{1,12}$/.test(path)
}

function mergeCodexOutputKind(previous: CodexOutputChangeKind | undefined, next: CodexOutputChangeKind): CodexOutputChangeKind {
  if (previous === 'deleted' || next === 'deleted') return 'deleted'
  if (previous === 'created' || next === 'created') return 'created'
  return 'edited'
}

function addCodexOutputChange(
  map: Map<string, CodexOutputChangeFile>,
  pathValue: string,
  kind: CodexOutputChangeKind,
  patch: Partial<Pick<CodexOutputChangeFile, 'insertions' | 'deletions' | 'blocks' | 'binary'>> = {}
) {
  const path = cleanCodexOutputPath(pathValue)
  if (!isCodexOutputFilePath(path)) return
  const current = map.get(path)
  map.set(path, {
    path,
    kind: mergeCodexOutputKind(current?.kind, kind),
    insertions: (current?.insertions ?? 0) + Math.max(0, patch.insertions ?? 0),
    deletions: (current?.deletions ?? 0) + Math.max(0, patch.deletions ?? 0),
    blocks: (current?.blocks ?? 0) + Math.max(0, patch.blocks ?? 0),
    binary: current?.binary === true || patch.binary === true
  })
}

function parseCodexOutputChangedFiles(rawEvents: string, finalMessage: string): CodexOutputChangeFile[] {
  const text = codexOutputText(rawEvents, finalMessage)
  const changes = new Map<string, CodexOutputChangeFile>()

  for (const match of text.matchAll(/^\*\*\*\s+(Add|Update|Delete)\s+File:\s+(.+)$/gim)) {
    const action = match[1]?.toLowerCase()
    const kind: CodexOutputChangeKind = action === 'add' ? 'created' : action === 'delete' ? 'deleted' : 'edited'
    addCodexOutputChange(changes, match[2] ?? '', kind)
  }

  const diffChunks = text.split(/\n(?=diff --git\s+a\/)/g)
  for (const chunk of diffChunks) {
    const header = chunk.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/m)
    const plus = chunk.match(/^\+\+\+\s+(?:b\/)?(.+)$/m)
    const minus = chunk.match(/^---\s+(?:a\/)?(.+)$/m)
    const targetPath = cleanCodexOutputPath(plus?.[1] && plus[1] !== '/dev/null' ? plus[1] : header?.[2] ?? minus?.[1] ?? '')
    if (!targetPath) continue
    const kind: CodexOutputChangeKind = /(?:^|\n)new file mode\b/.test(chunk)
      ? 'created'
      : /(?:^|\n)deleted file mode\b/.test(chunk) || plus?.[1] === '/dev/null'
        ? 'deleted'
        : 'edited'
    const insertions = chunk.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const deletions = chunk.split(/\r?\n/).filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    const blocks = chunk.split(/\r?\n/).filter((line) => line.startsWith('@@')).length
    addCodexOutputChange(changes, targetPath, kind, { insertions, deletions, blocks })
  }

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const verbSegments = line.matchAll(/\b(Created|Added|Edited|Updated|Modified|Changed|Deleted|Removed)\b([\s\S]*?)(?=\b(?:Created|Added|Edited|Updated|Modified|Changed|Deleted|Removed)\b|$)/gi)
    for (const segment of verbSegments) {
      const verb = segment[1].toLowerCase()
      const kind: CodexOutputChangeKind = ['created', 'added'].includes(verb)
        ? 'created'
        : ['deleted', 'removed'].includes(verb)
          ? 'deleted'
          : 'edited'
      for (const pathMatch of (segment[2] ?? '').matchAll(CODEX_OUTPUT_PATH_RE)) {
        addCodexOutputChange(changes, pathMatch[1] ?? pathMatch[0], kind)
      }
    }
  }

  return [...changes.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function codexOutputChanges(rawEvents: string, finalMessage: string): {
  hasChanges: boolean
  body: string
  truncated: boolean
  metadata: Record<string, unknown>
} {
  const fileStats = parseCodexOutputChangedFiles(rawEvents, finalMessage)
  if (fileStats.length === 0) {
    return {
      hasChanges: false,
      body: '',
      truncated: false,
      metadata: {
        changeSource: 'codex-output',
        changeHasNoChanges: true,
        changeFiles: 0,
        changeInsertions: 0,
        changeDeletions: 0,
        changeBlocks: 0,
        changeFileStats: [],
        patchPreviewLanguage: 'text'
      }
    }
  }
  const rows = fileStats.map((item) => {
    const label = item.kind === 'created' ? 'Created' : item.kind === 'deleted' ? 'Deleted' : 'Edited'
    const stats = item.binary ? ' (binary)' : item.insertions || item.deletions ? ` (+${item.insertions} -${item.deletions})` : ''
    return `${label} ${item.path}${stats}`
  })
  const preview = truncateCodexText(rows.join('\n'), CODEX_DIFF_PATCH_LIMIT)
  const insertions = fileStats.reduce((sum, item) => sum + item.insertions, 0)
  const deletions = fileStats.reduce((sum, item) => sum + item.deletions, 0)
  const blocks = fileStats.reduce((sum, item) => sum + item.blocks, 0)
  return {
    hasChanges: true,
    body: ['Codex reported file changes', '', '````text', preview.text, '````'].join('\n'),
    truncated: preview.truncated,
    metadata: {
      changeSource: 'codex-output',
      changeHasNoChanges: false,
      changeFiles: fileStats.length,
      changeInsertions: insertions,
      changeDeletions: deletions,
      changeBlocks: blocks,
      changeFileStats: fileStats.map((item) => ({
        path: item.path,
        kind: item.kind,
        insertions: item.insertions,
        deletions: item.deletions,
        blocks: item.blocks,
        untracked: item.kind === 'created',
        deleted: item.kind === 'deleted',
        binary: item.binary === true
      })),
      patchPreviewLanguage: 'text'
    }
  }
}

export function shouldStartPostRunPrompt(code: number | null, executionMode: CodexExecutionMode, postRunPrompt?: string): boolean {
  return executionMode === 'exec' && code === 0 && Boolean(postRunPrompt?.trim())
}

function extractCodexSessionId(rawEvents: string): string | undefined {
  const keys = new Set(['session_id', 'sessionId', 'conversation_id', 'conversationId', 'thread_id', 'threadId'])
  const visit = (value: unknown, depth = 0): string | undefined => {
    if (depth > 5 || !value || typeof value !== 'object') return undefined
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1)
        if (found) return found
      }
      return undefined
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(key) && typeof item === 'string' && item.trim()) return item.trim()
      const found = visit(item, depth + 1)
      if (found) return found
    }
    return undefined
  }
  for (const line of rawEvents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const found = visit(JSON.parse(trimmed) as unknown)
      if (found) return found
    } catch {
      // Ignore raw non-JSON lines.
    }
  }
  return undefined
}

function postRunContinuationPrompt(input: {
  language?: string
  projectPrompt: ProjectPromptSnapshot
  effectiveAgent?: (Partial<Agent> & { inherited?: boolean }) | null
  primaryFinalMessage: string
  primaryChanges: ReturnType<typeof codexOutputChanges>
}): string {
  return [
    'You are continuing an Open Mission Control Codex Run after the primary exec process completed successfully.',
    codexLanguageInstruction(input.language),
    projectInstructionsSection(input.projectPrompt, { audience: 'run' }),
    effectiveAgentSection(input.effectiveAgent),
    'Do not restart the original task. Continue from the current workspace state and apply only the Post-run prompt.',
    input.primaryFinalMessage.trim() ? `Primary run final message:\n${input.primaryFinalMessage.trim()}` : '',
    input.primaryChanges.hasChanges ? `Primary run Codex-reported changes:\n${input.primaryChanges.body}` : '',
    `Post-run prompt:\n${input.projectPrompt.postRunPrompt.trim()}`,
    'When done, summarize only the post-run work, changed files, and verification.'
  ].filter(Boolean).join('\n\n')
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
  const questions: PlannerQuestionItem[] = []
  if (Array.isArray(record.questions)) {
    for (const [index, raw] of record.questions.entries()) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const questionRecord = raw as Record<string, unknown>
      const question = typeof questionRecord.question === 'string' ? questionRecord.question.trim() : ''
      if (!question) continue
      const rawId = typeof questionRecord.id === 'string' ? questionRecord.id.trim() : ''
      const why = typeof questionRecord.why === 'string' && questionRecord.why.trim() ? questionRecord.why.trim() : undefined
      let options: PlannerQuestionOption[] | undefined
      if (questionRecord.options !== undefined) {
        const rawOptions = questionRecord.options
        if (!Array.isArray(rawOptions)) return errorResponse(ErrorCodes.Validation, 'Planner question options must be an array')
        if (rawOptions.length === 0) return errorResponse(ErrorCodes.Validation, 'Planner question options must include at least one label')
        options = rawOptions.flatMap((rawOption, optionIndex): PlannerQuestionOption[] => {
          if (typeof rawOption === 'string') {
            const label = rawOption.trim()
            return label ? [{ id: `option-${optionIndex + 1}`, label }] : []
          }
          if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) return []
          const optionRecord = rawOption as Record<string, unknown>
          const label = typeof optionRecord.label === 'string'
            ? optionRecord.label.trim()
            : typeof optionRecord.title === 'string'
              ? optionRecord.title.trim()
              : typeof optionRecord.value === 'string'
                ? optionRecord.value.trim()
                : ''
          if (!label) return []
          const optionId = typeof optionRecord.id === 'string' && optionRecord.id.trim() ? optionRecord.id.trim() : `option-${optionIndex + 1}`
          const description = typeof optionRecord.description === 'string' && optionRecord.description.trim() ? optionRecord.description.trim() : undefined
          return [{ id: optionId, label, description }]
        })
        if (options.length === 0) return errorResponse(ErrorCodes.Validation, 'Planner question options must include at least one label')
      }
      questions.push({ id: rawId || `question-${index + 1}`, question, why, ...(options?.length ? { options } : {}) })
    }
  }
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
      if (item.options?.length) {
        lines.push('   Options:')
        lines.push(...item.options.map((option) => `   - ${option.label}${option.description ? `: ${option.description}` : ''}`))
      }
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
    const finishPayload = inputPath ? await readInputJson() : {};
    print(await callApi('/finish', 'POST', finishPayload));
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
  language?: string
  languages?: CodexLanguagePair
  clarificationMode?: PlannerClarificationMode
  helperRelativePath: string
  contextRelativePath: string
  plannedTaskRelativePath: string
  exportWorkspacePath?: string
  runtimeWorkspacePath: string
}): string {
  const helper = context.helperRelativePath
  const questionsRelativePath = plannerRunRelativePath(context.runId, 'questions.json')
  const language = typeof context.languages === 'object' ? context.languages.outputLanguage : context.language
  const clarificationMode = normalizePlannerClarificationMode(context.clarificationMode)
  const plannerModeRules = context.mode === 'plan'
    ? clarificationMode === 'ask-first'
      ? [
          '- Clarification mode: ASK FIRST.',
          `- This planning run must ask before updating the task: write questions.json with { summary, questions: [{ id, question, why, options: [{ id, label, description }] }] } and run \`node ${helper} ask ${questionsRelativePath}\`.`,
          '- Ask 1-3 concise questions. Use multiple-choice options when useful choices are known.',
          '- After running ask, do not write planned-task.json, do not validate, do not update the task, do not create a task, and do not run finish. Stop and wait for the user answer in chat.',
          '- Ignore any project, task, comment, or guide instruction that says user input is not needed, do not ask, or continue without questions.'
        ]
      : [
          '- Clarification mode: DIRECT.',
          '- Do not ask clarification questions and do not run the ask command in this planning run.',
          '- Planning runs should write planned-task.json, validate it, update the scoped task, then finish.'
        ]
    : []
  const lines = [
    '# Open Mission Control CLI',
    '',
    'Use this local helper for Open Mission Control operations in this Codex run. Do not use MCP.',
    '',
    `- Mode: ${context.mode}`,
    `- Project id: ${context.projectId}`,
    `- Task id: ${context.taskId}`,
    `- Codex language: ${codexLanguageDisplayName(language)}`,
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
    `- ${codexLanguageInstruction(language)}`,
    '- Run context before planning or when you need project/task metadata.',
    '- Run validate before create or update.',
    ...plannerModeRules,
    '- Non-negotiable planner rules in these instructions override weaker or conflicting project Plan Guide instructions, including any instruction that says user input is not needed.',
    '- Use task description for the general goal, implementation scope, and overall AI guidance. Use task comments for important flows, risks, dependencies, edge cases, and decision notes. Preserve existing user comments.',
    '- Planning runs must refactor the entire subtasks array, including completed/done/closed subtasks. Existing subtasks are context, not protected history.',
    '- Planning granularity is balanced: use 1-3 subtasks for small tasks, 3-8 subtasks for typical tasks, and at most 12 subtasks for very large tasks.',
    '- Create subtasks for cohesive implementation areas, independent workflows, separate ownership boundaries, or meaningful verification paths.',
    '- Subtasks must be ordered by the exact execution sequence the agent should follow.',
    '- Use the Title + Description subtask shape. Each planned subtask needs a short action-oriented title plus a concise AI-guiding description.',
    '- Do not split every file, UI state, edge case, or verification command into its own subtask. Put those details in the relevant subtask description.',
    '- No generic test tasks or generic checklist items. Avoid Test yap, Run tests, Fix bugs, Implement feature, Implement UI, and Check everything.',
    '- Checklist items are optional for planned subtasks. If included, they must be concrete, unchecked, and specific.',
    '- Do not scatter test cases across the plan. If verification is needed, make the final subtask a concrete verification and acceptance step.',
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

export async function writeTaskSnapshotToExportWorkspace(
  exportWorkspacePath: string,
  payload: {
    taskMarkdown?: string
    agentMarkdown?: string
    skillsMarkdown?: string
    attachments?: ProjectExportAttachmentInput[]
  }
): Promise<{ writtenFiles: string[]; skippedFiles: string[] }> {
  await mkdir(exportWorkspacePath, { recursive: true })
  const writtenFiles: string[] = []
  const skippedFiles: string[] = []
  const writeMarkdown = async (name: string, content?: string) => {
    if (!content?.trim()) return
    await writeFile(join(exportWorkspacePath, name), content, 'utf8')
    writtenFiles.push(name)
  }

  await writeMarkdown('Task.md', payload.taskMarkdown)
  await writeMarkdown('Agents.md', payload.agentMarkdown)
  await writeMarkdown('Skills.md', payload.skillsMarkdown)

  const usedNames = new Set<string>()
  const attachmentsDir = join(exportWorkspacePath, 'attachments')
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

  return { writtenFiles, skippedFiles }
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

  private async advanceTaskFromFirstStatusAfterPlanning(taskId: string, organizationId: string): Promise<void> {
    const task = await this.repo.get(taskId)
    if (!task) return
    const statuses = await this.statuses.ensureProjectDefaults(task.projectId, organizationId)
    const ordered = [...statuses].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
    const first = ordered[0]
    const second = ordered[1]
    if (!first || !second) return
    const isFirstStatus = task.status === first.id || task.status === first.name
    if (!isFirstStatus) return
    const payload = await this.payloadWithAppendStatusOrder(task.projectId, second.id, asPayload(task.payload))
    const updated = await this.repo.update(task.id, { status: second.id, payload })
    if (updated) this.emitTaskUpdated(task.projectId, task.id, 'plan_status_advanced')
  }

  private async effectiveAgentForTask(task: TaskEntity, organizationId: string, project?: { metrics?: Record<string, unknown> | null }): Promise<(Partial<Agent> & { inherited?: boolean }) | null> {
    if (task.agentId) {
      const agent = await this.agents.get(task.agentId)
      return agent && agent.organizationId === organizationId
        ? { id: agent.id, name: agent.name, title: agent.title, description: agent.description, trainingMarkdown: agent.trainingMarkdown, tags: agent.tags, inherited: false }
        : { id: task.agentId, inherited: false }
    }
    const defaultAgentId = projectDefaultAgentId(project ?? {}) || await this.appSettings.get<string | null>(organizationId, DEFAULT_AGENT_KEY)
    const defaultAgent = defaultAgentId ? await this.agents.get(defaultAgentId) : undefined
    return defaultAgent && defaultAgent.organizationId === organizationId
      ? { id: defaultAgent.id, name: defaultAgent.name, title: defaultAgent.title, description: defaultAgent.description, trainingMarkdown: defaultAgent.trainingMarkdown, tags: defaultAgent.tags, inherited: true }
      : null
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

  private async notifyTerminalBridgeCompletion(context: PlannerBridgeContext, payload: unknown): Promise<void> {
    if (context.executionMode !== 'terminal') return
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const isExplicitTerminalCompletion = body.terminalCompletion === true
    const isAssistantFinish = Object.keys(body).length === 0
    if (!isExplicitTerminalCompletion && !isAssistantFinish) return
    const rawExitCode = body.exitCode
    const exitCode = typeof rawExitCode === 'number'
      ? rawExitCode
      : typeof rawExitCode === 'string' && rawExitCode.trim() ? Number(rawExitCode) : null
    if (exitCode !== null && !Number.isFinite(exitCode)) return
    const access = await this.ensureTaskAccess(context.actorToken, context.taskId)
    if (!access.ok || !access.data) return
    const kind = exitCode === null ? 'completed' : exitCode === 0 ? 'completed' : exitCode === 130 || exitCode === 143 ? 'stopped' : 'failed'
    showCodexNotification({
      kind,
      mode: context.mode === 'execute' ? 'run' : 'plan',
      taskTitle: access.data.task.title,
      projectId: access.data.task.projectId,
      taskId: context.taskId,
      conversationId: context.conversationId ?? context.runId ?? context.taskId,
      exitCode,
      model: context.model ?? null
    })
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
    await this.appendTaskActivityMessages(context.taskId, [
      {
        runId,
        conversationId,
        source: 'codex-plan',
        role: 'assistant',
        status: 'completed',
        body: plannerQuestionBody(payload),
        metadata: {
          codexBlock: 'planner-question',
          summary: payload.summary,
          questions: payload.questions,
          projectId: access.data.task.projectId,
          taskId: context.taskId,
          taskTitle: access.data.task.title,
          conversationId,
          gatewayId: context.gatewayId ?? null,
          model: context.model ?? null,
          language: context.language ?? null,
          reasoningEffort: context.reasoningEffort ?? null
        }
      },
      {
        runId,
        conversationId,
        source: 'codex-plan',
        role: 'system',
        status: 'completed',
        body: 'Planner paused for clarification.',
        metadata: { codexBlock: 'run-complete', plannerPaused: true, questionCount: payload.questions.length }
      }
    ], { emitTaskUpdatedAction: 'activity_complete' })
    showCodexNotification({
      kind: 'question',
      mode: 'plan',
      taskTitle: access.data.task.title,
      projectId: access.data.task.projectId,
      taskId: context.taskId,
      conversationId,
      questionCount: payload.questions.length,
      model: context.model ?? null,
      summary: payload.summary
    })
    return okResponse({ conversationId, questionCount: payload.questions.length })
  }

  private async appendTaskActivityMessages(
    taskId: string,
    messages: CodexActivityDraft[],
    options: { emitTaskUpdatedAction?: string } = {}
  ): Promise<TaskActivityMessage[]> {
    if (messages.length === 0) return []
    const task = await this.repo.get(taskId)
    if (!task) return []
    const now = Date.now()
    const nextMessages: TaskActivityMessage[] = messages.map((message) => {
      const compactMessage = compactActivityMessage(message)
      return {
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
    })
    const payload = asPayload(task.payload)
    const activityMessages = [...taskActivityMessagesFromPayload(payload), ...nextMessages].slice(-ACTIVITY_MESSAGE_LIMIT)
    await this.repo.update(task.id, { payload: { ...payload, activityMessages } })
    for (const nextMessage of nextMessages) {
      this.eventBus?.emit(IPC_CHANNELS.events.taskActivity, {
        projectId: task.projectId,
        taskId: task.id,
        message: nextMessage,
        updatedAt: now
      })
    }
    if (options.emitTaskUpdatedAction) this.emitTaskUpdated(task.projectId, task.id, options.emitTaskUpdatedAction)
    return nextMessages
  }

  private async appendTaskActivityMessage(
    taskId: string,
    message: CodexActivityDraft,
    options: { emitTaskUpdatedAction?: string } = {}
  ): Promise<TaskActivityMessage | null> {
    const [nextMessage] = await this.appendTaskActivityMessages(taskId, [message], options)
    return nextMessage ?? null
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

  async listPlannedCodex(payload: ListPlannedCodexTasksRequest, _meta?: Record<string, unknown>): Promise<ServiceResponse<PaginatedResponse<PlannedCodexTaskRow>>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const page = Math.max(1, Math.floor(Number(payload?.page ?? 1)))
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(payload?.pageSize ?? 12))))
    const { rows, total } = await this.repo.listPlannedCodex(actor.user.organizationId, page, pageSize)
    const plannedRows: PlannedCodexTaskRow[] = rows.map(({ task, project }) => {
      const taskCodex = taskCodexMetrics(task)
      const projectCodex = projectCodexMetrics(project.metrics)
      const gatewayId = stringOrEmpty(taskCodex.gatewayId) || stringOrEmpty(projectCodex.gatewayId)
      const runModel = stringOrEmpty(taskCodex.runModel)
        || stringOrEmpty(taskCodex.model)
        || stringOrEmpty(projectCodex.runModel)
        || stringOrEmpty(projectCodex.defaultModel)
      const language = stringOrEmpty(projectCodex.language)
        || stringOrEmpty(projectCodex.outputLanguage)
        || stringOrEmpty(projectCodex.inputLanguage)
      const runReasoningEffort = stringOrEmpty(projectCodex.runReasoningEffort)
      const missing: PlannedCodexTaskRow['missing'] = []
      if (!gatewayId) missing.push('gateway')
      if (!runModel) missing.push('runModel')
      return {
        taskId: task.id,
        projectId: project.id,
        taskTitle: task.title,
        taskStatus: task.status,
        projectName: project.name,
        projectDescription: project.description,
        codexPlanConversationId: taskCodexPlanConversationId(task),
        gatewayId: gatewayId || undefined,
        runModel: runModel || undefined,
        language: language || undefined,
        runReasoningEffort: runReasoningEffort || undefined,
        missing,
        runnable: missing.length === 0,
        updatedAt: task.updatedAt
      }
    })
    return okResponse({
      rows: plannedRows,
      total,
      page,
      pageSize
    })
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
    const inheritedAgentId = projectDefaultAgentId(project) || await this.appSettings.get<string | null>(access.data.actorOrgId, DEFAULT_AGENT_KEY)
    const defaultAgent = inheritedAgentId ? await this.agents.get(inheritedAgentId) : undefined
    const effectiveDefaultAgent = defaultAgent?.organizationId === access.data.actorOrgId ? defaultAgent : undefined
    const taskAgent = task.agentId ? await this.agents.get(task.agentId) : undefined
    const effectiveTaskAgent = taskAgent?.organizationId === access.data.actorOrgId ? taskAgent : undefined
    const taskForContext = !task.agentId && effectiveDefaultAgent ? { ...task, agentId: effectiveDefaultAgent.id } : task
    const language = await resolveCodexLanguageSetting(this.appSettings, access.data.actorOrgId, project)
    const projectPrompt = projectPromptSnapshot(project)
    const [tags, skills, customFields, statuses] = await Promise.all([
      this.tags.list(access.data.actorOrgId),
      this.skills.list(access.data.actorOrgId),
      this.customFields.list(access.data.actorOrgId),
      this.statuses.ensureProjectDefaults(project.id, access.data.actorOrgId)
    ])
    const inheritedSkillIds = new Set(projectDefaultSkillIds(project))
    const effectiveSkills = (task.skills?.length ?? 0) > 0
      ? task.skills ?? []
      : skills.filter((skill) => inheritedSkillIds.has(skill.id))
    const taskForContextWithSkills = (taskForContext.skills?.length ?? 0) > 0 || effectiveSkills.length === 0
      ? taskForContext
      : { ...taskForContext, skills: effectiveSkills }

    return okResponse({
      project: {
        id: project.id,
        name: project.name,
        description: project.description ?? '',
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? '',
        planGuide: projectPrompt.planGuide,
        rules: projectPrompt.rules,
        postRunPrompt: projectPrompt.postRunPrompt
      },
      task: taskForContextWithSkills,
      effectiveAgent: effectiveTaskAgent ? {
        id: effectiveTaskAgent.id,
        name: effectiveTaskAgent.name,
        inherited: false
      } : effectiveDefaultAgent ? {
        id: effectiveDefaultAgent.id,
        name: effectiveDefaultAgent.name,
        inherited: true
      } : null,
      codexLanguage: language,
      projectSettings: {
        language,
        defaultAgentId: projectDefaultAgentId(project) || null,
        defaultSkills: skills.filter((skill) => inheritedSkillIds.has(skill.id)).map((skill) => ({ id: skill.id, name: skill.name })),
        codex: project.metrics?.codex ?? {}
      },
      effectiveSkills: effectiveSkills.map((skill) => ({ id: skill.id, name: skill.name, slug: skill.slug })),
      currentTaskJson: taskPlannerJson(taskForContextWithSkills, customFields),
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
    const hasSnapshotPayload = Boolean(
      payload.taskMarkdown?.trim()
      || payload.agentMarkdown?.trim()
      || payload.skillsMarkdown?.trim()
      || (Array.isArray(payload.attachments) && payload.attachments.length > 0)
    )
    if (!zipBuffer?.length && !hasSnapshotPayload) return errorResponse(ErrorCodes.Validation, 'Task snapshot or ZIP bytes are required')

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
    const language = await resolveCodexLanguageSetting(this.appSettings, access.data.actorOrgId, project, payload)
    const reasoningEffort = projectCodexReasoningEffort(project, 'run', payload.reasoningEffort)
    const effectiveAgent = await this.effectiveAgentForTask(access.data.task, access.data.actorOrgId, project)

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
      if (zipBuffer?.length) {
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
      } else {
        await writeTaskSnapshotToExportWorkspace(exportWorkspacePath, payload)
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
      const prompt = initialCodexPrompt(exportWorkspacePath, runtimeWorkspacePath, project.id, access.data.task.id, instructionsRelativePath, {
        language,
        projectPrompt,
        effectiveAgent
      })
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
        language,
        mode: 'execute',
        executionMode,
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
        language,
        reasoningEffort,
        effectiveAgent,
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
        runtimeWorkspacePath,
        language,
      }), 'utf8')
      const codexCommand = [
        shellQuote(codexPath),
        '--cd', shellQuote(runtimeWorkspacePath),
        '--add-dir', shellQuote(exportWorkspacePath),
        '--model', shellQuote(model),
        '--sandbox', 'workspace-write',
        '--dangerously-bypass-approvals-and-sandbox',
        '-c', shellQuote(codexReasoningConfigArg(reasoningEffort)),
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
        '-c', codexReasoningConfigArg(reasoningEffort),
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
        '  local finish_payload="$RUN_DIR/finish-status.json"',
        '  printf \'{"terminalCompletion":true,"exitCode":%s}\\n\' "$status" > "$finish_payload"',
        '  (cd "$RUNTIME_WORKSPACE" && node "$HELPER_PATH" finish "$finish_payload" >/dev/null 2>&1) || true',
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
        language,
        effectiveAgent,
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
        await this.appendTaskActivityMessages(taskId, [
          {
            runId,
            source: 'codex-run',
            role: 'system',
            status: 'running',
            body: `Started Codex exec run with ${model}.`,
            metadata: { gatewayId: gateway.id, model, language, reasoningEffort, effectiveAgent, executionMode, runtimeWorkspacePath, exportWorkspacePath, runFolderPath }
          },
          {
            runId,
            source: 'codex-run',
            role: 'user',
            status: 'running',
            body: prompt,
            metadata: { command: execCommand }
          },
          {
            runId,
            source: 'codex-run',
            role: 'thinking',
            status: 'running',
            body: 'Codex is working through the task...',
            metadata: { executionMode, eventsPath: execEventsPath }
          }
        ])
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
        }, (messages) => this.appendTaskActivityMessages(taskId, messages))
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => streamer.writeStdout(chunk))
        child.stderr.on('data', (chunk: string) => streamer.writeStderr(chunk))
        let runNotificationSent = false
        const notifyRunCompletion = (kind: 'completed' | 'failed' | 'stopped', exitCode?: number | null) => {
          if (runNotificationSent) return
          runNotificationSent = true
          showCodexNotification({
            kind,
            mode: 'run',
            taskTitle: access.data.task.title,
            projectId: project.id,
            taskId,
            conversationId: runId,
            exitCode,
            model
          })
        }
        const runPostRunPrompt = async (
          primaryEventRaw: string,
          primaryFinalMessage: string,
          primaryChanges: ReturnType<typeof codexOutputChanges>
        ): Promise<number | null> => {
          const postRunId = plannerRunId(`${taskId}-post-run`)
          const postEventsPath = join(runFolderPath, 'post-run-events.jsonl')
          const postFinalMessagePath = join(runFolderPath, 'post-run-final-message.md')
          const postPrompt = postRunContinuationPrompt({
            language,
            projectPrompt,
            effectiveAgent,
            primaryFinalMessage,
            primaryChanges
          })
          const sessionId = extractCodexSessionId(primaryEventRaw)
          const postArgs = sessionId
            ? [
                'exec',
                'resume',
                '--json',
                '--output-last-message', postFinalMessagePath,
                '--model', model,
                '-c', codexReasoningConfigArg(reasoningEffort),
                '--skip-git-repo-check',
                '--dangerously-bypass-approvals-and-sandbox',
                sessionId,
                postPrompt
              ]
            : [
                'exec',
                '--json',
                '--output-last-message', postFinalMessagePath,
                '--cd', runtimeWorkspacePath,
                '--model', model,
                '-c', codexReasoningConfigArg(reasoningEffort),
                '--skip-git-repo-check',
                '--dangerously-bypass-approvals-and-sandbox',
                '--color', 'never',
                postPrompt
              ]
          const postCommand = [shellQuote(codexPath), ...postArgs.map(shellQuote)].join(' ')
          await this.appendTaskActivityMessages(taskId, [
            {
              runId: postRunId,
              conversationId: runId,
              source: 'codex-run',
              role: 'system',
              status: 'running',
              body: 'Starting Codex post-run prompt.',
              metadata: { codexBlock: 'post-run-start', parentRunId: runId, sessionId, command: postCommand, model, language, reasoningEffort }
            },
            {
              runId: postRunId,
              conversationId: runId,
              source: 'codex-run',
              role: 'user',
              status: 'completed',
              body: projectPrompt.postRunPrompt.trim(),
              metadata: { codexBlock: 'post-run-prompt', parentRunId: runId, command: postCommand }
            }
          ])
          const postStreamer = createCodexActivityStreamer({
            taskId,
            runId: postRunId,
            conversationId: runId,
            source: 'codex-run',
            eventsPath: postEventsPath
          }, (messages) => this.appendTaskActivityMessages(taskId, messages))
          return await new Promise<number | null>((resolvePostRun) => {
            let settled = false
            const settle = (value: number | null) => {
              if (settled) return
              settled = true
              resolvePostRun(value)
            }
            const postChild = spawn(codexPath, postArgs, {
              cwd: runtimeWorkspacePath,
              env: process.env,
              stdio: ['ignore', 'pipe', 'pipe']
            })
            postChild.stdout.setEncoding('utf8')
            postChild.stderr.setEncoding('utf8')
            postChild.stdout.on('data', (chunk: string) => postStreamer.writeStdout(chunk))
            postChild.stderr.on('data', (chunk: string) => postStreamer.writeStderr(chunk))
            postChild.on('error', (error) => {
              void this.appendTaskActivityMessage(taskId, {
                runId: postRunId,
                conversationId: runId,
                source: 'codex-run',
                role: 'error',
                status: 'failed',
                body: error.message,
                metadata: { codexBlock: 'run-complete', parentRunId: runId, command: postCommand }
              })
              settle(1)
            })
            postChild.on('close', (postCode, postSignal) => {
              if (settled) return
              void (async () => {
                await postStreamer.flush()
                const postFinalMessage = await readFile(postFinalMessagePath, 'utf8').catch(() => '')
                const postEventRaw = await readFile(postEventsPath, 'utf8').catch(() => '')
                const postEventSummary = summarizeCodexExecEvents(postEventRaw)
                const postUsage = postEventSummary.usage ?? postStreamer.latestUsage()
                const postChanges = codexOutputChanges(postEventRaw, postFinalMessage)
                const postTerminalMessages: CodexActivityDraft[] = []
                if (postChanges.hasChanges) {
                  postTerminalMessages.push({
                    runId: postRunId,
                    conversationId: runId,
                    source: 'codex-run',
                    role: 'tool',
                    status: 'completed',
                    body: postChanges.body,
                    metadata: { codexBlock: 'changes', code: postCode, signal: postSignal, eventsPath: postEventsPath, usage: postUsage, truncated: postChanges.truncated, ...postChanges.metadata }
                  })
                }
                postTerminalMessages.push({
                  runId: postRunId,
                  conversationId: runId,
                  source: 'codex-run',
                  role: 'system',
                  status: postCode === 0 ? 'completed' : 'failed',
                  body: postCode === 0 ? 'Codex post-run prompt completed.' : `Codex post-run prompt failed with code ${postCode ?? 'unknown'}.`,
                  metadata: { codexBlock: 'run-complete', parentRunId: runId, code: postCode, signal: postSignal, eventsPath: postEventsPath, finalMessagePath: postFinalMessagePath, usage: postUsage }
                })
                if (postCode === 0) {
                  if (!postStreamer.hasAssistantMessage()) {
                    postTerminalMessages.push({
                      runId: postRunId,
                      conversationId: runId,
                      source: 'codex-run',
                      role: 'assistant',
                      status: 'completed',
                      body: postFinalMessage.trim() || 'Codex post-run prompt completed.',
                      metadata: { code: postCode, signal: postSignal, eventsPath: postEventsPath, finalMessagePath: postFinalMessagePath, usage: postUsage, codexBlock: 'final-fallback' }
                    })
                  }
                } else {
                  postTerminalMessages.push({
                    runId: postRunId,
                    conversationId: runId,
                    source: 'codex-run',
                    role: 'error',
                    status: 'failed',
                    body: postFinalMessage.trim() || `Codex post-run prompt exited with code ${postCode ?? 'unknown'}.`,
                    metadata: { code: postCode, signal: postSignal, eventsPath: postEventsPath, finalMessagePath: postFinalMessagePath, usage: postUsage, rawTail: postEventSummary.rawTail }
                  })
                }
                await this.appendTaskActivityMessages(taskId, postTerminalMessages, { emitTaskUpdatedAction: 'activity_complete' })
                settle(postCode)
              })()
            })
          })
        }
        child.on('error', (error) => {
          void this.appendTaskActivityMessage(taskId, {
            runId,
            source: 'codex-run',
            role: 'error',
            status: 'failed',
            body: error.message,
            metadata: { command: execCommand }
          })
          notifyRunCompletion('failed', 1)
          void bridge?.close()
        })
        child.on('close', (code, signal) => {
          void (async () => {
            await streamer.flush()
            const finalMessage = await readFile(execFinalMessagePath, 'utf8').catch(() => '')
            const eventRaw = await readFile(execEventsPath, 'utf8').catch(() => '')
            const eventSummary = summarizeCodexExecEvents(eventRaw, { startedAt: executionStartedAt, endedAt: Date.now() })
            const usage = eventSummary.usage ?? streamer.latestUsage()
            const changes = codexOutputChanges(eventRaw, finalMessage)
            const terminalMessages: CodexActivityDraft[] = []
            if (changes.hasChanges) {
              terminalMessages.push({
                runId,
                source: 'codex-run',
                role: 'tool',
                status: 'completed',
                body: changes.body,
                metadata: { codexBlock: 'changes', code, signal, eventsPath: execEventsPath, usage, truncated: changes.truncated, ...changes.metadata }
              })
            }
            terminalMessages.push({
              runId,
              source: 'codex-run',
              role: 'system',
              status: code === 0 ? 'completed' : 'failed',
              body: code === 0 ? 'Codex run completed.' : `Codex run failed with code ${code ?? 'unknown'}.`,
              metadata: { codexBlock: 'run-complete', code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage }
            })
            if (code === 0) {
              if (!streamer.hasAssistantMessage()) {
                terminalMessages.push({
                  runId,
                  source: 'codex-run',
                  role: 'assistant',
                  status: 'completed',
                  body: finalMessage.trim() || 'Codex exec completed.',
                  metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage, codexBlock: 'final-fallback' }
                })
              }
              await this.appendTaskActivityMessages(taskId, terminalMessages, { emitTaskUpdatedAction: 'activity_complete' })
              const postRunCode = shouldStartPostRunPrompt(code, executionMode, projectPrompt.postRunPrompt)
                ? await runPostRunPrompt(eventRaw, finalMessage, changes)
                : 0
              if (postRunCode === 0) {
                await this.markTaskReadyForReview({ actorToken: payload.actorToken, projectId: project.id, taskId }).catch(() => undefined)
              }
              notifyRunCompletion(postRunCode === 0 ? 'completed' : 'failed', postRunCode)
            } else {
              terminalMessages.push({
                runId,
                source: 'codex-run',
                role: 'error',
                status: 'failed',
                body: finalMessage.trim() || `Codex exec exited with code ${code ?? 'unknown'}.`,
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage, rawTail: eventSummary.rawTail }
              })
              await this.appendTaskActivityMessages(taskId, terminalMessages, { emitTaskUpdatedAction: 'activity_complete' })
              notifyRunCompletion('failed', code)
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
      await this.appendTaskActivityMessages(access.data.task.id, [
        {
          runId,
          source: 'codex-run',
          role: 'system',
          status: 'running',
          body: `Started Codex terminal run with ${model}.`,
          metadata: { gatewayId: gateway.id, model, executionMode, runtimeWorkspacePath, exportWorkspacePath, runFolderPath }
        },
        {
          runId,
          source: 'codex-run',
          role: 'user',
          status: 'running',
          body: prompt,
          metadata: { command: codexCommand }
        },
        {
          runId,
          source: 'codex-run',
          role: 'thinking',
          status: 'running',
          body: 'Codex terminal is running this task...',
          metadata: { executionMode, runtimeWorkspacePath, runFolderPath }
        }
      ])
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
          const routedData = contextResponse.ok
            ? routedProjectContextForPrompt(contextResponse.data, context.mode === 'plan' ? 'plan' : 'run') as Record<string, unknown>
            : undefined
          result = contextResponse.ok
            ? okResponse({
              ...(routedData ?? {}),
              codexLanguage: context.language ?? (routedData?.codexLanguage as string | undefined) ?? normalizeCodexLanguage(undefined),
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
            const access = await this.ensureTaskAccess(context.actorToken, context.taskId)
            if (access.ok && access.data) await this.advanceTaskFromFirstStatusAfterPlanning(context.taskId, access.data.actorOrgId)
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
            await this.notifyTerminalBridgeCompletion(context, { terminalCompletion: true, exitCode: 0 })
            setTimeout(() => {
              void rm(context.workspaceRunPath ?? '', { recursive: true, force: true })
            }, 2_000).unref?.()
          }
          closeBridgeAfterResponse = true
        } else if (request.method === 'POST' && path === '/finish') {
          const body = await readRequestBody(request)
          await this.notifyTerminalBridgeCompletion(context, body)
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
    const language = await resolveCodexLanguageSetting(this.appSettings, access.data.actorOrgId, project, payload)
    const reasoningEffort = projectCodexReasoningEffort(project, 'plan', payload.reasoningEffort)
    const effectiveAgent = await this.effectiveAgentForTask(access.data.task, access.data.actorOrgId, project)

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
      const clarificationMode = clarificationMessage ? 'direct' : normalizePlannerClarificationMode(payload.clarificationMode)
      const model = payload.model.trim()
      const { codexPath, executionMode } = codexCliConfig(gateway.template)
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
        language,
        reasoningEffort,
        mode: 'plan',
        executionMode,
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
        language,
        reasoningEffort,
        clarificationMode,
        runtimeWorkspacePath,
        workspaceRunPath,
        projectPrompt,
        effectiveAgent,
        bridgeUrl: bridge.url,
        bridgeToken,
        createdAt: new Date().toISOString()
      }, null, 2), 'utf8')
      await writeFile(join(runtimeWorkspacePath, instructionsRelativePath), omcCliInstructions({
        mode: 'plan',
        projectId: project.id,
        taskId: access.data.task.id,
        runId,
        language,
        clarificationMode,
        helperRelativePath,
        contextRelativePath,
        plannedTaskRelativePath,
        runtimeWorkspacePath
      }), 'utf8')
      const taskId = access.data.task.id
      const transcript = taskActivityMessagesFromPayload(access.data.task.payload)
        .filter((item) => (item.conversationId || item.runId) === conversationId)
      const prompt = [
        `Read ${instructionsRelativePath} first.`,
        initialPlannerPrompt(project.id, access.data.task.id, helperRelativePath, contextRelativePath, plannedTaskRelativePath, {
          language,
          projectPrompt,
          effectiveAgent,
          clarificationMode
        }),
        plannerClarificationPrompt({ conversationId, clarificationMessage, transcript, language })
      ].join(' ')
      const codexCommand = [
        shellQuote(codexPath),
        '--cd', shellQuote(runtimeWorkspacePath),
        '--model', shellQuote(model),
        '--sandbox', 'workspace-write',
        '--dangerously-bypass-approvals-and-sandbox',
        '-c', shellQuote(codexReasoningConfigArg(reasoningEffort)),
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
        '-c', codexReasoningConfigArg(reasoningEffort),
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
        '  local finish_payload="$RUN_DIR/finish-status.json"',
        '  printf \'{"terminalCompletion":true,"exitCode":%s}\\n\' "$status" > "$finish_payload"',
        '  (cd "$RUNTIME_WORKSPACE" && node "$HELPER_PATH" finish "$finish_payload" >/dev/null 2>&1) || true',
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
        language,
        clarificationMode,
        effectiveAgent,
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
        await this.appendTaskActivityMessages(taskId, [
          {
            runId,
            conversationId,
            source: 'codex-plan',
            role: 'system',
            status: 'running',
            body: `Started Codex exec planner with ${model}.`,
            metadata: { gatewayId: gateway.id, model, language, reasoningEffort, clarificationMode, effectiveAgent, executionMode, runtimeWorkspacePath, runFolderPath }
          },
          {
            runId,
            conversationId,
            source: 'codex-plan',
            role: 'user',
            status: 'running',
            body: clarificationMessage || prompt,
            metadata: { command: execCommand, language, clarification: Boolean(clarificationMessage), clarificationMode }
          },
          {
            runId,
            conversationId,
            source: 'codex-plan',
            role: 'thinking',
            status: 'running',
            body: 'Codex is planning the task...',
            metadata: { executionMode, eventsPath: execEventsPath }
          }
        ])
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
        }, (messages) => this.appendTaskActivityMessages(taskId, messages))
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => streamer.writeStdout(chunk))
        child.stderr.on('data', (chunk: string) => streamer.writeStderr(chunk))
        let planNotificationSent = false
        const notifyPlanCompletion = (kind: 'completed' | 'failed', exitCode?: number | null) => {
          if (planNotificationSent) return
          planNotificationSent = true
          showCodexNotification({
            kind,
            mode: 'plan',
            taskTitle: access.data.task.title,
            projectId: project.id,
            taskId,
            conversationId,
            exitCode,
            model
          })
        }
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
          notifyPlanCompletion('failed', 1)
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
            const changes = codexOutputChanges(eventRaw, finalMessage)
            const terminalMessages: CodexActivityDraft[] = []
            if (changes.hasChanges) {
              terminalMessages.push({
                runId,
                conversationId,
                source: 'codex-plan',
                role: 'tool',
                status: 'completed',
                body: changes.body,
                metadata: { codexBlock: 'changes', code, signal, eventsPath: execEventsPath, usage, truncated: changes.truncated, ...changes.metadata }
              })
            }
            terminalMessages.push({
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
                terminalMessages.push({
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
              terminalMessages.push({
                runId,
                conversationId,
                source: 'codex-plan',
                role: 'error',
                status: 'failed',
                body: finalMessage.trim() || `Codex planner exited with code ${code ?? 'unknown'}.`,
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath, usage, rawTail: eventSummary.rawTail }
              })
            }
            await this.appendTaskActivityMessages(taskId, terminalMessages, { emitTaskUpdatedAction: 'activity_complete' })
            notifyPlanCompletion(code === 0 ? 'completed' : 'failed', code)
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
      await this.appendTaskActivityMessages(taskId, [
        {
          runId,
          conversationId,
          source: 'codex-plan',
          role: 'system',
          status: 'running',
          body: `Started Codex terminal planner with ${model}.`,
          metadata: { gatewayId: gateway.id, model, clarificationMode, executionMode, runtimeWorkspacePath, runFolderPath }
        },
        {
          runId,
          conversationId,
          source: 'codex-plan',
          role: 'user',
          status: 'running',
          body: clarificationMessage || prompt,
          metadata: { command: codexCommand, clarification: Boolean(clarificationMessage), clarificationMode }
        },
        {
          runId,
          conversationId,
          source: 'codex-plan',
          role: 'thinking',
          status: 'running',
          body: 'Codex terminal is planning this task...',
          metadata: { executionMode, runtimeWorkspacePath, runFolderPath }
        }
      ])
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
    const language = await resolveCodexLanguageSetting(this.appSettings, access.data.actorOrgId, project, payload)

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
    const reasoningEffort = projectCodexReasoningEffort(project, mode === 'plan' ? 'plan' : 'run', payload.reasoningEffort)
    const prompt = codexChatPrompt({
      task: access.data.task,
      message: normalizedMessage,
      transcript,
      context,
      followUpContext: typeof payload.followUpContext === 'string' ? payload.followUpContext : undefined,
      mode,
      attachments,
      language
    })
    const activitySource: TaskActivityMessage['source'] = mode === 'plan' ? 'codex-plan' : 'codex-chat'
    const execArgs = [
      'exec',
      '--json',
      '--output-last-message', finalMessagePath,
      '--cd', runtimeWorkspacePath,
      '--model', model,
      '-c', codexReasoningConfigArg(reasoningEffort),
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--color', 'never',
      prompt
    ]
    const execCommand = [shellQuote(codexPath), ...execArgs.map(shellQuote)].join(' ')

    await mkdir(runtimeWorkspacePath, { recursive: true })
    await this.appendTaskActivityMessages(taskId, [
      {
        runId,
        conversationId,
        source: activitySource,
        role: 'user',
        status: 'completed',
        body: mode === 'plan' ? `/plan ${normalizedMessage}` : normalizedMessage,
        metadata: { gatewayId: gateway.id, model, language, reasoningEffort, mode, attachments }
      },
      {
        runId,
        conversationId,
        source: activitySource,
        role: 'thinking',
        status: 'running',
        body: mode === 'plan'
          ? executionMode === 'exec' ? 'Codex is revising the plan...' : 'Opening Codex terminal to revise the plan...'
          : executionMode === 'exec' ? 'Codex is thinking...' : 'Opening Codex terminal...',
        metadata: { executionMode, runtimeWorkspacePath }
      }
    ])

    if (executionMode === 'terminal') {
      if (process.platform !== 'darwin') return errorResponse(ErrorCodes.Validation, 'Codex terminal chat currently requires macOS Terminal.app.')
      const wrapperPath = join(runFolderPath, 'run-codex-chat.sh')
      const codexCommand = [
        shellQuote(codexPath),
        '--cd', shellQuote(runtimeWorkspacePath),
        '--model', shellQuote(model),
        '--sandbox', 'workspace-write',
        '--dangerously-bypass-approvals-and-sandbox',
        '-c', shellQuote(codexReasoningConfigArg(reasoningEffort)),
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
    }, (messages) => this.appendTaskActivityMessages(taskId, messages))
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => streamer.writeStdout(chunk))
    child.stderr.on('data', (chunk: string) => streamer.writeStderr(chunk))
    let chatNotificationSent = false
    const notifyChatCompletion = (kind: 'completed' | 'failed' | 'stopped', exitCode?: number | null) => {
      if (chatNotificationSent) return
      chatNotificationSent = true
      showCodexNotification({
        kind,
        mode,
        taskTitle,
        projectId: project.id,
        taskId,
        conversationId,
        exitCode,
        model
      })
    }
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
      notifyChatCompletion('failed', 1)
    })
    child.on('close', (code, signal) => {
      void (async () => {
        this.activeCodexChatRuns.delete(runId)
        await streamer.flush()
        if (activeRun.stopRequested) {
          await this.appendTaskActivityMessages(taskId, [
            {
              runId,
              conversationId,
              source: activitySource,
              role: 'system',
              status: 'completed',
              body: 'Codex chat stopped.',
              metadata: { code, signal, eventsPath, stopped: true, codexBlock: 'run-complete' }
            },
            {
              runId,
              conversationId,
              source: activitySource,
              role: 'assistant',
              status: 'completed',
              body: 'Stopped by user.',
              metadata: { code, signal, eventsPath, stopped: true }
            }
          ], { emitTaskUpdatedAction: 'activity_complete' })
          notifyChatCompletion('stopped', code)
          return
        }
        const eventRaw = await readFile(eventsPath, 'utf8').catch(() => '')
        const eventSummary = summarizeCodexExecEvents(eventRaw, { startedAt: executionStartedAt, endedAt: Date.now() })
        const finalMessage = await readFile(finalMessagePath, 'utf8').catch(() => '')
        const usage = eventSummary.usage ?? streamer.latestUsage()
        const changes = codexOutputChanges(eventRaw, finalMessage)
        const terminalMessages: CodexActivityDraft[] = []
        if (changes.hasChanges) {
          terminalMessages.push({
            runId,
            conversationId,
            source: activitySource,
            role: 'tool',
            status: 'completed',
            body: changes.body,
            metadata: { codexBlock: 'changes', code, signal, eventsPath, usage, truncated: changes.truncated, ...changes.metadata }
          })
        }
        terminalMessages.push({
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
            terminalMessages.push({
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
          terminalMessages.push({
            runId,
            conversationId,
            source: activitySource,
            role: 'error',
            status: 'failed',
            body: finalMessage.trim() || `Codex chat exited with code ${code ?? 'unknown'}.`,
            metadata: { code, signal, eventsPath, finalMessagePath, usage, rawTail: eventSummary.rawTail }
          })
        }
        await this.appendTaskActivityMessages(taskId, terminalMessages, { emitTaskUpdatedAction: 'activity_complete' })
        notifyChatCompletion(code === 0 ? 'completed' : 'failed', code)
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
