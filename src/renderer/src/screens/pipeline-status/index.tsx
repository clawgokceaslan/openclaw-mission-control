import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LuExternalLink, LuRefreshCw, LuTv } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS, type WebServerStatusState } from '@shared/contracts/ipc'
import type { PipelineStatusSnapshot, PlanPipelineBatch, PlanPipelineRecord, RunPipelineGraph } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import styles from './index.module.scss'

function statusText(status?: string) {
  const map: Record<string, string> = {
    pending: 'Ready',
    queued: 'Queued',
    running: 'Running',
    blocked: 'Blocked',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    skipped: 'Skipped',
    cancelled: 'Cancelled'
  }
  return map[status ?? ''] ?? status ?? 'Unknown'
}

function formatClock(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : '-'
}

export function PipelineStatusPage() {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams<{ token?: string }>()
  const watchToken = params.token
  const standalone = location.pathname === APP_ROUTES.PIPELINE_STATUS_STANDALONE
  const [snapshot, setSnapshot] = useState<PipelineStatusSnapshot | null>(null)
  const [watchUrl, setWatchUrl] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [liveState, setLiveState] = useState<'live' | 'reconnecting'>('reconnecting')
  const refreshTimerRef = useRef<number | null>(null)

  const loadSnapshot = useCallback(async () => {
    if (standalone && !token) {
      const response = await fetch('/api/public/pipeline-status')
      const body = await response.json() as { ok?: boolean; data?: PipelineStatusSnapshot; error?: { message?: string } }
      if (!body.ok || !body.data) {
        setFeedback(body.error?.message ?? 'Status snapshot could not be loaded')
        return
      }
      setSnapshot(body.data)
      return
    }
    if (watchToken) {
      const response = await fetch(`/api/public/pipeline-status/${encodeURIComponent(watchToken)}`)
      const body = await response.json() as { ok?: boolean; data?: PipelineStatusSnapshot; error?: { message?: string } }
      if (!body.ok || !body.data) {
        setFeedback(body.error?.message ?? 'Status snapshot could not be loaded')
        return
      }
      setSnapshot(body.data)
      return
    }
    const response = await invokeBridge<PipelineStatusSnapshot>(IPC_CHANNELS.pipelineStatus.snapshot, { actorToken: token })
    if (!response.ok || !response.data) {
      setFeedback(response.error?.message ?? 'Status snapshot could not be loaded')
      return
    }
    setSnapshot(response.data)
    setFeedback(null)
  }, [standalone, token, watchToken])

  const scheduleSnapshotReload = useCallback(() => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void loadSnapshot()
    }, 180)
  }, [loadSnapshot])

  useEffect(() => {
    void loadSnapshot()
    const fallbackTimer = window.setInterval(() => void loadSnapshot(), 30000)
    return () => {
      window.clearInterval(fallbackTimer)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    }
  }, [loadSnapshot])

  useEffect(() => {
    if (standalone || watchToken) return
    const onPipelineEvent = () => {
      setLiveState('live')
      scheduleSnapshotReload()
    }
    subscribeToChannel(IPC_CHANNELS.events.planPipelineUpdated, onPipelineEvent)
    subscribeToChannel(IPC_CHANNELS.events.runPipelineUpdated, onPipelineEvent)
    setLiveState('live')
    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.planPipelineUpdated, onPipelineEvent)
      unsubscribeFromChannel(IPC_CHANNELS.events.runPipelineUpdated, onPipelineEvent)
    }
  }, [scheduleSnapshotReload, standalone, watchToken])

  useEffect(() => {
    if (!standalone && !watchToken) return
    if (typeof EventSource === 'undefined') return
    const source = new EventSource('/api/public/pipeline-status/events')
    const onLive = () => setLiveState('live')
    const onPipelineEvent = () => {
      setLiveState('live')
      scheduleSnapshotReload()
    }
    source.addEventListener('ready', onLive)
    source.addEventListener('heartbeat', onLive)
    source.addEventListener(IPC_CHANNELS.events.planPipelineUpdated, onPipelineEvent)
    source.addEventListener(IPC_CHANNELS.events.runPipelineUpdated, onPipelineEvent)
    source.onerror = () => setLiveState('reconnecting')
    return () => source.close()
  }, [scheduleSnapshotReload, standalone, watchToken])

  const standaloneUrl = async (): Promise<string | null> => {
    const serverResponse = await invokeBridge<WebServerStatusState>(IPC_CHANNELS.appSettings.getWebServerStatus, { actorToken: token })
    if (!serverResponse.ok || !serverResponse.data) {
      setFeedback(serverResponse.error?.message ?? 'Standalone link could not be created')
      return null
    }
    const server = serverResponse.data
    const base = server.lanAddresses.find((address) => address.url)?.url ?? server.localUrl ?? server.url ?? ''
    if (!base) {
      setFeedback('Web server URL is unavailable')
      return null
    }
    return `${base}${APP_ROUTES.PIPELINE_STATUS_STANDALONE}`
  }

  const openStandalone = async () => {
    const url = await standaloneUrl()
    if (!url) return
    setWatchUrl(url)
    await navigator.clipboard?.writeText(url).catch(() => undefined)
    const openResponse = await invokeBridge<{ opened: boolean; url: string }>(IPC_CHANNELS.appSettings.openWebServerUrl, {
      actorToken: token,
      url
    })
    if (!openResponse.ok && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const openAppStatus = () => {
    if (token) {
      navigate(APP_ROUTES.PIPELINE_STATUS)
      return
    }
    window.location.href = APP_ROUTES.PIPELINE_STATUS
  }

  const pipelines = snapshot?.pipelines ?? []
  const planBatches = snapshot?.planBatches ?? []
  const planRecords = snapshot?.planRecords ?? []
  const totals = useMemo(() => {
    const items = pipelines.flatMap((pipeline) => pipeline.items)
    const planRunning = planRecords.filter((record) => record.status === 'running').length
    const planQueued = planRecords.filter((record) => record.status === 'pending' || record.status === 'waiting').length
    const planFailed = planRecords.filter((record) => record.status === 'failed' || record.status === 'blocked').length
    const planCompleted = planRecords.filter((record) => record.status === 'completed' || record.status === 'skipped').length
    return {
      running: items.filter((item) => item.status === 'running').length + planRunning,
      queued: items.filter((item) => item.status === 'queued').length + planQueued,
      failed: items.filter((item) => item.status === 'failed' || item.status === 'blocked').length + planFailed,
      completed: items.filter((item) => item.status === 'completed' || item.status === 'skipped').length + planCompleted
    }
  }, [pipelines, planRecords])

  return (
    <section className={`${styles.page} ${watchToken ? styles.watch : ''} ${standalone ? styles.standalone : ''}`}>
      <header className={styles.header}>
        <div>
          <span><LuTv size={18} /> Pipeline Status</span>
          <h1>Live execution board</h1>
          <p><em className={`${styles.liveBadge} ${liveState === 'live' ? styles.live : styles.reconnecting}`}>{liveState === 'live' ? 'Live' : 'Reconnecting'}</em> Last updated {formatClock(snapshot?.generatedAt)}</p>
        </div>
        {!watchToken ? (
          <div className={styles.actions}>
            <button type="button" onClick={() => void loadSnapshot()}><LuRefreshCw size={15} /> Refresh</button>
            {standalone ? (
              <button type="button" onClick={openAppStatus}><LuExternalLink size={15} /> Back to app</button>
            ) : (
              <button type="button" onClick={() => void openStandalone()}><LuExternalLink size={15} /> Standalone page</button>
            )}
          </div>
        ) : null}
      </header>

      {feedback ? <div className={styles.alert}>{feedback}</div> : null}
      {watchUrl ? <div className={styles.linkBox}>{watchUrl}</div> : null}

      <section className={styles.kpis}>
        <div><span>Running</span><strong>{totals.running}</strong></div>
        <div><span>Queued</span><strong>{totals.queued}</strong></div>
        <div><span>Failed</span><strong>{totals.failed}</strong></div>
        <div><span>Completed</span><strong>{totals.completed}</strong></div>
      </section>

      <main className={styles.board}>
        {planBatches.map((batch) => (
          <PlanPipelineColumn key={batch.id} batch={batch} records={planRecords.filter((record) => record.batchId === batch.id)} />
        ))}
        {planRecords.filter((record) => !record.batchId).map((record) => (
          <PlanPipelineColumn key={record.id} batch={undefined} records={[record]} />
        ))}
        {pipelines.map((pipeline) => (
          <PipelineColumn key={pipeline.batch.id} pipeline={pipeline} />
        ))}
        {pipelines.length === 0 && planBatches.length === 0 && planRecords.length === 0 ? <div className={styles.empty}>No pipelines to display.</div> : null}
      </main>
    </section>
  )
}

function PlanPipelineColumn({ batch, records }: { batch?: PlanPipelineBatch; records: PlanPipelineRecord[] }) {
  const progress = records.length ? Math.round(records.reduce((sum, record) => sum + record.progress, 0) / records.length) : 0
  const title = batch?.name ?? records[0]?.sourceDraftName ?? 'Plan pipeline'
  const status = batch?.status ?? records[0]?.status
  return (
    <article className={styles.pipeline}>
      <header>
        <div>
          <h2>{title}</h2>
          <span>Plan · {statusText(status)} · {progress}%</span>
        </div>
        <strong>{records.length} stage</strong>
      </header>
      <div className={styles.progress}><i style={{ width: `${progress}%` }} /></div>
      <section className={styles.activeTask}>
        <span>Current plan stage</span>
        <strong>{records.find((record) => record.status === 'running')?.groupName ?? records[0]?.groupName ?? 'None'}</strong>
        <small>{batch?.runPipelineOnPlanComplete ? 'Run pipeline will be prepared after completion' : 'Run preparation is manual'}</small>
      </section>
      <div className={styles.stages}>
        {records.map((record) => (
          <section key={record.id} className={styles.stage}>
            <div>
              <strong>{record.groupName}</strong>
              <span>{statusText(record.status)} · {record.taskIds.length} task</span>
            </div>
            <div className={styles.progress}><i style={{ width: `${record.progress}%` }} /></div>
            {record.lastError ? <p>{record.lastError}</p> : null}
          </section>
        ))}
      </div>
    </article>
  )
}

function PipelineColumn({ pipeline }: { pipeline: RunPipelineGraph }) {
  const activeItem = pipeline.items.find((item) => item.id === pipeline.batch.currentItemId)
  return (
    <article className={styles.pipeline}>
      <header>
        <div>
          <h2>{pipeline.batch.name}</h2>
          <span>{statusText(pipeline.batch.status)} · {pipeline.batch.progress}%</span>
        </div>
        <strong>{pipeline.items.length} task</strong>
      </header>
      <div className={styles.progress}><i style={{ width: `${pipeline.batch.progress}%` }} /></div>
      <section className={styles.activeTask}>
        <span>Active task</span>
        <strong>{activeItem?.taskId ?? 'None'}</strong>
        <small>{activeItem ? `Attempt ${activeItem.attempt} · ${statusText(activeItem.status)}` : 'Next item has not started'}</small>
      </section>
      <div className={styles.stages}>
        {pipeline.stages.map((stage) => {
          const items = pipeline.items.filter((item) => item.stageId === stage.id)
          return (
            <section key={stage.id} className={styles.stage}>
              <div>
                <strong>{stage.name}</strong>
                <span>{statusText(stage.status)} · {items.length} task</span>
              </div>
              <div className={styles.progress}><i style={{ width: `${stage.progress}%` }} /></div>
              {items.filter((item) => item.status === 'failed' || item.status === 'blocked').map((item) => (
                <p key={item.id}>{item.taskId}: {item.lastError ?? 'Error'}</p>
              ))}
            </section>
          )
        })}
      </div>
    </article>
  )
}
