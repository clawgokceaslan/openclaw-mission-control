export const IPC_CHANNELS = {
  app: {
    navigateFromCompanion: 'app:navigate-from-companion',
    focusPlannerQuestion: 'app:focus-planner-question',
    rendererHealth: 'app:renderer-health',
    restart: 'app:restart',
    restartToDatabaseSettings: 'app:restart-to-database-settings'
  },
  auth: {
    login: 'auth:login',
    refresh: 'auth:refresh',
    logout: 'auth:logout',
    me: 'auth:me',
    inviteValidate: 'auth:invite-validate',
    updateProfile: 'auth:update-profile',
    updateAvatar: 'auth:update-avatar',
    removeAvatar: 'auth:remove-avatar',
    changePassword: 'auth:change-password'
  },
  projects: {
    list: 'projects:list',
    get: 'projects:get',
    create: 'projects:create',
    update: 'projects:update',
    moveWorkspace: 'projects:move-workspace',
    exportWorkspace: 'projects:export-workspace',
    remove: 'projects:remove'
  },
  workspaces: {
    list: 'workspaces:list',
    create: 'workspaces:create',
    update: 'workspaces:update',
    remove: 'workspaces:remove',
    pickFolder: 'workspaces:pick-folder'
  },
  appSettings: {
    getActiveGateway: 'app-settings:get-active-gateway',
    setActiveGateway: 'app-settings:set-active-gateway',
    getDefaultAgent: 'app-settings:get-default-agent',
    setDefaultAgent: 'app-settings:set-default-agent',
    getDefaultAddTaskProject: 'app-settings:get-default-add-task-project',
    setDefaultAddTaskProject: 'app-settings:set-default-add-task-project',
    getGatewayLanguage: 'app-settings:get-gateway-language',
    setGatewayLanguage: 'app-settings:set-gateway-language',
    getPlannerQuestionAttention: 'app-settings:get-planner-question-attention',
    setPlannerQuestionAttention: 'app-settings:set-planner-question-attention',
    getDatabaseLocation: 'app-settings:get-database-location',
    getWebServerStatus: 'app-settings:get-web-server-status',
    openWebServerUrl: 'app-settings:open-web-server-url',
    pickDatabaseFolder: 'app-settings:pick-database-folder',
    pickDatabaseFile: 'app-settings:pick-database-file',
    moveDatabaseLocation: 'app-settings:move-database-location',
    revealDatabaseLocation: 'app-settings:reveal-database-location'
  },
  statuses: {
    list: 'statuses:list',
    listTemplates: 'statuses:list-templates',
    createTemplate: 'statuses:create-template',
    updateTemplate: 'statuses:update-template',
    removeTemplate: 'statuses:remove-template',
    getProjectStatuses: 'statuses:get-project-statuses',
    updateProjectStatuses: 'statuses:update-project-statuses',
    applyTemplateToProject: 'statuses:apply-template-to-project'
  },
  tasks: {
    list: 'tasks:list',
    listPlannedGateway: 'tasks:list-planned-gateway',
    listRunningGateway: 'tasks:list-running-gateway',
    get: 'tasks:get',
    create: 'tasks:create',
    update: 'tasks:update',
    remove: 'tasks:remove',
    history: 'tasks:history',
    subtasksCreate: 'tasks:subtasks:create',
    subtasksUpdate: 'tasks:subtasks:update',
    subtasksRemove: 'tasks:subtasks:remove',
    tagsSet: 'tasks:tags:set',
    commentAdd: 'tasks:comment:add',
    commentUpdate: 'tasks:comment:update',
    commentRemove: 'tasks:comment:remove',
    skillsSet: 'tasks:skills:set',
    exportSnapshot: 'tasks:export-snapshot',
    runGateway: 'tasks:run-gateway',
    planWithGateway: 'tasks:plan-with-gateway',
    gatewayChatSend: 'tasks:gateway-chat:send',
    gatewayChatStop: 'tasks:gateway-chat:stop',
    gatewayChatResolve: 'tasks:gateway-chat:resolve',
    plannerContext: 'tasks:planner-context',
    plannerValidateJson: 'tasks:planner-validate-json',
    plannerCreateFromJson: 'tasks:planner-create-from-json',
    plannerUpdateFromJson: 'tasks:planner-update-from-json',
    importJson: 'tasks:import-json'
  },
  taskTemplates: {
    list: 'task-templates:list',
    create: 'task-templates:create',
    update: 'task-templates:update',
    remove: 'task-templates:remove',
    importJson: 'task-templates:import-json'
  },
  projectInstructionTemplates: {
    list: 'project-instruction-templates:list',
    create: 'project-instruction-templates:create',
    update: 'project-instruction-templates:update',
    remove: 'project-instruction-templates:remove'
  },
  attachments: {
    upload: 'attachments:upload'
  },
  agents: {
    list: 'agents:list',
    get: 'agents:get',
    create: 'agents:create',
    update: 'agents:update',
    remove: 'agents:remove'
  },
  gateways: {
    list: 'gateways:list',
    get: 'gateways:get',
    create: 'gateways:create',
    update: 'gateways:update',
    remove: 'gateways:remove',
    status: 'gateways:status',
    sessions: 'gateways:sessions',
    commands: 'gateways:commands',
    commandsHistory: 'gateways:commands-history',
    gatewayModels: 'gateways:gateway-models',
    templates: 'gateways:templates'
  },
  webhooks: {
    list: 'webhooks:list',
    create: 'webhooks:create',
    update: 'webhooks:update',
    remove: 'webhooks:remove'
  },
  skills: {
    list: 'skills:list',
    listPage: 'skills:list-page',
    create: 'skills:create',
    update: 'skills:update',
    remove: 'skills:remove',
    listPacks: 'skills:packs',
  },
  organization: {
    me: 'organization:me',
    listMembers: 'organization:members',
    createInvite: 'organization:create-invite'
  },
  projectGroups: {
    list: 'project-groups:list',
    create: 'project-groups:create',
    update: 'project-groups:update',
    remove: 'project-groups:remove'
  },
  planPipelines: {
    list: 'plan-pipelines:list',
    listBatches: 'plan-pipelines:list-batches',
    createFromGroups: 'plan-pipelines:create-from-groups',
    updateState: 'plan-pipelines:update-state',
    updateBatch: 'plan-pipelines:update-batch'
  },
  runPipelines: {
    list: 'run-pipelines:list',
    get: 'run-pipelines:get',
    createManual: 'run-pipelines:create-manual',
    createFromPlanBatch: 'run-pipelines:create-from-plan-batch',
    update: 'run-pipelines:update',
    start: 'run-pipelines:start',
    pause: 'run-pipelines:pause',
    resume: 'run-pipelines:resume',
    retryItem: 'run-pipelines:retry-item',
    skipItem: 'run-pipelines:skip-item',
    cancel: 'run-pipelines:cancel'
  },
  pipelineStatus: {
    snapshot: 'pipeline-status:snapshot',
    createWatchToken: 'pipeline-status:create-watch-token',
    revokeWatchToken: 'pipeline-status:revoke-watch-token'
  },
  customFields: {
    list: 'custom-fields:list',
    create: 'custom-fields:create',
    update: 'custom-fields:update',
    remove: 'custom-fields:remove',
    tagsList: 'custom-fields:tags:list',
    tagsCreate: 'custom-fields:tags:create',
    tagsUpdate: 'custom-fields:tags:update',
    tagsRemove: 'custom-fields:tags:remove'
  },
  outputFormats: {
    list: 'output-formats:list',
    create: 'output-formats:create',
    update: 'output-formats:update',
    remove: 'output-formats:remove'
  },
  jobs: {
    list: 'jobs:list',
    metrics: 'jobs:metrics'
  },
  events: {
    appNavigate: 'events:app-navigate',
    gatewayStatus: 'events:gateway-status',
    taskUpdated: 'events:task-updated',
    jobProgress: 'events:job-progress',
    taskActivity: 'events:task-activity',
    planPipelineUpdated: 'events:plan-pipeline-updated',
    runPipelineUpdated: 'events:run-pipeline-updated'
  }
} as const

type ChannelGroups = typeof IPC_CHANNELS
type ChannelGroupValues<T> = T extends Record<string, string> ? T[keyof T] : never
type EventGroups = {
  [K in keyof ChannelGroups]: ChannelGroupValues<ChannelGroups[K]>
}
type FlattenEvents = EventGroups[keyof EventGroups]

export type IpcChannel = FlattenEvents

export type ServiceDomain = keyof typeof SERVICE_MAP

export interface CorrelationMeta {
  requestId?: string
  correlationId?: string
}

export interface RequestEnvelope<T = unknown> {
  requestId?: string
  correlationId?: string
  payload?: T
  actorToken?: string
  meta?: Record<string, unknown>
}

export interface EventEnvelope<T = unknown> {
  payload: T
  eventAt: number
  requestId?: string
  correlationId?: string
}

export interface BridgeRequest<TPayload = unknown> {
  actorToken?: string
  requestId?: string
  correlationId?: string
  payload?: TPayload
  meta?: Record<string, unknown>
}

export interface BridgeResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
  meta?: Record<string, unknown>
}

export interface AppNavigateRequest {
  path?: string
  state?: AppNavigateState
}

export interface AppNavigateOpenCreateState {
  openCreateTask?: boolean
  title?: string
  projectId?: string
  templateId?: string | null
}

export interface AppNavigateOpenTaskChatState {
  openTaskId?: string
  openTaskConversationId?: string
  openTaskChat?: boolean
  openProjectSettings?: boolean
  projectSettingsTab?: 'statuses' | 'workspace' | 'projectGroup' | 'agents' | 'skills' | 'models' | 'language' | 'codex'
}

export interface AppNavigateState extends AppNavigateOpenCreateState, AppNavigateOpenTaskChatState {}

export interface AppNavigateEvent {
  path: string
  state?: AppNavigateState
}

export interface SetTaskTagsRequest {
  actorToken?: string
  taskId?: string
  tagIds?: string[]
}

export interface SetTaskSkillsRequest {
  actorToken?: string
  taskId?: string
  skillIds?: string[]
}

export interface CreateAgentRequest {
  actorToken?: string
  name?: string
  config?: Record<string, unknown>
  title?: string
  description?: string
  trainingMarkdown?: string
  tagIds?: string[]
}

export interface UpdateAgentRequest extends CreateAgentRequest {
  id?: string
}

export interface ImportTaskJsonRequest {
  actorToken?: string
  projectId?: string
  taskId?: string
  json?: unknown
}

export interface PlanTaskGatewayRequest {
  actorToken?: string
  projectId?: string
  taskId?: string
  gatewayId?: string
  model?: string
  language?: string
  reasoningEffort?: string
  clarificationMode?: 'ask-first' | 'direct'
  inputLanguage?: string
  outputLanguage?: string
  conversationId?: string
  clarificationMessage?: string
  generalContext?: string
  generalPrompt?: string
  defaultOutput?: string
}

export interface PlannerContextRequest {
  actorToken?: string
  projectId?: string
  taskId?: string
}

export interface PlannerJsonRequest {
  actorToken?: string
  projectId?: string
  taskId?: string
  json?: unknown
}

export interface ImportTaskTemplateJsonRequest {
  actorToken?: string
  id?: string
  json?: unknown
}

export interface ListSkillsPageRequest {
  actorToken?: string
  page?: number
  pageSize?: number
  query?: string
  category?: string
  enabled?: boolean
  status?: 'active' | 'inactive'
}

export interface CreateSkillRequest {
  actorToken?: string
  title?: string
  descriptionMarkdown?: string
  status?: 'active' | 'inactive'
}

export interface UpdateSkillRequest {
  actorToken?: string
  id?: string
  title?: string
  descriptionMarkdown?: string
  status?: 'active' | 'inactive'
}

export interface RemoveSkillRequest {
  actorToken?: string
  id?: string
}

export interface UpdateProjectRequest {
  actorToken?: string
  id?: string
  name?: string
  description?: string
  workspaceId?: string | null
  archived?: boolean
  generalContext?: string
  generalPrompt?: string
  defaultOutput?: string
  metrics?: Record<string, unknown>
  gateway?: {
    gatewayId?: string | null
    runtimeWorkspaceId?: string | null
    defaultModel?: string | null
    planModel?: string | null
    runModel?: string | null
    language?: string | null
    promptShape?: 'markdown' | 'json' | 'toon' | null
    planReasoningEffort?: string | null
    runReasoningEffort?: string | null
    inputLanguage?: string | null
    outputLanguage?: string | null
  }
}

export interface MoveProjectWorkspaceRequest {
  actorToken?: string
  projectId?: string
  workspaceId?: string | null
}

export interface ProjectExportAttachmentInput {
  name?: string
  exportName?: string
  url?: string
  ownerId?: string
}

export interface ProjectExportTaskInput {
  taskId: string
  taskMarkdown?: string
  taskJson?: string
  taskToon?: string
  agentMarkdown?: string
  skillsMarkdown?: string
  attachments?: ProjectExportAttachmentInput[]
}

export interface ExportProjectWorkspaceRequest {
  actorToken?: string
  projectId?: string
  tasks?: ProjectExportTaskInput[]
}

export interface PaginatedResponse<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export interface ListPlannedGatewayTasksRequest {
  actorToken?: string
  page?: number
  pageSize?: number
  projectId?: string
}

export interface PlannedGatewayTaskRow {
  taskId: string
  projectId: string
  taskTitle: string
  taskStatus: string
  projectName: string
  projectDescription?: string
  gatewayPlanConversationId?: string
  gatewayId?: string
  runModel?: string
  language?: string
  runReasoningEffort?: string
  missing: Array<'gateway' | 'runModel'>
  runnable: boolean
  updatedAt: number
}

export interface ListRunningGatewayTasksRequest {
  actorToken?: string
  page?: number
  pageSize?: number
  group?: RunningGatewayGroupKey
  projectId?: string
}

export type RunningGatewayConversationType = 'plan' | 'run' | 'chat' | 'steer' | 'post-run'
export type RunningGatewayGroupKey = 'all' | 'planning' | 'running' | 'postRunning'

export interface RunningGatewayGroupCounts {
  all: number
  planning: number
  running: number
  postRunning: number
}

export interface RunningGatewayTaskRow {
  taskId: string
  projectId: string
  taskTitle: string
  taskStatus: string
  projectName: string
  projectDescription?: string
  gatewayConversationId: string
  source: 'gateway-plan' | 'gateway-run' | 'gateway-chat'
  conversationType: RunningGatewayConversationType
  liveStatus: 'queued' | 'running'
  latestAt: number
  latestActivitySummary: string
}

export interface RunningGatewayTasksResponse extends PaginatedResponse<RunningGatewayTaskRow> {
  group: RunningGatewayGroupKey
  counts: RunningGatewayGroupCounts
}

export interface AddTaskCommentRequest {
  actorToken?: string
  taskId?: string
  body?: string
  authorName?: string
}

export interface UpdateTaskSubtaskRequest {
  actorToken?: string
  id?: string
  title?: string
  status?: string
  sortOrder?: number
  payload?: Record<string, unknown>
}

export interface UpdateTaskCommentRequest {
  actorToken?: string
  taskId?: string
  commentId?: string
  body?: string
}

export interface RemoveTaskCommentRequest {
  actorToken?: string
  taskId?: string
  commentId?: string
}

export interface ExportTaskSnapshotRequest {
  actorToken?: string
  taskId?: string
  projectId?: string
  taskMarkdown?: string
  taskJson?: string
  taskToon?: string
  agentMarkdown?: string
  skillsMarkdown?: string
  attachments?: ProjectExportAttachmentInput[]
}

export interface RunTaskGatewayRequest {
  actorToken?: string
  taskId?: string
  projectId?: string
  zipName?: string
  zipBytes?: ArrayBuffer | Uint8Array | number[]
  taskMarkdown?: string
  taskJson?: string
  taskToon?: string
  agentMarkdown?: string
  skillsMarkdown?: string
  attachments?: ProjectExportAttachmentInput[]
  gatewayId?: string
  model?: string
  language?: string
  reasoningEffort?: string
  inputLanguage?: string
  outputLanguage?: string
  generalContext?: string
  generalPrompt?: string
  defaultOutput?: string
}

export interface GatewayChatSendRequest {
  actorToken?: string
  taskId?: string
  projectId?: string
  message?: string
  gatewayId?: string
  model?: string
  language?: string
  reasoningEffort?: string
  inputLanguage?: string
  outputLanguage?: string
  conversationId?: string
  includeTaskContext?: boolean
  mode?: 'chat' | 'plan' | 'steer'
  command?: {
    id?: 'chat' | 'plan' | 'steer'
    source?: 'slash' | 'button' | 'chip'
    label?: string
  }
  attachments?: Array<{ name: string; bytes: ArrayBuffer | Uint8Array | number[]; size?: number; mimeType?: string }>
  followUpContext?: string
}

export interface GatewayChatStopRequest {
  actorToken?: string
  taskId?: string
  conversationId?: string
}

export interface GatewayChatResolveRequest {
  actorToken?: string
  taskId?: string
  conversationId?: string
  resolution?: 'stopped' | 'completed' | 'failed'
}

export interface UpsertGatewayRequest {
  actorToken?: string
  id?: string
  name?: string
  endpoint?: string
  apiBaseUrl?: string
  token?: string
  clearToken?: boolean
  workspaceRoot?: string
  allowSelfSignedTls?: boolean
  disableDevicePairing?: boolean
  autoConnect?: boolean
  codexPath?: string
  provider?: 'codex_cli'
  codexExecutionMode?: 'terminal' | 'exec'
}

export interface WorkspaceRequest {
  actorToken?: string
  id?: string
  name?: string
  rootPath?: string
}

export interface DatabaseLocationState {
  currentFolderPath: string
  currentDbPath: string
  currentDbExists: boolean
  pendingFolderPath: string | null
  pendingDbPath: string | null
  pendingDbExists: boolean
  recommendedSourceDbPath: string | null
  restartRequired: boolean
}

export type WebServerStatus = 'starting' | 'running' | 'stopped' | 'error'

export interface WebServerLanAddress {
  address: string
  url: string | null
}

export interface WebServerStatusState {
  status: WebServerStatus
  host: string
  preferredPort: number
  actualPort: number | null
  url: string | null
  localUrl: string | null
  lanAddresses: WebServerLanAddress[]
  lanReachable: boolean
  lastError: string | null
  updatedAt: number
}

export interface OpenWebServerUrlRequest {
  actorToken?: string
  url?: string | null
}

export interface PickDatabaseFolderRequest {
  actorToken?: string
}

export interface PickDatabaseFolderResponse {
  folderPath: string | null
}

export interface PickDatabaseFileRequest {
  actorToken?: string
}

export interface PickDatabaseFileResponse {
  filePath: string | null
}

export interface MoveDatabaseLocationRequest {
  actorToken?: string
  folderPath?: string | null
  sourceDbPath?: string | null
}

export interface RevealDatabaseLocationRequest {
  actorToken?: string
  path?: string | null
}

export interface RouteContract {
  domain: ServiceDomain
  action: string
  method: string
  channel: IpcChannel
  requiresAuth: boolean
}

export interface ServiceMapEntry<TDomain extends ServiceDomain = ServiceDomain, TAction extends string = string>
  extends RouteContract {
  domain: TDomain
  action: TAction
  method: TAction
  channel: IpcChannel
  requiresAuth: boolean
}

export const SERVICE_MAP = {
  auth: ['login', 'refresh', 'logout', 'me', 'inviteValidate', 'updateProfile', 'updateAvatar', 'removeAvatar', 'changePassword'],
  projects: ['list', 'get', 'create', 'update', 'moveWorkspace', 'exportWorkspace', 'remove'],
  workspaces: ['list', 'create', 'update', 'remove', 'pickFolder'],
  appSettings: ['getActiveGateway', 'setActiveGateway', 'getDefaultAgent', 'setDefaultAgent', 'getDefaultAddTaskProject', 'setDefaultAddTaskProject', 'getGatewayLanguage', 'setGatewayLanguage', 'getPlannerQuestionAttention', 'setPlannerQuestionAttention', 'getDatabaseLocation', 'getWebServerStatus', 'openWebServerUrl', 'pickDatabaseFolder', 'pickDatabaseFile', 'moveDatabaseLocation', 'revealDatabaseLocation'],
  statuses: ['list', 'listTemplates', 'createTemplate', 'updateTemplate', 'removeTemplate', 'getProjectStatuses', 'updateProjectStatuses', 'applyTemplateToProject'],
  tasks: ['list', 'listPlannedGateway', 'listRunningGateway', 'get', 'create', 'update', 'remove', 'history', 'subtasksCreate', 'subtasksUpdate', 'subtasksRemove', 'tagsSet', 'commentAdd', 'commentUpdate', 'commentRemove', 'skillsSet', 'exportSnapshot', 'runGateway', 'planWithGateway', 'gatewayChatSend', 'gatewayChatStop', 'gatewayChatResolve', 'plannerContext', 'plannerValidateJson', 'plannerCreateFromJson', 'plannerUpdateFromJson', 'importJson'],
  taskTemplates: ['list', 'create', 'update', 'remove', 'importJson'],
  projectInstructionTemplates: ['list', 'create', 'update', 'remove'],
  attachments: ['upload'],
  agents: ['list', 'get', 'create', 'update', 'remove'],
  gateways: ['list', 'get', 'create', 'update', 'remove', 'status', 'sessions', 'commands', 'commandsHistory', 'gatewayModels', 'templates'],
  webhooks: ['list', 'create', 'update', 'remove'],
  skills: ['list', 'listPage', 'create', 'update', 'remove', 'listPacks'],
  organization: ['me', 'listMembers', 'createInvite'],
  projectGroups: ['list', 'create', 'update', 'remove'],
  planPipelines: ['list', 'listBatches', 'createFromGroups', 'updateState', 'updateBatch'],
  runPipelines: ['list', 'get', 'createManual', 'createFromPlanBatch', 'update', 'start', 'pause', 'resume', 'retryItem', 'skipItem', 'cancel'],
  pipelineStatus: ['snapshot', 'createWatchToken', 'revokeWatchToken'],
  customFields: ['list', 'create', 'update', 'remove', 'tagsList', 'tagsCreate', 'tagsUpdate', 'tagsRemove'],
  outputFormats: ['list', 'create', 'update', 'remove'],
  jobs: ['list', 'metrics']
} as const

type ServiceActionByDomain<TDomain extends ServiceDomain> = (typeof SERVICE_MAP)[TDomain][number]

export const SERVICE_ROUTING: {
  [K in ServiceDomain]: { [Action in ServiceActionByDomain<K>]: ServiceMapEntry<K, Action> }
} = {
  auth: {
    login: {
      domain: 'auth',
      action: 'login',
      method: 'login',
      channel: IPC_CHANNELS.auth.login,
      requiresAuth: false
    },
    refresh: {
      domain: 'auth',
      action: 'refresh',
      method: 'refresh',
      channel: IPC_CHANNELS.auth.refresh,
      requiresAuth: false
    },
    logout: {
      domain: 'auth',
      action: 'logout',
      method: 'logout',
      channel: IPC_CHANNELS.auth.logout,
      requiresAuth: true
    },
    me: {
      domain: 'auth',
      action: 'me',
      method: 'me',
      channel: IPC_CHANNELS.auth.me,
      requiresAuth: true
    },
    inviteValidate: {
      domain: 'auth',
      action: 'inviteValidate',
      method: 'inviteValidate',
      channel: IPC_CHANNELS.auth.inviteValidate,
      requiresAuth: false
    },
    updateProfile: {
      domain: 'auth',
      action: 'updateProfile',
      method: 'updateProfile',
      channel: IPC_CHANNELS.auth.updateProfile,
      requiresAuth: true
    },
    updateAvatar: {
      domain: 'auth',
      action: 'updateAvatar',
      method: 'updateAvatar',
      channel: IPC_CHANNELS.auth.updateAvatar,
      requiresAuth: true
    },
    removeAvatar: {
      domain: 'auth',
      action: 'removeAvatar',
      method: 'removeAvatar',
      channel: IPC_CHANNELS.auth.removeAvatar,
      requiresAuth: true
    },
    changePassword: {
      domain: 'auth',
      action: 'changePassword',
      method: 'changePassword',
      channel: IPC_CHANNELS.auth.changePassword,
      requiresAuth: true
    }
  },
  projects: {
    list: {
      domain: 'projects',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.projects.list,
      requiresAuth: true
    },
    get: {
      domain: 'projects',
      action: 'get',
      method: 'get',
      channel: IPC_CHANNELS.projects.get,
      requiresAuth: true
    },
    create: {
      domain: 'projects',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.projects.create,
      requiresAuth: true
    },
    update: {
      domain: 'projects',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.projects.update,
      requiresAuth: true
    },
    moveWorkspace: {
      domain: 'projects',
      action: 'moveWorkspace',
      method: 'moveWorkspace',
      channel: IPC_CHANNELS.projects.moveWorkspace,
      requiresAuth: true
    },
    exportWorkspace: {
      domain: 'projects',
      action: 'exportWorkspace',
      method: 'exportWorkspace',
      channel: IPC_CHANNELS.projects.exportWorkspace,
      requiresAuth: true
    },
    remove: {
      domain: 'projects',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.projects.remove,
      requiresAuth: true
    }
  },
  workspaces: {
    list: {
      domain: 'workspaces',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.workspaces.list,
      requiresAuth: true
    },
    create: {
      domain: 'workspaces',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.workspaces.create,
      requiresAuth: true
    },
    update: {
      domain: 'workspaces',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.workspaces.update,
      requiresAuth: true
    },
    remove: {
      domain: 'workspaces',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.workspaces.remove,
      requiresAuth: true
    },
    pickFolder: {
      domain: 'workspaces',
      action: 'pickFolder',
      method: 'pickFolder',
      channel: IPC_CHANNELS.workspaces.pickFolder,
      requiresAuth: true
    }
  },
  appSettings: {
    getActiveGateway: {
      domain: 'appSettings',
      action: 'getActiveGateway',
      method: 'getActiveGateway',
      channel: IPC_CHANNELS.appSettings.getActiveGateway,
      requiresAuth: true
    },
    setActiveGateway: {
      domain: 'appSettings',
      action: 'setActiveGateway',
      method: 'setActiveGateway',
      channel: IPC_CHANNELS.appSettings.setActiveGateway,
      requiresAuth: true
    },
    getDefaultAgent: {
      domain: 'appSettings',
      action: 'getDefaultAgent',
      method: 'getDefaultAgent',
      channel: IPC_CHANNELS.appSettings.getDefaultAgent,
      requiresAuth: true
    },
    setDefaultAgent: {
      domain: 'appSettings',
      action: 'setDefaultAgent',
      method: 'setDefaultAgent',
      channel: IPC_CHANNELS.appSettings.setDefaultAgent,
      requiresAuth: true
    },
    getDefaultAddTaskProject: {
      domain: 'appSettings',
      action: 'getDefaultAddTaskProject',
      method: 'getDefaultAddTaskProject',
      channel: IPC_CHANNELS.appSettings.getDefaultAddTaskProject,
      requiresAuth: true
    },
    setDefaultAddTaskProject: {
      domain: 'appSettings',
      action: 'setDefaultAddTaskProject',
      method: 'setDefaultAddTaskProject',
      channel: IPC_CHANNELS.appSettings.setDefaultAddTaskProject,
      requiresAuth: true
    },
    getGatewayLanguage: {
      domain: 'appSettings',
      action: 'getGatewayLanguage',
      method: 'getGatewayLanguage',
      channel: IPC_CHANNELS.appSettings.getGatewayLanguage,
      requiresAuth: true
    },
    setGatewayLanguage: {
      domain: 'appSettings',
      action: 'setGatewayLanguage',
      method: 'setGatewayLanguage',
      channel: IPC_CHANNELS.appSettings.setGatewayLanguage,
      requiresAuth: true
    },
    getPlannerQuestionAttention: {
      domain: 'appSettings',
      action: 'getPlannerQuestionAttention',
      method: 'getPlannerQuestionAttention',
      channel: IPC_CHANNELS.appSettings.getPlannerQuestionAttention,
      requiresAuth: true
    },
    setPlannerQuestionAttention: {
      domain: 'appSettings',
      action: 'setPlannerQuestionAttention',
      method: 'setPlannerQuestionAttention',
      channel: IPC_CHANNELS.appSettings.setPlannerQuestionAttention,
      requiresAuth: true
    },
    getDatabaseLocation: {
      domain: 'appSettings',
      action: 'getDatabaseLocation',
      method: 'getDatabaseLocation',
      channel: IPC_CHANNELS.appSettings.getDatabaseLocation,
      requiresAuth: true
    },
    getWebServerStatus: {
      domain: 'appSettings',
      action: 'getWebServerStatus',
      method: 'getWebServerStatus',
      channel: IPC_CHANNELS.appSettings.getWebServerStatus,
      requiresAuth: true
    },
    openWebServerUrl: {
      domain: 'appSettings',
      action: 'openWebServerUrl',
      method: 'openWebServerUrl',
      channel: IPC_CHANNELS.appSettings.openWebServerUrl,
      requiresAuth: true
    },
    pickDatabaseFolder: {
      domain: 'appSettings',
      action: 'pickDatabaseFolder',
      method: 'pickDatabaseFolder',
      channel: IPC_CHANNELS.appSettings.pickDatabaseFolder,
      requiresAuth: true
    },
    pickDatabaseFile: {
      domain: 'appSettings',
      action: 'pickDatabaseFile',
      method: 'pickDatabaseFile',
      channel: IPC_CHANNELS.appSettings.pickDatabaseFile,
      requiresAuth: true
    },
    moveDatabaseLocation: {
      domain: 'appSettings',
      action: 'moveDatabaseLocation',
      method: 'moveDatabaseLocation',
      channel: IPC_CHANNELS.appSettings.moveDatabaseLocation,
      requiresAuth: true
    },
    revealDatabaseLocation: {
      domain: 'appSettings',
      action: 'revealDatabaseLocation',
      method: 'revealDatabaseLocation',
      channel: IPC_CHANNELS.appSettings.revealDatabaseLocation,
      requiresAuth: true
    }
  },
  statuses: {
    list: {
      domain: 'statuses',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.statuses.list,
      requiresAuth: true
    },
    listTemplates: {
      domain: 'statuses',
      action: 'listTemplates',
      method: 'listTemplates',
      channel: IPC_CHANNELS.statuses.listTemplates,
      requiresAuth: true
    },
    createTemplate: {
      domain: 'statuses',
      action: 'createTemplate',
      method: 'createTemplate',
      channel: IPC_CHANNELS.statuses.createTemplate,
      requiresAuth: true
    },
    updateTemplate: {
      domain: 'statuses',
      action: 'updateTemplate',
      method: 'updateTemplate',
      channel: IPC_CHANNELS.statuses.updateTemplate,
      requiresAuth: true
    },
    removeTemplate: {
      domain: 'statuses',
      action: 'removeTemplate',
      method: 'removeTemplate',
      channel: IPC_CHANNELS.statuses.removeTemplate,
      requiresAuth: true
    },
    getProjectStatuses: {
      domain: 'statuses',
      action: 'getProjectStatuses',
      method: 'getProjectStatuses',
      channel: IPC_CHANNELS.statuses.getProjectStatuses,
      requiresAuth: true
    },
    updateProjectStatuses: {
      domain: 'statuses',
      action: 'updateProjectStatuses',
      method: 'updateProjectStatuses',
      channel: IPC_CHANNELS.statuses.updateProjectStatuses,
      requiresAuth: true
    },
    applyTemplateToProject: {
      domain: 'statuses',
      action: 'applyTemplateToProject',
      method: 'applyTemplateToProject',
      channel: IPC_CHANNELS.statuses.applyTemplateToProject,
      requiresAuth: true
    }
  },
  tasks: {
    list: {
      domain: 'tasks',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.tasks.list,
      requiresAuth: true
    },
    listPlannedGateway: {
      domain: 'tasks',
      action: 'listPlannedGateway',
      method: 'listPlannedGateway',
      channel: IPC_CHANNELS.tasks.listPlannedGateway,
      requiresAuth: true
    },
    listRunningGateway: {
      domain: 'tasks',
      action: 'listRunningGateway',
      method: 'listRunningGateway',
      channel: IPC_CHANNELS.tasks.listRunningGateway,
      requiresAuth: true
    },
    get: {
      domain: 'tasks',
      action: 'get',
      method: 'get',
      channel: IPC_CHANNELS.tasks.get,
      requiresAuth: true
    },
    create: {
      domain: 'tasks',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.tasks.create,
      requiresAuth: true
    },
    update: {
      domain: 'tasks',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.tasks.update,
      requiresAuth: true
    },
    remove: {
      domain: 'tasks',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.tasks.remove,
      requiresAuth: true
    },
    history: {
      domain: 'tasks',
      action: 'history',
      method: 'history',
      channel: IPC_CHANNELS.tasks.history,
      requiresAuth: true
    },
    subtasksCreate: {
      domain: 'tasks',
      action: 'subtasksCreate',
      method: 'subtasksCreate',
      channel: IPC_CHANNELS.tasks.subtasksCreate,
      requiresAuth: true
    },
    subtasksUpdate: {
      domain: 'tasks',
      action: 'subtasksUpdate',
      method: 'subtasksUpdate',
      channel: IPC_CHANNELS.tasks.subtasksUpdate,
      requiresAuth: true
    },
    subtasksRemove: {
      domain: 'tasks',
      action: 'subtasksRemove',
      method: 'subtasksRemove',
      channel: IPC_CHANNELS.tasks.subtasksRemove,
      requiresAuth: true
    },
    tagsSet: {
      domain: 'tasks',
      action: 'tagsSet',
      method: 'tagsSet',
      channel: IPC_CHANNELS.tasks.tagsSet,
      requiresAuth: true
    },
    commentAdd: {
      domain: 'tasks',
      action: 'commentAdd',
      method: 'commentAdd',
      channel: IPC_CHANNELS.tasks.commentAdd,
      requiresAuth: true
    },
    commentUpdate: {
      domain: 'tasks',
      action: 'commentUpdate',
      method: 'commentUpdate',
      channel: IPC_CHANNELS.tasks.commentUpdate,
      requiresAuth: true
    },
    commentRemove: {
      domain: 'tasks',
      action: 'commentRemove',
      method: 'commentRemove',
      channel: IPC_CHANNELS.tasks.commentRemove,
      requiresAuth: true
    },
    skillsSet: {
      domain: 'tasks',
      action: 'skillsSet',
      method: 'skillsSet',
      channel: IPC_CHANNELS.tasks.skillsSet,
      requiresAuth: true
    },
    exportSnapshot: {
      domain: 'tasks',
      action: 'exportSnapshot',
      method: 'exportSnapshot',
      channel: IPC_CHANNELS.tasks.exportSnapshot,
      requiresAuth: true
    },
    runGateway: {
      domain: 'tasks',
      action: 'runGateway',
      method: 'runGateway',
      channel: IPC_CHANNELS.tasks.runGateway,
      requiresAuth: true
    },
    planWithGateway: {
      domain: 'tasks',
      action: 'planWithGateway',
      method: 'planWithGateway',
      channel: IPC_CHANNELS.tasks.planWithGateway,
      requiresAuth: true
    },
    gatewayChatSend: {
      domain: 'tasks',
      action: 'gatewayChatSend',
      method: 'gatewayChatSend',
      channel: IPC_CHANNELS.tasks.gatewayChatSend,
      requiresAuth: true
    },
    gatewayChatStop: {
      domain: 'tasks',
      action: 'gatewayChatStop',
      method: 'gatewayChatStop',
      channel: IPC_CHANNELS.tasks.gatewayChatStop,
      requiresAuth: true
    },
    gatewayChatResolve: {
      domain: 'tasks',
      action: 'gatewayChatResolve',
      method: 'gatewayChatResolve',
      channel: IPC_CHANNELS.tasks.gatewayChatResolve,
      requiresAuth: true
    },
    plannerContext: {
      domain: 'tasks',
      action: 'plannerContext',
      method: 'plannerContext',
      channel: IPC_CHANNELS.tasks.plannerContext,
      requiresAuth: true
    },
    plannerValidateJson: {
      domain: 'tasks',
      action: 'plannerValidateJson',
      method: 'plannerValidateJson',
      channel: IPC_CHANNELS.tasks.plannerValidateJson,
      requiresAuth: true
    },
    plannerCreateFromJson: {
      domain: 'tasks',
      action: 'plannerCreateFromJson',
      method: 'plannerCreateFromJson',
      channel: IPC_CHANNELS.tasks.plannerCreateFromJson,
      requiresAuth: true
    },
    plannerUpdateFromJson: {
      domain: 'tasks',
      action: 'plannerUpdateFromJson',
      method: 'plannerUpdateFromJson',
      channel: IPC_CHANNELS.tasks.plannerUpdateFromJson,
      requiresAuth: true
    },
    importJson: {
      domain: 'tasks',
      action: 'importJson',
      method: 'importJson',
      channel: IPC_CHANNELS.tasks.importJson,
      requiresAuth: true
    }
  },
  taskTemplates: {
    list: {
      domain: 'taskTemplates',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.taskTemplates.list,
      requiresAuth: true
    },
    create: {
      domain: 'taskTemplates',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.taskTemplates.create,
      requiresAuth: true
    },
    update: {
      domain: 'taskTemplates',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.taskTemplates.update,
      requiresAuth: true
    },
    remove: {
      domain: 'taskTemplates',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.taskTemplates.remove,
      requiresAuth: true
    },
    importJson: {
      domain: 'taskTemplates',
      action: 'importJson',
      method: 'importJson',
      channel: IPC_CHANNELS.taskTemplates.importJson,
      requiresAuth: true
    }
  },
  projectInstructionTemplates: {
    list: {
      domain: 'projectInstructionTemplates',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.projectInstructionTemplates.list,
      requiresAuth: true
    },
    create: {
      domain: 'projectInstructionTemplates',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.projectInstructionTemplates.create,
      requiresAuth: true
    },
    update: {
      domain: 'projectInstructionTemplates',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.projectInstructionTemplates.update,
      requiresAuth: true
    },
    remove: {
      domain: 'projectInstructionTemplates',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.projectInstructionTemplates.remove,
      requiresAuth: true
    }
  },
  attachments: {
    upload: {
      domain: 'attachments',
      action: 'upload',
      method: 'upload',
      channel: IPC_CHANNELS.attachments.upload,
      requiresAuth: true
    }
  },
  agents: {
    list: {
      domain: 'agents',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.agents.list,
      requiresAuth: true
    },
    get: {
      domain: 'agents',
      action: 'get',
      method: 'get',
      channel: IPC_CHANNELS.agents.get,
      requiresAuth: true
    },
    create: {
      domain: 'agents',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.agents.create,
      requiresAuth: true
    },
    update: {
      domain: 'agents',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.agents.update,
      requiresAuth: true
    },
    remove: {
      domain: 'agents',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.agents.remove,
      requiresAuth: true
    }
  },
  gateways: {
    list: {
      domain: 'gateways',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.gateways.list,
      requiresAuth: true
    },
    get: {
      domain: 'gateways',
      action: 'get',
      method: 'get',
      channel: IPC_CHANNELS.gateways.get,
      requiresAuth: true
    },
    create: {
      domain: 'gateways',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.gateways.create,
      requiresAuth: true
    },
    update: {
      domain: 'gateways',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.gateways.update,
      requiresAuth: true
    },
    remove: {
      domain: 'gateways',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.gateways.remove,
      requiresAuth: true
    },
    status: {
      domain: 'gateways',
      action: 'status',
      method: 'status',
      channel: IPC_CHANNELS.gateways.status,
      requiresAuth: true
    },
    sessions: {
      domain: 'gateways',
      action: 'sessions',
      method: 'sessions',
      channel: IPC_CHANNELS.gateways.sessions,
      requiresAuth: true
    },
    commands: {
      domain: 'gateways',
      action: 'commands',
      method: 'commands',
      channel: IPC_CHANNELS.gateways.commands,
      requiresAuth: true
    },
    commandsHistory: {
      domain: 'gateways',
      action: 'commandsHistory',
      method: 'commandsHistory',
      channel: IPC_CHANNELS.gateways.commandsHistory,
      requiresAuth: true
    },
    gatewayModels: {
      domain: 'gateways',
      action: 'gatewayModels',
      method: 'gatewayModels',
      channel: IPC_CHANNELS.gateways.gatewayModels,
      requiresAuth: true
    },
    templates: {
      domain: 'gateways',
      action: 'templates',
      method: 'templates',
      channel: IPC_CHANNELS.gateways.templates,
      requiresAuth: true
    }
  },
  webhooks: {
    list: {
      domain: 'webhooks',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.webhooks.list,
      requiresAuth: true
    },
    create: {
      domain: 'webhooks',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.webhooks.create,
      requiresAuth: true
    },
    update: {
      domain: 'webhooks',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.webhooks.update,
      requiresAuth: true
    },
    remove: {
      domain: 'webhooks',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.webhooks.remove,
      requiresAuth: true
    }
  },
  skills: {
    list: {
      domain: 'skills',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.skills.list,
      requiresAuth: true
    },
    listPage: {
      domain: 'skills',
      action: 'listPage',
      method: 'listPage',
      channel: IPC_CHANNELS.skills.listPage,
      requiresAuth: true
    },
    create: {
      domain: 'skills',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.skills.create,
      requiresAuth: true
    },
    update: {
      domain: 'skills',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.skills.update,
      requiresAuth: true
    },
    remove: {
      domain: 'skills',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.skills.remove,
      requiresAuth: true
    },
    listPacks: {
      domain: 'skills',
      action: 'listPacks',
      method: 'listPacks',
      channel: IPC_CHANNELS.skills.listPacks,
      requiresAuth: true
    }
  },
  organization: {
    me: {
      domain: 'organization',
      action: 'me',
      method: 'me',
      channel: IPC_CHANNELS.organization.me,
      requiresAuth: true
    },
    listMembers: {
      domain: 'organization',
      action: 'listMembers',
      method: 'listMembers',
      channel: IPC_CHANNELS.organization.listMembers,
      requiresAuth: true
    },
    createInvite: {
      domain: 'organization',
      action: 'createInvite',
      method: 'createInvite',
      channel: IPC_CHANNELS.organization.createInvite,
      requiresAuth: true
    }
  },
  projectGroups: {
    list: {
      domain: 'projectGroups',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.projectGroups.list,
      requiresAuth: true
    },
    create: {
      domain: 'projectGroups',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.projectGroups.create,
      requiresAuth: true
    },
    update: {
      domain: 'projectGroups',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.projectGroups.update,
      requiresAuth: true
    },
    remove: {
      domain: 'projectGroups',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.projectGroups.remove,
      requiresAuth: true
    }
  },
  planPipelines: {
    list: {
      domain: 'planPipelines',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.planPipelines.list,
      requiresAuth: true
    },
    listBatches: {
      domain: 'planPipelines',
      action: 'listBatches',
      method: 'listBatches',
      channel: IPC_CHANNELS.planPipelines.listBatches,
      requiresAuth: true
    },
    createFromGroups: {
      domain: 'planPipelines',
      action: 'createFromGroups',
      method: 'createFromGroups',
      channel: IPC_CHANNELS.planPipelines.createFromGroups,
      requiresAuth: true
    },
    updateState: {
      domain: 'planPipelines',
      action: 'updateState',
      method: 'updateState',
      channel: IPC_CHANNELS.planPipelines.updateState,
      requiresAuth: true
    },
    updateBatch: {
      domain: 'planPipelines',
      action: 'updateBatch',
      method: 'updateBatch',
      channel: IPC_CHANNELS.planPipelines.updateBatch,
      requiresAuth: true
    }
  },
  runPipelines: {
    list: {
      domain: 'runPipelines',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.runPipelines.list,
      requiresAuth: true
    },
    get: {
      domain: 'runPipelines',
      action: 'get',
      method: 'get',
      channel: IPC_CHANNELS.runPipelines.get,
      requiresAuth: true
    },
    createManual: {
      domain: 'runPipelines',
      action: 'createManual',
      method: 'createManual',
      channel: IPC_CHANNELS.runPipelines.createManual,
      requiresAuth: true
    },
    createFromPlanBatch: {
      domain: 'runPipelines',
      action: 'createFromPlanBatch',
      method: 'createFromPlanBatch',
      channel: IPC_CHANNELS.runPipelines.createFromPlanBatch,
      requiresAuth: true
    },
    update: {
      domain: 'runPipelines',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.runPipelines.update,
      requiresAuth: true
    },
    start: {
      domain: 'runPipelines',
      action: 'start',
      method: 'start',
      channel: IPC_CHANNELS.runPipelines.start,
      requiresAuth: true
    },
    pause: {
      domain: 'runPipelines',
      action: 'pause',
      method: 'pause',
      channel: IPC_CHANNELS.runPipelines.pause,
      requiresAuth: true
    },
    resume: {
      domain: 'runPipelines',
      action: 'resume',
      method: 'resume',
      channel: IPC_CHANNELS.runPipelines.resume,
      requiresAuth: true
    },
    retryItem: {
      domain: 'runPipelines',
      action: 'retryItem',
      method: 'retryItem',
      channel: IPC_CHANNELS.runPipelines.retryItem,
      requiresAuth: true
    },
    skipItem: {
      domain: 'runPipelines',
      action: 'skipItem',
      method: 'skipItem',
      channel: IPC_CHANNELS.runPipelines.skipItem,
      requiresAuth: true
    },
    cancel: {
      domain: 'runPipelines',
      action: 'cancel',
      method: 'cancel',
      channel: IPC_CHANNELS.runPipelines.cancel,
      requiresAuth: true
    }
  },
  pipelineStatus: {
    snapshot: {
      domain: 'pipelineStatus',
      action: 'snapshot',
      method: 'snapshot',
      channel: IPC_CHANNELS.pipelineStatus.snapshot,
      requiresAuth: true
    },
    createWatchToken: {
      domain: 'pipelineStatus',
      action: 'createWatchToken',
      method: 'createWatchToken',
      channel: IPC_CHANNELS.pipelineStatus.createWatchToken,
      requiresAuth: true
    },
    revokeWatchToken: {
      domain: 'pipelineStatus',
      action: 'revokeWatchToken',
      method: 'revokeWatchToken',
      channel: IPC_CHANNELS.pipelineStatus.revokeWatchToken,
      requiresAuth: true
    }
  },
  customFields: {
    list: {
      domain: 'customFields',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.customFields.list,
      requiresAuth: true
    },
    create: {
      domain: 'customFields',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.customFields.create,
      requiresAuth: true
    },
    update: {
      domain: 'customFields',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.customFields.update,
      requiresAuth: true
    },
    remove: {
      domain: 'customFields',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.customFields.remove,
      requiresAuth: true
    },
    tagsList: {
      domain: 'customFields',
      action: 'tagsList',
      method: 'tagsList',
      channel: IPC_CHANNELS.customFields.tagsList,
      requiresAuth: true
    },
    tagsCreate: {
      domain: 'customFields',
      action: 'tagsCreate',
      method: 'tagsCreate',
      channel: IPC_CHANNELS.customFields.tagsCreate,
      requiresAuth: true
    },
    tagsUpdate: {
      domain: 'customFields',
      action: 'tagsUpdate',
      method: 'tagsUpdate',
      channel: IPC_CHANNELS.customFields.tagsUpdate,
      requiresAuth: true
    },
    tagsRemove: {
      domain: 'customFields',
      action: 'tagsRemove',
      method: 'tagsRemove',
      channel: IPC_CHANNELS.customFields.tagsRemove,
      requiresAuth: true
    }
  },
  outputFormats: {
    list: {
      domain: 'outputFormats',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.outputFormats.list,
      requiresAuth: true
    },
    create: {
      domain: 'outputFormats',
      action: 'create',
      method: 'create',
      channel: IPC_CHANNELS.outputFormats.create,
      requiresAuth: true
    },
    update: {
      domain: 'outputFormats',
      action: 'update',
      method: 'update',
      channel: IPC_CHANNELS.outputFormats.update,
      requiresAuth: true
    },
    remove: {
      domain: 'outputFormats',
      action: 'remove',
      method: 'remove',
      channel: IPC_CHANNELS.outputFormats.remove,
      requiresAuth: true
    }
  },
  jobs: {
    list: {
      domain: 'jobs',
      action: 'list',
      method: 'list',
      channel: IPC_CHANNELS.jobs.list,
      requiresAuth: true
    },
    metrics: {
      domain: 'jobs',
      action: 'metrics',
      method: 'metrics',
      channel: IPC_CHANNELS.jobs.metrics,
      requiresAuth: true
    }
  }
}
