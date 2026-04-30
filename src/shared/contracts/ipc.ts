export const IPC_CHANNELS = {
  auth: {
    login: 'auth:login',
    logout: 'auth:logout',
    me: 'auth:me',
    inviteValidate: 'auth:invite-validate',
    updateProfile: 'auth:update-profile'
  },
  projects: {
    list: 'projects:list',
    get: 'projects:get',
    create: 'projects:create',
    update: 'projects:update',
    moveWorkspace: 'projects:move-workspace',
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
    setActiveGateway: 'app-settings:set-active-gateway'
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
    skillsSet: 'tasks:skills:set'
  },
  taskTemplates: {
    list: 'task-templates:list',
    create: 'task-templates:create',
    update: 'task-templates:update',
    remove: 'task-templates:remove'
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
    templates: 'gateways:templates',
    sendCommand: 'gateways:send-command',
    connect: 'gateways:connect',
    disconnect: 'gateways:disconnect',
    pairDevice: 'gateways:pair-device',
    resetPairing: 'gateways:reset-pairing',
    testConnection: 'gateways:test-connection',
    testMessage: 'gateways:test-message',
    rpcMethods: 'gateways:rpc-methods',
    rpcCall: 'gateways:rpc-call',
    chatSend: 'gateways:chat-send',
    chatHistory: 'gateways:chat-history',
    sessionsPatch: 'gateways:sessions-patch',
    sessionsDelete: 'gateways:sessions-delete',
    openClawBoards: 'gateways:openclaw-boards',
    openClawAgents: 'gateways:openclaw-agents',
    openClawSkills: 'gateways:openclaw-skills',
    openClawTags: 'gateways:openclaw-tags'
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
    gatewayStatus: 'events:gateway-status',
    taskUpdated: 'events:task-updated',
    jobProgress: 'events:job-progress'
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
}

export interface MoveProjectWorkspaceRequest {
  actorToken?: string
  projectId?: string
  workspaceId?: string | null
}

export interface PaginatedResponse<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
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
}

export interface WorkspaceRequest {
  actorToken?: string
  id?: string
  name?: string
  rootPath?: string
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
  auth: ['login', 'logout', 'me', 'inviteValidate', 'updateProfile'],
  projects: ['list', 'get', 'create', 'update', 'moveWorkspace', 'remove'],
  workspaces: ['list', 'create', 'update', 'remove', 'pickFolder'],
  appSettings: ['getActiveGateway', 'setActiveGateway'],
  statuses: ['list', 'listTemplates', 'createTemplate', 'updateTemplate', 'removeTemplate', 'getProjectStatuses', 'updateProjectStatuses', 'applyTemplateToProject'],
  tasks: ['list', 'get', 'create', 'update', 'remove', 'history', 'subtasksCreate', 'subtasksUpdate', 'subtasksRemove', 'tagsSet', 'commentAdd', 'commentUpdate', 'commentRemove', 'skillsSet'],
  taskTemplates: ['list', 'create', 'update', 'remove'],
  attachments: ['upload'],
  agents: ['list', 'get', 'create', 'update', 'remove'],
  gateways: ['list', 'get', 'create', 'update', 'remove', 'status', 'sessions', 'commands', 'commandsHistory', 'templates', 'sendCommand', 'connect', 'disconnect', 'pairDevice', 'resetPairing', 'testConnection', 'testMessage', 'rpcMethods', 'rpcCall', 'chatSend', 'chatHistory', 'sessionsPatch', 'sessionsDelete', 'openClawBoards', 'openClawAgents', 'openClawSkills', 'openClawTags'],
  webhooks: ['list', 'create', 'update', 'remove'],
  skills: ['list', 'listPage', 'create', 'update', 'remove', 'listPacks'],
  organization: ['me', 'listMembers', 'createInvite'],
  projectGroups: ['list', 'create', 'update', 'remove'],
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
    templates: {
      domain: 'gateways',
      action: 'templates',
      method: 'templates',
      channel: IPC_CHANNELS.gateways.templates,
      requiresAuth: true
    },
    sendCommand: {
      domain: 'gateways',
      action: 'sendCommand',
      method: 'sendCommand',
      channel: IPC_CHANNELS.gateways.sendCommand,
      requiresAuth: true
    },
    connect: {
      domain: 'gateways',
      action: 'connect',
      method: 'connect',
      channel: IPC_CHANNELS.gateways.connect,
      requiresAuth: true
    },
    disconnect: {
      domain: 'gateways',
      action: 'disconnect',
      method: 'disconnect',
      channel: IPC_CHANNELS.gateways.disconnect,
      requiresAuth: true
    },
    pairDevice: {
      domain: 'gateways',
      action: 'pairDevice',
      method: 'pairDevice',
      channel: IPC_CHANNELS.gateways.pairDevice,
      requiresAuth: true
    },
    resetPairing: {
      domain: 'gateways',
      action: 'resetPairing',
      method: 'resetPairing',
      channel: IPC_CHANNELS.gateways.resetPairing,
      requiresAuth: true
    },
    testConnection: {
      domain: 'gateways',
      action: 'testConnection',
      method: 'testConnection',
      channel: IPC_CHANNELS.gateways.testConnection,
      requiresAuth: true
    },
    testMessage: {
      domain: 'gateways',
      action: 'testMessage',
      method: 'testMessage',
      channel: IPC_CHANNELS.gateways.testMessage,
      requiresAuth: true
    },
    rpcMethods: {
      domain: 'gateways',
      action: 'rpcMethods',
      method: 'rpcMethods',
      channel: IPC_CHANNELS.gateways.rpcMethods,
      requiresAuth: true
    },
    rpcCall: {
      domain: 'gateways',
      action: 'rpcCall',
      method: 'rpcCall',
      channel: IPC_CHANNELS.gateways.rpcCall,
      requiresAuth: true
    },
    chatSend: {
      domain: 'gateways',
      action: 'chatSend',
      method: 'chatSend',
      channel: IPC_CHANNELS.gateways.chatSend,
      requiresAuth: true
    },
    chatHistory: {
      domain: 'gateways',
      action: 'chatHistory',
      method: 'chatHistory',
      channel: IPC_CHANNELS.gateways.chatHistory,
      requiresAuth: true
    },
    sessionsPatch: {
      domain: 'gateways',
      action: 'sessionsPatch',
      method: 'sessionsPatch',
      channel: IPC_CHANNELS.gateways.sessionsPatch,
      requiresAuth: true
    },
    sessionsDelete: {
      domain: 'gateways',
      action: 'sessionsDelete',
      method: 'sessionsDelete',
      channel: IPC_CHANNELS.gateways.sessionsDelete,
      requiresAuth: true
    },
    openClawBoards: {
      domain: 'gateways',
      action: 'openClawBoards',
      method: 'openClawBoards',
      channel: IPC_CHANNELS.gateways.openClawBoards,
      requiresAuth: true
    },
    openClawAgents: {
      domain: 'gateways',
      action: 'openClawAgents',
      method: 'openClawAgents',
      channel: IPC_CHANNELS.gateways.openClawAgents,
      requiresAuth: true
    },
    openClawSkills: {
      domain: 'gateways',
      action: 'openClawSkills',
      method: 'openClawSkills',
      channel: IPC_CHANNELS.gateways.openClawSkills,
      requiresAuth: true
    },
    openClawTags: {
      domain: 'gateways',
      action: 'openClawTags',
      method: 'openClawTags',
      channel: IPC_CHANNELS.gateways.openClawTags,
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
