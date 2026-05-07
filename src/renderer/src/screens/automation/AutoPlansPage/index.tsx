import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuCircleStop, LuExternalLink, LuListFilter, LuPlay, LuRefreshCw, LuTrash2 } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse, type PlanTaskGatewayRequest, type PlannedGatewayTaskRow, type RunningGatewayTaskRow, type RunningGatewayTasksResponse } from '@shared/contracts/ipc'
import type { Project, ProjectStatus, TaskEntity } from '@shared/types/entities'
import { DEFAULT_GATEWAY_LANGUAGE } from '@shared/utils/gateway-language'
import { GlobalTaskDetailModal } from '@renderer/components/navigation/GlobalTaskDetailModal'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { projectGatewaySettings, readTaskGatewayOverride, withTaskMeta } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from './index.module.scss'

type TabKey = 'running' | 'queue' | 'planned'
type PlanMode = NonNullable<PlanTaskGatewayRequest['clarificationMode']>
type QueueState = 'waiting' | 'running' | 'completed' | 'failed' | 'stopped'
type QueueItem = { id: string; taskId: string; projectId: string; state: QueueState; message?: string; conversationId?: string }
type GatewayPlanResponse = { executionMode?: 'terminal' | 'exec'; runId?: string; conversationId?: string; runtimeWorkspacePath?: string }

const PAGE_SIZE = 60
const tabLabels: Record<TabKey, string> = { running: 'Çalışanlar', queue: 'Plan kuyruğu', planned: 'Planlananlar' }

function formatDate(value: number) {
  return new Date(value).toLocaleString()
}

function missingPlanLabel(project: Project | undefined, task: TaskEntity) {
  const codex = projectGatewaySettings(project ?? null)
  const override = readTaskGatewayOverride(task)
  if (!(override.gatewayId || codex.gatewayId) && !(override.planModel || override.legacyModel || codex.planModel || codex.defaultModel)) return 'Gateway ve plan modeli eksik'
  if (!(override.gatewayId || codex.gatewayId)) return 'Gateway eksik'
  if (!(override.planModel || override.legacyModel || codex.planModel || codex.defaultModel)) return 'Plan modeli eksik'
  return ''
}

export function AutoPlansPage() {
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('queue')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({})
  const [runningRows, setRunningRows] = useState<RunningGatewayTaskRow[]>([])
  const [plannedRows, setPlannedRows] = useState<PlannedGatewayTaskRow[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [projectFilter, setProjectFilter] = useState('')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<PlanMode>('ask-first')
  const [loading, setLoading] = useState(true)
  const [queueBusy, setQueueBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailTarget, setDetailTarget] = useState<{ projectId: string; taskId: string } | null>(null)
  const stopRequestedRef = useRef(false)

  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const queuedTaskIds = useMemo(() => new Set(queue.filter((item) => item.state === 'waiting' || item.state === 'running').map((item) => item.taskId)), [queue])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [projectResponse, taskResponse, runningResponse, plannedResponse] = await Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token ?? null),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token ?? null),
      invokeBridge<RunningGatewayTasksResponse>(IPC_CHANNELS.tasks.listRunningGateway, { actorToken: token, page: 1, pageSize: PAGE_SIZE, group: 'planning' }),
      invokeBridge<PaginatedResponse<PlannedGatewayTaskRow>>(IPC_CHANNELS.tasks.listPlannedGateway, { actorToken: token, page: 1, pageSize: PAGE_SIZE })
    ])

    if (!projectResponse.ok) {
      setError(projectResponse.error?.message ?? 'Projeler yuklenemedi.')
      setLoading(false)
      return
    }

    const nextProjects = Array.isArray(projectResponse.data) ? projectResponse.data : []
    setProjects(nextProjects)
    setTasks(Array.isArray(taskResponse.data) ? taskResponse.data.map(withTaskMeta) : [])
    setRunningRows(runningResponse.ok && Array.isArray(runningResponse.data?.rows) ? runningResponse.data.rows : [])
    setPlannedRows(plannedResponse.ok && Array.isArray(plannedResponse.data?.rows) ? plannedResponse.data.rows : [])
    const statusEntries = await Promise.all(nextProjects.map(async (project) => {
      const response = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId: project.id })
      return [project.id, response.ok && Array.isArray(response.data) ? response.data : []] as const
    }))
    setStatusesByProject(Object.fromEntries(statusEntries))
    setError(!taskResponse.ok ? taskResponse.error?.message ?? 'Tasklar yuklenemedi.' : null)
    setLoading(false)
  }, [token])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    const refresh = () => void loadData()
    subscribeToChannel(IPC_CHANNELS.events.taskActivity, refresh)
    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, refresh)
    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, refresh)
      unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, refresh)
    }
  }, [loadData])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks
      .filter((task) => !projectFilter || task.projectId === projectFilter)
      .filter((task) => !normalizedQuery || `${task.title} ${task.description ?? ''} ${projectsById.get(task.projectId)?.name ?? ''}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 80)
  }, [projectFilter, projectsById, query, tasks])

  const isTaskClosed = useCallback((task: TaskEntity) => {
    const status = statusesByProject[task.projectId]?.find((item) => item.id === task.status)
    return status?.category === 'done' || status?.category === 'closed'
  }, [statusesByProject])

  const addToQueue = (task: TaskEntity) => {
    if (queuedTaskIds.has(task.id) || isTaskClosed(task) || missingPlanLabel(projectsById.get(task.projectId), task)) return
    setQueue((current) => [...current, { id: `${task.id}-${Date.now()}`, taskId: task.id, projectId: task.projectId, state: 'waiting' }])
    setActiveTab('queue')
  }

  const moveQueueItem = (itemId: string, direction: -1 | 1) => {
    setQueue((current) => {
      const index = current.findIndex((item) => item.id === itemId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }

  const runPlan = useCallback(async (item: QueueItem) => {
    const task = tasksById.get(item.taskId)
    const project = projectsById.get(item.projectId)
    if (!task || !project) throw new Error('Task veya proje bulunamadi.')
    const codex = projectGatewaySettings(project)
    const override = readTaskGatewayOverride(task)
    const gatewayId = override.gatewayId || codex.gatewayId || ''
    const model = override.planModel || override.legacyModel || codex.planModel || codex.defaultModel || ''
    if (!gatewayId || !model) throw new Error('Gateway veya plan modeli eksik.')

    const response = await invokeBridge<GatewayPlanResponse>(IPC_CHANNELS.tasks.planWithGateway, {
      actorToken: token,
      taskId: item.taskId,
      projectId: item.projectId,
      gatewayId,
      model,
      language: codex.language || DEFAULT_GATEWAY_LANGUAGE,
      reasoningEffort: override.planReasoningEffort || codex.planReasoningEffort || 'medium',
      clarificationMode: mode,
      generalContext: project.generalContext ?? '',
      generalPrompt: project.generalPrompt ?? '',
      defaultOutput: project.defaultOutput ?? ''
    })
    if (!response.ok) throw new Error(response.error?.message ?? 'Codex plan baslatilamadi.')
    return response.data?.conversationId || response.data?.runId || ''
  }, [mode, projectsById, tasksById, token])

  const startQueue = async () => {
    if (queueBusy) return
    stopRequestedRef.current = false
    setQueueBusy(true)
    setActiveTab('queue')
    try {
      for (const item of queue) {
        if (stopRequestedRef.current) break
        if (item.state !== 'waiting') continue
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'running', message: mode === 'ask-first' ? 'Soru moduyla baslatiliyor...' : 'Sorusuz modla baslatiliyor...' } : row))
        try {
          const conversationId = await runPlan(item)
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: stopRequestedRef.current ? 'stopped' : 'completed', conversationId, message: mode === 'ask-first' ? 'Plan soru moduyla baslatildi.' : 'Plan sorusuz baslatildi.' } : row))
        } catch (planError) {
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'failed', message: planError instanceof Error ? planError.message : 'Plan baslatma hatasi.' } : row))
        }
      }
      await loadData()
    } finally {
      setQueueBusy(false)
    }
  }

  const stopQueue = async () => {
    stopRequestedRef.current = true
    const active = queue.find((item) => item.state === 'running')
    if (active?.conversationId) await invokeBridge(IPC_CHANNELS.tasks.gatewayChatStop, { actorToken: token, taskId: active.taskId, conversationId: active.conversationId })
    setQueue((current) => current.map((item) => item.state === 'waiting' || item.state === 'running' ? { ...item, state: 'stopped', message: 'Durduruldu.' } : item))
    setQueueBusy(false)
  }

  const stopRunningRow = async (row: RunningGatewayTaskRow) => {
    await invokeBridge(IPC_CHANNELS.tasks.gatewayChatStop, { actorToken: token, taskId: row.taskId, conversationId: row.gatewayConversationId })
    await loadData()
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Auto Plans</h1>
          <p>Planlanacak taskları sıraya al, başlatmadan önce global soru modunu seç.</p>
        </div>
        <button type="button" onClick={() => void loadData()} disabled={loading}><LuRefreshCw size={15} /> Yenile</button>
      </header>

      {error ? <div className={styles.notice}>{error}</div> : null}

      <section className={styles.modeBar}>
        <div>
          <strong>Global plan modu</strong>
          <span>Bu seçim kuyruk başlatılmadan önce görünür kalır ve tüm tasklara aynı şekilde uygulanır.</span>
        </div>
        <div className={styles.modeButtons} role="radiogroup" aria-label="Global plan mode">
          <button type="button" className={mode === 'ask-first' ? styles.modeActive : ''} onClick={() => setMode('ask-first')} disabled={queueBusy}>Tüm tasklar için soru sor</button>
          <button type="button" className={mode === 'direct' ? styles.modeActive : ''} onClick={() => setMode('direct')} disabled={queueBusy}>Tüm tasklar için sorusuz ilerle</button>
        </div>
      </section>

      <section className={styles.controls}>
        <label>
          <span>Proje filtresi</span>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="">Tüm projeler</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          <span>Task ara</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Başlık, açıklama veya proje" />
        </label>
        <div className={styles.controlStat}><LuListFilter size={16} /><strong>{filteredTasks.length}</strong><span>aday</span></div>
      </section>

      <div className={styles.layout}>
        <aside className={styles.selector}>
          <header><strong>Plan task seçimi</strong><span>Plan modeli hazır olan açık tasklar kuyruğa alınabilir.</span></header>
          <div className={styles.taskList}>
            {loading ? <div className={styles.emptyState}>Yükleniyor...</div> : filteredTasks.length ? filteredTasks.map((task) => {
              const project = projectsById.get(task.projectId)
              const missing = missingPlanLabel(project, task)
              const disabled = queuedTaskIds.has(task.id) || isTaskClosed(task) || Boolean(missing)
              return (
                <article key={task.id} className={`${styles.taskCard} ${disabled ? styles.taskCardMuted : ''}`}>
                  <div className={styles.taskCardBody}>
                    <span>{project?.name ?? 'Proje yok'}</span>
                    <strong>{task.title}</strong>
                    <small>{project?.description?.trim() || 'Proje aciklamasi yok.'}</small>
                  </div>
                  <div className={styles.cardActions}>
                    <button type="button" onClick={() => setDetailTarget({ projectId: task.projectId, taskId: task.id })} title="Task detayını aç"><LuExternalLink size={15} /></button>
                    <button type="button" onClick={() => addToQueue(task)} disabled={disabled} title={missing || (queuedTaskIds.has(task.id) ? 'Kuyrukta' : 'Plan kuyruğuna ekle')}><LuPlay size={15} /></button>
                  </div>
                </article>
              )
            }) : <div className={styles.emptyState}>Filtreye uygun task yok.</div>}
          </div>
        </aside>

        <section className={styles.workbench}>
          <div className={styles.tabs} role="tablist">
            {(Object.keys(tabLabels) as TabKey[]).map((tab) => <button key={tab} type="button" className={activeTab === tab ? styles.tabActive : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}
          </div>

          {activeTab === 'queue' ? (
            <div className={styles.panel}>
              <header>
                <div><strong>Auto Plan kuyruğu</strong><span>{queue.length} öğe · {mode === 'ask-first' ? 'soru sor modu' : 'sorusuz ilerleme modu'}</span></div>
                <div className={styles.panelActions}>
                  <button type="button" onClick={() => void startQueue()} disabled={queueBusy || !queue.some((item) => item.state === 'waiting')}><LuPlay size={15} /> Başlat</button>
                  <button type="button" onClick={() => void stopQueue()} disabled={!queueBusy && !queue.some((item) => item.state === 'waiting' || item.state === 'running')}><LuCircleStop size={15} /> Durdur</button>
                </div>
              </header>
              <div className={styles.queueList}>
                {queue.length ? queue.map((item, index) => {
                  const task = tasksById.get(item.taskId)
                  const project = projectsById.get(item.projectId)
                  return (
                    <article key={item.id} className={`${styles.queueRow} ${styles[`state_${item.state}`]}`}>
                      <span className={styles.queueIndex}>{index + 1}</span>
                      <div><strong>{task?.title ?? item.taskId}</strong><span>{project?.name ?? item.projectId} · {item.message ?? item.state}</span></div>
                      <div className={styles.cardActions}>
                        <button type="button" onClick={() => moveQueueItem(item.id, -1)} disabled={index === 0 || item.state === 'running'} title="Yukarı taşı"><LuArrowUp size={15} /></button>
                        <button type="button" onClick={() => moveQueueItem(item.id, 1)} disabled={index === queue.length - 1 || item.state === 'running'} title="Aşağı taşı"><LuArrowDown size={15} /></button>
                        <button type="button" onClick={() => setDetailTarget({ projectId: item.projectId, taskId: item.taskId })} title="Task detayını aç"><LuExternalLink size={15} /></button>
                        <button type="button" onClick={() => setQueue((current) => current.filter((row) => row.id !== item.id || row.state === 'running'))} disabled={item.state === 'running'} title="Kuyruktan çıkar"><LuTrash2 size={15} /></button>
                      </div>
                    </article>
                  )
                }) : <div className={styles.emptyState}>Plan kuyruğu boş. Soldan task ekle.</div>}
              </div>
            </div>
          ) : null}

          {activeTab === 'running' ? (
            <div className={styles.panel}>
              <header><div><strong>Çalışan planlar</strong><span>{runningRows.length} aktif plan kaydı</span></div></header>
              <div className={styles.queueList}>
                {runningRows.length ? runningRows.map((row) => (
                  <article key={row.gatewayConversationId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.liveStatus}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} · {row.latestActivitySummary} · {formatDate(row.latestAt)}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Task detayını aç"><LuExternalLink size={15} /></button>
                      <button type="button" onClick={() => void stopRunningRow(row)} title="Durdur"><LuCircleStop size={15} /></button>
                    </div>
                  </article>
                )) : <div className={styles.emptyState}>Aktif planlama yok.</div>}
              </div>
            </div>
          ) : null}

          {activeTab === 'planned' ? (
            <div className={styles.panel}>
              <header><div><strong>Planlanan tasklar</strong><span>{plannedRows.length} task</span></div></header>
              <div className={styles.queueList}>
                {plannedRows.length ? plannedRows.map((row) => (
                  <article key={row.taskId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.runnable ? 'Run hazır' : 'Eksik'}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} · {row.runnable ? 'Run tarafına aktarılabilir' : row.missing.join(', ')}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Task detayını aç"><LuExternalLink size={15} /></button>
                    </div>
                  </article>
                )) : <div className={styles.emptyState}>Planlanan task yok.</div>}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {detailTarget ? <GlobalTaskDetailModal taskId={detailTarget.taskId} projectId={detailTarget.projectId} onClose={() => setDetailTarget(null)} /> : null}
    </section>
  )
}
