import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LuArrowLeft, LuArrowUpRight, LuRefreshCw } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Project, ProjectGroup, TaskEntity } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { loadList } from '@renderer/utils/api'
import { LoadingState } from '@renderer/components/loading'
import styles from './ProjectGroupsPage.module.scss'

function formatUpdatedAt(value?: number) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export function ProjectGroupDetailPage() {
  const { groupId } = useParams()
  const { token } = useAuth()
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [status, setStatus] = useState('Loading...')
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setStatus('Loading...')
    const [groupsResponse, projectsResponse, tasksResponse] = await Promise.all([
      loadList<ProjectGroup[]>(IPC_CHANNELS.projectGroups.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token)
    ])
    if (!groupsResponse.ok || !projectsResponse.ok) {
      setStatus('Failed')
      setError(groupsResponse.error?.message ?? projectsResponse.error?.message ?? 'Unable to load project group')
      setGroups([])
      setProjects([])
      return
    }
    setGroups(Array.isArray(groupsResponse.data) ? groupsResponse.data : [])
    setProjects(Array.isArray(projectsResponse.data) ? projectsResponse.data : [])
    setTasks(tasksResponse.ok && Array.isArray(tasksResponse.data) ? tasksResponse.data : [])
    setError(null)
    setStatus('Ready')
  }

  useEffect(() => {
    void refresh()
  }, [groupId, token])

  const group = useMemo(() => groups.find((item) => item.id === groupId) ?? null, [groupId, groups])
  const groupedProjects = useMemo(() => {
    const ids = new Set(group?.projectIds ?? [])
    return projects.filter((project) => ids.has(project.id))
  }, [group?.projectIds, projects])
  const activeProjects = groupedProjects.filter((project) => !project.archived).length
  const projectTaskCount = (projectId: string) => tasks.filter((task) => task.projectId === projectId).length
  const projectProgress = (projectId: string) => {
    const projectTasks = tasks.filter((task) => task.projectId === projectId)
    if (projectTasks.length === 0) return { done: 0, total: 0, percent: 0 }
    const done = projectTasks.filter((task) => {
      const status = task.status.toLowerCase()
      return status.includes('done') || status.includes('closed') || status.includes('complete')
    }).length
    return { done, total: projectTasks.length, percent: Math.round((done / projectTasks.length) * 100) }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link to={APP_ROUTES.PROJECT_GROUPS} className={styles.backLink}><LuArrowLeft size={15} /> Project groups</Link>
          <h1 className={styles.title}>{group?.name ?? 'Project group'}</h1>
          <p className={styles.subtitle}>{group?.description || 'Projects connected under this group.'}</p>
        </div>
        <button type="button" className={styles.createButton} onClick={() => void refresh()}>
          <LuRefreshCw size={15} />
          Refresh
        </button>
      </header>

      {error ? <p className={styles.formError}>{error}</p> : null}
      {status !== 'Ready' ? <LoadingState variant="skeleton" rows={4} columns={5} messageIndex={1} /> : null}

      {!group && status === 'Ready' ? (
        <section className={styles.tableCard}>
          <div className={styles.emptyRow}>Project group was not found.</div>
        </section>
      ) : null}

      {group ? (
        <section className={styles.tableCard}>
          <div className={styles.detailHero}>
            <div>
              <span className={styles.detailEyebrow}>Group overview</span>
              <h2>{group.name}</h2>
              <p>{group.description || 'Projects connected under this group.'}</p>
            </div>
            <div className={styles.detailStats}>
              <span><strong>{groupedProjects.length}</strong> projects</span>
              <span><strong>{activeProjects}</strong> active</span>
              <span><strong>{tasks.filter((task) => groupedProjects.some((project) => project.id === task.projectId)).length}</strong> tasks</span>
              <span><strong>{formatUpdatedAt(group.updatedAt)}</strong> updated</span>
            </div>
          </div>
          <div className={styles.detailTableHead}>
            <span>Project</span>
            <span>Progress</span>
            <span>State</span>
            <span>Updated</span>
            <span>Actions</span>
          </div>
          {groupedProjects.length > 0 ? groupedProjects.map((project) => {
            const progress = projectProgress(project.id)
            return (
              <div key={project.id} className={styles.detailTableRow}>
                <span>
                  <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={styles.projectName}>{project.name}</Link>
                  <small>{project.description || `${projectTaskCount(project.id)} tasks in this project.`}</small>
                </span>
                <span className={styles.detailProgressCell}>
                  <small>{progress.percent}% · {progress.done}/{progress.total} done</small>
                  <i><b style={{ width: `${progress.percent}%` }} /></i>
                </span>
                <span className={styles.projectCount}>{project.archived ? 'Archived' : 'Active'}</span>
                <span className={styles.updatedCell}>{formatUpdatedAt(project.updatedAt)}</span>
                <span className={styles.actionsCell}>
                  <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={styles.iconButton} aria-label={`Open ${project.name}`}>
                    <LuArrowUpRight size={15} />
                  </Link>
                </span>
              </div>
            )
          }) : (
            <div className={styles.emptyRow}>No projects in this group yet.</div>
          )}
        </section>
      ) : null}
    </section>
  )
}
