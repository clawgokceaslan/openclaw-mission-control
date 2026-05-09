import { matchPath } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'

export interface PageMetadata {
  title: string
  description: string
  keywords: string[]
}

type AppRouteKey = keyof typeof APP_ROUTES

const APP_NAME = 'OpenMissionControl'
const TITLE_SEPARATOR = '|'

export const DEFAULT_METADATA: PageMetadata = {
  title: APP_NAME,
  description: 'OpenMissionControl is a desktop mission control app for projects, tasks, agents, gateways, skills, and Codex-powered execution workflows.',
  keywords: [
    'OpenMissionControl',
    'mission control',
    'Electron app',
    'project management',
    'task planning',
    'Codex',
    'agents',
    'gateways',
    'skills',
    'workflows'
  ]
}

export const ROUTE_METADATA = {
  SIGN_IN: {
    title: 'Sign in',
    description: 'Sign in to OpenMissionControl and continue managing mission workflows.',
    keywords: ['sign in', 'authentication', 'session']
  },
  PROFILE_SETUP: {
    title: 'Profile setup',
    description: 'Complete the local user profile and database setup for OpenMissionControl.',
    keywords: ['profile setup', 'database setup', 'onboarding']
  },
  PROFILE: {
    title: 'Profile',
    description: 'Manage user profile, avatar, appearance, account details, and password settings.',
    keywords: ['profile', 'avatar', 'appearance', 'account']
  },
  DASHBOARD: {
    title: 'Dashboard',
    description: 'Review current mission health, workload, gateway sessions, readiness, and project progress.',
    keywords: ['dashboard', 'mission health', 'readiness', 'project progress']
  },
  DASHBOARD_DETAIL: {
    title: 'Detailed dashboard',
    description: 'Explore charts and operational reports across projects, tasks, gateways, agents, and skills.',
    keywords: ['analytics', 'reports', 'charts', 'operations']
  },
  PROJECTS: {
    title: 'Projects',
    description: 'Browse projects, inspect task coverage, and create new project workspaces.',
    keywords: ['projects', 'tasks', 'project workspace']
  },
  PLAN_PIPELINE: {
    title: 'Plan Pipeline',
    description: 'Group project tasks into ordered planning pipelines and prepare execution batches.',
    keywords: ['plan pipeline', 'task groups', 'planning workflow']
  },
  PLAN_PIPELINE_RUNS: {
    title: 'Pipeline runs',
    description: 'Open the latest plan pipeline run list and continue pipeline execution review.',
    keywords: ['pipeline runs', 'planned tasks', 'execution review']
  },
  PLAN_PIPELINE_RUN_DETAIL: {
    title: 'Pipeline run detail',
    description: 'Inspect task lists and generated outputs for a selected plan pipeline run.',
    keywords: ['pipeline detail', 'run detail', 'generated tasks']
  },
  PROJECTS_NEW: {
    title: 'New project',
    description: 'Create a new OpenMissionControl project with mission context and workspace settings.',
    keywords: ['new project', 'create project', 'workspace']
  },
  PROJECT_DETAIL: {
    title: 'Project detail',
    description: 'Manage a project board, table, tasks, chats, statuses, agents, exports, and settings.',
    keywords: ['project detail', 'project board', 'task management', 'project settings']
  },
  PROJECT_TASK_DETAIL: {
    title: 'Task detail',
    description: 'Review and update an individual project task, including prompts, attachments, chats, and gateway runs.',
    keywords: ['task detail', 'task chat', 'attachments', 'gateway run']
  },
  PROJECT_SUBTASK_DETAIL: {
    title: 'Subtask detail',
    description: 'Review and update a task subtask with status, description, checklist, attachments, and chat context.',
    keywords: ['subtask detail', 'checklist', 'subtask status', 'task context']
  },
  WORKSPACES: {
    title: 'Workspaces',
    description: 'Configure Codex runtime workspaces from the OpenMissionControl settings area.',
    keywords: ['workspaces', 'runtime workspace', 'settings']
  },
  AGENTS: {
    title: 'Agents',
    description: 'Manage task agents with titles, prompts, tags, training content, and import tools.',
    keywords: ['agents', 'agent prompts', 'task agent', 'import agent']
  },
  AGENTS_NEW: {
    title: 'New agent',
    description: 'Create a reusable OpenMissionControl agent for project and task execution.',
    keywords: ['new agent', 'create agent', 'agent configuration']
  },
  GATEWAYS: {
    title: 'Gateways',
    description: 'Configure Codex gateways, runtime connections, models, and gateway availability.',
    keywords: ['gateways', 'Codex gateway', 'models', 'runtime']
  },
  GATEWAYS_NEW: {
    title: 'New gateway',
    description: 'Add a new Codex gateway configuration for OpenMissionControl execution flows.',
    keywords: ['new gateway', 'gateway setup', 'Codex runtime']
  },
  GATEWAY_DETAIL: {
    title: 'Gateway detail',
    description: 'Inspect gateway documentation, events, and runtime configuration details.',
    keywords: ['gateway detail', 'gateway events', 'Codex CLI']
  },
  SETTINGS: {
    title: 'Settings',
    description: 'Manage OpenMissionControl general settings, web server, database, workspaces, and gateways.',
    keywords: ['settings', 'web server', 'database', 'configuration']
  },
  DOCUMENTATION: {
    title: 'Documentation',
    description: 'Read OpenMissionControl documentation for setup, workflows, gateways, and app behavior.',
    keywords: ['documentation', 'setup guide', 'workflow guide']
  },
  DOCUMENTATION_GATEWAY: {
    title: 'Gateway documentation',
    description: 'Read focused documentation for Codex gateway setup and gateway-driven execution.',
    keywords: ['gateway documentation', 'Codex gateway', 'CLI setup']
  },
  SKILLS: {
    title: 'Skills',
    description: 'Manage reusable skills that extend agents with specialized knowledge and workflows.',
    keywords: ['skills', 'agent skills', 'workflow knowledge']
  },
  PROJECT_GROUPS: {
    title: 'Project groups',
    description: 'Organize related projects into groups and review grouped task progress.',
    keywords: ['project groups', 'project organization', 'group progress']
  },
  PROJECT_GROUPS_NEW: {
    title: 'New project group',
    description: 'Create a project group to organize related OpenMissionControl projects.',
    keywords: ['new project group', 'project grouping', 'organization']
  },
  PROJECT_GROUP_DETAIL: {
    title: 'Project group detail',
    description: 'Inspect a selected project group, connected projects, and grouped task counts.',
    keywords: ['project group detail', 'grouped projects', 'task counts']
  },
  CUSTOM_FIELDS: {
    title: 'Custom fields',
    description: 'Define custom task fields used by templates, project workflows, and generated outputs.',
    keywords: ['custom fields', 'task fields', 'field preview']
  },
  OUTPUT_FORMATS: {
    title: 'Data Formats',
    description: 'Build structured input and output data formats for AI instructions and task exports.',
    keywords: ['data formats', 'output formats', 'structured data', 'AI instructions']
  },
  TASK_TEMPLATES: {
    title: 'Task templates',
    description: 'Create reusable task templates with subtasks, checklists, fields, skills, and attachments.',
    keywords: ['task templates', 'checklists', 'template tasks', 'attachments']
  },
  PROJECT_INSTRUCTION_TEMPLATES: {
    title: 'Project Instructions',
    description: 'Manage reusable project instruction templates for planning, running, and chat guidance.',
    keywords: ['project instructions', 'instruction templates', 'planning prompt']
  },
  STATUSES: {
    title: 'Statuses',
    description: 'Manage task workflow statuses, status colors, categories, and workflow order.',
    keywords: ['statuses', 'workflow status', 'status colors']
  },
  TAGS: {
    title: 'Tags',
    description: 'Manage reusable tags for organizing projects, tasks, agents, and templates.',
    keywords: ['tags', 'labels', 'task organization']
  },
  TAG_ADD: {
    title: 'Add tag',
    description: 'Create a new tag for organizing OpenMissionControl entities.',
    keywords: ['add tag', 'create tag', 'labels']
  },
  INVITE: {
    title: 'Invite',
    description: 'Prepare organization invitations for OpenMissionControl collaborators.',
    keywords: ['invite', 'organization', 'collaboration']
  },
  ACTIVITY: {
    title: 'Activity',
    description: 'Review job activity, operational metrics, and queued background work.',
    keywords: ['activity', 'jobs', 'metrics', 'background work']
  },
  LAST_CHATS: {
    title: 'Chats',
    description: 'View recent Codex conversations across tasks, projects, and gateway runs.',
    keywords: ['chats', 'Codex conversations', 'task conversations']
  },
  ONBOARDING: {
    title: 'Onboarding',
    description: 'Start OpenMissionControl with guided onboarding for initial setup.',
    keywords: ['onboarding', 'getting started', 'initial setup']
  },
  COMPANION: {
    title: 'Companion',
    description: 'Use the compact companion surface for quick task creation and focused mission actions.',
    keywords: ['companion', 'quick actions', 'task creation']
  }
} satisfies Record<AppRouteKey, PageMetadata>

export function pageTitle(metadata: PageMetadata): string {
  return metadata.title === APP_NAME ? APP_NAME : `${metadata.title} ${TITLE_SEPARATOR} ${APP_NAME}`
}

export function keywordsContent(metadata: PageMetadata): string {
  return Array.from(new Set([...metadata.keywords, ...DEFAULT_METADATA.keywords])).join(', ')
}

export function metadataForPath(pathname: string): PageMetadata {
  const matchedEntry = (Object.entries(APP_ROUTES) as Array<[AppRouteKey, string]>).find(([, routePath]) =>
    Boolean(matchPath({ path: routePath, end: true }, pathname))
  )

  if (!matchedEntry) {
    return DEFAULT_METADATA
  }

  return ROUTE_METADATA[matchedEntry[0]]
}
