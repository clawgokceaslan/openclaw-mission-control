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
  archived: boolean
  metrics?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface TaskEntity {
  id: string
  projectId: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  agentId?: string | null
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  description?: string
  comments?: TaskComment[]
  commentCount?: number
  tags?: Tag[]
  skills?: Skill[]
  subtasks?: TaskSubtask[]
  customFieldValues?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface TaskComment {
  id: string
  authorName: string
  body: string
  createdAt: number
}

export interface TaskSubtask {
  id: string
  taskId: string
  title: string
  status: 'pending' | 'completed'
  sortOrder: number
  payload?: Record<string, unknown>
  description?: string
  assigneeId?: string
  assigneeName?: string
  dueAt?: number
  createdAt: number
  updatedAt: number
}

export interface Agent {
  id: string
  organizationId: string
  name: string
  status: 'idle' | 'busy' | 'offline'
  heartbeatAt: number
  config?: Record<string, unknown>
  title?: string
  trainingMarkdown?: string
  steps?: AgentStep[]
  reasoningLevel?: AgentReasoningLevel
  createdAt: number
  updatedAt: number
}

export type AgentReasoningLevel = 'low' | 'medium' | 'high' | 'extra_high'

export interface AgentStep {
  id: string
  title: string
  description: string
  sortOrder: number
}

export interface Gateway {
  id: string
  organizationId: string
  name: string
  status: 'online' | 'offline' | 'connecting'
  endpoint: string
  token: string
  template?: OpenClawGatewayConfig | Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type GatewayProvider = 'openclaw'
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
