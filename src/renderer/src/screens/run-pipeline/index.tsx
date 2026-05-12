import { useEffect, useMemo, useRef, useState } from 'react'
import { LuCirclePause, LuListRestart, LuPause, LuPlay, LuPlus, LuRefreshCw, LuSkipForward, LuSquare, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { PlanPipelineBatch, Project, RunPipelineGraph, RunPipelineItem, RunPipelineStatus, TaskEntity } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { useDebouncedEventRefresh } from '@renderer/hooks/useDebouncedEventRefresh'
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

function taskTitle(task: TaskEntity | undefined, fallback = 'Untitled task') {
  return typeof task?.title === 'string' && task.title.trim() ? task.title : fallback
}

function tone(status?: string) {
  if (status === 'completed' || status === 'skipped') return 'success'
  if (status === 'running') return 'active'
  if (status === 'blocked' || status === 'paused') return 'warning'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'idle'
}

export function RunPipelinePage() {
  const { token } = useAuth()
  const [pipelines, setPipelines] = useState<RunPipelineGraph[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [planBatches, setPlanBatches] = useState<PlanPipelineBatch[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('New run pipeline')
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [selectedPlanBatchId, setSelectedPlanBatchId] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshTimerRef = useRef<number | null>(null)

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true)
    const [runRes, projectRes, taskRes, batchRes] = await Promise.all([
      loadList<RunPipelineGraph[]>(IPC_CHANNELS.runPipelines.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token),
      loadList<PlanPipelineBatch[]>(IPC_CHANNELS.planPipelines.listBatches, token)
    ])
    const graphs = runRes.ok && Array.isArray(runRes.data) ? runRes.data : []
    setPipelines(graphs)
    setProjects(projectRes.ok && Array.isArray(projectRes.data) ? projectRes.data : [])
    setTasks(taskRes.ok && Array.isArray(taskRes.data) ? taskRes.data.filter((task): task is TaskEntity => Boolean(task?.id)) : [])
    setPlanBatches(batchRes.ok && Array.isArray(batchRes.data) ? batchRes.data : [])
    setSelectedId((current) => current ?? graphs[0]?.batch.id ?? null)
    if (!runRes.ok) setFeedback(runRes.error?.message ?? 'Run pipeline list could not be loaded')
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [token])

  useEffect(() => {
    const onRunPipelineUpdated = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        void loadData(true)
      }, 180)
    }
    subscribeToChannel(IPC_CHANNELS.events.runPipelineUpdated, onRunPipelineUpdated)
    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.runPipelineUpdated, onRunPipelineUpdated)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    }
  }, [token])

  useDebouncedEventRefresh(
    [IPC_CHANNELS.events.taskUpdated, IPC_CHANNELS.events.planPipelineUpdated],
    () => loadData(true)
  )

  const selected = pipelines.find((pipeline) => pipeline.batch.id === selectedId) ?? pipelines[0]
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const visibleTasks = useMemo(() => {
    const projectSet = new Set(selectedProjectIds)
    return tasks.filter((task) => task?.id && (projectSet.size === 0 || projectSet.has(task.projectId)))
  }, [tasks, selectedProjectIds])
  const selectedStage = selected?.stages.find((stage) => stage.id === selected.batch.currentStageId) ?? selected?.stages[0]
  const detailItems = selected && selectedStage ? selected.items.filter((item) => item.stageId === selectedStage.id) : []
  const activeItem = selected?.items.find((item) => item.id === selected.batch.currentItemId)

  const runAction = async (channel: string, payload: Record<string, unknown>) => {
    const response = await invokeBridge<RunPipelineGraph>(channel, { actorToken: token, ...payload })
    if (!response.ok || !response.data) {
      setFeedback(response.error?.message ?? 'Action could not be completed')
      return
    }
    setPipelines((current) => current.map((pipeline) => pipeline.batch.id === response.data!.batch.id ? response.data! : pipeline))
    setSelectedId(response.data.batch.id)
  }

  const createManual = async () => {
    const response = await invokeBridge<RunPipelineGraph>(IPC_CHANNELS.runPipelines.createManual, {
      actorToken: token,
      name,
      projectIds: selectedProjectIds,
      stages: [{ name: 'Stage 1', taskIds: selectedTaskIds }]
    })
    if (!response.ok || !response.data) {
      setFeedback(response.error?.message ?? 'Pipeline could not be created')
      return
    }
    setPipelines((current) => [response.data!, ...current])
    setSelectedId(response.data.batch.id)
    setModalOpen(false)
  }

  const createFromPlan = async () => {
    const response = await invokeBridge<RunPipelineGraph>(IPC_CHANNELS.runPipelines.createFromPlanBatch, {
      actorToken: token,
      planBatchId: selectedPlanBatchId
    })
    if (!response.ok || !response.data) {
      setFeedback(response.error?.message ?? 'Pipeline could not be created from the plan batch')
      return
    }
    setPipelines((current) => [response.data!, ...current.filter((pipeline) => pipeline.batch.id !== response.data!.batch.id)])
    setSelectedId(response.data.batch.id)
    setModalOpen(false)
  }

  const itemAction = async (channel: string, item: RunPipelineItem) => {
    await runAction(channel, { id: item.batchId, itemId: item.id })
  }

  const stats = selected ? {
    running: selected.items.filter((item) => item.status === 'running').length,
    queued: selected.items.filter((item) => item.status === 'queued').length,
    failed: selected.items.filter((item) => item.status === 'failed' || item.status === 'blocked').length
  } : { running: 0, queued: 0, failed: 0 }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Run Pipeline</h1>
          <p>Run tasks one by one by stage order and resolve execution failures from one place.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => void loadData()}><LuRefreshCw size={15} /> Refresh</button>
          <button type="button" className={styles.primary} onClick={() => setModalOpen(true)}><LuPlus size={15} /> Create pipeline</button>
        </div>
      </header>

      {feedback ? <div className={styles.alert}><span>{feedback}</span><button type="button" onClick={() => setFeedback(null)}>Dismiss</button></div> : null}

      <section className={styles.summary}>
        <div>
          <span>Active run</span>
          <strong>{selected?.batch.name ?? (loading ? 'Loading' : 'None yet')}</strong>
          <small>{activeItem ? taskTitle(taskById.get(activeItem.taskId), activeItem.taskId) : 'No active task'}</small>
        </div>
        <div className={styles.metrics}>
          <span>Running <strong>{stats.running}</strong></span>
          <span>Queued <strong>{stats.queued}</strong></span>
          <span>Failed <strong>{stats.failed}</strong></span>
          <span>Progress <strong>{selected?.batch.progress ?? 0}%</strong></span>
        </div>
        <div className={styles.progress}><i style={{ width: `${selected?.batch.progress ?? 0}%` }} /></div>
        <div className={styles.actions}>
          <button type="button" disabled={!selected || selected.batch.status === 'running'} onClick={() => selected && void runAction(IPC_CHANNELS.runPipelines.start, { id: selected.batch.id })}><LuPlay size={14} /> Start</button>
          <button type="button" disabled={!selected || selected.batch.status !== 'running'} onClick={() => selected && void runAction(IPC_CHANNELS.runPipelines.pause, { id: selected.batch.id })}><LuPause size={14} /> Pause</button>
          <button type="button" disabled={!selected || selected.batch.status !== 'paused'} onClick={() => selected && void runAction(IPC_CHANNELS.runPipelines.resume, { id: selected.batch.id })}><LuPlay size={14} /> Resume</button>
          <button type="button" disabled={!selected || ['completed', 'cancelled'].includes(selected.batch.status)} onClick={() => selected && void runAction(IPC_CHANNELS.runPipelines.cancel, { id: selected.batch.id })}><LuSquare size={14} /> Cancel</button>
        </div>
      </section>

      <main className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Stage list</h2>
            <span>{pipelines.length} pipeline</span>
          </div>
          {pipelines.length === 0 ? (
            <div className={styles.empty}>No run pipelines yet.</div>
          ) : pipelines.map((pipeline) => (
            <article key={pipeline.batch.id} className={`${styles.pipelineRow} ${pipeline.batch.id === selected?.batch.id ? styles.active : ''}`} onClick={() => setSelectedId(pipeline.batch.id)}>
              <div>
                <strong>{pipeline.batch.name}</strong>
                <small>{pipeline.stages.length} stage · {pipeline.items.length} task</small>
              </div>
              <em className={`${styles.badge} ${styles[`tone-${tone(pipeline.batch.status)}`]}`}>{statusText(pipeline.batch.status)}</em>
              <span>{pipeline.batch.progress}%</span>
            </article>
          ))}
        </section>

        <aside className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>{selectedStage?.name ?? 'Stage detail'}</h2>
            <span>{statusText(selected?.batch.status as RunPipelineStatus)}</span>
          </div>
          {detailItems.length === 0 ? <div className={styles.empty}>Select a pipeline to inspect details.</div> : detailItems.map((item, index) => (
            <article key={item.id} className={styles.itemRow}>
              <span>{index + 1}</span>
              <div>
                <strong>{taskTitle(taskById.get(item.taskId), item.taskId)}</strong>
                <small>{projectById.get(item.projectId)?.name ?? 'Project'} · Attempt {item.attempt} · Run {item.taskGatewayRunId ?? '-'}</small>
                {item.lastError ? <p>{item.lastError}</p> : null}
              </div>
              <em className={`${styles.badge} ${styles[`tone-${tone(item.status)}`]}`}>{statusText(item.status)}</em>
              <div className={styles.itemActions}>
                <button type="button" disabled={item.status !== 'failed'} onClick={() => void itemAction(IPC_CHANNELS.runPipelines.retryItem, item)}><LuListRestart size={13} /> Retry</button>
                <button type="button" disabled={!['failed', 'blocked', 'queued'].includes(item.status)} onClick={() => void itemAction(IPC_CHANNELS.runPipelines.skipItem, item)}><LuSkipForward size={13} /> Skip</button>
              </div>
            </article>
          ))}
        </aside>
      </main>

      {modalOpen ? (
        <>
          <button className={styles.backdrop} type="button" aria-label="Close" onClick={() => setModalOpen(false)} />
          <section className={styles.modal} role="dialog" aria-modal="true">
            <header>
              <h2>Create run pipeline</h2>
              <button type="button" onClick={() => setModalOpen(false)}><LuX size={16} /></button>
            </header>
            <label>
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className={styles.planCreate}>
              <select value={selectedPlanBatchId} onChange={(event) => setSelectedPlanBatchId(event.target.value)}>
                <option value="">Select completed plan</option>
                {planBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {statusText(batch.status)}</option>)}
              </select>
              <button type="button" disabled={!selectedPlanBatchId} onClick={() => void createFromPlan()}>Create from plan</button>
            </div>
            <div className={styles.selectorGrid}>
              <section>
                <h3>Projects</h3>
                {projects.map((project) => (
                  <label key={project.id} className={styles.checkRow}>
                    <input type="checkbox" checked={selectedProjectIds.includes(project.id)} onChange={(event) => {
                      setSelectedProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))
                    }} />
                    <span>{project.name}</span>
                  </label>
                ))}
              </section>
              <section>
                <h3>Tasks</h3>
                {visibleTasks.map((task) => (
                  <label key={task.id} className={styles.checkRow}>
                    <input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={(event) => {
                      setSelectedTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))
                    }} />
                    <span>{taskTitle(task, task.id)}</span>
                  </label>
                ))}
              </section>
            </div>
            <footer>
              <button type="button" onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="button" className={styles.primary} onClick={() => void createManual()}>Create manually</button>
            </footer>
          </section>
        </>
      ) : null}
    </section>
  )
}
