import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LuExternalLink, LuRefreshCw, LuTv } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS, type WebServerStatusState } from '@shared/contracts/ipc'
import type { PipelineStatusSnapshot, RunPipelineGraph } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge } from '@renderer/utils/api'
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

  const loadSnapshot = async () => {
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
  }

  useEffect(() => {
    void loadSnapshot()
    const timer = window.setInterval(() => void loadSnapshot(), watchToken ? 5000 : 8000)
    return () => window.clearInterval(timer)
  }, [token, watchToken])

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
  const totals = useMemo(() => {
    const items = pipelines.flatMap((pipeline) => pipeline.items)
    return {
      running: items.filter((item) => item.status === 'running').length,
      queued: items.filter((item) => item.status === 'queued').length,
      failed: items.filter((item) => item.status === 'failed' || item.status === 'blocked').length,
      completed: items.filter((item) => item.status === 'completed' || item.status === 'skipped').length
    }
  }, [pipelines])

  return (
    <section className={`${styles.page} ${watchToken ? styles.watch : ''} ${standalone ? styles.standalone : ''}`}>
      <header className={styles.header}>
        <div>
          <span><LuTv size={18} /> Pipeline Status</span>
          <h1>Live execution board</h1>
          <p>Last updated {formatClock(snapshot?.generatedAt)}</p>
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
        {pipelines.length === 0 ? <div className={styles.empty}>No pipelines to display.</div> : pipelines.map((pipeline) => (
          <PipelineColumn key={pipeline.batch.id} pipeline={pipeline} />
        ))}
      </main>
    </section>
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
