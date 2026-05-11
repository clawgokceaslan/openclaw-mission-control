import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { LuActivity, LuRefreshCw, LuSatellite, LuTv, LuVolume2, LuVolumeX } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS, type WebServerStatusState } from '@shared/contracts/ipc'
import type {
  PipelineStatusSnapshot,
  PipelineStatusTaskSummary,
  PlanPipelineBatch,
  PlanPipelineRecord,
  RunPipelineGraph,
  RunPipelineItem
} from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import styles from './index.module.scss'

const appIconSrc = new URL('../../../../../app-icon.png', import.meta.url).href
const SOUND_KEY = 'omc:pipeline-status-sound'

type LiveEvent = {
  id: string
  label: string
  detail: string
  tone: 'info' | 'success' | 'warning' | 'danger'
  at: number
}

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
    cancelled: 'Cancelled',
    waiting: 'Waiting'
  }
  return map[status ?? ''] ?? status ?? 'Unknown'
}

function statusTone(status?: string): 'idle' | 'active' | 'success' | 'warning' | 'danger' {
  if (status === 'running') return 'active'
  if (status === 'completed' || status === 'skipped') return 'success'
  if (status === 'blocked' || status === 'paused' || status === 'waiting') return 'warning'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'idle'
}

function formatClock(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : '-'
}

function eventId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`
}

function snapshotSignature(snapshot: PipelineStatusSnapshot | null): Map<string, string> {
  const values = new Map<string, string>()
  if (!snapshot) return values
  for (const batch of snapshot.planBatches) {
    values.set(`plan:${batch.id}`, `${batch.status}:${batch.updatedAt}:${batch.linkedRunPipelineId ?? ''}`)
  }
  for (const record of snapshot.planRecords) {
    values.set(`plan-record:${record.id}`, `${record.status}:${record.progress}:${record.updatedAt}:${record.lastError ?? ''}`)
  }
  for (const pipeline of snapshot.pipelines) {
    values.set(`run:${pipeline.batch.id}`, `${pipeline.batch.status}:${pipeline.batch.progress}:${pipeline.batch.updatedAt}:${pipeline.batch.currentItemId ?? ''}`)
    for (const item of pipeline.items) {
      values.set(`run-item:${item.id}`, `${item.status}:${item.progress}:${item.updatedAt}:${item.lastError ?? ''}`)
    }
  }
  return values
}

function changedKeys(previous: PipelineStatusSnapshot | null, next: PipelineStatusSnapshot): Set<string> {
  const before = snapshotSignature(previous)
  const after = snapshotSignature(next)
  const changed = new Set<string>()
  for (const [key, value] of after.entries()) {
    if (before.has(key) && before.get(key) !== value) changed.add(key)
  }
  return changed
}

function strongestChangedTone(snapshot: PipelineStatusSnapshot, keys: Set<string>): LiveEvent['tone'] {
  for (const pipeline of snapshot.pipelines) {
    if (keys.has(`run:${pipeline.batch.id}`) && ['failed', 'blocked', 'cancelled'].includes(pipeline.batch.status)) return 'danger'
    if (keys.has(`run:${pipeline.batch.id}`) && pipeline.batch.status === 'completed') return 'success'
    for (const item of pipeline.items) {
      if (keys.has(`run-item:${item.id}`) && ['failed', 'blocked'].includes(item.status)) return 'danger'
      if (keys.has(`run-item:${item.id}`) && item.status === 'completed') return 'success'
    }
  }
  for (const record of snapshot.planRecords) {
    if (keys.has(`plan-record:${record.id}`) && ['failed', 'blocked', 'cancelled'].includes(record.status)) return 'danger'
    if (keys.has(`plan-record:${record.id}`) && record.status === 'completed') return 'success'
  }
  return 'info'
}

function taskName(task: PipelineStatusTaskSummary | undefined, fallback: string) {
  return task?.title?.trim() || fallback
}

function projectName(task: PipelineStatusTaskSummary | undefined, fallback = 'Project') {
  return task?.projectName?.trim() || fallback
}

function taskStatusCounts(tasks: PipelineStatusTaskSummary[]) {
  return {
    active: tasks.filter((task) => ['running', 'active', 'in_progress'].includes(task.status)).length,
    done: tasks.filter((task) => ['done', 'closed', 'completed', 'skipped'].includes(task.status)).length,
    blocked: tasks.filter((task) => ['blocked', 'failed', 'cancelled'].includes(task.status)).length
  }
}

export function PipelineStatusPage() {
  const { token } = useAuth()
  const location = useLocation()
  const params = useParams<{ token?: string }>()
  const watchToken = params.token
  const standalone = location.pathname === APP_ROUTES.PIPELINE_STATUS_STANDALONE
  const broadcastMode = standalone || Boolean(watchToken)
  const [snapshot, setSnapshot] = useState<PipelineStatusSnapshot | null>(null)
  const [watchUrl, setWatchUrl] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [liveState, setLiveState] = useState<'live' | 'reconnecting'>('reconnecting')
  const [eventCount, setEventCount] = useState(0)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [highlightedKeys, setHighlightedKeys] = useState<Set<string>>(() => new Set())
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem(SOUND_KEY)
    if (!saved) localStorage.setItem(SOUND_KEY, 'on')
    return saved !== 'off'
  })
  const [soundReady, setSoundReady] = useState(false)
  const previousSnapshotRef = useRef<PipelineStatusSnapshot | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const pushEvent = useCallback((event: Omit<LiveEvent, 'id' | 'at'>) => {
    setEvents((current) => [{ ...event, id: eventId(event.label), at: Date.now() }, ...current].slice(0, 12))
  }, [])

  const playChime = useCallback((tone: LiveEvent['tone']) => {
    if (!soundEnabled || !soundReady || typeof window === 'undefined') return
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    const context = audioContextRef.current ?? new AudioCtor()
    audioContextRef.current = context
    if (context.state === 'suspended') void context.resume()
    const now = context.currentTime
    const frequencies: Record<LiveEvent['tone'], [number, number]> = {
      info: [520, 760],
      success: [620, 920],
      warning: [360, 520],
      danger: [260, 190]
    }
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    gain.connect(context.destination)
    frequencies[tone].forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      oscillator.type = tone === 'danger' ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.075)
      oscillator.connect(gain)
      oscillator.start(now + index * 0.075)
      oscillator.stop(now + 0.24)
    })
  }, [soundEnabled, soundReady])

  const armSound = useCallback(async () => {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    const context = audioContextRef.current ?? new AudioCtor()
    audioContextRef.current = context
    await context.resume()
    setSoundReady(true)
    setSoundEnabled(true)
    localStorage.setItem(SOUND_KEY, 'on')
    window.setTimeout(() => playChime('info'), 0)
  }, [playChime])

  const toggleSound = useCallback(() => {
    if (!soundEnabled || !soundReady) {
      void armSound()
      return
    }
    setSoundEnabled(false)
    localStorage.setItem(SOUND_KEY, 'off')
  }, [armSound, soundEnabled, soundReady])

  const ingestSnapshot = useCallback((next: PipelineStatusSnapshot) => {
    const previous = previousSnapshotRef.current
    const changed = changedKeys(previous, next)
    previousSnapshotRef.current = next
    setSnapshot(next)
    setFeedback(null)
    if (changed.size > 0) {
      setHighlightedKeys(changed)
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = window.setTimeout(() => {
        highlightTimerRef.current = null
        setHighlightedKeys(new Set())
      }, 2600)
      const tone = strongestChangedTone(next, changed)
      playChime(tone)
      pushEvent({
        label: 'Snapshot updated',
        detail: `${changed.size} pipeline signal${changed.size === 1 ? '' : 's'} changed`,
        tone
      })
    }
  }, [playChime, pushEvent])

  const loadSnapshot = useCallback(async () => {
    if (standalone && !token) {
      const response = await fetch('/api/public/pipeline-status')
      const body = await response.json() as { ok?: boolean; data?: PipelineStatusSnapshot; error?: { message?: string } }
      if (!body.ok || !body.data) {
        setFeedback(body.error?.message ?? 'Status snapshot could not be loaded')
        return
      }
      ingestSnapshot(body.data)
      return
    }
    if (watchToken) {
      const response = await fetch(`/api/public/pipeline-status/${encodeURIComponent(watchToken)}`)
      const body = await response.json() as { ok?: boolean; data?: PipelineStatusSnapshot; error?: { message?: string } }
      if (!body.ok || !body.data) {
        setFeedback(body.error?.message ?? 'Status snapshot could not be loaded')
        return
      }
      ingestSnapshot(body.data)
      return
    }
    const response = await invokeBridge<PipelineStatusSnapshot>(IPC_CHANNELS.pipelineStatus.snapshot, { actorToken: token })
    if (!response.ok || !response.data) {
      setFeedback(response.error?.message ?? 'Status snapshot could not be loaded')
      return
    }
    ingestSnapshot(response.data)
  }, [ingestSnapshot, standalone, token, watchToken])

  const scheduleSnapshotReload = useCallback(() => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void loadSnapshot()
    }, 180)
  }, [loadSnapshot])

  const handlePipelineEvent = useCallback((label: string, detail: string) => {
    setLiveState('live')
    setEventCount((current) => current + 1)
    pushEvent({ label, detail, tone: 'info' })
    playChime('info')
    scheduleSnapshotReload()
  }, [playChime, pushEvent, scheduleSnapshotReload])

  useEffect(() => {
    document.documentElement.dataset.pipelineStatusMode = broadcastMode ? 'broadcast' : 'app'
    return () => {
      delete document.documentElement.dataset.pipelineStatusMode
    }
  }, [broadcastMode])

  useEffect(() => {
    void loadSnapshot()
    const fallbackTimer = window.setInterval(() => void loadSnapshot(), 30000)
    return () => {
      window.clearInterval(fallbackTimer)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
    }
  }, [loadSnapshot])

  useEffect(() => {
    if (standalone || watchToken) return
    const onPlanPipelineUpdated = () => handlePipelineEvent('Plan pipeline', 'Plan status changed')
    const onRunPipelineUpdated = () => handlePipelineEvent('Run pipeline', 'Execution status changed')
    subscribeToChannel(IPC_CHANNELS.events.planPipelineUpdated, onPlanPipelineUpdated)
    subscribeToChannel(IPC_CHANNELS.events.runPipelineUpdated, onRunPipelineUpdated)
    setLiveState('live')
    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.planPipelineUpdated, onPlanPipelineUpdated)
      unsubscribeFromChannel(IPC_CHANNELS.events.runPipelineUpdated, onRunPipelineUpdated)
    }
  }, [handlePipelineEvent, standalone, watchToken])

  useEffect(() => {
    if (!standalone && !watchToken) return
    if (typeof EventSource === 'undefined') return
    const source = new EventSource('/api/public/pipeline-status/events')
    const onLive = () => setLiveState('live')
    const onPlanEvent = () => handlePipelineEvent('Plan pipeline', 'Plan status changed')
    const onRunEvent = () => handlePipelineEvent('Run pipeline', 'Execution status changed')
    source.addEventListener('ready', onLive)
    source.addEventListener('heartbeat', onLive)
    source.addEventListener(IPC_CHANNELS.events.planPipelineUpdated, onPlanEvent)
    source.addEventListener(IPC_CHANNELS.events.runPipelineUpdated, onRunEvent)
    source.onerror = () => {
      setLiveState('reconnecting')
      pushEvent({ label: 'Live stream', detail: 'Reconnecting', tone: 'warning' })
    }
    return () => source.close()
  }, [handlePipelineEvent, pushEvent, standalone, watchToken])

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

  const pipelines = snapshot?.pipelines ?? []
  const planBatches = snapshot?.planBatches ?? []
  const planRecords = snapshot?.planRecords ?? []
  const taskById = useMemo(() => new Map((snapshot?.taskSummaries ?? []).map((task) => [task.id, task])), [snapshot?.taskSummaries])
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
    <section className={`${styles.page} ${broadcastMode ? styles.broadcast : ''}`}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img src={appIconSrc} alt="Open Mission Control" />
          <div>
            <span><LuSatellite size={17} /> Open Mission Control</span>
            <h1>Live pipeline broadcast</h1>
            <p>
              <em className={`${styles.liveBadge} ${liveState === 'live' ? styles.live : styles.reconnecting}`}>{liveState === 'live' ? 'Live' : 'Reconnecting'}</em>
              Last updated {formatClock(snapshot?.generatedAt)}
              <strong>{eventCount} events</strong>
            </p>
          </div>
        </div>
        <section className={styles.liveTicker}>
          <div><LuActivity size={15} /> Activity signal</div>
          <i
            className={`${styles.signalLoader} ${liveState === 'reconnecting' ? styles.reconnectLoader : ''}`}
            aria-label={liveState === 'reconnecting' ? 'Reconnecting live stream' : 'Listening for pipeline updates'}
          >
            <b /><b /><b />
          </i>
        </section>
        {!watchToken ? (
          <div className={styles.actions}>
            <button type="button" onClick={toggleSound}>{soundEnabled && soundReady ? <LuVolume2 size={15} /> : <LuVolumeX size={15} />} {soundEnabled && soundReady ? 'Sound on' : soundEnabled ? 'Sound pending' : 'Sound off'}</button>
            <button type="button" onClick={() => void loadSnapshot()}><LuRefreshCw size={15} /> Hard refresh</button>
            {!standalone ? (
              <button type="button" onClick={() => void openStandalone()}><LuTv size={15} /> Standalone page</button>
            ) : null}
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
          <PlanPipelineColumn
            key={batch.id}
            batch={batch}
            records={planRecords.filter((record) => record.batchId === batch.id)}
            taskById={taskById}
            changed={highlightedKeys.has(`plan:${batch.id}`)}
          />
        ))}
        {planRecords.filter((record) => !record.batchId).map((record) => (
          <PlanPipelineColumn
            key={record.id}
            batch={undefined}
            records={[record]}
            taskById={taskById}
            changed={highlightedKeys.has(`plan-record:${record.id}`)}
          />
        ))}
        {pipelines.map((pipeline) => (
          <PipelineColumn
            key={pipeline.batch.id}
            pipeline={pipeline}
            taskById={taskById}
            changed={highlightedKeys.has(`run:${pipeline.batch.id}`)}
            changedKeys={highlightedKeys}
          />
        ))}
        {pipelines.length === 0 && planBatches.length === 0 && planRecords.length === 0 ? <div className={styles.empty}>No pipelines to display.</div> : null}
      </main>
    </section>
  )
}

function PlanPipelineColumn({
  batch,
  records,
  taskById,
  changed
}: {
  batch?: PlanPipelineBatch
  records: PlanPipelineRecord[]
  taskById: Map<string, PipelineStatusTaskSummary>
  changed: boolean
}) {
  const progress = records.length ? Math.round(records.reduce((sum, record) => sum + record.progress, 0) / records.length) : 0
  const title = batch?.name ?? records[0]?.sourceDraftName ?? 'Plan pipeline'
  const status = batch?.status ?? records[0]?.status
  const current = records.find((record) => record.status === 'running') ?? records.find((record) => record.status === 'waiting') ?? records[0]
  const tasks = current?.taskIds.map((taskId) => taskById.get(taskId)).filter((task): task is PipelineStatusTaskSummary => Boolean(task)) ?? []
  const counts = taskStatusCounts(tasks)
  return (
    <article className={`${styles.pipeline} ${styles[`tone-${statusTone(status)}`]} ${changed ? styles.changed : ''}`}>
      <header>
        <div>
          <span className={styles.kind}>Plan</span>
          <h2>{title}</h2>
          <span>{statusText(status)} · {progress}%</span>
        </div>
        <strong>{records.length} stage</strong>
      </header>
      <div className={styles.progress}><i style={{ width: `${progress}%` }} /></div>
      <section className={`${styles.activeTask} ${current?.status === 'running' ? styles.scanning : ''}`}>
        <span>Current plan stage</span>
        <strong>{current?.groupName ?? 'None'}</strong>
        <small>{counts.active} active · {counts.done} done · {counts.blocked} blocked</small>
      </section>
      <div className={styles.stages}>
        {records.map((record) => {
          const stageTasks = record.taskIds.map((taskId) => taskById.get(taskId)).filter((task): task is PipelineStatusTaskSummary => Boolean(task))
          return (
            <section key={record.id} className={`${styles.stage} ${styles[`tone-${statusTone(record.status)}`]} ${record.status === 'running' ? styles.scanning : ''}`}>
              <div>
                <strong>{record.groupName}</strong>
                <span>{statusText(record.status)} · {record.taskIds.length} task</span>
              </div>
              <div className={styles.progress}><i style={{ width: `${record.progress}%` }} /></div>
              <TaskMiniList tasks={stageTasks} fallbackIds={record.taskIds} />
              {record.lastError ? <p>{record.lastError}</p> : null}
            </section>
          )
        })}
      </div>
    </article>
  )
}

function PipelineColumn({
  pipeline,
  taskById,
  changed,
  changedKeys
}: {
  pipeline: RunPipelineGraph
  taskById: Map<string, PipelineStatusTaskSummary>
  changed: boolean
  changedKeys: Set<string>
}) {
  const activeItem = pipeline.items.find((item) => item.id === pipeline.batch.currentItemId)
  const activeTask = activeItem ? taskById.get(activeItem.taskId) : undefined
  return (
    <article className={`${styles.pipeline} ${styles[`tone-${statusTone(pipeline.batch.status)}`]} ${changed ? styles.changed : ''}`}>
      <header>
        <div>
          <span className={styles.kind}>Run</span>
          <h2>{pipeline.batch.name}</h2>
          <span>{statusText(pipeline.batch.status)} · {pipeline.batch.progress}%</span>
        </div>
        <strong>{pipeline.items.length} task</strong>
      </header>
      <div className={styles.progress}><i style={{ width: `${pipeline.batch.progress}%` }} /></div>
      <section className={`${styles.activeTask} ${activeItem?.status === 'running' ? styles.scanning : ''}`}>
        <span>Active task</span>
        <strong>{activeItem ? taskName(activeTask, activeItem.taskId) : 'None'}</strong>
        <small>{activeItem ? `${projectName(activeTask)} · Attempt ${activeItem.attempt} · Run ${activeItem.taskGatewayRunId ?? '-'}` : 'Next item has not started'}</small>
        {activeItem?.lastError ? <p>{activeItem.lastError}</p> : null}
      </section>
      <div className={styles.stages}>
        {pipeline.stages.map((stage) => {
          const items = pipeline.items.filter((item) => item.stageId === stage.id)
          return (
            <section key={stage.id} className={`${styles.stage} ${styles[`tone-${statusTone(stage.status)}`]} ${stage.status === 'running' ? styles.scanning : ''}`}>
              <div>
                <strong>{stage.name}</strong>
                <span>{statusText(stage.status)} · {items.length} task</span>
              </div>
              <div className={styles.progress}><i style={{ width: `${stage.progress}%` }} /></div>
              <RunItemList items={items} taskById={taskById} changedKeys={changedKeys} />
            </section>
          )
        })}
      </div>
    </article>
  )
}

function TaskMiniList({ tasks, fallbackIds }: { tasks: PipelineStatusTaskSummary[]; fallbackIds: string[] }) {
  const rows = tasks.length > 0 ? tasks.slice(0, 4) : fallbackIds.slice(0, 4).map((id) => ({ id, title: id, status: 'Unknown', projectId: '', projectName: undefined, updatedAt: 0 }))
  return (
    <div className={styles.taskList}>
      {rows.map((task) => (
        <div key={task.id} className={styles.taskLine}>
          <span className={`${styles.dot} ${styles[`tone-${statusTone(task.status)}`]}`} />
          <strong>{taskName(task, task.id)}</strong>
          <small>{projectName(task, 'Project')} · {statusText(task.status)}</small>
        </div>
      ))}
      {fallbackIds.length > rows.length ? <small className={styles.moreTasks}>+{fallbackIds.length - rows.length} more tasks</small> : null}
    </div>
  )
}

function RunItemList({ items, taskById, changedKeys }: { items: RunPipelineItem[]; taskById: Map<string, PipelineStatusTaskSummary>; changedKeys: Set<string> }) {
  return (
    <div className={styles.taskList}>
      {items.slice(0, 5).map((item) => {
        const task = taskById.get(item.taskId)
        return (
          <div key={item.id} className={`${styles.taskLine} ${changedKeys.has(`run-item:${item.id}`) ? styles.changedLine : ''}`}>
            <span className={`${styles.dot} ${styles[`tone-${statusTone(item.status)}`]}`} />
            <strong>{taskName(task, item.taskId)}</strong>
            <small>{projectName(task, item.projectId)} · {statusText(item.status)} · {item.progress}% · Attempt {item.attempt}</small>
            {item.lastError ? <p>{item.lastError}</p> : null}
          </div>
        )
      })}
      {items.length > 5 ? <small className={styles.moreTasks}>+{items.length - 5} more tasks</small> : null}
    </div>
  )
}
