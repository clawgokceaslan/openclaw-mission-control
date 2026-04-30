import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Navbar, Container } from 'react-bootstrap'
import { useEffect, useMemo, useState } from 'react'
import {
  LuBot,
  LuClipboardList,
  LuFolder,
  LuFolderPlus,
  LuHardDrive,
  LuListTodo,
  LuSearch,
  LuSparkles,
  LuWaypoints,
  LuX
} from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, Gateway, Project, Skill, StatusTemplate, TaskEntity, TaskTemplate, User, Workspace } from '@shared/types/entities'
import styles from '@renderer/App.module.scss'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'

type SearchRow = {
  id: string
  title: string
  subtitle: string
  type: 'Project' | 'Task template' | 'Agent' | 'Skill' | 'Gateway' | 'Workspace'
  path?: string
}

type SearchTab = 'create' | 'all' | 'projects' | 'templates' | 'agents' | 'skills' | 'gateways' | 'workspaces'
type CreateKind = 'project' | 'task' | 'template' | 'agent' | 'skill' | 'workspace' | null
type CreateActionKind = Exclude<CreateKind, null> | 'gateway'

type CreateDraft = {
  name: string
  description: string
  projectId: string
  templateId: string
  statusTemplateId: string
  workspaceId: string
  status: string
  folderPath: string
}

const emptyDraft: CreateDraft = {
  name: '',
  description: '',
  projectId: '',
  templateId: '',
  statusTemplateId: '',
  workspaceId: '',
  status: '',
  folderPath: ''
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'MC'
}

function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)$/)
  return match?.[1] ?? null
}

function defaultName(kind: Exclude<CreateKind, null>): string {
  if (kind === 'task') return 'Untitled task'
  if (kind === 'template') return 'Untitled template'
  if (kind === 'agent') return 'New agent'
  if (kind === 'skill') return 'New skill'
  if (kind === 'workspace') return ''
  return 'New project'
}

export function TopHeader({ user }: { user: User | null }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const userName = user?.name?.trim() || 'Mission Operator'
  const initials = initialsFromName(userName)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<SearchTab>('create')
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [statusTemplates, setStatusTemplates] = useState<StatusTemplate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [createKind, setCreateKind] = useState<CreateKind>(null)
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyDraft)
  const [creating, setCreating] = useState(false)
  const currentProjectId = projectIdFromPath(location.pathname)

  const loadSearchData = async () => {
    const [projectResponse, templateResponse, statusTemplateResponse, agentResponse, skillResponse, gatewayResponse, workspaceResponse] = await Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      loadList<StatusTemplate[]>(IPC_CHANNELS.statuses.listTemplates, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token)
    ])
    if (projectResponse.ok) setProjects(Array.isArray(projectResponse.data) ? projectResponse.data : [])
    if (templateResponse.ok) setTemplates(Array.isArray(templateResponse.data) ? templateResponse.data : [])
    if (statusTemplateResponse.ok) setStatusTemplates(Array.isArray(statusTemplateResponse.data) ? statusTemplateResponse.data : [])
    if (agentResponse.ok) setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
    if (skillResponse.ok) setSkills(Array.isArray(skillResponse.data) ? skillResponse.data : [])
    if (gatewayResponse.ok) setGateways(Array.isArray(gatewayResponse.data) ? gatewayResponse.data : [])
    if (workspaceResponse.ok) setWorkspaces(Array.isArray(workspaceResponse.data) ? workspaceResponse.data : [])
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
        setActiveTab('create')
        void loadSearchData()
      }
      if (event.key === 'Escape') {
        if (createKind) {
          setCreateKind(null)
          setError(null)
          return
        }
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [token, createKind])

  useEffect(() => {
    if (open) void loadSearchData()
  }, [open])

  const allRows = useMemo<SearchRow[]>(() => [
    ...projects.map((project) => ({ id: `project:${project.id}`, title: project.name, subtitle: 'Project', type: 'Project' as const, path: `${APP_ROUTES.PROJECTS}/${project.id}` })),
    ...templates.map((template) => ({ id: `template:${template.id}`, title: template.name, subtitle: 'Task template', type: 'Task template' as const, path: APP_ROUTES.TASK_TEMPLATES })),
    ...agents.map((agent) => ({ id: `agent:${agent.id}`, title: agent.name, subtitle: `Agent · ${agent.status}`, type: 'Agent' as const, path: APP_ROUTES.AGENTS })),
    ...skills.map((skill) => ({ id: `skill:${skill.id}`, title: skill.name, subtitle: `Skill · ${skill.status}`, type: 'Skill' as const, path: APP_ROUTES.SKILLS })),
    ...gateways.map((gateway) => ({ id: `gateway:${gateway.id}`, title: gateway.name, subtitle: `Gateway · ${gateway.status}`, type: 'Gateway' as const, path: `${APP_ROUTES.GATEWAYS}/${gateway.id}` })),
    ...workspaces.map((workspace) => ({ id: `workspace:${workspace.id}`, title: workspace.name, subtitle: workspace.rootPath, type: 'Workspace' as const, path: APP_ROUTES.WORKSPACES }))
  ], [agents, gateways, projects, skills, templates, workspaces])

  const rows = useMemo<SearchRow[]>(() => {
    const needle = query.trim().toLowerCase()
    const byQuery = needle
      ? allRows.filter((row) => `${row.title} ${row.subtitle}`.toLowerCase().includes(needle))
      : allRows
    const byTab = byQuery.filter((row) => {
      if (activeTab === 'all') return true
      if (activeTab === 'projects') return row.type === 'Project'
      if (activeTab === 'templates') return row.type === 'Task template'
      if (activeTab === 'agents') return row.type === 'Agent'
      if (activeTab === 'skills') return row.type === 'Skill'
      if (activeTab === 'gateways') return row.type === 'Gateway'
      if (activeTab === 'workspaces') return row.type === 'Workspace'
      return false
    })
    return byTab.slice(0, needle ? 20 : 12)
  }, [activeTab, allRows, query])

  const close = () => {
    setOpen(false)
    setError(null)
    setCreateKind(null)
    setCreating(false)
  }

  const navigateTo = (path: string) => {
    navigate(path)
    close()
  }

  const openCreate = (kind: CreateActionKind) => {
    if (kind === 'gateway') {
      navigateTo(APP_ROUTES.GATEWAYS_NEW)
      return
    }
    const title = query.trim() || defaultName(kind)
    setError(null)
    setActiveTab('create')
    setCreateKind(kind)
    setCreateDraft({
      name: title,
      description: '',
      projectId: currentProjectId ?? '',
      templateId: '',
      statusTemplateId: statusTemplates[0]?.id ?? '',
      workspaceId: '',
      status: kind === 'agent' ? 'idle' : kind === 'skill' ? 'active' : '',
      folderPath: ''
    })
  }

  const updateDraft = (patch: Partial<CreateDraft>) => {
    setCreateDraft((current) => ({ ...current, ...patch }))
  }

  const chooseWorkspaceFolder = async () => {
    const pickResponse = await invokeBridge<{ rootPath: string } | null>(IPC_CHANNELS.workspaces.pickFolder, { actorToken: token })
    if (!pickResponse.ok) {
      setError(pickResponse.error?.message ?? 'Unable to pick workspace folder')
      return
    }
    const rootPath = pickResponse.data?.rootPath
    if (rootPath) updateDraft({ folderPath: rootPath })
  }

  const submitCreate = async () => {
    if (!createKind || creating) return
    const name = createDraft.name.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    if (createKind === 'task' && !createDraft.projectId) {
      setError('Project selection is required for task creation.')
      return
    }
    if (createKind === 'workspace' && !createDraft.folderPath.trim()) {
      setError('Workspace folder is required.')
      return
    }

    setCreating(true)
    setError(null)
    try {
      if (createKind === 'project') {
        const response = await invokeBridge<Project>(IPC_CHANNELS.projects.create, {
          actorToken: token,
          name,
          description: createDraft.description.trim() || undefined,
          workspaceId: createDraft.workspaceId || null
        })
        if (!response.ok || !response.data) throw new Error(response.error?.message ?? 'Unable to create project')
        if (createDraft.statusTemplateId) {
          const templateResponse = await invokeBridge(IPC_CHANNELS.statuses.applyTemplateToProject, {
            actorToken: token,
            projectId: response.data.id,
            templateId: createDraft.statusTemplateId
          })
          if (!templateResponse.ok) throw new Error(templateResponse.error?.message ?? 'Project created, but status template could not be applied.')
        }
        navigateTo(`${APP_ROUTES.PROJECTS}/${response.data.id}`)
        return
      }

      if (createKind === 'task') {
        const selectedTemplate = createDraft.templateId ? templates.find((template) => template.id === createDraft.templateId) : null
        const templatePayload = selectedTemplate?.template
        const response = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.create, {
          actorToken: token,
          projectId: createDraft.projectId,
          title: name,
          status: templatePayload?.status || 'not_started',
          description: createDraft.description.trim() || templatePayload?.description || '',
          agentId: templatePayload?.agentId ?? null
        })
        if (!response.ok) throw new Error(response.error?.message ?? 'Unable to create task')
        navigateTo(`${APP_ROUTES.PROJECTS}/${createDraft.projectId}`)
        return
      }

      if (createKind === 'template') {
        const response = await invokeBridge<TaskTemplate>(IPC_CHANNELS.taskTemplates.create, {
          actorToken: token,
          name,
          description: createDraft.description.trim(),
          template: {
            title: name,
            description: createDraft.description.trim(),
            status: 'not_started',
            tagIds: [],
            skillIds: [],
            customFieldValues: {},
            checklistItems: [],
            comments: [],
            attachments: [],
            subtasks: []
          }
        })
        if (!response.ok) throw new Error(response.error?.message ?? 'Unable to create task template')
        navigateTo(APP_ROUTES.TASK_TEMPLATES)
        return
      }

      if (createKind === 'agent') {
        const response = await invokeBridge<Agent>(IPC_CHANNELS.agents.create, {
          actorToken: token,
          name,
          title: createDraft.description.trim(),
          status: createDraft.status || 'idle',
          trainingMarkdown: '',
          reasoningLevel: 'medium',
          steps: []
        })
        if (!response.ok) throw new Error(response.error?.message ?? 'Unable to create agent')
        navigateTo(APP_ROUTES.AGENTS)
        return
      }

      if (createKind === 'skill') {
        const response = await invokeBridge<Skill>(IPC_CHANNELS.skills.create, {
          actorToken: token,
          title: name,
          descriptionMarkdown: createDraft.description.trim(),
          status: createDraft.status || 'active'
        })
        if (!response.ok) throw new Error(response.error?.message ?? 'Unable to create skill')
        navigateTo(APP_ROUTES.SKILLS)
        return
      }

      if (createKind === 'workspace') {
        const response = await invokeBridge<Workspace>(IPC_CHANNELS.workspaces.create, {
          actorToken: token,
          name,
          rootPath: createDraft.folderPath.trim()
        })
        if (!response.ok) throw new Error(response.error?.message ?? 'Unable to create workspace')
        navigateTo(APP_ROUTES.WORKSPACES)
      }
    } catch (err) {
      setCreating(false)
      setError(err instanceof Error ? err.message : 'Create failed')
    }
  }

  const resultIcon = (type: SearchRow['type']) => {
    if (type === 'Project') return <LuFolder size={15} />
    if (type === 'Task template') return <LuClipboardList size={15} />
    if (type === 'Agent') return <LuBot size={15} />
    if (type === 'Skill') return <LuSparkles size={15} />
    if (type === 'Gateway') return <LuWaypoints size={15} />
    return <LuHardDrive size={15} />
  }

  const createTitle = createKind ? {
    project: 'Create project',
    task: 'Create task',
    template: 'Create task template',
    agent: 'Create agent',
    skill: 'Create skill',
    workspace: 'Create workspace'
  }[createKind] : ''

  return (
    <Navbar className={styles.topbar}>
      <Container fluid className={styles.topbarInner}>
        <div className={styles.brandArea}>
          <div className={styles.brandMark}>OM</div>
          <div className={styles.brandText}>
            <p className={styles.brandTitle}>Open Mission Control</p>
          </div>
        </div>

        <button type="button" className={styles.universalSearchButton} onClick={() => { setOpen(true); setActiveTab('create') }}>
          <LuSearch size={15} />
          <span>Search or create...</span>
          <kbd>⌘K</kbd>
        </button>

        <Link className={styles.userArea} to={APP_ROUTES.PROFILE} aria-label="Open profile">
          <div className={styles.userMeta}>
            <span className={styles.userName}>{userName}</span>
            <span className={styles.userRole}>{user?.role ?? 'operator'}</span>
          </div>
          <div className={styles.userAvatar}>{initials}</div>
        </Link>
      </Container>

      {open ? (
        <>
          <div className={styles.commandBackdrop} onClick={close} />
          <section className={styles.commandModal} role="dialog" aria-modal="true" aria-label="Search or create">
            <header className={styles.commandHeader}>
              <LuSearch size={18} />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or create..." />
              <button type="button" onClick={close} aria-label="Close search"><LuX size={17} /></button>
            </header>

            <nav className={styles.commandTabs} aria-label="Search categories">
              <button type="button" className={`${styles.commandTab} ${styles.commandTabCreate} ${activeTab === 'create' ? styles.commandTabActive : ''}`} onClick={() => { setActiveTab('create'); setCreateKind(null) }}>
                Create
              </button>
              <span className={styles.commandTabDivider} />
              {[
                ['all', 'All'],
                ['projects', 'Projects'],
                ['templates', 'Task templates'],
                ['agents', 'Agents'],
                ['skills', 'Skills'],
                ['gateways', 'Gateways'],
                ['workspaces', 'Workspaces']
              ].map(([tab, label]) => (
                <button key={tab} type="button" className={`${styles.commandTab} ${activeTab === tab ? styles.commandTabActive : ''}`} onClick={() => { setActiveTab(tab as SearchTab); setCreateKind(null) }}>
                  {label}
                </button>
              ))}
            </nav>

            {error ? <p className={styles.commandError}>{error}</p> : null}

            <div className={styles.commandBody}>
              {activeTab === 'create' ? (
                createKind ? (
                  <div className={styles.commandCreatePanel}>
                    <div>
                      <span className={styles.commandSectionTitle}>{createTitle}</span>
                      <p>Fill the minimum fields, then create. Nothing is saved before this form is submitted.</p>
                    </div>

                    <label>
                      <span>{createKind === 'skill' ? 'Skill title' : createKind === 'task' ? 'Task title' : 'Name'}</span>
                      <input value={createDraft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder={createTitle} />
                    </label>

                    {createKind === 'task' ? (
                      <label>
                        <span>Project</span>
                        <select value={createDraft.projectId} onChange={(event) => updateDraft({ projectId: event.target.value })}>
                          <option value="">Select project...</option>
                          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                      </label>
                    ) : null}

                    {createKind === 'project' ? (
                      <>
                        <label>
                          <span>Workspace</span>
                          <select value={createDraft.workspaceId} onChange={(event) => updateDraft({ workspaceId: event.target.value })}>
                            <option value="">No workspace</option>
                            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>Status template</span>
                          <select value={createDraft.statusTemplateId} onChange={(event) => updateDraft({ statusTemplateId: event.target.value })}>
                            <option value="">No status template</option>
                            {statusTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                          </select>
                        </label>
                      </>
                    ) : null}

                    {createKind === 'task' ? (
                      <label>
                        <span>Template</span>
                        <select value={createDraft.templateId} onChange={(event) => updateDraft({ templateId: event.target.value })}>
                          <option value="">No template</option>
                          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                        </select>
                      </label>
                    ) : null}

                    {createKind === 'agent' || createKind === 'skill' ? (
                      <label>
                        <span>Status</span>
                        <select value={createDraft.status} onChange={(event) => updateDraft({ status: event.target.value })}>
                          {createKind === 'agent' ? (
                            <>
                              <option value="idle">Idle</option>
                              <option value="busy">Busy</option>
                              <option value="offline">Offline</option>
                            </>
                          ) : (
                            <>
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </>
                          )}
                        </select>
                      </label>
                    ) : null}

                    {createKind === 'workspace' ? (
                      <label>
                        <span>Folder path</span>
                        <div className={styles.commandInlinePicker}>
                          <input value={createDraft.folderPath} onChange={(event) => updateDraft({ folderPath: event.target.value })} placeholder="/Users/.../Workspace" />
                          <button type="button" onClick={() => void chooseWorkspaceFolder()}>
                            <LuFolderPlus size={14} />
                            Choose
                          </button>
                        </div>
                      </label>
                    ) : null}

                    {createKind !== 'workspace' ? (
                      <label>
                        <span>{createKind === 'agent' ? 'Title' : 'Description'}</span>
                        <textarea value={createDraft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Optional" rows={3} />
                      </label>
                    ) : null}

                    <div className={styles.commandInlineActions}>
                      <button type="button" onClick={() => setCreateKind(null)}>Back</button>
                      <button
                        type="button"
                        onClick={() => void submitCreate()}
                        disabled={creating || !createDraft.name.trim() || (createKind === 'task' && !createDraft.projectId) || (createKind === 'workspace' && !createDraft.folderPath.trim())}
                      >
                        {creating ? 'Creating...' : createTitle}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.commandActions}>
                    <button type="button" onClick={() => openCreate('project')}><LuFolderPlus size={16} /><strong>Create project</strong><span>Open project form with optional workspace.</span></button>
                    <button type="button" onClick={() => openCreate('task')}><LuListTodo size={16} /><strong>Create task</strong><span>Select a project, optionally use a template.</span></button>
                    <button type="button" onClick={() => openCreate('template')}><LuClipboardList size={16} /><strong>Create task template</strong><span>Start an empty reusable template.</span></button>
                    <button type="button" onClick={() => openCreate('agent')}><LuBot size={16} /><strong>Create agent</strong><span>Create an agent profile.</span></button>
                    <button type="button" onClick={() => openCreate('skill')}><LuSparkles size={16} /><strong>Create skill</strong><span>Create an active capability.</span></button>
                    <button type="button" onClick={() => openCreate('gateway')}><LuWaypoints size={16} /><strong>Create gateway</strong><span>Open gateway setup form.</span></button>
                    <button type="button" onClick={() => openCreate('workspace')}><LuHardDrive size={16} /><strong>Create workspace</strong><span>Name it first, then choose a folder.</span></button>
                  </div>
                )
              ) : (
                <div className={styles.commandResults}>
                  {rows.map((row) => (
                    <button key={row.id} type="button" onClick={() => row.path ? navigateTo(row.path) : undefined}>
                      <span className={styles.commandResultIcon}>{resultIcon(row.type)}</span>
                      <span>
                        <strong>{row.title}</strong>
                        <small>{row.subtitle}</small>
                      </span>
                      <em>{row.type}</em>
                    </button>
                  ))}
                  {rows.length === 0 ? <p>No matching results.</p> : null}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </Navbar>
  )
}
