export interface User {
  id: string
  email: string
  name?: string | null
  role: 'owner' | 'admin' | 'member'
  organizationId: string
}

export interface Session {
  id: string
  userId: string
  token: string
  expiresAt: number
  createdAt: number
}

export interface Project {
  id: string
  organizationId: string
  name: string
  description?: string
  workspaceId?: string | null
  generalContext?: string
  generalPrompt?: string
  defaultOutput?: string
  archived: boolean
  metrics?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface ProjectCodexSettings {
  gatewayId?: string | null
  runtimeWorkspaceId?: string | null
  defaultModel?: string | null
  planModel?: string | null
  runModel?: string | null
  language?: string | null
  planReasoningEffort?: string | null
  runReasoningEffort?: string | null
  /** Legacy project language fields. Read as fallback only; new saves should write language. */
  inputLanguage?: string | null
  outputLanguage?: string | null
}

export interface Workspace {
  id: string
  organizationId: string
  name: string
  rootPath: string
  createdAt: number
  updatedAt: number
}

export type ProjectStatusCategory = 'not_started' | 'active' | 'done' | 'closed'

export interface ProjectStatus {
  id: string
  organizationId: string
  projectId?: string
  templateId?: string
  name: string
  category: ProjectStatusCategory
  color: string
  sortOrder: number
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface StatusTemplate {
  id: string
  organizationId: string
  name: string
  createdAt: number
  updatedAt: number
  items?: ProjectStatus[]
}

export interface TaskEntity {
  id: string
  projectId: string
  title: string
  status: string
  agentId?: string | null
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  description?: string
  comments?: TaskComment[]
  commentCount?: number
  tags?: Tag[]
  skills?: Skill[]
  subtasks?: TaskSubtask[]
  checklistItems?: TaskChecklistItem[]
  customFieldValues?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface TaskChecklistItem {
  id: string
  title: string
  checked: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskComment {
  id: string
  authorName: string
  body: string
  createdAt: number
  updatedAt?: number
}

export interface TaskSubtask {
  id: string
  taskId: string
  title: string
  status: string
  sortOrder: number
  payload?: Record<string, unknown>
  description?: string
  assigneeId?: string
  assigneeName?: string
  dueAt?: number
  createdAt: number
  updatedAt: number
}

export interface TaskAttachment {
  id: string
  name: string
  url: string
  type: string
  size: number
  createdAt: number
}

export interface TaskTemplatePayload {
  title?: string
  description?: string
  status?: string
  agentId?: string | null
  tagIds?: string[]
  skillIds?: string[]
  customFieldValues?: Record<string, unknown>
  checklistItems?: TaskChecklistItem[]
  inputFormatId?: string | null
  outputFormatId?: string | null
  comments?: TaskComment[]
  attachments?: TaskAttachment[]
  codex?: {
    gatewayId?: string | null
    model?: string | null
  }
  subtasks?: Array<{
    title?: string
    status?: string
    payload?: Record<string, unknown>
    agentId?: string | null
    dueAt?: number
    inputFormatId?: string | null
    outputFormatId?: string | null
  }>
}

export interface TaskTemplate {
  id: string
  organizationId: string
  name: string
  description?: string
  template: TaskTemplatePayload
  createdAt: number
  updatedAt: number
}

export interface ProjectInstructionTemplatePayload {
  generalContext?: string
  generalPrompt?: string
  planGuide?: string
  defaultOutput?: string
  rules?: string
  postRunPrompt?: string
}

export interface ProjectInstructionTemplate {
  id: string
  organizationId: string
  name: string
  description?: string
  template: ProjectInstructionTemplatePayload
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskJsonImportResult {
  task?: TaskEntity
  template?: TaskTemplate
  warnings: string[]
}

export interface Agent {
  id: string
  organizationId: string
  name: string
  /** Legacy runtime status. Read for older rows only; new agent writes do not expose it. */
  status?: 'idle' | 'busy' | 'offline'
  heartbeatAt: number
  config?: Record<string, unknown>
  title?: string
  description?: string
  trainingMarkdown?: string
  tags?: Tag[]
  tagIds?: string[]
  createdAt: number
  updatedAt: number
}

export interface AgentOutputFormatField {
  id: string
  key: string
  description: string
  defaultValue?: string
  valueType?: 'string' | 'number' | 'boolean' | 'array' | 'enum'
  required?: boolean
  enumValues?: string[]
  children?: AgentOutputFormatField[]
}

export interface OutputFormat {
  id: string
  organizationId: string
  name: string
  description?: string
  formatRole: 'input' | 'output'
  fields: AgentOutputFormatField[]
  instructionsMarkdown?: string
  createdAt: number
  updatedAt: number
}

export interface Gateway {
  id: string
  organizationId: string
  name: string
  status: 'online' | 'offline' | 'connecting'
  endpoint: string
  token: string
  template?: CodexCliGatewayConfig | OpenClawGatewayConfig | Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type GatewayProvider = 'codex_cli' | 'openclaw'

export interface CodexCliModel {
  id: string
  label: string
  source?: string
  recommended?: boolean
}

export interface CodexCliGatewayConfig {
  provider: 'codex_cli'
  codexPath?: string
  executionMode?: 'terminal' | 'exec'
  models?: CodexCliModel[]
  lastModelRefreshAt?: number
  lastModelRefreshError?: string
}
export type OpenClawGatewayPairingStatus = 'not_paired' | 'requested' | 'paired' | 'rejected' | 'failed'

export interface OpenClawGatewayDeviceIdentity {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
  createdAt: number
}

export interface OpenClawGatewayConfig {
  provider: GatewayProvider
  apiBaseUrl?: string
  authMode?: 'device_pairing' | 'control_ui_token'
  workspaceRoot?: string
  allowSelfSignedTls?: boolean
  disableDevicePairing?: boolean
  autoConnect?: boolean
  lastHandshakeAt?: number
  protocolVersion?: string
  capabilities?: string[]
  deviceIdentity?: OpenClawGatewayDeviceIdentity
  deviceToken?: string
  deviceScopes?: string[]
  pairingStatus?: OpenClawGatewayPairingStatus
  lastPairingError?: string
}

export type OpenClawRpcAccess = 'read' | 'write' | 'admin'

export interface OpenClawRpcMethodDefinition {
  method: string
  group: string
  access: OpenClawRpcAccess
  description: string
  sampleParams?: Record<string, unknown>
}

export interface OpenClawRpcCallResult {
  ok: boolean
  method: string
  requestId: string
  durationMs: number
  result?: unknown
  error?: string
  raw?: unknown
}

export interface OpenClawGatewayTestResult {
  ok: boolean
  wsOk: boolean
  restOk: boolean
  message: string
  details?: Record<string, unknown>
}

export interface OpenClawBoardSummary {
  id: string
  name?: string
  slug?: string
  description?: string
  [key: string]: unknown
}

export interface OpenClawAgentSummary {
  id: string
  name?: string
  status?: string
  [key: string]: unknown
}

export interface OpenClawSkillSummary {
  id: string
  name?: string
  slug?: string
  description?: string
  [key: string]: unknown
}

export interface OpenClawTagSummary {
  id: string
  name?: string
  color?: string
  [key: string]: unknown
}

export type OpenClawResourceType = 'agent' | 'skill'
export type OpenClawSyncStatus = 'pending' | 'synced' | 'failed'

export interface OpenClawResourceMapping {
  id: string
  organizationId: string
  gatewayId: string
  resourceType: OpenClawResourceType
  localId: string
  openClawId: string
  syncStatus: OpenClawSyncStatus
  contentHash?: string
  lastSyncedAt?: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface OpenClawAgentSyncResult {
  agentId: string
  gatewayId: string
  openClawId: string
  status: 'synced' | 'failed' | 'skipped'
  contentHash?: string
  error?: string
}

export interface GatewayHistoryItem {
  id: string
  gatewayId: string
  eventType: string
  payload?: Record<string, unknown>
  createdAt: number
}

export interface GatewaySession {
  id: string
  gatewayId: string
  status: 'connected' | 'disconnected' | 'reconnecting'
  state?: Record<string, unknown>
  lastSeenAt: number
  backoffMs?: number
}

export interface GatewayCommand {
  id: string
  gatewayId: string
  requestId: string
  command: string
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  status: 'queued' | 'sent' | 'completed' | 'failed'
  createdAt: number
  updatedAt: number
}

export interface Webhook {
  id: string
  organizationId: string
  url: string
  active: boolean
  secret?: string
  eventTypes: string[]
  failureCount: number
}

export interface Skill {
  id: string
  organizationId: string
  name: string
  slug: string
  category: string
  version: string
  enabled: boolean
  descriptionMarkdown?: string
  status: 'active' | 'inactive'
  updatedAt?: number
}

export interface Pack {
  id: string
  organizationId: string
  name: string
  version: string
  enabled: boolean
}

export interface Organization {
  id: string
  name: string
}

export interface Membership {
  id: string
  organizationId: string
  userId: string
  role: string
}

export interface ProjectGroup {
  id: string
  organizationId: string
  name: string
  settings: Record<string, unknown>
  description?: string
  projectIds?: string[]
  projectCount?: number
  createdAt: number
  updatedAt: number
}

export interface CustomField {
  id: string
  organizationId: string
  name: string
  type: 'text' | 'number' | 'boolean' | 'json'
  config?: Record<string, unknown>
  description?: string
  defaultValue?: unknown
}

export interface Tag {
  id: string
  organizationId: string
  name: string
  color?: string
  description?: string
  updatedAt?: number
  taskCount?: number
}

export interface Job {
  id: string
  type: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'dead'
  attempts: number
  maxAttempts: number
  nextRunAt: number
  payload: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type Task = TaskEntity
