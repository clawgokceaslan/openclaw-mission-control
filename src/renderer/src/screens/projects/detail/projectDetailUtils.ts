import type {
  CodexCliGatewayConfig,
  Project,
  ProjectGatewaySettings,
  TaskEntity,
  Workspace
} from '@shared/types/entities'
import type { TaskActivityMessage } from './types'
import type { ProjectStatusColumn } from './status'
import { normalizeGatewayLanguage, normalizeGatewayReasoningEffort } from '@shared/utils/gateway-language'
import {
  gatewayChatLifecycleStatusKey,
  gatewayChatPhaseActionLabel,
  gatewayMetadataBlock,
  gatewayLifecycleStatusMeta,
  inferGatewayChatPhase,
  type GatewayChatPhase,
  type GatewayLifecycleStatusKey,
  type GatewayLifecycleTone
} from '@shared/utils/gateway-chat-phase'
import { normalizeGatewayPromptShape } from '@shared/utils/gateway-prompt-shape'

export function projectGatewaySettings(project: Project | null): ProjectGatewaySettings {
  const value = project?.metrics?.gateway
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
    language: typeof record.language === 'string' ? normalizeGatewayLanguage(record.language) : legacyLanguage ? normalizeGatewayLanguage(legacyLanguage) : null,
    promptShape: normalizeGatewayPromptShape(record.promptShape),
    planReasoningEffort: typeof record.planReasoningEffort === 'string' ? normalizeGatewayReasoningEffort(record.planReasoningEffort) : null,
    runReasoningEffort: typeof record.runReasoningEffort === 'string' ? normalizeGatewayReasoningEffort(record.runReasoningEffort) : null,
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

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
    : []
}

function projectManagement(project: Project | null): Record<string, unknown> {
  const value = project?.metrics?.management
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function projectLinkedAgentIds(project: Project | null): string[] {
  const management = projectManagement(project)
  const direct = stringIds(management.agentIds)
  const legacy = stringIds(project?.metrics?.agentIds)
  const defaultAgentId = projectDefaultAgentId(project)
  return Array.from(new Set([...direct, ...legacy, ...(defaultAgentId ? [defaultAgentId] : [])]))
}

export function projectLinkedToolIds(project: Project | null): string[] {
  const management = projectManagement(project)
  return Array.from(new Set([
    ...stringIds(management.toolIds),
    ...stringIds(project?.metrics?.toolIds),
    ...stringIds(project?.metrics?.defaultToolIds)
  ]))
}

export function buildProjectManagementMetrics(project: Project | null, draft: { defaultAgentId: string | null; defaultSkillIds: string[]; agentIds: string[]; toolIds: string[] }): Record<string, unknown> {
  const defaultAgentId = draft.defaultAgentId || null
  const defaultSkillIds = stringIds(draft.defaultSkillIds)
  const agentIds = Array.from(new Set([...stringIds(draft.agentIds), ...(defaultAgentId ? [defaultAgentId] : [])]))
  const toolIds = stringIds(draft.toolIds)
  return {
    ...(project?.metrics ?? {}),
    defaultAgentId,
    defaultSkillIds,
    agentIds,
    toolIds,
    management: {
      ...(projectManagement(project)),
      version: 1,
      defaultAgentId,
      defaultSkillIds,
      agentIds,
      toolIds
    }
  }
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

export function taskGatewayModel(task: TaskEntity | null | undefined): string {
  return readTaskGatewayOverride(task).legacyModel
}

export function readTaskGatewayOverride(task: TaskEntity | null | undefined): { gatewayId: string; legacyModel: string; planModel: string; runModel: string; planReasoningEffort: string; runReasoningEffort: string } {
  const codex = task?.payload?.gateway
  if (!codex || typeof codex !== 'object' || Array.isArray(codex)) {
    return { gatewayId: '', legacyModel: '', planModel: '', runModel: '', planReasoningEffort: '', runReasoningEffort: '' }
  }
  const record = codex as Record<string, unknown>
  return {
    gatewayId: typeof record.gatewayId === 'string' ? record.gatewayId : '',
    legacyModel: typeof record.model === 'string' ? record.model : '',
    planModel: typeof record.planModel === 'string' ? record.planModel : '',
    runModel: typeof record.runModel === 'string' ? record.runModel : '',
    planReasoningEffort: typeof record.planReasoningEffort === 'string' ? normalizeGatewayReasoningEffort(record.planReasoningEffort) : '',
    runReasoningEffort: typeof record.runReasoningEffort === 'string' ? normalizeGatewayReasoningEffort(record.runReasoningEffort) : ''
  }
}

export function taskGatewayPlanModel(task: TaskEntity | null | undefined): string {
  return readTaskGatewayOverride(task).planModel
}

export function taskGatewayRunModel(task: TaskEntity | null | undefined): string {
  const { runModel, legacyModel } = readTaskGatewayOverride(task)
  return runModel || legacyModel
}

export function taskGatewayExplicitPlanModel(task: TaskEntity | null | undefined): string {
  return readTaskGatewayOverride(task).planModel
}

export function taskGatewayExplicitRunModel(task: TaskEntity | null | undefined): string {
  return readTaskGatewayOverride(task).runModel
}

export function taskGatewayId(task: TaskEntity | null | undefined): string {
  return readTaskGatewayOverride(task).gatewayId
}

export function codexPayloadOverride(gatewayId: string, model: string, planModel = '', runModel = '', planReasoningEffort = '', runReasoningEffort = ''): Record<string, string> | undefined {
  const next: Record<string, string> = {}
  if (gatewayId) next.gatewayId = gatewayId
  if (model) next.model = model
  if (planModel) next.planModel = planModel
  if (runModel) next.runModel = runModel
  if (planReasoningEffort) next.planReasoningEffort = normalizeGatewayReasoningEffort(planReasoningEffort)
  if (runReasoningEffort) next.runReasoningEffort = normalizeGatewayReasoningEffort(runReasoningEffort)
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

export type TaskGatewayPlanBadge = {
  state: 'planned' | 'needs-clarification'
  label: 'Plan hazır' | 'Onay bekliyor'
  conversationId?: string
}

export type TaskGatewayActionChip = {
  phase: GatewayChatPhase
  label: string
  conversationId: string
  status: TaskActivityMessage['status'] | 'event'
  at: number
}

export type TaskGatewayConversationSource = GatewayChatPhase | 'gateway-plan' | 'gateway-run'

export type TaskGatewayConversationMatch = {
  source: TaskActivityMessage['source']
  phase: GatewayChatPhase
  conversationId: string
  at: number
}

export type TaskGatewaySurfaceStatus = {
  key: string
  statusKey: GatewayLifecycleStatusKey
  label: string
  tone: GatewayLifecycleTone
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
    phase: inferGatewayChatPhase(message)
  }))
}

export function taskGatewayPlanBadge(task: TaskEntity): TaskGatewayPlanBadge | null {
  const value = task.payload?.gatewayPlanState
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.state === 'planned') {
    return {
      state: 'planned',
      label: 'Plan hazır',
      conversationId: typeof record.conversationId === 'string' ? record.conversationId : undefined
    }
  }
  if (record.state === 'needs-clarification') {
    return {
      state: 'needs-clarification',
      label: 'Onay bekliyor',
      conversationId: typeof record.conversationId === 'string' ? record.conversationId : undefined
    }
  }
  return null
}

function activityMessageTime(message: TaskActivityMessage): number {
  return message.updatedAt ?? message.createdAt
}

function latestActivityMessageByPhase(task: TaskEntity, phase: GatewayChatPhase): TaskActivityMessage | null {
  let latest: TaskActivityMessage | null = null
  for (const message of taskActivityMessages(task)) {
    if (inferGatewayChatPhase(message) !== phase) continue
    if (!latest || activityMessageTime(latest) <= activityMessageTime(message)) latest = message
  }
  return latest
}

function isFreshActiveMessage(message: TaskActivityMessage, now: number): boolean {
  if (message.status !== 'running' && message.status !== 'queued') return false
  return now - (message.updatedAt ?? message.createdAt) <= 15 * 60 * 1000
}

function activityMetadata(message: TaskActivityMessage): Record<string, unknown> {
  return message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown>
    : {}
}

function isStaleActiveMessage(message: TaskActivityMessage, now: number): boolean {
  if (message.status !== 'running' && message.status !== 'queued') return false
  return !isFreshActiveMessage(message, now)
}

function isStoppedActivityMessage(message: TaskActivityMessage): boolean {
  return activityMetadata(message).stopped === true
}

function isBlockedActivityMessage(message: TaskActivityMessage): boolean {
  const metadata = activityMetadata(message)
  const block = gatewayMetadataBlock(metadata)
  return block === 'planner-question' || metadata.needsInput === true || metadata.blocked === true
}

function isTerminalActivityMessage(message: TaskActivityMessage): boolean {
  const metadata = activityMetadata(message)
  const gatewayBlock = gatewayMetadataBlock(metadata)
  const runStatus = typeof metadata.runStatus === 'string' ? metadata.runStatus : undefined
  if (gatewayBlock && ['command', 'log', 'changes'].includes(gatewayBlock)) return false
  return gatewayBlock === 'run-complete'
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
  statusKey: GatewayLifecycleStatusKey,
  conversationId?: string,
  active?: boolean,
  iconOnly?: boolean
): TaskGatewaySurfaceStatus {
  const meta = gatewayLifecycleStatusMeta(statusKey)
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

function phaseSurfaceStatus(phase: GatewayChatPhase, message: TaskActivityMessage, active: boolean, now = Date.now()): TaskGatewaySurfaceStatus {
  if (isStoppedActivityMessage(message)) return surfaceStatus(`${phase}:paused`, 'paused', conversationIdOfActivity(message))
  if (isBlockedActivityMessage(message)) return surfaceStatus(`${phase}:blocked`, 'blocked', conversationIdOfActivity(message))
  if (isStaleActiveMessage(message, now)) return surfaceStatus(`${phase}:stale`, 'stale', conversationIdOfActivity(message))
  const statusKey = gatewayChatLifecycleStatusKey(phase, message.status ?? 'event', active)
  const status = surfaceStatus(`${phase}:${statusKey}`, statusKey, conversationIdOfActivity(message), active)
  if (statusKey !== 'failed') return status
  if (phase === 'PLAN') return { ...status, label: 'Planlama durdu' }
  if (phase === 'RUN') return { ...status, label: 'Çalıştırma durdu' }
  if (phase === 'POST-RUNNING') return { ...status, label: 'Doğrulama durdu' }
  return { ...status, label: 'Devam akışı durdu' }
}

function latestFreshActiveMessageByPhase(task: TaskEntity, phase: GatewayChatPhase, now: number): TaskActivityMessage | null {
  let latest: TaskActivityMessage | null = null
  for (const message of taskActivityMessages(task)) {
    if (inferGatewayChatPhase(message) !== phase) continue
    if (!isFreshActiveMessage(message, now)) continue
    if (!latest || activityMessageTime(latest) <= activityMessageTime(message)) latest = message
  }
  return latest
}

function latestTerminalMessageByPhase(task: TaskEntity, phase: GatewayChatPhase): TaskActivityMessage | null {
  let latest: TaskActivityMessage | null = null
  for (const message of taskActivityMessages(task)) {
    if (inferGatewayChatPhase(message) !== phase) continue
    if (!isTerminalActivityMessage(message)) continue
    if (!latest || activityMessageTime(latest) <= activityMessageTime(message)) latest = message
  }
  return latest
}

function activeMessageAfterTerminal(task: TaskEntity, phase: GatewayChatPhase, now: number, terminal: TaskActivityMessage | null): TaskActivityMessage | null {
  const active = latestFreshActiveMessageByPhase(task, phase, now)
  if (!active) return null
  if (terminal && activityMessageTime(terminal) >= activityMessageTime(active)) return null
  return active
}

export function taskGatewaySurfaceStatuses(task: TaskEntity, now = Date.now()): TaskGatewaySurfaceStatus[] {
  const statuses: TaskGatewaySurfaceStatus[] = []
  const planBadge = taskGatewayPlanBadge(task)
  const terminalPlan = latestTerminalMessageByPhase(task, 'PLAN')
  const activePlan = activeMessageAfterTerminal(task, 'PLAN', now, terminalPlan)
  const latestPlan = latestActivityMessageByPhase(task, 'PLAN')

  if (activePlan) {
    statuses.push(phaseSurfaceStatus('PLAN', activePlan, true, now))
  } else if (terminalPlan?.status === 'failed' || terminalPlan?.role === 'error' || terminalPlan?.metadata?.runStatus === 'failed') {
    statuses.push(phaseSurfaceStatus('PLAN', terminalPlan, false, now))
  } else if (planBadge?.state === 'planned') {
    statuses.push(surfaceStatus('PLAN:planned', 'planned', planBadge.conversationId, false, true))
  } else if (planBadge?.state === 'needs-clarification') {
    statuses.push(surfaceStatus('PLAN:needs-input', 'needs-input', planBadge.conversationId))
  } else if (terminalPlan) {
    statuses.push(phaseSurfaceStatus('PLAN', terminalPlan, false, now))
  } else if (latestPlan) {
    statuses.push(phaseSurfaceStatus('PLAN', latestPlan, false, now))
  } else {
    statuses.push(surfaceStatus('PLAN:not-planned', 'not-planned'))
  }

  const latestRun = latestActivityMessageByPhase(task, 'RUN')
  if (latestRun) {
    const terminalRun = latestTerminalMessageByPhase(task, 'RUN')
    const activeRun = activeMessageAfterTerminal(task, 'RUN', now, terminalRun)
    statuses.push(phaseSurfaceStatus('RUN', activeRun ?? terminalRun ?? latestRun, Boolean(activeRun), now))
  }

  const latestPostRunning = latestActivityMessageByPhase(task, 'POST-RUNNING')
  if (latestPostRunning) {
    const terminalPostRunning = latestTerminalMessageByPhase(task, 'POST-RUNNING')
    const activePostRunning = activeMessageAfterTerminal(task, 'POST-RUNNING', now, terminalPostRunning)
    statuses.push(phaseSurfaceStatus('POST-RUNNING', activePostRunning ?? terminalPostRunning ?? latestPostRunning, Boolean(activePostRunning), now))
  }

  const latestFollowUp = latestActivityMessageByPhase(task, 'FOLLOW UP')
  if (latestFollowUp) {
    const terminalFollowUp = latestTerminalMessageByPhase(task, 'FOLLOW UP')
    const activeFollowUp = activeMessageAfterTerminal(task, 'FOLLOW UP', now, terminalFollowUp)
    statuses.push(phaseSurfaceStatus('FOLLOW UP', activeFollowUp ?? terminalFollowUp ?? latestFollowUp, Boolean(activeFollowUp), now))
  }

  return statuses
}

export function taskGatewayActiveTone(task: TaskEntity, now = Date.now()): TaskGatewaySurfaceStatus['tone'] | null {
  const active = taskGatewaySurfaceStatuses(task, now).find((status) => status.active)
  return active?.tone ?? null
}

export function taskGatewayLatestSurfaceStatus(task: TaskEntity, now = Date.now()): TaskGatewaySurfaceStatus | null {
  const messages = taskActivityMessages(task)
  if (messages.length === 0) return null

  const latestMessageTimeByConversation = new Map<string, number>()
  for (const message of messages) {
    const conversationId = conversationIdOfActivity(message)
    const at = activityMessageTime(message)
    const current = latestMessageTimeByConversation.get(conversationId)
    if (current === undefined || current <= at) latestMessageTimeByConversation.set(conversationId, at)
  }

  let latest: { status: TaskGatewaySurfaceStatus; at: number; index: number } | null = null
  taskGatewaySurfaceStatuses(task, now).forEach((status, index) => {
    if (status.statusKey === 'not-planned') return
    const at = status.conversationId ? latestMessageTimeByConversation.get(status.conversationId) : undefined
    if (at === undefined) return
    if (!latest || latest.at < at || (latest.at === at && latest.index < index)) {
      latest = { status, at, index }
    }
  })

  return latest?.status ?? null
}

function normalizeConversationSourcePhase(source: TaskGatewayConversationSource): GatewayChatPhase {
  if (source === 'gateway-plan') return 'PLAN'
  if (source === 'gateway-run') return 'RUN'
  return source
}

export function latestTaskGatewayConversation(task: TaskEntity, requestedPhase: TaskGatewayConversationSource): TaskGatewayConversationMatch | null {
  let latest: TaskGatewayConversationMatch | null = null
  const normalizedPhase = normalizeConversationSourcePhase(requestedPhase)
  for (const message of taskActivityMessages(task)) {
    const phase = inferGatewayChatPhase(message)
    if (phase !== normalizedPhase) continue
    const conversationId = message.conversationId || message.runId
    if (!conversationId) continue
    const at = message.updatedAt ?? message.createdAt
    if (latest && latest.at >= at) continue
    latest = { source: message.source, phase, conversationId, at }
  }
  return latest
}

export function latestActiveTaskGatewayConversation(task: TaskEntity, requestedPhase: TaskGatewayConversationSource, now = Date.now()): TaskGatewayConversationMatch | null {
  let latest: TaskGatewayConversationMatch | null = null
  const normalizedPhase = normalizeConversationSourcePhase(requestedPhase)
  const terminalByConversation = new Map<string, number>()
  for (const message of taskActivityMessages(task)) {
    if (inferGatewayChatPhase(message) !== normalizedPhase) continue
    if (!isTerminalActivityMessage(message)) continue
    const conversationId = conversationIdOfActivity(message)
    const at = activityMessageTime(message)
    const current = terminalByConversation.get(conversationId)
    if (current === undefined || current <= at) terminalByConversation.set(conversationId, at)
  }
  for (const message of taskActivityMessages(task)) {
    if (inferGatewayChatPhase(message) !== normalizedPhase) continue
    if (!isFreshActiveMessage(message, now)) continue
    const conversationId = message.conversationId || message.runId
    if (!conversationId) continue
    const at = message.updatedAt ?? message.createdAt
    const terminalAt = terminalByConversation.get(conversationId)
    if (terminalAt !== undefined && terminalAt >= at) continue
    if (latest && latest.at >= at) continue
    latest = { source: message.source, phase: normalizedPhase, conversationId, at }
  }
  return latest
}

export function taskGatewayActionChips(task: TaskEntity): TaskGatewayActionChip[] {
  return (['PLAN', 'RUN', 'POST-RUNNING', 'FOLLOW UP'] as const).flatMap((phase) => {
    const latest = latestTaskGatewayConversation(task, phase)
    if (!latest) return []
    const message = taskActivityMessages(task)
      .filter((item) => inferGatewayChatPhase(item) === phase && (item.conversationId || item.runId) === latest.conversationId)
      .find((item) => (item.updatedAt ?? item.createdAt) === latest.at)
    return [{
      phase,
      label: gatewayChatPhaseActionLabel(phase),
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

export function nextStatusTopOrder(tasks: TaskEntity[], status: string): number {
  const firstOrder = tasks
    .filter((task) => task.status === status)
    .map((task) => getStatusOrder(task, status))
    .filter((order): order is number => order !== null)
    .sort((a, b) => a - b)[0]
  return typeof firstOrder === 'number' ? firstOrder - 1 : 0
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
  const insertIndex = sourceStatus !== targetStatus
    ? 0
    : targetIndex >= 0
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
