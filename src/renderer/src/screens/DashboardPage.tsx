import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  ArcElement,
  BarElement,
  Tooltip
} from 'chart.js'
import { Bar, Doughnut, Line, Radar } from 'react-chartjs-2'
import { LuActivity, LuArrowRight, LuBot, LuBoxes, LuCircle, LuFolderKanban, LuRefreshCw, LuTimer, LuWaypoints } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { LoadingState } from '@renderer/components/loading'
import type { Agent, Gateway, GatewaySession, Job, Project, ProjectStatus, Skill, TaskEntity } from '@shared/types/entities'
import styles from './DashboardPage.module.scss'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, RadialLinearScale, Filler, Tooltip, Legend)

interface SessionRow {
  id: string
  label: string
  endpoint: string
  status: string
  seenAt: number
}

interface ActivityRow {
  id: string
  title: string
  subtitle: string
  updatedAt: number
}

interface DashboardVm {
  agents: Agent[]
  skills: Skill[]
  projects: Project[]
  tasks: TaskEntity[]
  statuses: ProjectStatus[]
  gateways: Gateway[]
  jobs: Job[]
  sessions: SessionRow[]
  activities: ActivityRow[]
}

interface StatusWorkloadRow {
  key: string
  label: string
  color: string
  count: number
}

type MetricCardProps = {
  label: string
  value: string | number
  hint: string
  icon: React.ReactNode
  tone?: 'default' | 'success' | 'warn'
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (!Number.isFinite(diff) || diff < 0) return 'now'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function taskStatus(task: TaskEntity): string {
  return task.status || 'unknown'
}

function statusFallbackLabel(status: string): string {
  if (!status || status === 'unknown') return 'Unknown'
  return status
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function buildStatusWorkload(tasks: TaskEntity[], statuses: ProjectStatus[]): StatusWorkloadRow[] {
  const statusById = new Map(statuses.map((status) => [status.id, status]))
  const rows = new Map<string, StatusWorkloadRow>()
  tasks.forEach((task) => {
    const statusId = taskStatus(task)
    const status = statusById.get(statusId)
    const label = status?.name ?? statusFallbackLabel(statusId)
    const color = status?.color || '#2F80ED'
    const key = status ? `${label}::${color}` : statusId
    const current = rows.get(key)
    if (current) {
      current.count += 1
      return
    }
    rows.set(key, {
      key,
      label,
      color,
      count: 1
    })
  })
  return [...rows.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = keyFn(row)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`
}

function MetricCard({ label, value, hint, icon, tone = 'default' }: MetricCardProps) {
  return (
    <article className={`${styles.metricCard} ${tone === 'success' ? styles.metricSuccess : ''} ${tone === 'warn' ? styles.metricWarn : ''}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function useDashboardData() {
  const { token } = useAuth()
  const [vm, setVm] = useState<DashboardVm | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = async () => {
    setLoading(true)
    const [agentsRes, skillsRes, tasksRes, projectsRes, gatewaysRes, jobsRes, activeGatewayRes] = await Promise.all([
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<Job[]>(IPC_CHANNELS.jobs.list, token),
      invokeBridge<{ gatewayId: string | null }>(IPC_CHANNELS.appSettings.getActiveGateway, { actorToken: token })
    ])
    const failures = [agentsRes, skillsRes, tasksRes, projectsRes, gatewaysRes, jobsRes].filter((item) => !item.ok)
    if (failures.length > 0) {
      setError(failures[0]?.error?.message ?? 'Dashboard data could not be loaded')
      setLoading(false)
      return
    }
    const activeGatewayId = activeGatewayRes.ok ? activeGatewayRes.data?.gatewayId : null
    const projects = safeArray<Project>(projectsRes.data)
    const statusResponses = await Promise.all(projects.map((project) => invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, {
      actorToken: token,
      projectId: project.id
    })))
    const statuses = statusResponses.flatMap((response) => response.ok ? safeArray<ProjectStatus>(response.data) : [])
    const gateways = safeArray<Gateway>(gatewaysRes.data).sort((a, b) => {
      if (a.id === activeGatewayId) return -1
      if (b.id === activeGatewayId) return 1
      return 0
    })
    const sessionResponses = await Promise.all(gateways.map((gateway) => invokeBridge<GatewaySession[]>(IPC_CHANNELS.gateways.sessions, {
      actorToken: token,
      gatewayId: gateway.id
    })))
    const sessions: SessionRow[] = []
    gateways.forEach((gateway, index) => {
      const rows = sessionResponses[index]?.ok ? safeArray<GatewaySession>(sessionResponses[index].data) : []
      rows.forEach((row) => sessions.push({
        id: row.id,
        label: gateway.name,
        endpoint: gateway.endpoint,
        status: row.status,
        seenAt: row.lastSeenAt
      }))
    })
    const jobs = safeArray<Job>(jobsRes.data)
    setVm({
      agents: safeArray<Agent>(agentsRes.data),
      skills: safeArray<Skill>(skillsRes.data),
      tasks: safeArray<TaskEntity>(tasksRes.data),
      projects,
      statuses,
      gateways,
      jobs,
      sessions,
      activities: jobs.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((job) => ({
        id: job.id,
        title: job.type,
        subtitle: `${job.status} · attempts ${job.attempts}/${job.maxAttempts}`,
        updatedAt: job.updatedAt
      }))
    })
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    void loadDashboard()
  }, [token])

  return { vm, loading, error, reload: loadDashboard }
}

function buildMetrics(vm: DashboardVm) {
  const completed = vm.tasks.filter((task) => ['completed', 'done', 'closed'].includes(taskStatus(task))).length
  const failed = vm.tasks.filter((task) => ['failed', 'review'].includes(taskStatus(task))).length
  const activeTasks = vm.tasks.filter((task) => ['running', 'in_progress', 'active'].includes(taskStatus(task))).length
  const configuredAgents = vm.agents.length
  const onlineAgents = vm.agents.filter((agent) => agent.status !== 'offline').length
  const onlineGateways = vm.gateways.filter((gateway) => gateway.status === 'online').length
  const errorRate = completed + failed > 0 ? (failed / (completed + failed)) * 100 : 0
  return { completed, failed, activeTasks, configuredAgents, onlineAgents, onlineGateways, errorRate }
}

export function DashboardPage() {
  const { vm, loading, error, reload } = useDashboardData()
  const metrics = vm ? buildMetrics(vm) : null
  const statusWorkload = useMemo(() => vm ? buildStatusWorkload(vm.tasks, vm.statuses) : [], [vm])
  const projectProgress = useMemo(() => {
    if (!vm) return null
    const completedStatuses = new Set(['completed', 'done', 'closed'])
    const rows = vm.projects.map((project) => {
      const projectTasks = vm.tasks.filter((task) => task.projectId === project.id)
      const completed = projectTasks.filter((task) => completedStatuses.has(taskStatus(task))).length
      return {
        project,
        total: projectTasks.length,
        completed,
        percent: projectTasks.length > 0 ? Math.round((completed / projectTasks.length) * 100) : 0
      }
    })
    const busiest = [...rows].sort((a, b) => b.total - a.total)[0]
    const active = rows.filter((row) => row.total > 0 && row.percent < 100).length
    return { rows, busiest, active }
  }, [vm])

  return (
    <section className={styles.dashboard}>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Dashboard</h1>
          <p className={styles.pageSubtitle}>A quick operational entry point for current mission health.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.refreshBtn} onClick={() => void reload()}><LuRefreshCw size={15} />Refresh</button>
          <Link className={styles.primaryLink} to={APP_ROUTES.DASHBOARD_DETAIL}>Detailed dashboard <LuArrowRight size={15} /></Link>
        </div>
      </header>
      {error ? <p className={styles.dashboardNotice}>{error}</p> : null}
      {loading ? <LoadingState messageIndex={0} /> : null}
      {vm && metrics ? (
        <>
          <div className={styles.heroGrid}>
            <MetricCard label="Active tasks" value={metrics.activeTasks} hint={`${vm.tasks.length} total tasks`} icon={<LuBoxes size={17} />} />
            <MetricCard label="Agents" value={metrics.configuredAgents} hint="configured" icon={<LuBot size={17} />} tone="success" />
            <MetricCard label="Gateways online" value={metrics.onlineGateways} hint={`${vm.gateways.length} configured`} icon={<LuWaypoints size={17} />} tone={metrics.onlineGateways === vm.gateways.length ? 'success' : 'warn'} />
            <MetricCard label="Error rate" value={percent(metrics.errorRate)} hint={`${metrics.failed} failed/review items`} icon={<LuActivity size={17} />} tone="warn" />
          </div>
          <div className={styles.overviewGrid}>
            <section className={styles.panelCard}>
              <h2>Mission snapshot</h2>
              <div className={styles.snapshotList}>
                <span><b>{vm.projects.length}</b> projects</span>
                <span><b>{vm.skills.filter((skill) => skill.status === 'active').length}</b> active skills</span>
                <span><b>{metrics.completed}</b> completed tasks</span>
                <span><b>{vm.sessions.length}</b> gateway sessions</span>
              </div>
            </section>
            <section className={styles.panelCard}>
              <h2>Recent activity</h2>
              <div className={styles.feedWrap}>
                {vm.activities.length > 0 ? vm.activities.map((activity) => (
                  <article key={activity.id} className={styles.feedRow}>
                    <div>
                      <p className={styles.feedTitle}><LuCircle size={7} className={styles.dot} /> {activity.title}</p>
                      <p className={styles.feedSub}>{activity.subtitle}</p>
                    </div>
                    <span className={styles.feedMeta}>{relativeTime(activity.updatedAt)}</span>
                  </article>
                )) : <p className={styles.emptyText}>No recent activity.</p>}
              </div>
            </section>
            <section className={styles.panelCard}>
              <h2>Workload by status</h2>
              <div className={styles.statusStack}>
                {statusWorkload.length > 0 ? statusWorkload.map((row) => {
                  const count = row.count
                  const width = vm.tasks.length > 0 ? Math.max(4, Math.round((count / vm.tasks.length) * 100)) : 0
                  return (
                    <div key={row.key} className={styles.statusRow} style={{ '--status-color': row.color } as CSSProperties}>
                      <span>{row.label}</span>
                      <strong>{count}</strong>
                      <i><b style={{ width: `${width}%` }} /></i>
                    </div>
                  )
                }) : <p className={styles.emptyText}>No workload yet.</p>}
              </div>
            </section>
            <section className={styles.panelCard}>
              <h2>Gateway sessions</h2>
              <div className={styles.sessionList}>
                {vm.sessions.length > 0 ? vm.sessions.slice(0, 5).map((session) => (
                  <article key={session.id} className={styles.sessionRow}>
                    <div>
                      <strong>{session.label}</strong>
                      <span>{session.endpoint}</span>
                    </div>
                    <em>{session.status} · {relativeTime(session.seenAt)}</em>
                  </article>
                )) : <p className={styles.emptyText}>No active gateway sessions.</p>}
              </div>
            </section>
            <section className={styles.panelCard}>
              <h2>Readiness</h2>
              <div className={styles.snapshotList}>
                <span><b>{vm.agents.filter((agent) => agent.trainingMarkdown?.trim()).length}</b> prompted agents</span>
                <span><b>{vm.skills.filter((skill) => skill.status === 'active').length}</b> active skills</span>
                <span><b>{vm.gateways.filter((gateway) => gateway.status === 'online').length}</b> online gateways</span>
                <span><b>{vm.jobs.filter((job) => job.status === 'failed').length}</b> failed jobs</span>
              </div>
            </section>
            <section className={styles.panelCard}>
              <h2>Project progress</h2>
              <div className={styles.projectProgressCard}>
                <span><LuFolderKanban size={18} /></span>
                <div>
                  <strong>{projectProgress?.active ?? 0} active projects</strong>
                  <p>{projectProgress?.busiest ? `${projectProgress.busiest.project.name} has ${projectProgress.busiest.total} tasks` : 'No project workload yet.'}</p>
                </div>
                <i><b style={{ width: `${projectProgress?.busiest?.percent ?? 0}%` }} /></i>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </section>
  )
}

export function DetailedDashboardPage() {
  const { vm, loading, error, reload } = useDashboardData()
  const metrics = vm ? buildMetrics(vm) : null
  const statusWorkload = useMemo(() => vm ? buildStatusWorkload(vm.tasks, vm.statuses) : [], [vm])
  const projectCounts = useMemo(() => {
    if (!vm) return {}
    return vm.projects.reduce<Record<string, number>>((acc, project) => {
      acc[project.name] = vm.tasks.filter((task) => task.projectId === project.id).length
      return acc
    }, {})
  }, [vm])
  const jobCounts = useMemo(() => vm ? countBy(vm.jobs, (job) => new Date(job.updatedAt).toLocaleDateString()) : {}, [vm])

  const statusLabels = statusWorkload.map((row) => row.label)
  const projectLabels = Object.keys(projectCounts)
  const jobLabels = Object.keys(jobCounts).slice(-12)

  return (
    <section className={styles.dashboard}>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Detailed dashboard</h1>
          <p className={styles.pageSubtitle}>Charts and operational reports across projects, tasks, gateways, agents, and skills.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.refreshBtn} to={APP_ROUTES.DASHBOARD}>Simple view</Link>
          <button type="button" className={styles.refreshBtn} onClick={() => void reload()}><LuRefreshCw size={15} />Refresh</button>
        </div>
      </header>
      {error ? <p className={styles.dashboardNotice}>{error}</p> : null}
      {loading ? <LoadingState messageIndex={1} /> : null}
      {vm && metrics ? (
        <>
          <div className={styles.heroGrid}>
            <MetricCard label="Completion" value={metrics.completed} hint={`${vm.tasks.length} total tasks`} icon={<LuTimer size={17} />} tone="success" />
            <MetricCard label="Backlog" value={vm.tasks.length - metrics.completed} hint="Open task load" icon={<LuBoxes size={17} />} />
            <MetricCard label="Error rate" value={percent(metrics.errorRate)} hint="Failed/review ratio" icon={<LuActivity size={17} />} tone="warn" />
            <MetricCard label="Gateway health" value={`${metrics.onlineGateways}/${vm.gateways.length}`} hint="Online gateways" icon={<LuWaypoints size={17} />} tone="success" />
          </div>
          <div className={styles.chartGrid}>
            <section className={styles.chartCard}>
              <h2>Task status distribution</h2>
              <Doughnut data={{ labels: statusLabels, datasets: [{ data: statusWorkload.map((row) => row.count), backgroundColor: statusWorkload.map((row) => row.color) }] }} />
            </section>
            <section className={styles.chartCard}>
              <h2>Tasks by project</h2>
              <Bar data={{ labels: projectLabels, datasets: [{ label: 'Tasks', data: projectLabels.map((label) => projectCounts[label]), backgroundColor: '#2F80ED' }] }} />
            </section>
            <section className={styles.chartCard}>
              <h2>Job activity</h2>
              <Line data={{ labels: jobLabels, datasets: [{ label: 'Jobs', data: jobLabels.map((label) => jobCounts[label]), borderColor: '#29B764', backgroundColor: 'rgba(41,183,100,0.18)', fill: true, tension: 0.3 }] }} />
            </section>
            <section className={styles.chartCard}>
              <h2>Operational readiness</h2>
              <Radar data={{
                labels: ['Agents', 'Skills', 'Gateways', 'Tasks', 'Completion'],
                datasets: [{
                  label: 'Readiness',
                  data: [
                    vm.agents.length ? (metrics.onlineAgents / vm.agents.length) * 100 : 0,
                    vm.skills.length ? (vm.skills.filter((skill) => skill.status === 'active').length / vm.skills.length) * 100 : 0,
                    vm.gateways.length ? (metrics.onlineGateways / vm.gateways.length) * 100 : 0,
                    vm.tasks.length ? ((vm.tasks.length - metrics.failed) / vm.tasks.length) * 100 : 0,
                    vm.tasks.length ? (metrics.completed / vm.tasks.length) * 100 : 0
                  ],
                  borderColor: '#8B5CF6',
                  backgroundColor: 'rgba(139,92,246,0.18)'
                }]
              }} />
            </section>
          </div>
        </>
      ) : null}
    </section>
  )
}
