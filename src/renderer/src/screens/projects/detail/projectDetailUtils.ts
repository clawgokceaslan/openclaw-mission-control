import type {
  CodexCliGatewayConfig,
  CustomField,
  Project,
  ProjectCodexSettings,
  TaskEntity,
  Workspace
} from '@shared/types/entities'
import type { ProjectTableViewConfig, TableColumnConfig } from './types'

export function projectCodexSettings(project: Project | null): ProjectCodexSettings {
  const value = project?.metrics?.codex
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    gatewayId: typeof record.gatewayId === 'string' ? record.gatewayId : null,
    runtimeWorkspaceId: typeof record.runtimeWorkspaceId === 'string' ? record.runtimeWorkspaceId : null,
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : null,
    planModel: typeof record.planModel === 'string' ? record.planModel : null,
    runModel: typeof record.runModel === 'string' ? record.runModel : null
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

export function taskCodexModel(task: TaskEntity | null | undefined): string {
  return readTaskCodexOverride(task).legacyModel
}

export function readTaskCodexOverride(task: TaskEntity | null | undefined): { gatewayId: string; legacyModel: string; planModel: string; runModel: string } {
  const codex = task?.payload?.codex
  if (!codex || typeof codex !== 'object' || Array.isArray(codex)) {
    return { gatewayId: '', legacyModel: '', planModel: '', runModel: '' }
  }
  const record = codex as Record<string, unknown>
  return {
    gatewayId: typeof record.gatewayId === 'string' ? record.gatewayId : '',
    legacyModel: typeof record.model === 'string' ? record.model : '',
    planModel: typeof record.planModel === 'string' ? record.planModel : '',
    runModel: typeof record.runModel === 'string' ? record.runModel : ''
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

export function codexPayloadOverride(gatewayId: string, model: string, planModel = '', runModel = ''): Record<string, string> | undefined {
  const next: Record<string, string> = {}
  if (gatewayId) next.gatewayId = gatewayId
  if (model) next.model = model
  if (planModel) next.planModel = planModel
  if (runModel) next.runModel = runModel
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

export const DEFAULT_TABLE_COLUMNS: TableColumnConfig[] = [
  { id: 'index', kind: 'index', label: '#', width: 42, required: true },
  { id: 'name', kind: 'name', label: 'Name', width: 300, required: true },
  { id: 'assignee', kind: 'assignee', label: 'Assignee', width: 170 },
  { id: 'status', kind: 'status', label: 'Status', width: 180, required: true },
  { id: 'due', kind: 'due', label: 'Due date', width: 150 },
  { id: 'tags', kind: 'tags', label: 'Tags', width: 190 },
  { id: 'subtasks', kind: 'subtasks', label: 'Subtasks', width: 110 },
  { id: 'priority', kind: 'priority', label: 'Priority', width: 110 }
]

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

export function getTableViewConfig(project: Project | null): ProjectTableViewConfig {
  const value = project?.metrics?.tableView
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as ProjectTableViewConfig
}

export function normalizeTableColumns(project: Project | null, customFields: CustomField[]): TableColumnConfig[] {
  const config = getTableViewConfig(project)
  const customFieldIds = new Set(customFields.map((field) => field.id))
  const incoming = Array.isArray(config.columns) ? config.columns : DEFAULT_TABLE_COLUMNS
  const byId = new Map(DEFAULT_TABLE_COLUMNS.map((column) => [column.id, column]))
  const normalized = incoming
    .filter((column) => column && typeof column.id === 'string')
    .filter((column) => column.kind !== 'custom' || (column.customFieldId && customFieldIds.has(column.customFieldId)))
    .slice(0, 12)
    .map((column) => {
      const base = byId.get(column.id)
      if (base) return { ...base, width: config.columnWidths?.[base.id] ?? column.width ?? base.width }
      const field = customFields.find((item) => item.id === column.customFieldId)
      return {
        id: column.id,
        kind: 'custom' as const,
        label: field?.name ?? column.label,
        customFieldId: column.customFieldId,
        width: config.columnWidths?.[column.id] ?? column.width ?? 180
      }
    })
  for (const required of DEFAULT_TABLE_COLUMNS.filter((column) => column.required)) {
    if (!normalized.some((column) => column.id === required.id)) normalized.unshift(required)
  }
  return normalized.slice(0, 12)
}

export function getLegacyTableOrder(task: TaskEntity) {
  const value = task.payload?.tableOrder
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
