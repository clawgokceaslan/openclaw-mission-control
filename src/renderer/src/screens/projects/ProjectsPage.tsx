import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LuArrowUpRight, LuPlus, LuRefreshCw, LuX } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import type { Project, ProjectGroup, ProjectStatus, StatusTemplate, TaskEntity, Workspace } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { LoadingState } from '@renderer/components/loading'
import { PROJECT_STATUS_COLUMNS } from './detail/status'
import styles from './ProjectsPage.module.scss'

function formatProjectTime(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

export function ProjectsPage() {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({})
  const [status, setStatus] = useState('Yukleniyor...')
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [statusTemplates, setStatusTemplates] = useState<StatusTemplate[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [workspaceDraftName, setWorkspaceDraftName] = useState('')
  const [workspaceDraftPath, setWorkspaceDraftPath] = useState('')
  const [showWorkspaceCreate, setShowWorkspaceCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const selectedTemplate = useMemo(
    () => statusTemplates.find((template) => template.id === selectedTemplateId) ?? statusTemplates[0] ?? null,
    [selectedTemplateId, statusTemplates]
  )

  const closeCreateModal = () => {
    setShowCreate(false)
    setName('')
    setDescription('')
    setSelectedTemplateId(statusTemplates[0]?.id ?? '')
    setSelectedWorkspaceId('')
  }

  const loadProjects = async () => {
    setStatus('Yukleniyor...')
    const [response, taskResponse, groupResponse] = await Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token),
      loadList<ProjectGroup[]>(IPC_CHANNELS.projectGroups.list, token)
    ])
    if (!response.ok) {
      setError(response.error?.message ?? 'Yukleme hatasi')
      setStatus('Yukleme hatasi')
      setItems([])
      return
    }

    const projects = Array.isArray(response.data) ? response.data : []
    setItems(projects)
    setTasks(taskResponse.ok && Array.isArray(taskResponse.data) ? taskResponse.data : [])
    setGroups(groupResponse.ok && Array.isArray(groupResponse.data) ? groupResponse.data : [])
    const statusEntries = await Promise.all(projects.map(async (project) => {
      const statusResponse = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId: project.id })
      return [project.id, statusResponse.ok && Array.isArray(statusResponse.data) ? statusResponse.data : []] as const
    }))
    setStatusesByProject(Object.fromEntries(statusEntries))
    setStatus('Hazir')
    setError(null)
  }

  useEffect(() => {
    void loadProjects()
  }, [token])

  useEffect(() => {
    const state = location.state as { openCreate?: boolean; name?: string } | null
    const searchParams = new URLSearchParams(location.search)
    const shouldOpen = Boolean(state?.openCreate) || searchParams.get('create') === '1'
    if (!shouldOpen) return
    setName(state?.name ?? searchParams.get('name') ?? '')
    setDescription('')
    setShowCreate(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    const loadTemplates = async () => {
      const [response, workspaceResponse] = await Promise.all([
        invokeBridge<StatusTemplate[]>(IPC_CHANNELS.statuses.listTemplates, { actorToken: token }),
        loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token)
      ])
      if (!response.ok) {
        setError(response.error?.message ?? 'Unable to load status templates')
        return
      }
      const rows = Array.isArray(response.data) ? response.data : []
      setStatusTemplates(rows)
      setSelectedTemplateId((current) => current || rows[0]?.id || '')
      if (workspaceResponse.ok) setWorkspaces(Array.isArray(workspaceResponse.data) ? workspaceResponse.data : [])
    }

    void loadTemplates()
  }, [token])

  const chooseWorkspaceFolder = async () => {
    const pickResponse = await invokeBridge<{ rootPath: string } | null>(IPC_CHANNELS.workspaces.pickFolder, { actorToken: token })
    if (!pickResponse.ok) {
      setError(pickResponse.error?.message ?? 'Unable to select workspace folder')
      return
    }
    const rootPath = pickResponse.data?.rootPath
    if (!rootPath) return
    setWorkspaceDraftPath(rootPath)
  }

  const createWorkspaceFromDraft = async () => {
    if (!workspaceDraftName.trim() || !workspaceDraftPath.trim()) return
    const createResponse = await invokeBridge<Workspace>(IPC_CHANNELS.workspaces.create, {
      actorToken: token,
      name: workspaceDraftName.trim(),
      rootPath: workspaceDraftPath.trim()
    })
    if (!createResponse.ok || !createResponse.data) {
      setError(createResponse.error?.message ?? 'Unable to create workspace')
      return
    }
    setWorkspaces((current) => [createResponse.data!, ...current.filter((item) => item.id !== createResponse.data!.id)])
    setSelectedWorkspaceId(createResponse.data.id)
    setWorkspaceDraftName('')
    setWorkspaceDraftPath('')
    setShowWorkspaceCreate(false)
  }

  const groupForProject = (projectId: string) => groups.find((group) => Array.isArray(group.projectIds) && group.projectIds.includes(projectId))

  const progressForProject = (project: Project) => {
    const projectTasks = tasks.filter((task) => task.projectId === project.id)
    const statuses = statusesByProject[project.id]?.length
      ? statusesByProject[project.id]
      : PROJECT_STATUS_COLUMNS.map((column, index) => ({
        id: column.status,
        name: column.title,
        color: column.accent,
        category: column.category,
        sortOrder: index,
        projectId: project.id,
        createdAt: 0,
        updatedAt: 0
      }))
    const total = projectTasks.length
    const doneStatusIds = new Set(statuses.filter((item) => item.category === 'done' || item.category === 'closed').map((item) => item.id))
    const done = projectTasks.filter((task) => doneStatusIds.has(task.status)).length
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    const segments = statuses.map((status) => {
      const count = projectTasks.filter((task) => task.status === status.id).length
      return {
        id: status.id,
        name: status.name,
        color: status.color,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0
      }
    }).filter((segment) => segment.count > 0)
    return { total, done, percent, segments }
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    setCreating(true)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.create, {
      actorToken: token,
      name: name.trim(),
      description: description.trim() || undefined,
      workspaceId: selectedWorkspaceId || null
    })

    if (!response.ok) {
      setCreating(false)
      setError(response.error?.message ?? 'Olusturulamadi')
      return
    }

    if (response.data?.id && selectedTemplateId) {
      const templateResponse = await invokeBridge(IPC_CHANNELS.statuses.applyTemplateToProject, {
        actorToken: token,
        projectId: response.data.id,
        templateId: selectedTemplateId
      })
      if (!templateResponse.ok) {
        setCreating(false)
        setError(templateResponse.error?.message ?? 'Project created, but status template could not be applied.')
        await loadProjects()
        return
      }
    }

    setCreating(false)
    closeCreateModal()
    await loadProjects()
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Projects</h1>
          <p>Manage projects and task workflows. {items.length} project total.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadProjects()}>
            <LuRefreshCw size={15} />
            Refresh
          </button>
          <button className={styles.primaryButton} type="button" onClick={() => setShowCreate(true)}>
            <LuPlus size={16} />
            Create project
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status !== 'Hazir' ? <p className={styles.notice}>{status}</p> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <span>Project</span>
          <span>Project group</span>
          <span>Progress</span>
          <span>State</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {items.length > 0 ? items.map((project) => {
          const group = groupForProject(project.id)
          const progress = progressForProject(project)
          return (
            <div key={project.id} className={styles.tableRow}>
              <span>
                <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={styles.tableName}>
                  {project.name}
                </Link>
                <small>{project.description || 'No description.'}</small>
              </span>
              <span>
                {group ? (
                  <Link to={`${APP_ROUTES.PROJECT_GROUPS}/${group.id}`} className={styles.groupLink}>{group.name}</Link>
                ) : (
                  <span className={styles.ungrouped}>Ungrouped</span>
                )}
              </span>
              <span className={styles.progressCell}>
                <span className={styles.progressMeta}>{progress.percent}% · {progress.done}/{progress.total} done</span>
                <span className={styles.progressBar}>
                  {progress.segments.length > 0 ? progress.segments.map((segment) => (
                    <i key={segment.id} title={`${segment.name}: ${segment.percent}%`} style={{ width: `${Math.max(segment.percent, 4)}%`, background: segment.color }} />
                  )) : <i style={{ width: '100%', background: 'var(--omc-border-subtle)' }} />}
                </span>
              </span>
              <span>
                <span className={`${styles.statePill} ${project.archived ? styles.stateArchived : styles.stateActive}`}>
                  {project.archived ? 'Archived' : 'Active'}
                </span>
              </span>
              <span className={styles.updatedCell}>{formatProjectTime(project.updatedAt)}</span>
              <span className={styles.actionsCell}>
                <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={styles.textIconButton}>
                  <LuArrowUpRight size={15} />
                  Open
                </Link>
              </span>
            </div>
          )
        }) : (
          <div className={styles.emptyRow}>No projects yet.</div>
        )}
      </section>

      {showCreate ? (
        <>
          <div className={styles.modalBackdrop} onClick={closeCreateModal} />
          <section className={styles.createModal} role="dialog" aria-modal="true" aria-label="Create project">
            <header className={styles.modalHeader}>
              <div>
                <h2>Create project</h2>
                <p>Initialize a project and choose its workflow template.</p>
              </div>
              <button type="button" onClick={closeCreateModal} aria-label="Close create project modal">
                <LuX size={16} />
              </button>
            </header>
            <form onSubmit={handleCreate} className={styles.form}>
              <label>
                <span>Project name</span>
                <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  id="project-description"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span>Status template</span>
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={statusTemplates.length === 0}>
                  {statusTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.items?.length ?? 0} statuses)
                    </option>
                  ))}
                </select>
                {statusTemplates.length === 0 ? <LoadingState size="compact" messageIndex={3} /> : null}
              </label>
              <label>
                <span>Workspace</span>
                <div className={styles.inlinePicker}>
                  <select value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
                    <option value="">No workspace yet</option>
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                    ))}
                  </select>
                  <button type="button" className={styles.secondaryButton} onClick={() => setShowWorkspaceCreate((value) => !value)}>
                    Add workspace
                  </button>
                </div>
              </label>
              {showWorkspaceCreate ? (
                <div className={styles.inlineCreateCard}>
                  <label>
                    <span>Workspace name</span>
                    <input value={workspaceDraftName} onChange={(event) => setWorkspaceDraftName(event.target.value)} />
                  </label>
                  <label>
                    <span>Folder path</span>
                    <div className={styles.inlinePicker}>
                      <input value={workspaceDraftPath} onChange={(event) => setWorkspaceDraftPath(event.target.value)} />
                      <button type="button" className={styles.secondaryButton} onClick={() => void chooseWorkspaceFolder()}>
                        Choose folder
                      </button>
                    </div>
                  </label>
                  <div className={styles.formActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => setShowWorkspaceCreate(false)}>Cancel</button>
                    <button type="button" className={styles.primaryButton} disabled={!workspaceDraftName.trim() || !workspaceDraftPath.trim()} onClick={() => void createWorkspaceFromDraft()}>
                      Save workspace
                    </button>
                  </div>
                </div>
              ) : null}
              {selectedTemplate ? (
                <div className={styles.statusPreview}>
                  <div className={styles.statusPreviewHeader}>
                    <span>Selected statuses</span>
                    <strong>{selectedTemplate.items?.length ?? 0}</strong>
                  </div>
                  <div className={styles.statusPreviewList}>
                    {(selectedTemplate.items ?? []).map((status) => (
                      <span key={status.id} className={styles.statusPreviewItem}>
                        <i style={{ background: status.color }} />
                        {status.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <footer className={styles.modalFooter}>
                <button className={styles.secondaryButton} type="button" onClick={closeCreateModal} disabled={creating}>Cancel</button>
                <button className={styles.primaryButton} type="submit" disabled={creating || !name.trim() || statusTemplates.length === 0}>
                  {creating ? 'Creating...' : 'Create project'}
                </button>
              </footer>
            </form>
          </section>
        </>
      ) : null}
    </section>
  )
}
