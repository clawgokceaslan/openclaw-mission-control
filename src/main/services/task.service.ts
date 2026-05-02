import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
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
import { WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { TaskJsonImportNormalizer } from './task-json-import.js'
import { safeConsole } from '../utils/safe-output.js'

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
  pid?: number
  eventsPath?: string
  finalMessagePath?: string
}

type CodexTerminalRun = {
  finishFilePath: string
  terminalTitle: string
}

type ProjectPromptSnapshot = {
  generalContext: string
  generalPrompt: string
  defaultOutput: string
}

type CodexExecutionMode = 'terminal' | 'exec'

type TaskActivityMessage = {
  id: string
  runId: string
  source: 'codex-plan' | 'codex-run'
  role: 'user' | 'assistant' | 'tool' | 'system' | 'error'
  status?: 'running' | 'completed' | 'failed'
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

function projectPromptSnapshot(project: { generalContext?: string | null; generalPrompt?: string | null; defaultOutput?: string | null }): ProjectPromptSnapshot {
  return {
    generalContext: project.generalContext ?? '',
    generalPrompt: project.generalPrompt ?? '',
    defaultOutput: project.defaultOutput ?? ''
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
    'Execute the task described in Task.md.',
    'Respect subtask status instructions: bypass subtasks marked completed/done/closed.',
    'Do not use MCP in this flow.',
    'Use the local .omc CLI ready-for-review operation only after implementation and checks are complete.',
    'When the implementation is complete, summarize the changed files and remaining checks in Codex.',
    'Do not ask for the ZIP; all exported files are already available in the export directory.'
  ].join(' ')
}

function initialPlannerPrompt(projectId: string, taskId: string, helperPath: string, contextPath: string, plannedTaskPath: string): string {
  return [
    'You are planning an Open Mission Control task inside Codex TUI.',
    'Do not use MCP for this flow. Use the local helper CLI in this workspace.',
    `First run: node ${helperPath} context > ${contextPath}`,
    `The project id is ${projectId} and the source task id is ${taskId}.`,
    'Plan the current task from its task-detail data: title, description, custom fields, checklist, comments, tags, and subtasks.',
    'For every subtask, consider its title, description, custom fields, checklist, comments, tags, status, and due date.',
    `Use ${contextPath} currentTaskJson as the starting JSON shape and revise it into the planned task JSON.`,
    `Write the planned JSON to ${plannedTaskPath}.`,
    `After writing, run: node ${helperPath} validate ${plannedTaskPath}`,
    `After validation succeeds, update the scoped source task by running: node ${helperPath} update ${plannedTaskPath}`,
    'Do not create a new task in this planning flow.',
    `If you need to create a new task instead, ask the user first, then run: node ${helperPath} create ${plannedTaskPath}`,
    `After the update succeeds, run: node ${helperPath} finish`
  ].join(' ')
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

function omcCliInstructions(context: {
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
    `- Move task to review: \`node ${helper} ready-for-review\``,
    `- Finish without status change: \`node ${helper} finish\``,
    '',
    '## Rules',
    '',
    '- Run context before planning or when you need project/task metadata.',
    '- Run validate before create or update.',
    '- Planning runs should write planned-task.json, validate it, update the scoped task, then finish.',
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
    private readonly eventBus?: EventEmitter
  ) { }

  private async findProjectOrg(projectId: string): Promise<string | undefined> {
    const project = await this.projects.get(projectId)
    return project?.organizationId
  }

  private emitTaskUpdated(projectId: string, taskId: string, action: string): void {
    this.eventBus?.emit(IPC_CHANNELS.events.taskUpdated, { projectId, taskId, action, updatedAt: Date.now() })
  }

  private async appendTaskActivityMessage(
    taskId: string,
    message: Omit<TaskActivityMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
  ): Promise<TaskActivityMessage | null> {
    const task = await this.repo.get(taskId)
    if (!task) return null
    const now = Date.now()
    const nextMessage: TaskActivityMessage = {
      id: message.id ?? `codex-activity-${randomUUID()}`,
      runId: message.runId,
      source: message.source,
      role: message.role,
      status: message.status,
      body: message.body,
      metadata: message.metadata,
      createdAt: message.createdAt ?? now,
      updatedAt: now
    }
    const payload = asPayload(task.payload)
    const activityMessages = [...taskActivityMessagesFromPayload(payload), nextMessage]
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
        defaultOutput: project.defaultOutput ?? ''
      },
      task,
      currentTaskJson: taskPlannerJson(task, customFields),
      allowed: {
        tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
        skills: skills.map((skill) => ({ id: skill.id, name: skill.name, slug: skill.slug })),
        customFields: customFields.map((field) => ({ id: field.id, name: field.name, type: field.type, description: field.description ?? '' })),
        statuses: statuses.map((status) => ({ id: status.id, name: status.name, category: status.category }))
      },
      jsonFormat: {
        root: ['title', 'description', 'status', 'tags', 'checklist', 'comments', 'customFields', 'subtasks'],
        subtask: ['title', 'description', 'status', 'tags', 'checklist', 'comments', 'customFields', 'dueAt'],
        note: 'Use tag names or ids. customFields is an array of { name, value }. checklist is an array of { title, checked }. comments is an array of { body, authorName }. omc_update_task_from_json updates the scoped source task.'
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
        const child = spawn(codexPath, execArgs, {
          cwd: runtimeWorkspacePath,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          void appendFile(execEventsPath, chunk, 'utf8')
        })
        child.stderr.on('data', (chunk: string) => {
          void appendFile(execEventsPath, chunk, 'utf8')
        })
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
            const finalMessage = await readFile(execFinalMessagePath, 'utf8').catch(() => '')
            const eventTail = (await readFile(execEventsPath, 'utf8').catch(() => '')).trim().slice(-4000)
            if (eventTail) {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                source: 'codex-run',
                role: 'tool',
                status: code === 0 ? 'completed' : 'failed',
                body: eventTail,
                metadata: { code, signal, eventsPath: execEventsPath }
              })
            }
            if (code === 0) {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                source: 'codex-run',
                role: 'assistant',
                status: 'completed',
                body: finalMessage.trim() || 'Codex exec completed.',
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath }
              })
              await this.markTaskReadyForReview({ actorToken: payload.actorToken, projectId: project.id, taskId }).catch(() => undefined)
            } else {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                source: 'codex-run',
                role: 'error',
                status: 'failed',
                body: eventTail || `Codex exec exited with code ${code ?? 'unknown'}.`,
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath }
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
        } else if (request.method === 'POST' && path === '/ready-for-review') {
          result = await this.markTaskReadyForReview({ actorToken: context.actorToken, projectId: context.projectId, taskId: context.taskId })
          if (result.ok && context.workspaceRunPath) {
            setTimeout(() => {
              void rm(context.workspaceRunPath ?? '', { recursive: true, force: true })
            }, 2_000).unref?.()
          }
          closeBridgeAfterResponse = true
        } else if (request.method === 'POST' && path === '/finish') {
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
        mode: 'plan',
        projectId: project.id,
        taskId: access.data.task.id,
        gatewayId: gateway.id,
        model: payload.model,
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
      const model = payload.model.trim()
      const taskId = access.data.task.id
      const prompt = [
        `Read ${instructionsRelativePath} first.`,
        initialPlannerPrompt(project.id, access.data.task.id, helperRelativePath, contextRelativePath, plannedTaskRelativePath)
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
          source: 'codex-plan',
          role: 'system',
          status: 'running',
          body: `Started Codex exec planner with ${model}.`,
          metadata: { gatewayId: gateway.id, model, executionMode, runtimeWorkspacePath, runFolderPath }
        })
        await this.appendTaskActivityMessage(taskId, {
          runId,
          source: 'codex-plan',
          role: 'user',
          status: 'running',
          body: prompt,
          metadata: { command: execCommand }
        })
        const child = spawn(codexPath, execArgs, {
          cwd: runtimeWorkspacePath,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          void appendFile(execEventsPath, chunk, 'utf8')
        })
        child.stderr.on('data', (chunk: string) => {
          void appendFile(execEventsPath, chunk, 'utf8')
        })
        child.on('error', (error) => {
          void this.appendTaskActivityMessage(taskId, {
            runId,
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
            const finalMessage = await readFile(execFinalMessagePath, 'utf8').catch(() => '')
            const eventTail = (await readFile(execEventsPath, 'utf8').catch(() => '')).trim().slice(-4000)
            if (eventTail) {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                source: 'codex-plan',
                role: 'tool',
                status: code === 0 ? 'completed' : 'failed',
                body: eventTail,
                metadata: { code, signal, eventsPath: execEventsPath }
              })
            }
            if (code === 0) {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                source: 'codex-plan',
                role: 'assistant',
                status: 'completed',
                body: finalMessage.trim() || 'Codex planner completed.',
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath }
              })
            } else {
              await this.appendTaskActivityMessage(taskId, {
                runId,
                source: 'codex-plan',
                role: 'error',
                status: 'failed',
                body: eventTail || `Codex planner exited with code ${code ?? 'unknown'}.`,
                metadata: { code, signal, eventsPath: execEventsPath, finalMessagePath: execFinalMessagePath }
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
          pid: child.pid,
          eventsPath: execEventsPath,
          finalMessagePath: execFinalMessagePath
        })
      }

      if (process.platform !== 'darwin') return errorResponse(ErrorCodes.Validation, 'Codex task planning currently requires macOS Terminal.app.')
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
        runId
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
