import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  LuBot,
  LuChevronLeft,
  LuChevronRight,
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
import type { Agent, Gateway, Project, Skill, TaskTemplate, Workspace } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import styles from '@renderer/App.module.scss'

type SearchRow = {
  id: string
  title: string
  subtitle: string
  type: 'Project' | 'Task template' | 'Agent' | 'Skill' | 'Gateway' | 'Workspace'
  path?: string
  state?: unknown
}

type SearchTab = 'create' | 'all' | 'projects' | 'templates' | 'agents' | 'skills' | 'gateways' | 'workspaces'
type CreateActionKind = 'project' | 'task' | 'template' | 'agent' | 'skill' | 'workspace' | 'gateway'

export type GlobalTaskCreateInitial = {
  title?: string
  projectId?: string
  templateId?: string | null
}

function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)$/)
  return match?.[1] ?? null
}

function defaultName(kind: Exclude<CreateActionKind, 'gateway'>): string {
  if (kind === 'task') return 'Untitled task'
  if (kind === 'template') return 'Untitled template'
  if (kind === 'agent') return 'New agent'
  if (kind === 'skill') return 'New skill'
  if (kind === 'workspace') return ''
  return 'New project'
}

function pathWithCreateQuery(path: string, params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams()
  searchParams.set('create', '1')
  for (const [key, value] of Object.entries(params)) {
    if (value?.trim()) searchParams.set(key, value.trim())
  }
  return `${path}?${searchParams.toString()}`
}

interface UniversalCommandProps {
  embedded?: boolean
  onClose?: () => void
  onOpenTaskCreate?: (initial: GlobalTaskCreateInitial) => void
}

export function UniversalCommand({ embedded = false, onClose, onOpenTaskCreate }: UniversalCommandProps) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<SearchTab>('create')
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const tabsRef = useRef<HTMLElement | null>(null)
  const tabScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentProjectId = projectIdFromPath(location.pathname)

  const close = () => {
    setError(null)
    if (onClose) {
      onClose()
      return
    }
    if (embedded && typeof window !== 'undefined') window.close()
  }

  const loadSearchData = async () => {
    const [projectResponse, templateResponse, agentResponse, skillResponse, gatewayResponse, workspaceResponse] = await Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token)
    ])
    if (projectResponse.ok) setProjects(Array.isArray(projectResponse.data) ? projectResponse.data : [])
    if (templateResponse.ok) setTemplates(Array.isArray(templateResponse.data) ? templateResponse.data : [])
    if (agentResponse.ok) setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
    if (skillResponse.ok) setSkills(Array.isArray(skillResponse.data) ? skillResponse.data : [])
    if (gatewayResponse.ok) setGateways(Array.isArray(gatewayResponse.data) ? gatewayResponse.data : [])
    if (workspaceResponse.ok) setWorkspaces(Array.isArray(workspaceResponse.data) ? workspaceResponse.data : [])
  }

  useEffect(() => {
    void loadSearchData()
  }, [token])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, embedded])

  useEffect(() => {
    const stopTabScroll = () => {
      if (!tabScrollIntervalRef.current) return
      clearInterval(tabScrollIntervalRef.current)
      tabScrollIntervalRef.current = null
    }
    window.addEventListener('pointerup', stopTabScroll)
    window.addEventListener('blur', stopTabScroll)
    return () => {
      stopTabScroll()
      window.removeEventListener('pointerup', stopTabScroll)
      window.removeEventListener('blur', stopTabScroll)
    }
  }, [])

  const allRows = useMemo<SearchRow[]>(() => [
    ...projects.map((project) => ({ id: `project:${project.id}`, title: project.name, subtitle: 'Project', type: 'Project' as const, path: `${APP_ROUTES.PROJECTS}/${project.id}` })),
    ...templates.map((template) => ({ id: `template:${template.id}`, title: template.name, subtitle: 'Task template', type: 'Task template' as const, path: `${APP_ROUTES.TASK_TEMPLATES}?template=${encodeURIComponent(template.id)}`, state: { openTemplateId: template.id, template } })),
    ...agents.map((agent) => ({ id: `agent:${agent.id}`, title: agent.name, subtitle: `Agent · ${agent.status}`, type: 'Agent' as const, path: `${APP_ROUTES.AGENTS}?edit=${encodeURIComponent(agent.id)}`, state: { openEditId: agent.id, agent } })),
    ...skills.map((skill) => ({ id: `skill:${skill.id}`, title: skill.name, subtitle: `Skill · ${skill.status}`, type: 'Skill' as const, path: `${APP_ROUTES.SKILLS}?edit=${encodeURIComponent(skill.id)}`, state: { openEditId: skill.id, skill } })),
    ...gateways.map((gateway) => ({ id: `gateway:${gateway.id}`, title: gateway.name, subtitle: `Gateway · ${gateway.status}`, type: 'Gateway' as const, path: `${APP_ROUTES.GATEWAYS}/${gateway.id}` })),
    ...workspaces.map((workspace) => ({ id: `workspace:${workspace.id}`, title: workspace.name, subtitle: workspace.rootPath, type: 'Workspace' as const, path: `${APP_ROUTES.WORKSPACES}?edit=${encodeURIComponent(workspace.id)}`, state: { openEditId: workspace.id, workspace } }))
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

  const navigateTo = async (path: string, state?: unknown) => {
    if (embedded) {
      const response = await invokeBridge(IPC_CHANNELS.app.navigateFromCompanion, { path, state })
      if (!response.ok) {
        setError(response.error?.message ?? 'Unable to open route in the main app.')
      }
      return
    }
    navigate(path, state ? { state } : undefined)
    close()
  }

  const openCreate = (kind: CreateActionKind) => {
    if (kind === 'gateway') {
      void navigateTo(APP_ROUTES.GATEWAYS_NEW)
      return
    }
    const title = query.trim()
    if (kind === 'task') {
      const initial = {
        title: title || defaultName('task'),
        projectId: currentProjectId ?? '',
        templateId: null
      }
      if (onOpenTaskCreate) {
        onOpenTaskCreate(initial)
        close()
        return
      }
      void navigateTo(currentProjectId ? `${APP_ROUTES.PROJECTS}/${currentProjectId}` : APP_ROUTES.PROJECTS, {
        openCreateTask: true,
        title: initial.title,
        templateId: null
      })
      return
    }
    if (kind === 'project') {
      void navigateTo(embedded ? pathWithCreateQuery(APP_ROUTES.PROJECTS, { name: title }) : APP_ROUTES.PROJECTS, { openCreate: true, name: title })
      return
    }
    if (kind === 'template') {
      void navigateTo(embedded ? pathWithCreateQuery(APP_ROUTES.TASK_TEMPLATES, { name: title }) : APP_ROUTES.TASK_TEMPLATES, { openCreate: true, name: title })
      return
    }
    if (kind === 'agent') {
      void navigateTo(embedded ? pathWithCreateQuery(APP_ROUTES.AGENTS, { name: title }) : APP_ROUTES.AGENTS, { openCreate: true, name: title })
      return
    }
    if (kind === 'skill') {
      void navigateTo(embedded ? pathWithCreateQuery(APP_ROUTES.SKILLS, { title }) : APP_ROUTES.SKILLS, { openCreate: true, title })
      return
    }
    if (kind === 'workspace') {
      void navigateTo(embedded ? pathWithCreateQuery(APP_ROUTES.WORKSPACES, { name: title }) : APP_ROUTES.WORKSPACES, { openCreate: true, name: title })
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

  const scrollTabs = (direction: -1 | 1) => {
    tabsRef.current?.scrollBy({ left: direction * 96, behavior: 'smooth' })
  }

  const startTabScroll = (direction: -1 | 1) => {
    scrollTabs(direction)
    if (tabScrollIntervalRef.current) clearInterval(tabScrollIntervalRef.current)
    tabScrollIntervalRef.current = setInterval(() => {
      tabsRef.current?.scrollBy({ left: direction * 42, behavior: 'auto' })
    }, 55)
  }

  const stopTabScroll = () => {
    if (!tabScrollIntervalRef.current) return
    clearInterval(tabScrollIntervalRef.current)
    tabScrollIntervalRef.current = null
  }

  return (
    <section className={`${styles.commandModal} ${embedded ? styles.commandModalEmbedded : ''}`} role="dialog" aria-modal={!embedded} aria-label="Search or create">
      {embedded ? (
        <div className={styles.commandBrandBar}>
          <span className={styles.commandBrandMark}>OM</span>
          <span className={styles.commandBrandTitle}>OpenMissionControl</span>
        </div>
      ) : null}
      <header className={styles.commandHeader}>
        <LuSearch size={18} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="OpenMissionControl Companion" />
        <button type="button" onClick={close} aria-label="Close search"><LuX size={17} /></button>
      </header>

      <div className={styles.commandTabsShell}>
        <button
          type="button"
          className={styles.commandTabScrollButton}
          onClick={() => scrollTabs(-1)}
          onPointerDown={() => startTabScroll(-1)}
          onPointerLeave={stopTabScroll}
          aria-label="Scroll categories left"
        >
          <LuChevronLeft size={16} />
        </button>
        <nav ref={tabsRef} className={styles.commandTabs} aria-label="Search categories">
          <button type="button" className={`${styles.commandTab} ${styles.commandTabCreate} ${activeTab === 'create' ? styles.commandTabActive : ''}`} onClick={() => setActiveTab('create')}>
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
            <button key={tab} type="button" className={`${styles.commandTab} ${activeTab === tab ? styles.commandTabActive : ''}`} onClick={() => setActiveTab(tab as SearchTab)}>
              {label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={styles.commandTabScrollButton}
          onClick={() => scrollTabs(1)}
          onPointerDown={() => startTabScroll(1)}
          onPointerLeave={stopTabScroll}
          aria-label="Scroll categories right"
        >
          <LuChevronRight size={16} />
        </button>
      </div>

      {error ? <p className={styles.commandError}>{error}</p> : null}

      <div className={styles.commandBody}>
        {activeTab === 'create' ? (
          <div className={styles.commandActions}>
            <button type="button" onClick={() => openCreate('project')}><LuFolderPlus size={16} /><strong>Create project</strong><span>Open project form with optional workspace.</span></button>
            <button type="button" onClick={() => openCreate('task')}><LuListTodo size={16} /><strong>Create task</strong><span>Select a project, optionally use a template.</span></button>
            <button type="button" onClick={() => openCreate('template')}><LuClipboardList size={16} /><strong>Create task template</strong><span>Start an empty reusable template.</span></button>
            <button type="button" onClick={() => openCreate('agent')}><LuBot size={16} /><strong>Create agent</strong><span>Create an agent profile.</span></button>
            <button type="button" onClick={() => openCreate('skill')}><LuSparkles size={16} /><strong>Create skill</strong><span>Create an active capability.</span></button>
            <button type="button" onClick={() => openCreate('gateway')}><LuWaypoints size={16} /><strong>Create gateway</strong><span>Open gateway setup form.</span></button>
            <button type="button" onClick={() => openCreate('workspace')}><LuHardDrive size={16} /><strong>Create workspace</strong><span>Name it first, then choose a folder.</span></button>
          </div>
        ) : (
          <div className={styles.commandResults}>
            {rows.map((row) => (
              <button key={row.id} type="button" onClick={() => row.path ? void navigateTo(row.path, row.state) : undefined}>
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
  )
}
