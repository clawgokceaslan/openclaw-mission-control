import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LuArrowLeft, LuCheck, LuListRestart, LuLoader, LuPlay, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { PlanPipelineRecord, PlanPipelineStatus, Project, TaskEntity } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import styles from './index.module.scss'

type Feedback = { kind: 'success' | 'error'; message: string } | null

function statusText(status: PlanPipelineStatus) {
  const map: Record<PlanPipelineStatus, string> = {
    pending: 'Bekliyor',
    waiting: 'Onay bekliyor',
    running: 'Çalışıyor',
    paused: 'Duraklatıldı',
    blocked: 'Bloklandı',
    completed: 'Tamamlandı',
    failed: 'Hatalı',
    cancelled: 'İptal edildi',
    skipped: 'Atlandı'
  }
  return map[status] ?? status
}

function statusTone(status: PlanPipelineStatus) {
  if (status === 'completed') return 'success'
  if (status === 'running') return 'active'
  if (status === 'waiting' || status === 'blocked' || status === 'paused') return 'warning'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'idle'
}

function formatTime(timestamp?: number) {
  if (!timestamp) return 'Henüz yok'
  return new Date(timestamp).toLocaleString()
}

export function PlanPipelineRunsPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const { pipelineId } = useParams<{ pipelineId?: string }>()
  const [pipelines, setPipelines] = useState<PlanPipelineRecord[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const refreshTimerRef = useRef<number | null>(null)

  const loadData = async () => {
    setLoading(true)
    setFeedback(null)
    const [pipelineResponse, projectResponse, taskResponse] = await Promise.all([
      loadList<PlanPipelineRecord[]>(IPC_CHANNELS.planPipelines.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token)
    ])
    setLoading(false)
    if (!pipelineResponse.ok) {
      setFeedback({ kind: 'error', message: pipelineResponse.error?.message ?? 'Pipeline kayıtları yüklenemedi' })
      setPipelines([])
      return
    }
    const nextPipelines = Array.isArray(pipelineResponse.data) ? pipelineResponse.data : []
    setPipelines(nextPipelines)
    setProjects(projectResponse.ok && Array.isArray(projectResponse.data) ? projectResponse.data : [])
    setTasks(taskResponse.ok && Array.isArray(taskResponse.data) ? taskResponse.data : [])
    setSelectedId((current) => pipelineId ?? current ?? nextPipelines[0]?.id ?? null)
    if (!projectResponse.ok || !taskResponse.ok) {
      setFeedback({ kind: 'error', message: 'Pipeline yüklendi fakat proje veya task detaylarının bir kısmı alınamadı' })
    }
  }

  useEffect(() => {
    void loadData()
  }, [token, pipelineId])

  useEffect(() => {
    const onPipelineUpdated = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        void loadData()
      }, 180)
    }
    subscribeToChannel(IPC_CHANNELS.events.planPipelineUpdated, onPipelineUpdated)
    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.planPipelineUpdated, onPipelineUpdated)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    }
  }, [token, pipelineId])

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const orderedPipelines = useMemo(() => pipelines.slice().sort((a, b) => {
    const priority = (status: PlanPipelineStatus) => status === 'running' ? 0 : status === 'waiting' || status === 'pending' ? 1 : status === 'failed' ? 2 : 3
    return priority(a.status) - priority(b.status) || b.updatedAt - a.updatedAt
  }), [pipelines])
  const selected = orderedPipelines.find((pipeline) => pipeline.id === selectedId) ?? orderedPipelines[0]
  const runningCount = pipelines.filter((pipeline) => pipeline.status === 'running').length
  const waitingCount = pipelines.filter((pipeline) => pipeline.status === 'pending' || pipeline.status === 'waiting').length
  const failedCount = pipelines.filter((pipeline) => pipeline.status === 'failed').length
  const averageProgress = pipelines.length > 0 ? Math.round(pipelines.reduce((sum, pipeline) => sum + pipeline.progress, 0) / pipelines.length) : 0

  const updatePipeline = async (id: string, patch: Partial<Pick<PlanPipelineRecord, 'status' | 'progress' | 'retryCount' | 'lastError'>>) => {
    setUpdatingId(id)
    const response = await invokeBridge<PlanPipelineRecord>(IPC_CHANNELS.planPipelines.updateState, {
      actorToken: token,
      id,
      ...patch
    })
    setUpdatingId(null)
    if (!response.ok || !response.data) {
      setFeedback({ kind: 'error', message: response.error?.message ?? 'Pipeline durumu güncellenemedi' })
      return
    }
    setPipelines((current) => current.map((pipeline) => pipeline.id === id ? response.data! : pipeline))
    setFeedback({ kind: 'success', message: 'Pipeline durumu güncellendi' })
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link to={APP_ROUTES.PLAN_PIPELINE} className={styles.backLink}><LuArrowLeft size={15} /> Plan Pipeline</Link>
          <h1>Pipeline Çalıştırmaları</h1>
          <p>Seçili pipeline grubunu stage, task ve progress bağlamıyla izle.</p>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={() => void loadData()}>
          <LuRefreshCw size={15} />
          Yenile
        </button>
      </header>

      {feedback ? (
        <div className={`${styles.alert} ${feedback.kind === 'success' ? styles.successAlert : ''}`}>
          {feedback.kind === 'success' ? <LuCheck size={16} /> : <LuTriangleAlert size={16} />}
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)}>Kapat</button>
        </div>
      ) : null}

      <section className={styles.metrics}>
        <article>
          <span>Çalışan</span>
          <strong>{runningCount}</strong>
        </article>
        <article>
          <span>Bekleyen</span>
          <strong>{waitingCount}</strong>
        </article>
        <article>
          <span>Hatalı</span>
          <strong>{failedCount}</strong>
        </article>
        <article>
          <span>Ortalama progress</span>
          <strong>{averageProgress}%</strong>
        </article>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.runList}>
          <div className={styles.sectionHead}>
            <div>
              <h2>Run listesi</h2>
              <p>Öncelik çalışan ve bekleyen kayıtlar.</p>
            </div>
            {loading ? <span className={styles.statePill}><LuLoader size={14} /> Yükleniyor</span> : <span className={styles.statePill}>{orderedPipelines.length} kayıt</span>}
          </div>
          <div className={styles.pipelineList}>
            {orderedPipelines.map((pipeline) => (
              <button
                key={pipeline.id}
                type="button"
                className={`${styles.pipelineItem} ${selected?.id === pipeline.id ? styles.pipelineItemActive : ''}`}
                onClick={() => {
                  setSelectedId(pipeline.id)
                  navigate(`/plan-pipeline/${encodeURIComponent(pipeline.id)}/runs`, { replace: true })
                }}
              >
                <strong>{pipeline.groupName}</strong>
                <span>{pipeline.sourceDraftName}</span>
                <em className={`${styles.statusBadge} ${styles[`tone-${statusTone(pipeline.status)}`]}`}>{statusText(pipeline.status)}</em>
              </button>
            ))}
            {!loading && orderedPipelines.length === 0 ? <div className={styles.emptyState}>Kayıtlı pipeline bulunamadı.</div> : null}
          </div>
        </aside>

        <main className={styles.detailPanel}>
          {selected ? (
            <>
              <div className={styles.detailHead}>
                <div>
                  <span>{selected.sourceDraftName}</span>
                  <h2>{selected.groupName}</h2>
                  <p>{selected.groupDescription || 'Açıklama yok'}</p>
                </div>
                <em className={`${styles.statusBadge} ${styles[`tone-${statusTone(selected.status)}`]}`}>{statusText(selected.status)}</em>
              </div>
              <div className={styles.progressBlock}>
                <div>
                  <span>Progress</span>
                  <strong>{selected.progress}%</strong>
                </div>
                <div className={styles.progressTrack}>
                  <i style={{ width: `${selected.progress}%` }} />
                </div>
              </div>
              <div className={styles.factGrid}>
                <article>
                  <span>Task</span>
                  <strong>{selected.taskIds.length}</strong>
                </article>
                <article>
                  <span>Retry</span>
                  <strong>{selected.retryCount}</strong>
                </article>
                <article>
                  <span>Oluşturulma</span>
                  <strong>{formatTime(selected.createdAt)}</strong>
                </article>
                <article>
                  <span>Güncelleme</span>
                  <strong>{formatTime(selected.updatedAt)}</strong>
                </article>
              </div>
              {selected.lastError ? <p className={styles.errorText}>{selected.lastError}</p> : null}
              <div className={styles.stageRail}>
                {orderedPipelines.map((pipeline, index) => (
                  <button
                    key={pipeline.id}
                    type="button"
                    className={`${styles.stageNode} ${selected.id === pipeline.id ? styles.stageNodeActive : ''}`}
                    onClick={() => setSelectedId(pipeline.id)}
                  >
                    <span className={`${styles.stageMarker} ${styles[`tone-${statusTone(pipeline.status)}`]}`}>{index + 1}</span>
                    <strong>{pipeline.groupName}</strong>
                    <small>{pipeline.progress}% · {statusText(pipeline.status)}</small>
                  </button>
                ))}
              </div>
              <section className={styles.taskPanel}>
                <div className={styles.sectionHead}>
                  <div>
                    <h2>Task listesi</h2>
                    <p>Gruba bağlı task ve proje bağlamı.</p>
                  </div>
                </div>
                <div className={styles.taskList}>
                  {selected.taskIds.map((taskId, index) => {
                    const task = taskById.get(taskId)
                    return (
                      <article key={taskId} className={styles.taskItem}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{task?.title ?? taskId}</strong>
                          <small>{projectById.get(task?.projectId ?? '')?.name ?? 'Proje yok'} · {task?.status ?? 'Durum yok'}</small>
                        </div>
                      </article>
                    )
                  })}
                  {selected.taskIds.length === 0 ? <div className={styles.emptyState}>Bu pipeline grubunda task yok.</div> : null}
                </div>
              </section>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={(selected.status !== 'pending' && selected.status !== 'waiting') || updatingId === selected.id}
                  onClick={() => void updatePipeline(selected.id, { status: 'running', progress: selected.progress })}
                >
                  <LuPlay size={14} />
                  {updatingId === selected.id ? 'Başlatılıyor' : 'Başlat'}
                </button>
                <button
                  type="button"
                  disabled={selected.status !== 'failed' || updatingId === selected.id}
                  onClick={() => void updatePipeline(selected.id, { status: 'running', progress: 0, retryCount: selected.retryCount + 1, lastError: undefined })}
                >
                  <LuListRestart size={14} />
                  Yeniden dene
                </button>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>Detay için bir pipeline kaydı seç.</div>
          )}
        </main>
      </section>
    </section>
  )
}
