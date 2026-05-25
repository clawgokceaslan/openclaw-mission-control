import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { Agent, Gateway, Project } from '../../shared/types/entities.js'
import { AppSettingsRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { getDatabaseLocationState, moveDatabaseToFolder } from '../../db/config.js'
import { AuthService } from './auth.service.js'
import { DEFAULT_GATEWAY_LANGUAGE, normalizeGatewayLanguage, type GatewayLanguage } from '../../shared/utils/gateway-language.js'
import {
  DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR,
  normalizePlannerQuestionAttentionBehavior,
  type PlannerQuestionAttentionBehavior
} from '../../shared/utils/planner-question-attention.js'
import {
  DEFAULT_ALERT_SOUND_SETTINGS,
  normalizeAlertSoundSettings,
  type AlertSoundSettings
} from '../../shared/utils/alert-sound-settings.js'
import { electronRuntime } from '../utils/electron-runtime.js'
import type { DatabaseLocationState, WebServerStatusState } from '../../shared/contracts/ipc.js'
import { getInternalHttpServerStatus } from '../internal-api/http-server.js'

const ACTIVE_GATEWAY_KEY = 'activeGatewayId'
const DEFAULT_AGENT_KEY = 'defaultAgentId'
const DEFAULT_ADD_TASK_PROJECT_KEY = 'defaultAddTaskProjectId'
const GATEWAY_LANGUAGE_KEY = 'gatewayLanguage'
const PLANNER_QUESTION_ATTENTION_KEY = 'plannerQuestionAttention'
const ALERT_SOUND_SETTINGS_KEY = 'alertSoundSettings'

export class AppSettingsService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: AppSettingsRepository,
    private readonly gateways: GatewayRepository,
    private readonly agents: AgentRepository,
    private readonly projects: ProjectRepository
  ) {}

  async getActiveGateway(payload: { actorToken?: string }): Promise<ServiceResponse<{ gatewayId: string | null; gateway?: Gateway | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const gatewayId = await this.repo.get<string | null>(actor.user.organizationId, ACTIVE_GATEWAY_KEY)
    if (!gatewayId) return okResponse({ gatewayId: null, gateway: null })
    const gateway = await this.gateways.get(gatewayId)
    if (!gateway || gateway.organizationId !== actor.user.organizationId) {
      await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, null)
      return okResponse({ gatewayId: null, gateway: null })
    }
    return okResponse({ gatewayId, gateway })
  }

  async setActiveGateway(payload: { actorToken?: string; gatewayId?: string | null }): Promise<ServiceResponse<{ gatewayId: string | null; gateway?: Gateway | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const gatewayId = payload.gatewayId || null
    if (!gatewayId) {
      await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, null)
      return okResponse({ gatewayId: null, gateway: null })
    }
    const gateway = await this.gateways.get(gatewayId)
    if (!gateway) return errorResponse(ErrorCodes.NotFound, 'Gateway not found')
    if (gateway.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, gateway.id)
    return okResponse({ gatewayId: gateway.id, gateway })
  }

  async getDefaultAgent(payload: { actorToken?: string }): Promise<ServiceResponse<{ agentId: string | null; agent?: Agent | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const agentId = await this.repo.get<string | null>(actor.user.organizationId, DEFAULT_AGENT_KEY)
    if (!agentId) return okResponse({ agentId: null, agent: null })
    const agent = await this.agents.get(agentId)
    if (!agent || agent.organizationId !== actor.user.organizationId) {
      await this.repo.set(actor.user.organizationId, DEFAULT_AGENT_KEY, null)
      return okResponse({ agentId: null, agent: null })
    }
    return okResponse({ agentId, agent })
  }

  async setDefaultAgent(payload: { actorToken?: string; agentId?: string | null }): Promise<ServiceResponse<{ agentId: string | null; agent?: Agent | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const agentId = payload.agentId || null
    if (!agentId) {
      await this.repo.set(actor.user.organizationId, DEFAULT_AGENT_KEY, null)
      return okResponse({ agentId: null, agent: null })
    }
    const agent = await this.agents.get(agentId)
    if (!agent) return errorResponse(ErrorCodes.NotFound, 'Agent not found')
    if (agent.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.set(actor.user.organizationId, DEFAULT_AGENT_KEY, agent.id)
    return okResponse({ agentId: agent.id, agent })
  }

  async getDefaultAddTaskProject(payload: { actorToken?: string }): Promise<ServiceResponse<{ projectId: string | null; project?: Project | null; fallbackProject?: Project | null; invalidStoredProjectId?: string | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const organizationId = actor.user.organizationId
    const projectId = await this.repo.get<string | null>(organizationId, DEFAULT_ADD_TASK_PROJECT_KEY)
    const rows = await this.projects.list(organizationId)
    const fallbackProject = rows.find((project) => !project.archived) ?? null
    if (!projectId) return okResponse({ projectId: null, project: null, fallbackProject, invalidStoredProjectId: null })
    const project = await this.projects.get(projectId)
    if (!project || project.organizationId !== organizationId || project.archived) {
      await this.repo.set(organizationId, DEFAULT_ADD_TASK_PROJECT_KEY, null)
      return okResponse({ projectId: null, project: null, fallbackProject, invalidStoredProjectId: projectId })
    }
    return okResponse({ projectId: project.id, project, fallbackProject, invalidStoredProjectId: null })
  }

  async setDefaultAddTaskProject(payload: { actorToken?: string; projectId?: string | null }): Promise<ServiceResponse<{ projectId: string | null; project?: Project | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const organizationId = actor.user.organizationId
    const projectId = payload.projectId || null
    if (!projectId) {
      await this.repo.set(organizationId, DEFAULT_ADD_TASK_PROJECT_KEY, null)
      return okResponse({ projectId: null, project: null })
    }
    const project = await this.projects.get(projectId)
    if (!project) return errorResponse(ErrorCodes.NotFound, 'Project not found')
    if (project.organizationId !== organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    if (project.archived) return errorResponse(ErrorCodes.Validation, 'Archived projects cannot be used as the default Add Task project')
    await this.repo.set(organizationId, DEFAULT_ADD_TASK_PROJECT_KEY, project.id)
    return okResponse({ projectId: project.id, project })
  }

  async getGatewayLanguage(payload: { actorToken?: string }): Promise<ServiceResponse<{ language: GatewayLanguage }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const stored = await this.repo.get<string | null>(actor.user.organizationId, GATEWAY_LANGUAGE_KEY)
    const language = normalizeGatewayLanguage(stored)
    if (stored && stored !== language) await this.repo.set(actor.user.organizationId, GATEWAY_LANGUAGE_KEY, language)
    return okResponse({ language: stored ? language : DEFAULT_GATEWAY_LANGUAGE })
  }

  async setGatewayLanguage(payload: { actorToken?: string; language?: string | null }): Promise<ServiceResponse<{ language: GatewayLanguage }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const language = normalizeGatewayLanguage(payload?.language)
    await this.repo.set(actor.user.organizationId, GATEWAY_LANGUAGE_KEY, language)
    return okResponse({ language })
  }

  async getPlannerQuestionAttention(payload: { actorToken?: string }): Promise<ServiceResponse<{ behavior: PlannerQuestionAttentionBehavior }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const stored = await this.repo.get<string | null>(actor.user.organizationId, PLANNER_QUESTION_ATTENTION_KEY)
    const behavior = normalizePlannerQuestionAttentionBehavior(stored)
    if (stored && stored !== behavior) await this.repo.set(actor.user.organizationId, PLANNER_QUESTION_ATTENTION_KEY, behavior)
    return okResponse({ behavior: stored ? behavior : DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR })
  }

  async setPlannerQuestionAttention(payload: { actorToken?: string; behavior?: string | null }): Promise<ServiceResponse<{ behavior: PlannerQuestionAttentionBehavior }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const behavior = normalizePlannerQuestionAttentionBehavior(payload?.behavior)
    await this.repo.set(actor.user.organizationId, PLANNER_QUESTION_ATTENTION_KEY, behavior)
    return okResponse({ behavior })
  }

  async getAlertSoundSettings(payload: { actorToken?: string }): Promise<ServiceResponse<{ settings: AlertSoundSettings }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const stored = await this.repo.get<unknown>(actor.user.organizationId, ALERT_SOUND_SETTINGS_KEY)
    const settings = normalizeAlertSoundSettings(stored ?? DEFAULT_ALERT_SOUND_SETTINGS)
    if (stored && JSON.stringify(stored) !== JSON.stringify(settings)) {
      await this.repo.set(actor.user.organizationId, ALERT_SOUND_SETTINGS_KEY, settings)
    }
    return okResponse({ settings })
  }

  async setAlertSoundSettings(payload: { actorToken?: string; settings?: unknown }): Promise<ServiceResponse<{ settings: AlertSoundSettings }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const settings = normalizeAlertSoundSettings(payload?.settings ?? DEFAULT_ALERT_SOUND_SETTINGS)
    await this.repo.set(actor.user.organizationId, ALERT_SOUND_SETTINGS_KEY, settings)
    return okResponse({ settings })
  }

  async getDatabaseLocation(payload: { actorToken?: string }): Promise<ServiceResponse<DatabaseLocationState>> {
    await this.auth.requireActor(payload?.actorToken)
    return okResponse(getDatabaseLocationState())
  }

  async getWebServerStatus(payload: { actorToken?: string }): Promise<ServiceResponse<WebServerStatusState>> {
    await this.auth.requireActor(payload?.actorToken)
    return okResponse(getInternalHttpServerStatus())
  }

  async openWebServerUrl(payload: { actorToken?: string; url?: string | null }): Promise<ServiceResponse<{ opened: boolean; url: string }>> {
    await this.auth.requireActor(payload?.actorToken)
    const status = getInternalHttpServerStatus()
    const targetUrl = payload?.url?.trim() || status.localUrl || status.url || ''
    if (!targetUrl) return errorResponse(ErrorCodes.Validation, 'Web server URL is unavailable')
    let parsed: URL
    try {
      parsed = new URL(targetUrl)
    } catch {
      return errorResponse(ErrorCodes.Validation, 'Web server URL is invalid')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return errorResponse(ErrorCodes.Validation, 'Web server URL must use HTTP')
    }
    const shell = electronRuntime.shell
    if (!shell) {
      return errorResponse(ErrorCodes.Internal, 'Electron shell runtime is unavailable')
    }
    await shell.openExternal(parsed.toString())
    return okResponse({ opened: true, url: parsed.toString() })
  }

  async pickDatabaseFolder(payload: { actorToken?: string }): Promise<ServiceResponse<{ folderPath: string } | null>> {
    await this.auth.requireActor(payload?.actorToken)
    const dialog = electronRuntime.dialog
    if (!dialog) {
      return errorResponse(ErrorCodes.Internal, 'Electron dialog runtime is unavailable')
    }
    const result = await dialog.showOpenDialog({
      title: 'Select database folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) {
      return okResponse(null)
    }
    return okResponse({ folderPath: result.filePaths[0] })
  }

  async pickDatabaseFile(payload: { actorToken?: string }): Promise<ServiceResponse<{ filePath: string } | null>> {
    await this.auth.requireActor(payload?.actorToken)
    const dialog = electronRuntime.dialog
    if (!dialog) {
      return errorResponse(ErrorCodes.Internal, 'Electron dialog runtime is unavailable')
    }
    const result = await dialog.showOpenDialog({
      title: 'Select SQLite database file',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite database', extensions: ['sqlite', 'sqlite3', 'db'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) {
      return okResponse(null)
    }
    return okResponse({ filePath: result.filePaths[0] })
  }

  async moveDatabaseLocation(payload: { actorToken?: string; folderPath?: string | null; sourceDbPath?: string | null }): Promise<ServiceResponse<DatabaseLocationState>> {
    await this.auth.requireActor(payload?.actorToken)
    const folderPath = payload?.folderPath?.trim() ?? ''
    if (!folderPath) return errorResponse(ErrorCodes.Validation, 'Destination folder is required')
    try {
      const state = await moveDatabaseToFolder(folderPath, payload?.sourceDbPath)
      return okResponse(state)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to move database file'
      const lowered = message.toLowerCase()
      if (
        lowered.includes('destination folder') ||
        lowered.includes('destination path') ||
        lowered.includes('same folder') ||
        lowered.includes('required') ||
        lowered.includes('already contains') ||
        lowered.includes('selected database file') ||
        lowered.includes('database file cannot be found')
      ) {
        return errorResponse(ErrorCodes.Validation, message)
      }
      return errorResponse(ErrorCodes.Internal, message)
    }
  }

  async revealDatabaseLocation(payload: { actorToken?: string; path?: string | null }): Promise<ServiceResponse<{ revealed: boolean }>> {
    await this.auth.requireActor(payload?.actorToken)
    const shell = electronRuntime.shell
    if (!shell) {
      return errorResponse(ErrorCodes.Internal, 'Electron shell runtime is unavailable')
    }
    const state = getDatabaseLocationState()
    const targetPath = payload?.path?.trim() || state.currentDbPath || state.currentFolderPath
    if (!targetPath) {
      return errorResponse(ErrorCodes.Validation, 'Database path is unavailable')
    }
    if (targetPath.endsWith('mission-control.sqlite')) {
      shell.showItemInFolder(targetPath)
    } else {
      await shell.openPath(targetPath)
    }
    return okResponse({ revealed: true })
  }
}

export { ACTIVE_GATEWAY_KEY, DEFAULT_AGENT_KEY, DEFAULT_ADD_TASK_PROJECT_KEY, GATEWAY_LANGUAGE_KEY, PLANNER_QUESTION_ATTENTION_KEY, ALERT_SOUND_SETTINGS_KEY }
