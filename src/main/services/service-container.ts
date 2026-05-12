import EventEmitter from 'node:events'
import { getDb } from '../../db/config.js'
import { runMigrations } from '../../db/migrations/index.js'
import { SqliteAdapter } from '../../db/adapter/sqlite.js'
import { AuthRepository } from '../../db/repositories/auth-repo.js'
import { ProjectRepository } from '../../db/repositories/project-repo.js'
import { TaskRepository, TaskSkillRepository, TaskSubtaskRepository, TaskTagRepository } from '../../db/repositories/task-repo.js'
import { TaskTemplateRepository } from '../../db/repositories/task-template-repo.js'
import { ProjectInstructionTemplateRepository } from '../../db/repositories/project-instruction-template-repo.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { McpRepository } from '../../db/repositories/mcp-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { WebhookRepository } from '../../db/repositories/webhook-repo.js'
import { SkillRepository, PackRepository } from '../../db/repositories/skill-repo.js'
import { ToolRepository } from '../../db/repositories/tool-repo.js'
import { OrganizationRepository } from '../../db/repositories/org-repo.js'
import { GroupRepository } from '../../db/repositories/group-repo.js'
import { PlanPipelineRepository } from '../../db/repositories/plan-pipeline-repo.js'
import { RunPipelineRepository } from '../../db/repositories/run-pipeline-repo.js'
import { CustomFieldRepository, TagRepository } from '../../db/repositories/custom-field-repo.js'
import { JobRepository } from '../../db/repositories/job-repo.js'
import { StatusRepository } from '../../db/repositories/status-repo.js'
import { OutputFormatRepository } from '../../db/repositories/output-format-repo.js'
import { AppSettingsRepository, WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { AuthService } from './auth.service.js'
import { ProjectService } from './project.service.js'
import { TaskService } from './task.service.js'
import { TaskTemplateService } from './task-template.service.js'
import { ProjectInstructionTemplateService } from './project-instruction-template.service.js'
import { AgentService } from './agent.service.js'
import { McpService } from './mcp.service.js'
import { GatewayService } from './gateway/index.js'
import { OpenClawGatewayRuntimeRegistry } from './gateway/index.js'
import { WebhookService } from './webhook.service.js'
import { SkillService } from './skill.service.js'
import { ToolService } from './tool.service.js'
import { OrganizationService } from './organization.service.js'
import { ProjectGroupService } from './project-group.service.js'
import { PlanPipelineService } from './plan-pipeline.service.js'
import { PipelineStatusService, RunPipelineService } from './run-pipeline.service.js'
import { CustomFieldService } from './custom-field.service.js'
import { JobService } from './job.service.js'
import { StatusService } from './status.service.js'
import { OutputFormatService } from './output-format.service.js'
import { AttachmentService } from './attachment.service.js'
import { WorkspaceService } from './workspace.service.js'
import { AppSettingsService } from './app-settings.service.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import type { PipelineStatusUpdateEvent } from '../../shared/types/entities.js'

export interface AppServices {
  auth: AuthService
  projects: ProjectService
  workspaces: WorkspaceService
  appSettings: AppSettingsService
  statuses: StatusService
  tasks: TaskService
  taskTemplates: TaskTemplateService
  projectInstructionTemplates: ProjectInstructionTemplateService
  agents: AgentService
  mcp: McpService
  gateways: GatewayService
  webhooks: WebhookService
  skills: SkillService
  tools: ToolService
  organization: OrganizationService
  projectGroups: ProjectGroupService
  planPipelines: PlanPipelineService
  runPipelines: RunPipelineService
  pipelineStatus: PipelineStatusService
  customFields: CustomFieldService
  outputFormats: OutputFormatService
  jobs: JobService
  attachments: AttachmentService
}

export interface AppContext {
  db: SqliteAdapter
  eventBus: EventEmitter
  services: AppServices
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function pipelinePhase(value: unknown): PipelineStatusUpdateEvent['phase'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'plan' || normalized === 'planning') return 'plan'
  if (normalized === 'run' || normalized === 'running') return 'run'
  if (normalized === 'post-running' || normalized === 'post-run' || normalized === 'post running') return 'post-running'
  if (normalized === 'follow-up' || normalized === 'follow up' || normalized === 'follow_up') return 'follow-up'
  return undefined
}

function pipelineStatus(value: unknown): PipelineStatusUpdateEvent['status'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'pending'
    || normalized === 'queued'
    || normalized === 'running'
    || normalized === 'completed'
    || normalized === 'failed'
    || normalized === 'blocked'
    || normalized === 'paused'
    || normalized === 'cancelled'
    || normalized === 'skipped'
    || normalized === 'planned'
    || normalized === 'needs-input'
  ) {
    return normalized
  }
  if (normalized === 'waiting') return 'queued'
  if (normalized === 'needs-clarification') return 'needs-input'
  return undefined
}

function compactEventText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return undefined
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized
}

export function registerPipelineStatusEventBridge(eventBus: EventEmitter): void {
  const emit = (payload: PipelineStatusUpdateEvent) => {
    eventBus.emit(IPC_CHANNELS.events.pipelineStatusUpdated, payload)
  }

  eventBus.on(IPC_CHANNELS.events.taskUpdated, (payload) => {
    const record = asRecord(payload)
    emit({
      reason: 'task_updated',
      source: 'task',
      projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
      taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
      action: typeof record.action === 'string' ? record.action : undefined,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
    })
  })

  eventBus.on(IPC_CHANNELS.events.taskActivity, (payload) => {
    const record = asRecord(payload)
    const message = asRecord(record.message)
    const metadata = asRecord(message.metadata)
    const status = pipelineStatus(message.status) ?? pipelineStatus(metadata.runStatus)
    emit({
      reason: 'task_activity',
      source: 'task-activity',
      projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
      taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
      conversationId: typeof message.conversationId === 'string' ? message.conversationId : typeof message.runId === 'string' ? message.runId : undefined,
      runItemId: typeof message.runPipelineItemId === 'string' ? message.runPipelineItemId : undefined,
      phase: pipelinePhase(message.phase) ?? pipelinePhase(metadata.phase),
      action: status ?? (typeof message.status === 'string' ? message.status : undefined),
      status,
      progressText: compactEventText(message.body),
      error: status === 'failed' ? compactEventText(message.body) : undefined,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
    })
  })

  eventBus.on(IPC_CHANNELS.events.planPipelineUpdated, (payload) => {
    const record = asRecord(payload)
    emit({
      reason: 'plan_pipeline',
      source: 'plan-pipeline',
      planBatchId: typeof record.batchId === 'string' ? record.batchId : undefined,
      planRecordId: typeof record.recordId === 'string' ? record.recordId : undefined,
      runPipelineId: typeof record.linkedRunPipelineId === 'string' ? record.linkedRunPipelineId : undefined,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
    })
  })

  eventBus.on(IPC_CHANNELS.events.runPipelineUpdated, (payload) => {
    const record = asRecord(payload)
    emit({
      reason: 'run_pipeline',
      source: 'run-pipeline',
      runPipelineId: typeof record.batchId === 'string' ? record.batchId : undefined,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
    })
  })
}

export async function createAppContext(): Promise<AppContext> {
  const db = await getDb()
  await runMigrations()

  const eventBus = new EventEmitter()
  registerPipelineStatusEventBridge(eventBus)

  const authRepo = new AuthRepository(db)
  const mcpRepo = new McpRepository(db)
  const projectRepo = new ProjectRepository(db, mcpRepo)
  const taskRepo = new TaskRepository(db)
  const taskTemplateRepo = new TaskTemplateRepository(db)
  const projectInstructionTemplateRepo = new ProjectInstructionTemplateRepository(db)
  const taskSubtaskRepo = new TaskSubtaskRepository(db)
  const taskTagRepo = new TaskTagRepository(db)
  const taskSkillRepo = new TaskSkillRepository(db)
  const agentRepo = new AgentRepository(db, mcpRepo)
  const gatewayRepo = new GatewayRepository(db)
  const gatewayRuntime = new OpenClawGatewayRuntimeRegistry()
  const webhookRepo = new WebhookRepository(db)
  const skillRepo = new SkillRepository(db, mcpRepo)
  const toolRepo = new ToolRepository(db)
  const packRepo = new PackRepository(db)
  const orgRepo = new OrganizationRepository(db)
  const groupRepo = new GroupRepository(db)
  const planPipelineRepo = new PlanPipelineRepository(db)
  const runPipelineRepo = new RunPipelineRepository(db)
  const customFieldRepo = new CustomFieldRepository(db)
  const tagRepo = new TagRepository(db)
  const jobRepo = new JobRepository(db)
  const statusRepo = new StatusRepository(db)
  const outputFormatRepo = new OutputFormatRepository(db)
  const workspaceRepo = new WorkspaceRepository(db)
  const appSettingsRepo = new AppSettingsRepository(db)

  const auth = new AuthService(authRepo, eventBus)
  const tasks = new TaskService(auth, taskRepo, taskSubtaskRepo, taskTagRepo, taskSkillRepo, projectRepo, tagRepo, skillRepo, customFieldRepo, agentRepo, statusRepo, workspaceRepo, gatewayRepo, appSettingsRepo, eventBus)
  const planPipelines = new PlanPipelineService(auth, planPipelineRepo, projectRepo, taskRepo, eventBus)
  const runPipelines = new RunPipelineService(auth, runPipelineRepo, planPipelineRepo, projectRepo, taskRepo, tasks, eventBus)
  planPipelines.setRunPipelineCreator((organizationId, planBatchId, actorToken, createdByName) =>
    runPipelines.createFromPlanBatchForActor(organizationId, planBatchId, actorToken, createdByName)
  )
  const services: AppServices = {
    auth,
    projects: new ProjectService(auth, projectRepo, workspaceRepo, gatewayRepo, taskRepo, taskSubtaskRepo),
    workspaces: new WorkspaceService(auth, workspaceRepo),
    appSettings: new AppSettingsService(auth, appSettingsRepo, gatewayRepo, agentRepo, projectRepo),
    statuses: new StatusService(auth, statusRepo, projectRepo),
    tasks,
    taskTemplates: new TaskTemplateService(auth, taskTemplateRepo, agentRepo, tagRepo, skillRepo, customFieldRepo),
    projectInstructionTemplates: new ProjectInstructionTemplateService(auth, projectInstructionTemplateRepo),
    agents: new AgentService(auth, agentRepo, tagRepo, toolRepo),
    mcp: new McpService(auth, mcpRepo, agentRepo, skillRepo, projectRepo),
    gateways: new GatewayService(auth, gatewayRepo, eventBus, gatewayRuntime, appSettingsRepo),
    webhooks: new WebhookService(auth, webhookRepo),
    skills: new SkillService(auth, skillRepo, packRepo),
    tools: new ToolService(auth, toolRepo, agentRepo),
    organization: new OrganizationService(auth, orgRepo, authRepo),
    projectGroups: new ProjectGroupService(auth, groupRepo, projectRepo),
    planPipelines,
    runPipelines,
    pipelineStatus: new PipelineStatusService(auth, runPipelineRepo, planPipelineRepo, projectRepo, taskRepo),
    customFields: new CustomFieldService(auth, customFieldRepo, tagRepo),
    outputFormats: new OutputFormatService(auth, outputFormatRepo),
    jobs: new JobService(auth, jobRepo),
    attachments: new AttachmentService(auth, projectRepo, workspaceRepo, taskRepo, taskSubtaskRepo, taskTemplateRepo)
  }

  return { db, eventBus, services }
}
