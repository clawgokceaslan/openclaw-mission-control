import type {
  CodexCliGatewayConfig,
  Project,
  ProjectCodexSettings,
  TaskEntity,
  Workspace
} from '@shared/types/entities'
import type { TaskActivityMessage } from './types'
import type { ProjectStatusColumn } from './status'
import { normalizeCodexLanguage, normalizeCodexReasoningEffort } from '@shared/utils/codex-language'
import {
  codexChatLifecycleStatusKey,
  codexChatPhaseActionLabel,
  codexLifecycleStatusMeta,
  inferCodexChatPhase,
  type CodexChatPhase,
  type CodexLifecycleStatusKey,
  type CodexLifecycleTone
} from '@shared/utils/codex-chat-phase'
import { normalizeCodexPromptShape } from '@shared/utils/codex-prompt-shape'

export function projectCodexSettings(project: Project | null): ProjectCodexSettings {
  const value = project?.metrics?.codex
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { promptShape: 'markdown' }
  const record = value as Record<string, unknown>
  const legacyLanguage = typeof record.outputLanguage === 'string'
    ? record.outputLanguage
    : typeof record.inputLanguage === 'string'
      ? record.inputLanguage
      : undefined
  return {
    gatewayId: typeof record.gatewayId === 'string' ? record.gatewayId : null,
    runtimeWorkspaceId: typeof record.runtimeWorkspaceId === 'string' ? record.runtimeWorkspaceId : null,
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : null,
    planModel: typeof record.planModel === 'string' ? record.planModel : null,
    runModel: typeof record.runModel === 'string' ? record.runModel : null,
    language: typeof record.language === 'string' ? normalizeCodexLanguage(record.language) : legacyLanguage ? normalizeCodexLanguage(legacyLanguage) : null,
    promptShape: normalizeCodexPromptShape(record.promptShape),
    planReasoningEffort: typeof record.planReasoningEffort === 'string' ? normalizeCodexReasoningEffort(record.planReasoningEffort) : null,
    runReasoningEffort: typeof record.runReasoningEffort === 'string' ? normalizeCodexReasoningEffort(record.runReasoningEffort) : null,
    inputLanguage: typeof record.inputLanguage === 'string' ? record.inputLanguage : null,
    outputLanguage: typeof record.outputLanguage === 'string' ? record.outputLanguage : null
  }
}

export function projectDefaultAgentId(project: Project | null): string {
  const value = project?.metrics?.defaultAgentId
  return typeof value === 'string' ? value : ''
}

export function projectDefaultSkillIds(project: Project | null): string[] {
  const value = project?.metrics?.defaultSkillIds
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

export function codexConfigOf(gateway?: { template?: unknown; endpoint?: string | null } | null): CodexCliGatewayConfig {
  const template = gateway?.template && typeof gateway.template === 'object' && !Array.isArray(gateway.template)
    ? gateway.template as Partial<CodexCliGatewayConfig>
    : {}
  return {
    provider: 'codex_cli',
    codexPath: typeof template.codexPath === 'string' ? template.codexPath : gateway?.endpoint ?? 'codex',
    executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal',
    models: Array.isArray(template.models) ? template.models : [],
    lastModelRefreshAt: typeof template.lastModelRefreshAt === 'number' ? template.lastModelRefreshAt : undefined,
    lastModelRefreshError: typeof template.lastModelRefreshError === 'string' ? template.lastModelRefreshError : undefined
  }
}

export function taskCodexModel(task: TaskEntity | null | undefined): string {
  return readTaskCodexOverride(task).legacyModel
}

export function readTaskCodexOverride(task: TaskEntity | null | undefined): { gatewayId: string; legacyModel: string; planModel: string; runModel: string; planReasoningEffort: string; runReasoningEffort: string } {
  const codex = task?.payload?.codex
  if (!codex || typeof codex !== 'object' || Array.isArray(codex)) {
    return { gatewayId: '', legacyModel: '', planModel: '', runModel: '', planReasoningEffort: '', runReasoningEffort: '' }
  }
  const record = codex as Record<string, unknown>
  return {
    gatewayId: typeof record.gatewayId === 'string' ? record.gatewayId : '',
    legacyModel: typeof record.model === 'string' ? record.model : '',
    planModel: typeof record.planModel === 'string' ? record.planModel : '',
    runModel: typeof record.runModel === 'string' ? record.runModel : '',
    planReasoningEffort: typeof record.planReasoningEffort === 'string' ? normalizeCodexReasoningEffort(record.planReasoningEffort) : '',
    runReasoningEffort: typeof record.runReasoningEffort === 'string' ? normalizeCodexReasoningEffort(record.runReasoningEffort) : ''
  }
}

export function taskCodexPlanModel(task: TaskEntity | null | undefined): string {
  return readTaskCodexOverride(task).planModel
}

export function taskCodexRunModel(task: TaskEntity | null | undefined): string {
  const { runModel, legacyModel } = readTaskCodexOverride(task)
  return runModel || legacyModel
}

export function taskCodexExplicitPlanModel(task: TaskEntity | null | undefined): string {
  return readTaskCodexOverride(task).planModel
}

export function taskCodexExplicitRunModel(task: TaskEntity | null | undefined): string {
  return readTaskCodexOverride(task).runModel
}

export function taskCodexGatewayId(task: TaskEntity | null | undefined): string {
  return readTaskCodexOverride(task).gatewayId
}

export function codexPayloadOverride(gatewayId: string, model: string, planModel = '', runModel = '', planReasoningEffort = '', runReasoningEffort = ''): Record<string, string> | undefined {
  const next: Record<string, string> = {}
  if (gatewayId) next.gatewayId = gatewayId
  if (model) next.model = model
  if (planModel) next.planModel = planModel
  if (runModel) next.runModel = runModel
  if (planReasoningEffort) next.planReasoningEffort = normalizeCodexReasoningEffort(planReasoningEffort)
  if (runReasoningEffort) next.runReasoningEffort = normalizeCodexReasoningEffort(runReasoningEffort)
  return Object.keys(next).length > 0 ? next : undefined
}

export function slugPart(value: string | undefined, fallback: string): string {
  const base = (value || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return base || fallback
}

export async function shortSha1(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return value.slice(0, 8)
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 8)
}

export async function projectWorkspaceFolder(workspace: Workspace | null | undefined, project: Project | null): Promise<string> {
  if (!workspace || !project) return ''
  return `${workspace.rootPath.replace(/[\\/]$/, '')}/Projects/${slugPart(project.name, 'project')}__${await shortSha1(project.id)}`
}

export function withTaskMeta(task: TaskEntity): TaskEntity {
  return {
    ...task,
    tags: Array.isArray(task.tags) ? task.tags : [],
    comments: Array.isArray(task.comments) ? task.comments : [],
    skills: Array.isArray(task.skills) ? task.skills : [],
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    checklistItems: Array.isArray(task.checklistItems) ? task.checklistItems : [],
    customFieldValues: task.customFieldValues && typeof task.customFieldValues === 'object' ? task.customFieldValues : {}
  }
}

export type TaskCodexPlanBadge = {
  state: 'planned' | 'needs-clarification'
  label: 'Planned' | 'Needs Input'
  conversationId?: string
}

export type TaskCodexActionChip = {
  phase: CodexChatPhase
  label: string
  conversationId: string
  status: TaskActivityMessage['status'] | 'event'
  at: number
}

export type TaskCodexConversationSource = CodexChatPhase | 'codex-plan' | 'codex-run'

export type TaskCodexConversationMatch = {
  source: TaskActivityMessage['source']
  phase: CodexChatPhase
  conversationId: string
  at: number
}

export type TaskCodexSurfaceStatus = {
  key: string
  statusKey: CodexLifecycleStatusKey
  label: string
  tone: CodexLifecycleTone
  conversationId?: string
  iconOnly?: boolean
  active?: boolean
}

export function taskActivityMessages(task: TaskEntity): TaskActivityMessage[] {
  const messages = task.payload?.activityMessages
  if (!Array.isArray(messages)) return []
  return messages.filter((item): item is TaskActivityMessage => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const record = item as Partial<TaskActivityMessage>
    return typeof record.runId === 'string'
      && typeof record.source === 'string'
      && typeof record.role === 'string'
      && typeof record.body === 'string'
      && typeof record.createdAt === 'number'
  }).map((message) => ({
    ...message,
    phase: inferCodexChatPhase(message)
  }))
}

export function taskCodexPlanBadge(task: TaskEntity): TaskCodexPlanBadge | null {
  const value = task.payload?.codexPlanState
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.state === 'planned') {
    return {
      state: 'planned',
      label: 'Planned',
      conversationId: typeof record.conversationId === 'string' ? record.conversationId : undefined
    }
  }
  if (record.state === 'needs-clarification') {
    return {
      state: 'needs-clarification',
      label: 'Needs Input',
      conversationId: typeof record.conversationId === 'string' ? record.conversationId : undefined
    }
  }
  return null
}

function activityMessageTime(message: TaskActivityMessage): number {
  return message.updatedAt ?? message.createdAt
}

function latestActivityMessageByPhase(task: TaskEntity, phase: CodexChatPhase): TaskActivityMessage | null {
  let latest: TaskActivityMessage | null = null
  for (const message of taskActivityMessages(task)) {
    if (inferCodexChatPhase(message) !== phase) continue
    if (!latest || activityMessageTime(latest) <= activityMessageTime(message)) latest = message
  }
  return latest
}

function isFreshActiveMessage(message: TaskActivityMessage, now: number): boolean {
  if (message.status !== 'running' && message.status !== 'queued') return false
  return now - (message.updatedAt ?? message.createdAt) <= 15 * 60 * 1000
}

function isTerminalActivityMessage(message: TaskActivityMessage): boolean {
  const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown>
    : {}
  const codexBlock = typeof metadata.codexBlock === 'string' ? metadata.codexBlock : undefined
  const runStatus = typeof metadata.runStatus === 'string' ? metadata.runStatus : undefined
  if (codexBlock && ['command', 'log', 'changes'].includes(codexBlock)) return false
  return codexBlock === 'run-complete'
    || metadata.stopped === true
    || message.role === 'error'
    || message.status === 'failed'
    || runStatus === 'completed'
    || runStatus === 'failed'
}

function conversationIdOfActivity(message: TaskActivityMessage): string {
  return message.conversationId || message.runId
}

function surfaceStatus(
  key: string,
  statusKey: CodexLifecycleStatusKey,
  conversationId?: string,
  active?: boolean,
  iconOnly?: boolean
): TaskCodexSurfaceStatus {
  const meta = codexLifecycleStatusMeta(statusKey)
  return {
    key,
    statusKey,
    label: meta.label,
    tone: meta.tone,
    conversationId,
    active: active && meta.active ? true : undefined,
    iconOnly
  }
}

function phaseSurfaceStatus(phase: CodexChatPhase, message: TaskActivityMessage, active: boolean): TaskCodexSurfaceStatus {
  const statusKey = codexChatLifecycleStatusKey(phase, message.status ?? 'event', active)
  return surfaceStatus(`${phase}:${statusKey}`, statusKey, conversationIdOfActivity(message), active)
}

function latestFreshActiveMessageByPhase(task: TaskEntity, phase: CodexChatPhase, now: number): TaskActivityMessage | null {
  let latest: TaskActivityMessage | null = null
  for (const message of taskActivityMessages(task)) {
    if (inferCodexChatPhase(message) !== phase) continue
    if (!isFreshActiveMessage(message, now)) continue
    if (!latest || activityMessageTime(latest) <= activityMessageTime(message)) latest = message
  }
  return latest
}

function latestTerminalMessageByPhase(task: TaskEntity, phase: CodexChatPhase): TaskActivityMessage | null {
  let latest: TaskActivityMessage | null = null
  for (const message of taskActivityMessages(task)) {
    if (inferCodexChatPhase(message) !== phase) continue
    if (!isTerminalActivityMessage(message)) continue
    if (!latest || activityMessageTime(latest) <= activityMessageTime(message)) latest = message
  }
  return latest
}

function activeMessageAfterTerminal(task: TaskEntity, phase: CodexChatPhase, now: number, terminal: TaskActivityMessage | null): TaskActivityMessage | null {
  const active = latestFreshActiveMessageByPhase(task, phase, now)
  if (!active) return null
  if (terminal && activityMessageTime(terminal) >= activityMessageTime(active)) return null
  return active
}

export function taskCodexSurfaceStatuses(task: TaskEntity, now = Date.now()): TaskCodexSurfaceStatus[] {
  const statuses: TaskCodexSurfaceStatus[] = []
  const planBadge = taskCodexPlanBadge(task)
  const terminalPlan = latestTerminalMessageByPhase(task, 'PLAN')
  const activePlan = activeMessageAfterTerminal(task, 'PLAN', now, terminalPlan)
  const latestPlan = latestActivityMessageByPhase(task, 'PLAN')

  if (activePlan) {
    statuses.push(phaseSurfaceStatus('PLAN', activePlan, true))
  } else if (terminalPlan?.status === 'failed' || terminalPlan?.role === 'error' || terminalPlan?.metadata?.runStatus === 'failed') {
    statuses.push(phaseSurfaceStatus('PLAN', terminalPlan, false))
  } else if (planBadge?.state === 'planned') {
    statuses.push(surfaceStatus('PLAN:planned', 'planned', planBadge.conversationId, false, true))
  } else if (planBadge?.state === 'needs-clarification') {
    statuses.push(surfaceStatus('PLAN:needs-input', 'needs-input', planBadge.conversationId))
  } else if (terminalPlan) {
    statuses.push(phaseSurfaceStatus('PLAN', terminalPlan, false))
  } else if (latestPlan) {
    statuses.push(phaseSurfaceStatus('PLAN', latestPlan, false))
  } else {
    statuses.push(surfaceStatus('PLAN:not-planned', 'not-planned'))
  }

  const latestRun = latestActivityMessageByPhase(task, 'RUN')
  if (latestRun) {
    const terminalRun = latestTerminalMessageByPhase(task, 'RUN')
    const activeRun = activeMessageAfterTerminal(task, 'RUN', now, terminalRun)
    statuses.push(phaseSurfaceStatus('RUN', activeRun ?? terminalRun ?? latestRun, Boolean(activeRun)))
  }

  const latestPostRunning = latestActivityMessageByPhase(task, 'POST-RUNNING')
  if (latestPostRunning) {
    const terminalPostRunning = latestTerminalMessageByPhase(task, 'POST-RUNNING')
    const activePostRunning = activeMessageAfterTerminal(task, 'POST-RUNNING', now, terminalPostRunning)
    statuses.push(phaseSurfaceStatus('POST-RUNNING', activePostRunning ?? terminalPostRunning ?? latestPostRunning, Boolean(activePostRunning)))
  }

  const latestFollowUp = latestActivityMessageByPhase(task, 'FOLLOW UP')
  if (latestFollowUp) {
    const terminalFollowUp = latestTerminalMessageByPhase(task, 'FOLLOW UP')
    const activeFollowUp = activeMessageAfterTerminal(task, 'FOLLOW UP', now, terminalFollowUp)
    statuses.push(phaseSurfaceStatus('FOLLOW UP', activeFollowUp ?? terminalFollowUp ?? latestFollowUp, Boolean(activeFollowUp)))
  }

  return statuses
}

export function taskCodexActiveTone(task: TaskEntity, now = Date.now()): TaskCodexSurfaceStatus['tone'] | null {
  const active = taskCodexSurfaceStatuses(task, now).find((status) => status.active)
  return active?.tone ?? null
}

export function taskCodexLatestSurfaceStatus(task: TaskEntity, now = Date.now()): TaskCodexSurfaceStatus | null {
  const messages = taskActivityMessages(task)
  if (messages.length === 0) return null

  const latestMessageTimeByConversation = new Map<string, number>()
  for (const message of messages) {
    const conversationId = conversationIdOfActivity(message)
    const at = activityMessageTime(message)
    const current = latestMessageTimeByConversation.get(conversationId)
    if (current === undefined || current <= at) latestMessageTimeByConversation.set(conversationId, at)
  }

  let latest: { status: TaskCodexSurfaceStatus; at: number; index: number } | null = null
  taskCodexSurfaceStatuses(task, now).forEach((status, index) => {
    if (status.statusKey === 'not-planned') return
    const at = status.conversationId ? latestMessageTimeByConversation.get(status.conversationId) : undefined
    if (at === undefined) return
    if (!latest || latest.at < at || (latest.at === at && latest.index < index)) {
      latest = { status, at, index }
    }
  })

  return latest?.status ?? null
}

function normalizeConversationSourcePhase(source: TaskCodexConversationSource): CodexChatPhase {
  if (source === 'codex-plan') return 'PLAN'
  if (source === 'codex-run') return 'RUN'
  return source
}

export function latestTaskCodexConversation(task: TaskEntity, requestedPhase: TaskCodexConversationSource): TaskCodexConversationMatch | null {
  let latest: TaskCodexConversationMatch | null = null
  const normalizedPhase = normalizeConversationSourcePhase(requestedPhase)
  for (const message of taskActivityMessages(task)) {
    const phase = inferCodexChatPhase(message)
    if (phase !== normalizedPhase) continue
    const conversationId = message.conversationId || message.runId
    if (!conversationId) continue
    const at = message.updatedAt ?? message.createdAt
    if (latest && latest.at >= at) continue
    latest = { source: message.source, phase, conversationId, at }
  }
  return latest
}

export function taskCodexActionChips(task: TaskEntity): TaskCodexActionChip[] {
  return (['PLAN', 'RUN', 'POST-RUNNING', 'FOLLOW UP'] as const).flatMap((phase) => {
    const latest = latestTaskCodexConversation(task, phase)
    if (!latest) return []
    const message = taskActivityMessages(task)
      .filter((item) => inferCodexChatPhase(item) === phase && (item.conversationId || item.runId) === latest.conversationId)
      .find((item) => (item.updatedAt ?? item.createdAt) === latest.at)
    return [{
      phase,
      label: codexChatPhaseActionLabel(phase),
      conversationId: latest.conversationId,
      status: message?.status ?? 'event',
      at: latest.at
    }]
  })
}

export function getStatusOrder(task: TaskEntity, status: string) {
  const value = task.payload?.statusOrder
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const order = (value as Record<string, unknown>)[status]
  return typeof order === 'number' && Number.isFinite(order) ? order : null
}

export function getTaskNewestTime(task: TaskEntity) {
  return Number.isFinite(task.createdAt) ? task.createdAt : task.updatedAt
}

export function statusOrderPayload(task: TaskEntity, status: string, order: number): Record<string, unknown> {
  const current = task.payload?.statusOrder
  return {
    ...((current && typeof current === 'object' && !Array.isArray(current)) ? current as Record<string, unknown> : {}),
    [status]: order
  }
}

export type TaskDropPosition = 'before' | 'after'

export type ReorderedTaskUpdate = {
  task: TaskEntity
  status: TaskEntity['status']
  order: number
}

export function orderedTasksForStatus(rows: TaskEntity[]): TaskEntity[] {
  const newestFirstIndex = new Map(
    [...rows]
      .sort((a, b) => getTaskNewestTime(b) - getTaskNewestTime(a))
      .map((task, index) => [task.id, index])
  )
  return rows
    .map((task, index) => ({
      task,
      index,
      order: getStatusOrder(task, task.status) ?? newestFirstIndex.get(task.id) ?? index
    }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((item) => item.task)
}

export function reorderTasksForDrop(
  tasks: TaskEntity[],
  sourceTaskId: string,
  targetStatus: TaskEntity['status'],
  targetTaskId?: string,
  position: TaskDropPosition = 'after'
): { tasks: TaskEntity[]; updates: ReorderedTaskUpdate[] } {
  const sourceTask = tasks.find((task) => task.id === sourceTaskId)
  if (!sourceTask) return { tasks, updates: [] }

  const sourceStatus = sourceTask.status
  const targetRows = orderedTasksForStatus(tasks.filter((task) => task.id !== sourceTaskId && task.status === targetStatus))
  const targetIndex = targetTaskId ? targetRows.findIndex((task) => task.id === targetTaskId) : -1
  const insertIndex = targetIndex >= 0
    ? position === 'before' ? targetIndex : targetIndex + 1
    : targetRows.length
  const movedTask = { ...sourceTask, status: targetStatus }
  const nextTargetRows = [...targetRows]
  nextTargetRows.splice(Math.max(0, Math.min(insertIndex, nextTargetRows.length)), 0, movedTask)

  const nextRowsById = new Map<string, TaskEntity>()
  const updates: ReorderedTaskUpdate[] = []
  const addRows = (rows: TaskEntity[], status: TaskEntity['status']) => {
    rows.forEach((task, order) => {
      const nextTask = {
        ...task,
        status,
        payload: {
          ...(task.payload ?? {}),
          statusOrder: statusOrderPayload(task, status, order)
        }
      }
      nextRowsById.set(nextTask.id, nextTask)
      updates.push({ task: nextTask, status, order })
    })
  }

  addRows(nextTargetRows, targetStatus)
  if (sourceStatus !== targetStatus) {
    addRows(orderedTasksForStatus(tasks.filter((task) => task.id !== sourceTaskId && task.status === sourceStatus)), sourceStatus)
  }

  return {
    tasks: tasks.map((task) => nextRowsById.get(task.id) ?? task),
    updates
  }
}

export function customFieldValueToDraft(field: CustomField, value: unknown): string {
  if (field.type === 'boolean') return value === true ? 'true' : value === false ? 'false' : ''
  if (field.type === 'json') {
    if (value === undefined) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  return value == null ? '' : String(value)
}

export function customFieldValueLabel(field: CustomField, value: unknown): string {
  if (value === undefined) return 'Empty'
  if (field.type === 'boolean') return value ? 'True' : 'False'
  if (field.type === 'json') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return 'Invalid JSON'
    }
  }
  return String(value)
}

export function createLocalId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
