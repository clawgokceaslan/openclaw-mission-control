import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Row,
  Stack,
  Table
} from 'react-bootstrap'
import {
  LuArrowUpRight,
  LuBot,
  LuBoxes,
  LuCircle,
  LuInfo,
  LuTimer,
  LuActivity
} from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import type {
  Agent,
  Project,
  Gateway,
  GatewaySession,
  Job,
  TaskEntity
} from '@shared/types/entities'
import styles from './DashboardPage.module.scss'

interface SessionRow {
  id: string
  label: string
  endpoint: string
  status: string
  seenAt: number
  usage: string
}

interface ActivityRow {
  id: string
  title: string
  subtitle: string
  updatedAt: number
}

interface DashboardVm {
  onlineAgents: number
  totalAgents: number
  tasksInProgress: number
  latestCompleted: number
  errorRate: number
  completionSpeed: number
  workloadTotal: number
  workloadInbox: number
  workloadProgress: number
  workloadReview: number
  workloadCompleted: number
  throughputCompleted: number
  throughputAverage: number
  throughputErrorRate: number
  throughputConsistencyDays: number
  throughputReviewBacklogRatio: number
  gatewayConfigured: number
  gatewayConnected: number
  gatewayUnavailable: number
  gatewayIssues: number
  sessions: SessionRow[]
  activities: ActivityRow[]
}

interface JobMetricMap {
  [key: string]: number
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
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function toPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function toRate(value: number): string {
  return `${value.toFixed(1)}/day`
}

function buildDashboardViewModel(input: {
  agents: Agent[]
  tasks: TaskEntity[]
  projects: Project[]
  gateways: Gateway[]
  jobs: Job[]
  metrics: JobMetricMap
  sessions: SessionRow[]
}): DashboardVm {
  const { agents, tasks, projects, gateways, jobs, sessions } = input

  const onlineAgents = agents.filter((agent) => agent.status !== 'offline').length
  const tasksInProgress = tasks.filter((task) => task.status === 'running').length
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const failedTasks = tasks.filter((task) => task.status === 'failed').length
  const pendingTasks = tasks.filter((task) => task.status === 'pending').length

  const gatewayConnected = gateways.filter((gateway) => gateway.status === 'online').length
  const gatewayUnavailable = gateways.filter((gateway) => gateway.status === 'offline').length
  const gatewayIssues = gateways.filter((gateway) => gateway.status === 'connecting').length

  const totalForError = completedTasks + failedTasks
  const errorRate = totalForError > 0 ? (failedTasks / totalForError) * 100 : 0

  const taskTimes = tasks.map((task) => task.updatedAt).filter((value) => Number.isFinite(value))
  const minUpdated = taskTimes.length > 0 ? Math.min(...taskTimes) : Date.now()
  const activeDays = Math.max(1, Math.ceil((Date.now() - minUpdated) / 86400000))
  const completionSpeed = completedTasks / activeDays

  const latestCompleted = jobs.filter((job) => job.status === 'done').length
  const activityRows = [...jobs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((job) => ({
      id: job.id,
      title: `${job.type} received from Can bot.`,
      subtitle: `Attempts ${job.attempts}/${job.maxAttempts}`,
      updatedAt: job.updatedAt
    }))

  const throughputAverage = input.metrics.completedPerDay ?? completionSpeed
  const throughputErrorRate = input.metrics.errorRate ?? errorRate

  return {
    onlineAgents,
    totalAgents: agents.length,
    tasksInProgress,
    latestCompleted,
    errorRate,
    completionSpeed,
    workloadTotal: tasks.length,
    workloadInbox: pendingTasks,
    workloadProgress: tasksInProgress,
    workloadReview: failedTasks,
    workloadCompleted: completedTasks,
    throughputCompleted: completedTasks,
    throughputAverage,
    throughputErrorRate,
    throughputConsistencyDays: activeDays,
    throughputReviewBacklogRatio: tasks.length > 0 ? failedTasks / tasks.length : 0,
    gatewayConfigured: gateways.length,
    gatewayConnected,
    gatewayUnavailable,
    gatewayIssues,
    sessions: sessions.slice(0, 8),
    activities: activityRows
  }
}

function StatRows({ rows }: { rows: Array<{ label: string; value: string | number; tone?: 'success' | 'default' }> }) {
  return (
    <Table responsive size="sm" className={styles.statTable}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td className={`${styles.valueCell} ${row.tone === 'success' ? styles.successCell : ''}`}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function KpiCard({
  title,
  value,
  meta,
  icon,
  tone = 'default'
}: {
  title: string
  value: string
  meta: string
  icon: React.ReactNode
  tone?: 'default' | 'success' | 'warn'
}) {
  return (
    <Card className={styles.kpiCard}>
      <Card.Body className={styles.kpiBody}>
        <div>
          <p className={styles.kpiLabel}>{title}</p>
          <h3 className={styles.kpiValue}>{value}</h3>
          <p className={styles.kpiMeta}>{meta}</p>
        </div>
        <span className={`${styles.kpiIcon} ${tone === 'success' ? styles.kpiSuccess : ''} ${tone === 'warn' ? styles.kpiWarn : ''}`}>
          {icon}
        </span>
      </Card.Body>
    </Card>
  )
}

export function DashboardPage() {
  const { token } = useAuth()
  const [vm, setVm] = useState<DashboardVm | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = async () => {
    setLoading(true)

    const [agentsRes, tasksRes, projectsRes, gatewaysRes, jobsRes, metricsRes] = await Promise.all([
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<Job[]>(IPC_CHANNELS.jobs.list, token),
      invokeBridge<JobMetricMap>(IPC_CHANNELS.jobs.metrics, { actorToken: token })
    ])

    const failures = [agentsRes, tasksRes, projectsRes, gatewaysRes, jobsRes].filter((item) => !item.ok)
    if (failures.length > 0) {
      setError(failures[0]?.error?.message ?? 'Dashboard verisi yuklenemedi')
      setLoading(false)
      return
    }

    const gateways = safeArray<Gateway>(gatewaysRes.data)
    const sessionResponses = await Promise.all(
      gateways.map((gateway) => invokeBridge<GatewaySession[]>(IPC_CHANNELS.gateways.sessions, {
        actorToken: token,
        gatewayId: gateway.id
      }))
    )

    const sessions: SessionRow[] = []
    gateways.forEach((gateway, index) => {
      const response = sessionResponses[index]
      const rows = response?.ok ? safeArray<GatewaySession>(response.data) : []
      rows.forEach((row, rowIndex) => {
        sessions.push({
          id: row.id,
          label: gateway.name,
          endpoint: gateway.endpoint,
          status: row.status,
          seenAt: row.lastSeenAt,
          usage: `${(120 + rowIndex * 7).toFixed(1)}k/200.0k (${60 - rowIndex * 6}%)`
        })
      })
    })

    setVm(buildDashboardViewModel({
      agents: safeArray<Agent>(agentsRes.data),
      tasks: safeArray<TaskEntity>(tasksRes.data),
      projects: safeArray<Project>(projectsRes.data),
      gateways,
      jobs: safeArray<Job>(jobsRes.data),
      metrics: metricsRes.ok ? (metricsRes.data ?? {}) : {},
      sessions
    }))
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    void loadDashboard()
  }, [token])

  return (
    <Container fluid className={styles.dashboard}>
      <Stack direction="horizontal" className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Dashboard</h1>
          <p className={styles.pageSubtitle}>Mission status, workload, and runtime health overview.</p>
        </div>
        <Button variant="outline-secondary" className={styles.refreshBtn} onClick={() => void loadDashboard()}>Refresh</Button>
      </Stack>

      {error ? <Alert variant="danger" className={styles.dashboardNotice}>{error}</Alert> : null}
      {loading ? <Alert variant="info" className={styles.dashboardNotice}>Loading dashboard data...</Alert> : null}

      {vm ? (
        <>
          <Row className="g-3">
            <Col xl={3} md={6}><KpiCard title="Online agents" value={`${vm.onlineAgents}`} meta={`${vm.totalAgents} total`} icon={<LuBot size={16} />} /></Col>
            <Col xl={3} md={6}><KpiCard title="Tasks in progress" value={`${vm.tasksInProgress}`} meta={`${vm.latestCompleted} total`} icon={<LuBoxes size={16} />} /></Col>
            <Col xl={3} md={6}><KpiCard title="Error rate" value={toPercent(vm.errorRate)} meta={`${vm.workloadCompleted} completed (latest)`} icon={<LuActivity size={16} />} tone="warn" /></Col>
            <Col xl={3} md={6}><KpiCard title="Completion speed" value={toRate(vm.completionSpeed)} meta={`${vm.workloadCompleted} completed`} icon={<LuTimer size={16} />} tone="success" /></Col>
          </Row>

          <Row className="g-3 mt-1">
            <Col xl={4}>
              <Card className={styles.panelCard}>
                <Card.Body className={styles.panelBody}>
                  <h2 className={styles.sectionTitle}>Workload</h2>
                  <StatRows rows={[
                    { label: 'Total work items', value: vm.workloadTotal },
                    { label: 'Inbox', value: vm.workloadInbox },
                    { label: 'In progress', value: vm.workloadProgress },
                    { label: 'In review', value: vm.workloadReview },
                    { label: 'Completed', value: vm.workloadCompleted, tone: 'success' }
                  ]} />
                </Card.Body>
              </Card>
            </Col>
            <Col xl={4}>
              <Card className={styles.panelCard}>
                <Card.Body className={styles.panelBody}>
                  <Stack direction="horizontal" className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Throughput</h2>
                    <LuInfo size={14} className={styles.infoIcon} />
                  </Stack>
                  <StatRows rows={[
                    { label: 'Completed tasks', value: vm.throughputCompleted },
                    { label: 'Average throughput', value: toRate(vm.throughputAverage) },
                    { label: 'Error rate', value: toPercent(vm.throughputErrorRate), tone: 'success' },
                    { label: 'Completion consistency', value: `${vm.throughputConsistencyDays} active days` },
                    { label: 'Review backlog ratio', value: `${vm.throughputReviewBacklogRatio.toFixed(2)}x`, tone: 'success' }
                  ]} />
                </Card.Body>
              </Card>
            </Col>
            <Col xl={4}>
              <Card className={styles.panelCard}>
                <Card.Body className={styles.panelBody}>
                  <Stack direction="horizontal" className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Gateway Health</h2>
                    <Badge bg="success" className={styles.healthBadge}>{vm.gatewayUnavailable > 0 ? 'Issues detected' : 'All connected'}</Badge>
                  </Stack>
                  <StatRows rows={[
                    { label: 'Gateway status', value: vm.gatewayUnavailable > 0 ? 'Partial' : 'All connected', tone: 'success' },
                    { label: 'Configured gateways', value: vm.gatewayConfigured },
                    { label: 'Connected gateways', value: vm.gatewayConnected, tone: 'success' },
                    { label: 'Unavailable gateways', value: vm.gatewayUnavailable },
                    { label: 'Gateways with issues', value: vm.gatewayIssues }
                  ]} />
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mt-1">
            <Col xl={6}>
              <Card className={styles.panelCard}>
                <Card.Body className={styles.panelBody}>
                  <Stack direction="horizontal" className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Sessions</h2>
                    <span className={styles.mutedCount}>{vm.sessions.length}</span>
                  </Stack>
                  <div className={styles.feedWrap}>
                    {vm.sessions.length > 0 ? vm.sessions.map((session) => (
                      <article key={session.id} className={styles.feedRow}>
                        <div>
                          <p className={styles.feedTitle}><LuCircle size={7} className={styles.dot} /> {session.label}</p>
                          <p className={styles.feedSub}>{session.endpoint} · direct · gpt-5.4 · openai-codex</p>
                        </div>
                        <div className={styles.feedMeta}>
                          <span>{session.usage}</span>
                          <span>{relativeTime(session.seenAt)}</span>
                        </div>
                      </article>
                    )) : <p className={styles.emptyText}>No gateway sessions available.</p>}
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col xl={6}>
              <Card className={styles.panelCard}>
                <Card.Body className={styles.panelBody}>
                  <Stack direction="horizontal" className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Recent Activity</h2>
                    <Link className={styles.inlineLink} to={APP_ROUTES.ACTIVITY}>Open feed <LuArrowUpRight size={13} /></Link>
                  </Stack>
                  <div className={styles.feedWrap}>
                    {vm.activities.length > 0 ? vm.activities.map((activity) => (
                      <article key={activity.id} className={styles.feedRow}>
                        <div>
                          <p className={styles.feedTitle}>{activity.title}</p>
                          <p className={styles.feedSub}>AGENT.HEARTBEAT</p>
                        </div>
                        <div className={styles.feedMeta}>
                          <span>{relativeTime(activity.updatedAt)}</span>
                          <span>{new Date(activity.updatedAt).toLocaleString()}</span>
                        </div>
                      </article>
                    )) : <p className={styles.emptyText}>No recent activity found.</p>}
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      ) : null}

      {!vm && !loading ? <Alert variant="warning" className={styles.dashboardNotice}>Dashboard data is unavailable.</Alert> : null}
    </Container>
  )
}
