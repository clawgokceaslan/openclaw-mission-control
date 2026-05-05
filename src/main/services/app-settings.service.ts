import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { Agent, Gateway, Project } from '../../shared/types/entities.js'
import { AppSettingsRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { AuthService } from './auth.service.js'
import { DEFAULT_CODEX_LANGUAGE, normalizeCodexLanguage, type CodexLanguage } from '../../shared/utils/codex-language.js'

const ACTIVE_GATEWAY_KEY = 'activeGatewayId'
const DEFAULT_AGENT_KEY = 'defaultAgentId'
const DEFAULT_ADD_TASK_PROJECT_KEY = 'defaultAddTaskProjectId'
const CODEX_LANGUAGE_KEY = 'codexLanguage'

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

  async getCodexLanguage(payload: { actorToken?: string }): Promise<ServiceResponse<{ language: CodexLanguage }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const stored = await this.repo.get<string | null>(actor.user.organizationId, CODEX_LANGUAGE_KEY)
    const language = normalizeCodexLanguage(stored)
    if (stored && stored !== language) await this.repo.set(actor.user.organizationId, CODEX_LANGUAGE_KEY, language)
    return okResponse({ language: stored ? language : DEFAULT_CODEX_LANGUAGE })
  }

  async setCodexLanguage(payload: { actorToken?: string; language?: string | null }): Promise<ServiceResponse<{ language: CodexLanguage }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const language = normalizeCodexLanguage(payload?.language)
    await this.repo.set(actor.user.organizationId, CODEX_LANGUAGE_KEY, language)
    return okResponse({ language })
  }
}

export { ACTIVE_GATEWAY_KEY, DEFAULT_AGENT_KEY, DEFAULT_ADD_TASK_PROJECT_KEY, CODEX_LANGUAGE_KEY }
