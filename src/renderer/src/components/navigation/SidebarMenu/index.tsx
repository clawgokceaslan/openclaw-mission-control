import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { LuLayers3, LuPlay, LuRefreshCw, LuRoute, LuWorkflow } from 'react-icons/lu'
import { NAV_BY_GROUP, NAV_GROUP_ORDER } from '@renderer/navigation/nav.config'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS, type PaginatedResponse, type PlannedGatewayTaskRow, type RunningGatewayGroupCounts, type RunningGatewayTasksResponse } from '@shared/contracts/ipc'
import type { Project, TaskGroup } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import styles from './index.module.scss'

const EMPTY_RUNNING_COUNTS: RunningGatewayGroupCounts = {
  all: 0,
  planning: 0,
  running: 0,
  postRunning: 0
}

type QueueSummary = {
  plannedTotal: number
  runningCounts: RunningGatewayGroupCounts
  groupTotal: number
  activeGroupTotal: number
  currentProjectName: string
  error: string | null
}

function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/)
  if (!match || match[1] === 'new') return null
  return decodeURIComponent(match[1])
}

function isQueueActive(group: TaskGroup): boolean {
  return group.planningQueueState.state === 'queued'
    || group.planningQueueState.state === 'running'
    || group.executionQueueState.state === 'queued'
    || group.executionQueueState.state === 'running'
}

function countText(value: number, empty: string): string {
  if (value <= 0) return empty
  return value > 99 ? '99+' : String(value)
}

function TaskExecutionSummary() {
  const { token } = useAuth()
  const location = useLocation()
  const currentProjectId = useMemo(() => projectIdFromPath(location.pathname), [location.pathname])
  const [summary, setSummary] = useState<QueueSummary>({
    plannedTotal: 0,
    runningCounts: EMPTY_RUNNING_COUNTS,
    groupTotal: 0,
    activeGroupTotal: 0,
    currentProjectName: '',
    error: null
  })
  const [loading, setLoading] = useState(false)

  const loadSummary = useCallback(async () => {
    if (!token) {
      setSummary({
        plannedTotal: 0,
        runningCounts: EMPTY_RUNNING_COUNTS,
        groupTotal: 0,
        activeGroupTotal: 0,
        currentProjectName: '',
        error: null
      })
      return
    }

    setLoading(true)
    const scope = currentProjectId ? { projectId: currentProjectId } : {}
    const [plannedResponse, runningResponse, projectsResponse] = await Promise.all([
      invokeBridge<PaginatedResponse<PlannedGatewayTaskRow>>(IPC_CHANNELS.tasks.listPlannedGateway, { actorToken: token, page: 1, pageSize: 1, ...scope }),
      invokeBridge<RunningGatewayTasksResponse>(IPC_CHANNELS.tasks.listRunningGateway, { actorToken: token, page: 1, pageSize: 1, group: 'all', ...scope }),
      invokeBridge<Project[]>(IPC_CHANNELS.projects.list, { actorToken: token })
    ])

    const projects = projectsResponse.ok && Array.isArray(projectsResponse.data) ? projectsResponse.data : []
    const visibleProjects = currentProjectId ? projects.filter((project) => project.id === currentProjectId) : projects
    const groupResponses = await Promise.all(visibleProjects.map((project) => (
      invokeBridge<TaskGroup[]>(IPC_CHANNELS.taskGroups.list, { actorToken: token, projectId: project.id })
    )))
    const groups = groupResponses.flatMap((response) => response.ok && Array.isArray(response.data) ? response.data : [])
    const firstError = [plannedResponse, runningResponse, projectsResponse, ...groupResponses].find((response) => !response.ok)

    setSummary({
      plannedTotal: plannedResponse.ok ? Number(plannedResponse.data?.total ?? 0) : 0,
      runningCounts: runningResponse.ok ? runningResponse.data?.counts ?? EMPTY_RUNNING_COUNTS : EMPTY_RUNNING_COUNTS,
      groupTotal: groups.length,
      activeGroupTotal: groups.filter(isQueueActive).length,
      currentProjectName: currentProjectId ? projects.find((project) => project.id === currentProjectId)?.name ?? '' : '',
      error: firstError?.error?.message ?? null
    })
    setLoading(false)
  }, [currentProjectId, token])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    if (!token) return
    const refresh = () => void loadSummary()
    subscribeToChannel(IPC_CHANNELS.events.taskActivity, refresh)
    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, refresh)
    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, refresh)
      unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, refresh)
    }
  }, [loadSummary, token])

  const executionTotal = summary.runningCounts.running + summary.runningCounts.postRunning
  const contextLabel = summary.currentProjectName || 'Tüm projeler'

  return (
    <section className={styles.taskExecution} aria-label="Task yürütme özeti">
      <div className={styles.taskExecution__header}>
        <div>
          <span>Task yürütme</span>
          <strong title={contextLabel}>{contextLabel}</strong>
        </div>
        <button type="button" onClick={() => void loadSummary()} disabled={loading} aria-label="Task yürütme özetini yenile" title="Yenile">
          <LuRefreshCw size={13} />
        </button>
      </div>
      <div className={styles.taskExecution__grid}>
        <Link className={styles.taskExecution__item} to={currentProjectId ? `/projects/${currentProjectId}` : APP_ROUTES.PROJECTS}>
          <span className={styles.taskExecution__icon}><LuLayers3 size={14} /></span>
          <span className={styles.taskExecution__copy}>
            <strong>Task Grupları</strong>
            <small>{summary.activeGroupTotal > 0 ? `${summary.activeGroupTotal} aktif grup` : `${summary.groupTotal} grup`}</small>
          </span>
          <b>{countText(summary.groupTotal, '0')}</b>
        </Link>
        <Link className={styles.taskExecution__item} to={APP_ROUTES.AUTO_PLANS}>
          <span className={styles.taskExecution__icon}><LuWorkflow size={14} /></span>
          <span className={styles.taskExecution__copy}>
            <strong>Plan Kuyruğu</strong>
            <small>{summary.runningCounts.planning > 0 ? `${summary.runningCounts.planning} planlanıyor` : 'hazır tasklar'}</small>
          </span>
          <b>{countText(summary.plannedTotal, '0')}</b>
        </Link>
        <Link className={styles.taskExecution__item} to={APP_ROUTES.AUTO_RUN}>
          <span className={styles.taskExecution__icon}><LuRoute size={14} /></span>
          <span className={styles.taskExecution__copy}>
            <strong>Çalışma Kuyruğu</strong>
            <small>{executionTotal > 0 ? `${executionTotal} aktif çalışma` : 'başlatmaya hazır'}</small>
          </span>
          <b>{countText(executionTotal, '0')}</b>
        </Link>
      </div>
      {summary.plannedTotal > 0 ? (
        <Link className={styles.taskExecution__quickAction} to={APP_ROUTES.AUTO_RUN}>
          <LuPlay size={13} />
          <span>Sıradaki planlı taskı başlat</span>
        </Link>
      ) : null}
      {summary.error ? (
        <button type="button" className={styles.taskExecution__error} onClick={() => void loadSummary()}>
          Kuyruk özeti alınamadı. Tekrar dene.
        </button>
      ) : null}
    </section>
  )
}

export function SidebarMenu() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarScroll}>
        {NAV_GROUP_ORDER.map((group) => (
          <section key={group} className={styles.navGroup}>
            <h3 className={styles.navGroupTitle}>{group}</h3>
            {group === 'Projects' ? <TaskExecutionSummary /> : null}
            <nav className={styles.navList} aria-label={`${group} navigation`}>
              {NAV_BY_GROUP[group].map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    aria-label={item.label}
                    className={({ isActive }) =>
                      `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                    }
                    end={item.path === '/dashboard'}
                  >
                    <span className={styles.navIcon}><Icon size={15} /></span>
                    <span className={styles.navLabel}>{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>
          </section>
        ))}
      </div>
    </aside>
  )
}
