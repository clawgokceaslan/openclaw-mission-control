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

export async function createAppContext(): Promise<AppContext> {
  const db = await getDb()
  await runMigrations()

  const eventBus = new EventEmitter()

  const authRepo = new AuthRepository(db)
  const projectRepo = new ProjectRepository(db)
  const taskRepo = new TaskRepository(db)
  const taskTemplateRepo = new TaskTemplateRepository(db)
  const projectInstructionTemplateRepo = new ProjectInstructionTemplateRepository(db)
  const taskSubtaskRepo = new TaskSubtaskRepository(db)
  const taskTagRepo = new TaskTagRepository(db)
  const taskSkillRepo = new TaskSkillRepository(db)
  const agentRepo = new AgentRepository(db)
  const gatewayRepo = new GatewayRepository(db)
  const gatewayRuntime = new OpenClawGatewayRuntimeRegistry()
  const webhookRepo = new WebhookRepository(db)
  const skillRepo = new SkillRepository(db)
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
