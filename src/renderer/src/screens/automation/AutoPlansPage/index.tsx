import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuSquareCheck, LuCircleStop, LuExternalLink, LuGripVertical, LuListFilter, LuPlay, LuRefreshCw, LuSquare, LuTrash2 } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse, type PlanTaskGatewayRequest, type PlannedGatewayTaskRow, type RunningGatewayTaskRow, type RunningGatewayTasksResponse } from '@shared/contracts/ipc'
import type { Project, ProjectStatus, TaskEntity } from '@shared/types/entities'
import { DEFAULT_GATEWAY_LANGUAGE } from '@shared/utils/gateway-language'
import { GlobalTaskDetailModal } from '@renderer/components/navigation/GlobalTaskDetailModal'
import { LoadingState } from '@renderer/components/loading'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { projectGatewaySettings, taskGatewaySurfaceStatuses, withTaskMeta } from '@renderer/screens/projects/detail/projectDetailUtils'
import { automationQueueSnapshot, enqueueAutomationQueue, subscribeAutomationQueue } from '@renderer/screens/automation/automationQueueCoordinator'
import styles from './index.module.scss'

type StepKey = 'scope' | 'tasks' | 'queue' | 'confirm'
type PlanMode = NonNullable<PlanTaskGatewayRequest['clarificationMode']>
type QueueState = 'waiting' | 'running' | 'completed' | 'failed' | 'stopped'
type QueueItem = { id: string; taskId: string; projectId: string; state: QueueState; message?: string; conversationId?: string }
type GatewayPlanResponse = { executionMode?: 'terminal' | 'exec'; runId?: string; conversationId?: string; runtimeWorkspacePath?: string }
type DefaultProjectResponse = { projectId: string | null; project?: Project | null; fallbackProject?: Project | null; invalidStoredProjectId?: string | null }

const PAGE_SIZE = 60
const stepLabels: Record<StepKey, string> = { scope: 'Scope', tasks: 'Tasks', queue: 'Queue', confirm: 'Review' }
const stepDescriptions: Record<StepKey, string> = {
  scope: 'Project boundary',
  tasks: 'Pick plan targets',
  queue: 'Order planning',
  confirm: 'Launch safely'
}
const stepOrder: StepKey[] = ['scope', 'tasks', 'queue', 'confirm']

function formatDate(value: number) {
  return new Date(value).toLocaleString()
}

function missingPlanLabel(project: Project | undefined) {
  const codex = projectGatewaySettings(project ?? null)
  if (!codex.gatewayId && !(codex.planModel || codex.defaultModel)) return 'Project gateway and plan model are missing'
  if (!codex.gatewayId) return 'Project gateway is missing'
  if (!(codex.planModel || codex.defaultModel)) return 'Project plan model is missing'
  return ''
}

function isTaskUnplanned(task: TaskEntity) {
  return taskGatewaySurfaceStatuses(task).some((status) => status.key === 'PLAN:not-planned')
}

function isTaskWorking(task: TaskEntity) {
  return taskGatewaySurfaceStatuses(task).some((status) => status.active === true)
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function AutoPlansPage() {
  const { token } = useAuth()
  const [activeStep, setActiveStep] = useState<StepKey>('scope')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({})
  const [runningRows, setRunningRows] = useState<RunningGatewayTaskRow[]>([])
  const [plannedRows, setPlannedRows] = useState<PlannedGatewayTaskRow[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [currentProjectId, setCurrentProjectId] = useState('')
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<PlanMode>('ask-first')
  const [loading, setLoading] = useState(true)
  const [queueBusy, setQueueBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailTarget, setDetailTarget] = useState<{ projectId: string; taskId: string } | null>(null)
  const [automationSnapshot, setAutomationSnapshot] = useState(() => automationQueueSnapshot())
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [draggingQueueId, setDraggingQueueId] = useState<string | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const stopRequestedRef = useRef(false)

  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const queuedTaskIds = useMemo(() => new Set(queue.filter((item) => item.state === 'waiting' || item.state === 'running').map((item) => item.taskId)), [queue])
  const currentProject = projectsById.get(currentProjectId)
  const sameAutomationActive = automationSnapshot.active.plan
  const otherAutomationActive = automationSnapshot.active.run
  const activeAutomationLabel = sameAutomationActive ? 'Plan kuyruğu zaten çalışıyor' : otherAutomationActive ? 'Çalıştırma kuyruğu bağımsız ilerliyor' : null
  const activeStepIndex = Math.max(0, stepOrder.indexOf(activeStep))
  const stepProgress = `${Math.round(((activeStepIndex + 1) / stepOrder.length) * 100)}%`
  const queueSummary = useMemo(() => ({
    waiting: queue.filter((item) => item.state === 'waiting').length,
    running: queue.filter((item) => item.state === 'running').length,
    completed: queue.filter((item) => item.state === 'completed').length,
    failed: queue.filter((item) => item.state === 'failed').length,
    stopped: queue.filter((item) => item.state === 'stopped').length
  }), [queue])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [projectResponse, taskResponse, runningResponse, plannedResponse, defaultProjectResponse] = await Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token ?? null),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token ?? null),
      invokeBridge<RunningGatewayTasksResponse>(IPC_CHANNELS.tasks.listRunningGateway, { actorToken: token, page: 1, pageSize: PAGE_SIZE, group: 'planning' }),
      invokeBridge<PaginatedResponse<PlannedGatewayTaskRow>>(IPC_CHANNELS.tasks.listPlannedGateway, { actorToken: token, page: 1, pageSize: PAGE_SIZE }),
      invokeBridge<DefaultProjectResponse>(IPC_CHANNELS.appSettings.getDefaultAddTaskProject, { actorToken: token })
    ])

    if (!projectResponse.ok) {
      setError(projectResponse.error?.message ?? 'Projects could not be loaded.')
      setLoading(false)
      return
    }

    const nextProjects = Array.isArray(projectResponse.data) ? projectResponse.data : []
    setProjects(nextProjects)
    setCurrentProjectId((current) => {
      if (current && nextProjects.some((project) => project.id === current)) return current
      const defaultProjectId = defaultProjectResponse.ok ? defaultProjectResponse.data?.project?.id ?? defaultProjectResponse.data?.fallbackProject?.id ?? defaultProjectResponse.data?.projectId ?? '' : ''
      return defaultProjectId && nextProjects.some((project) => project.id === defaultProjectId) ? defaultProjectId : nextProjects[0]?.id ?? ''
    })
    setTasks(Array.isArray(taskResponse.data) ? taskResponse.data.map(withTaskMeta) : [])
    setRunningRows(runningResponse.ok && Array.isArray(runningResponse.data?.rows) ? runningResponse.data.rows : [])
    setPlannedRows(plannedResponse.ok && Array.isArray(plannedResponse.data?.rows) ? plannedResponse.data.rows : [])
    const statusEntries = await Promise.all(nextProjects.map(async (project) => {
      const response = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId: project.id })
      return [project.id, response.ok && Array.isArray(response.data) ? response.data : []] as const
    }))
    setStatusesByProject(Object.fromEntries(statusEntries))
    setError(!taskResponse.ok ? taskResponse.error?.message ?? 'Tasks could not be loaded.' : null)
    setLoading(false)
  }, [token])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => subscribeAutomationQueue(() => setAutomationSnapshot(automationQueueSnapshot())), [])

  useEffect(() => {
    const refresh = () => void loadData()
    subscribeToChannel(IPC_CHANNELS.events.taskActivity, refresh)
    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, refresh)
    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, refresh)
      unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, refresh)
    }
  }, [loadData])

  const firstStatusByProject = useMemo(() => Object.fromEntries(Object.entries(statusesByProject).map(([projectId, statuses]) => [
    projectId,
    [...statuses].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? ''
  ])), [statusesByProject])

  const taskStatus = useCallback((task: TaskEntity) => statusesByProject[task.projectId]?.find((status) => status.id === task.status), [statusesByProject])

  const isPlanCandidate = useCallback((task: TaskEntity) => (
    task.projectId === currentProjectId
    && task.status === firstStatusByProject[task.projectId]
    && isTaskUnplanned(task)
    && !isTaskWorking(task)
  ), [currentProjectId, firstStatusByProject])

  const queryMatchesTask = useCallback((task: TaskEntity, normalizedQuery: string) => (
    !normalizedQuery || `${task.title} ${task.description ?? ''} ${projectsById.get(task.projectId)?.name ?? ''} ${taskStatus(task)?.name ?? ''}`.toLowerCase().includes(normalizedQuery)
  ), [projectsById, taskStatus])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks
      .filter((task) => task.projectId === currentProjectId)
      .filter(isPlanCandidate)
      .filter((task) => queryMatchesTask(task, normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 80)
  }, [currentProjectId, isPlanCandidate, query, queryMatchesTask, tasks])

  const otherTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks
      .filter((task) => task.projectId === currentProjectId)
      .filter((task) => !isPlanCandidate(task))
      .filter((task) => queryMatchesTask(task, normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
  }, [currentProjectId, isPlanCandidate, query, queryMatchesTask, tasks])

  useEffect(() => {
    setSelectedTaskIds((current) => current.filter((taskId) => filteredTasks.some((task) => task.id === taskId) && !queuedTaskIds.has(taskId)))
  }, [filteredTasks, queuedTaskIds])

  const isTaskClosed = useCallback((task: TaskEntity) => {
    const status = statusesByProject[task.projectId]?.find((item) => item.id === task.status)
    return status?.category === 'done' || status?.category === 'closed'
  }, [statusesByProject])

  const addToQueue = (task: TaskEntity) => {
    if (queuedTaskIds.has(task.id) || isTaskClosed(task) || missingPlanLabel(projectsById.get(task.projectId))) return
    setQueue((current) => [...current, { id: `${task.id}-${Date.now()}`, taskId: task.id, projectId: task.projectId, state: 'waiting' }])
    setActiveStep('queue')
  }

  const addTaskIdToQueue = (taskId: string) => {
    const task = tasksById.get(taskId)
    if (task) addToQueue(task)
  }

  const addSelectedToQueue = () => {
    const selected = filteredTasks.filter((task) => selectedTaskIds.includes(task.id))
    const nextItems = selected
      .filter((task) => !queuedTaskIds.has(task.id) && !isTaskClosed(task) && !missingPlanLabel(projectsById.get(task.projectId)))
      .map((task, index) => ({ id: `${task.id}-${Date.now()}-${index}`, taskId: task.id, projectId: task.projectId, state: 'waiting' as QueueState }))
    if (nextItems.length === 0) return
    setQueue((current) => [...current, ...nextItems])
    setSelectedTaskIds([])
    setActiveStep('queue')
  }

  const toggleSelectedTask = (taskId: string) => {
    setSelectedTaskIds((current) => current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId])
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

  const moveQueueItemToIndex = (itemId: string, targetIndex: number) => {
    setQueue((current) => {
      const index = current.findIndex((item) => item.id === itemId)
      if (index < 0 || targetIndex < 0 || targetIndex > current.length || index === targetIndex) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      return next
    })
  }

  const onTaskDragStart = (event: DragEvent<HTMLElement>, task: TaskEntity, disabled: boolean) => {
    if (disabled) return
    setDraggingTaskId(task.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-omc-task-id', task.id)
    event.dataTransfer.setData('text/plain', task.id)
  }

  const onQueueDragStart = (event: DragEvent<HTMLElement>, item: QueueItem) => {
    if (item.state === 'running') return
    setDraggingQueueId(item.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }

  const onQueueDrop = (event: DragEvent<HTMLElement>, targetIndex: number) => {
    event.preventDefault()
    event.stopPropagation()
    const itemId = draggingQueueId || event.dataTransfer.getData('text/plain')
    if (itemId) moveQueueItemToIndex(itemId, targetIndex)
    setDraggingQueueId(null)
  }

  const onQueuePanelDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    if (draggingQueueId) return
    const taskId = draggingTaskId || event.dataTransfer.getData('application/x-omc-task-id')
    if (taskId) addTaskIdToQueue(taskId)
    setDraggingTaskId(null)
  }

  const planTaskReason = (task: TaskEntity) => {
    const firstStatusId = firstStatusByProject[task.projectId]
    if (task.projectId !== currentProjectId) return 'Different project'
    if (task.status !== firstStatusId) return `Status: ${taskStatus(task)?.name ?? 'Unknown'}`
    if (!isTaskUnplanned(task)) return 'Already planned or needs input'
    if (isTaskWorking(task)) return 'Codex is active'
    return ''
  }

  const runPlan = useCallback(async (item: QueueItem) => {
    const task = tasksById.get(item.taskId)
    const project = projectsById.get(item.projectId)
    if (!task || !project) throw new Error('Task or project was not found.')
    const codex = projectGatewaySettings(project)
    const gatewayId = codex.gatewayId || ''
    const model = codex.planModel || codex.defaultModel || ''
    if (!gatewayId || !model) throw new Error('Project gateway or plan model is missing.')

    const response = await invokeBridge<GatewayPlanResponse>(IPC_CHANNELS.tasks.planWithGateway, {
      actorToken: token,
      taskId: item.taskId,
      projectId: item.projectId,
      gatewayId,
      model,
      language: codex.language || DEFAULT_GATEWAY_LANGUAGE,
      reasoningEffort: codex.planReasoningEffort || 'medium',
      clarificationMode: mode,
      generalContext: project.generalContext ?? '',
      generalPrompt: project.generalPrompt ?? '',
      defaultOutput: project.defaultOutput ?? ''
    })
    if (!response.ok) throw new Error(response.error?.message ?? 'Codex plan could not be started.')
    return response.data?.conversationId || response.data?.runId || ''
  }, [mode, projectsById, tasksById, token])

  const waitForPlanCompletion = useCallback(async (item: QueueItem, conversationId: string) => {
    if (!conversationId) return
    let observedRunningRow = false
    const startedAt = Date.now()
    while (!stopRequestedRef.current) {
      const response = await invokeBridge<RunningGatewayTasksResponse>(IPC_CHANNELS.tasks.listRunningGateway, { actorToken: token, page: 1, pageSize: PAGE_SIZE, group: 'planning' })
      const rows = response.ok && Array.isArray(response.data?.rows) ? response.data.rows : []
      setRunningRows(rows)
      const activeRow = rows.find((row) => row.gatewayConversationId === conversationId || row.taskId === item.taskId)
      if (activeRow) {
        observedRunningRow = true
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, message: `Active: ${activeRow.latestActivitySummary || activeRow.liveStatus}` } : row))
      }
      if (observedRunningRow && !activeRow) return
      if (!observedRunningRow && Date.now() - startedAt > 10000) return
      await delay(3000)
    }
  }, [token])

  const executeQueue = async () => {
    if (queueBusy) return
    stopRequestedRef.current = false
    setQueueBusy(true)
    setActiveStep('queue')
    try {
      for (const item of queue) {
        if (stopRequestedRef.current) break
        if (item.state !== 'waiting') continue
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'running', message: mode === 'ask-first' ? 'Active: starting in ask-first mode...' : 'Active: starting in direct mode...' } : row))
        try {
          const conversationId = await runPlan(item)
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, conversationId, message: conversationId ? 'Active: plan started, waiting for completion.' : 'Completed: plan started without conversation tracking.' } : row))
          await waitForPlanCompletion(item, conversationId)
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: stopRequestedRef.current ? 'stopped' : 'completed', conversationId, message: stopRequestedRef.current ? 'Stopped.' : 'Completed: plan finished.' } : row))
        } catch (planError) {
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'failed', message: planError instanceof Error ? `Failed: ${planError.message}` : 'Failed: plan start failed.' } : row))
        }
      }
      await loadData()
    } finally {
      setQueueBusy(false)
    }
  }

  const startQueue = async () => {
    if (queueBusy || !queue.some((item) => item.state === 'waiting')) return
    setQueueBusy(true)
    if (automationQueueSnapshot().active.plan) {
      setQueue((current) => current.map((item) => item.state === 'waiting' ? { ...item, message: 'Bekliyor: başka bir plan kuyruğunun arkasında.' } : item))
    }
    const { promise } = enqueueAutomationQueue('plan', executeQueue)
    await promise
  }

  const stopQueue = async () => {
    stopRequestedRef.current = true
    const active = queue.find((item) => item.state === 'running')
    if (active?.conversationId) await invokeBridge(IPC_CHANNELS.tasks.gatewayChatStop, { actorToken: token, taskId: active.taskId, conversationId: active.conversationId })
    setQueue((current) => current.map((item) => item.state === 'waiting' || item.state === 'running' ? { ...item, state: 'stopped', message: 'Stopped.' } : item))
    setQueueBusy(false)
  }

  const stopRunningRow = async (row: RunningGatewayTaskRow) => {
    await invokeBridge(IPC_CHANNELS.tasks.gatewayChatStop, { actorToken: token, taskId: row.taskId, conversationId: row.gatewayConversationId })
    await loadData()
  }

  const goToRelativeStep = (direction: -1 | 1) => {
    const nextIndex = activeStepIndex + direction
    const nextStep = stepOrder[nextIndex]
    if (!nextStep) return
    if ((nextStep === 'queue' || nextStep === 'confirm') && queue.length === 0) return
    setActiveStep(nextStep)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Plan Kuyruğu</h1>
          <p>Tek task pipeline ana akıştır; birden fazla taskı planlamak gerektiğinde bu ikincil kuyruğu kullan.</p>
        </div>
        <button type="button" onClick={() => void loadData()} disabled={loading}><LuRefreshCw size={15} /> Refresh</button>
      </header>

      {error ? <div className={styles.notice}>{error}</div> : null}
      {activeAutomationLabel ? <div className={styles.notice}>{activeAutomationLabel}. Plan kuyrukları seri ilerler; çalıştırma kuyruğu ayrı kalır.</div> : null}

      <section className={styles.modeBar}>
        <div>
          <strong>Plan mode</strong>
          <span>This setting applies to every task in the prepared queue.</span>
        </div>
        <div className={styles.modeButtons} role="radiogroup" aria-label="Global plan mode">
          <button type="button" className={mode === 'ask-first' ? styles.modeActive : ''} onClick={() => setMode('ask-first')} disabled={queueBusy}>Ask first</button>
          <button type="button" className={mode === 'direct' ? styles.modeActive : ''} onClick={() => setMode('direct')} disabled={queueBusy}>Direct</button>
        </div>
      </section>

      <section className={styles.controls}>
        <div className={styles.scopeSummary}>
          <div className={styles.scopeIcon}><LuListFilter size={18} /></div>
          <div className={styles.scopeCopy}>
            <span>Current project</span>
            <strong>{currentProject?.name ?? 'No project selected'}</strong>
            <small>Default results stay scoped here.</small>
          </div>
          <button type="button" onClick={() => setProjectPickerOpen(true)}>Switch</button>
        </div>
        <label className={styles.searchBox}>
          <span>Search tasks</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, description, or project" />
        </label>
        <div className={styles.controlStat}>
          <span>Eligible</span>
          <strong>{filteredTasks.length}</strong>
          <small>not-planned tasks</small>
        </div>
      </section>

      <section className={styles.stepperShell} aria-label="Plan kuyruğu ilerlemesi">
        <header className={styles.stepperHeader}>
          <div>
            <span>Workflow</span>
            <strong>{stepLabels[activeStep]}</strong>
            <small>{stepDescriptions[activeStep]}</small>
          </div>
          <p>{queue.length} queued · {filteredTasks.length} eligible · {mode === 'ask-first' ? 'Ask first' : 'Direct'}</p>
        </header>
        <div className={styles.stepperTrack} aria-hidden="true">
          <span style={{ width: stepProgress }} />
        </div>
        <div className={styles.stepper} role="tablist" aria-label="Plan kuyruğu adımları">
          {stepOrder.map((step, index) => {
            const isActive = activeStep === step
            const isComplete = stepOrder.indexOf(step) < activeStepIndex
            return (
              <button key={step} type="button" className={`${isActive ? styles.stepActive : ''} ${isComplete ? styles.stepComplete : ''}`} onClick={() => setActiveStep(step)} disabled={(step === 'queue' || step === 'confirm') && queue.length === 0}>
                <span>{index + 1}</span>
                <b>{stepLabels[step]}</b>
                <small>{stepDescriptions[step]}</small>
              </button>
            )
          })}
        </div>
      </section>

      <div className={`${styles.layout} ${activeStep === 'scope' || activeStep === 'queue' ? styles.layoutFull : ''}`}>
        {activeStep === 'tasks' || activeStep === 'confirm' ? <aside className={styles.selector}>
          <header>
            <div><strong>{activeStep === 'confirm' ? 'Review selection' : 'Plan task selection'}</strong><span>Drag cards to the queue target on the right.</span></div>
            <button type="button" onClick={addSelectedToQueue} disabled={selectedTaskIds.length === 0}>Add selected</button>
          </header>
          <div className={styles.taskList}>
            {loading ? <LoadingState variant="skeleton" rows={5} columns={2} messageIndex={1} /> : filteredTasks.length ? filteredTasks.map((task) => {
              const project = projectsById.get(task.projectId)
              const status = taskStatus(task)
              const missing = missingPlanLabel(project)
              const disabled = queuedTaskIds.has(task.id) || isTaskClosed(task) || Boolean(missing)
              const selected = selectedTaskIds.includes(task.id)
              return (
                <article
                  key={task.id}
                  className={`${styles.taskCard} ${selected ? styles.taskCardSelected : ''} ${disabled ? styles.taskCardMuted : ''}`}
                  draggable={!disabled}
                  onDragStart={(event) => onTaskDragStart(event, task, disabled)}
                  onDragEnd={() => setDraggingTaskId(null)}
                  onClick={() => setDetailTarget({ projectId: task.projectId, taskId: task.id })}
                >
                  <button type="button" className={styles.selectButton} onClick={(event) => {
                    event.stopPropagation()
                    toggleSelectedTask(task.id)
                  }} disabled={disabled} aria-label={selected ? `Unselect ${task.title}` : `Select ${task.title}`}>
                    {selected ? <LuSquareCheck size={17} /> : <LuSquare size={17} />}
                  </button>
                  <div className={styles.taskCardBody}>
                    <span>{project?.name ?? 'No project'} · {status?.name ?? 'No status'}</span>
                    <strong>{task.title}</strong>
                    <small>{missing || (queuedTaskIds.has(task.id) ? 'Already queued' : 'Planlamaya hazır')}</small>
                  </div>
                  <div className={styles.cardActions}>
                    <button type="button" onClick={(event) => {
                      event.stopPropagation()
                      addToQueue(task)
                    }} disabled={disabled} title={missing || (queuedTaskIds.has(task.id) ? 'Already queued' : 'Add to plan queue')}><LuPlay size={15} /></button>
                  </div>
                </article>
              )
            }) : <div className={styles.emptyState}>No NOT PLANNED tasks match this project.</div>}
            {otherTasks.length ? (
              <details className={styles.otherTasks}>
                <summary>Other current-project tasks <span>{otherTasks.length}</span></summary>
                <div className={styles.otherTaskList}>
                  {otherTasks.map((task) => (
                    <button key={task.id} type="button" onClick={() => setDetailTarget({ projectId: task.projectId, taskId: task.id })}>
                      <strong>{task.title}</strong>
                      <span>{planTaskReason(task)}</span>
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </aside> : null}

        <section className={styles.workbench}>
          {activeStep === 'scope' ? (
            <div className={styles.panel}>
              <header><div><strong>Scope</strong><span>Default lists stay limited to the current project.</span></div></header>
              <div className={styles.queueList}>
                <div className={styles.emptyState}>Choose another project only when you need to continue from that project's task details.</div>
              </div>
            </div>
          ) : null}

          {activeStep === 'queue' || activeStep === 'confirm' ? (
            <div className={`${styles.panel} ${draggingTaskId ? styles.dropReady : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onQueuePanelDrop}>
              <header>
                <div><strong>Plan kuyruğu</strong><span>{queueSummary.waiting} pending · {queueSummary.running} active · {queueSummary.completed} completed · {queueSummary.failed} failed · {mode === 'ask-first' ? 'ask-first mode' : 'direct mode'}</span></div>
                <div className={styles.panelActions}>
                  <button type="button" onClick={() => void startQueue()} disabled={queueBusy || !queue.some((item) => item.state === 'waiting')}><LuPlay size={15} /> Start</button>
                  <button type="button" onClick={() => void stopQueue()} disabled={!queueBusy && !queue.some((item) => item.state === 'waiting' || item.state === 'running')}><LuCircleStop size={15} /> Stop</button>
                </div>
              </header>
              <div className={styles.queueList}>
                {queue.length ? queue.map((item, index) => {
                  const task = tasksById.get(item.taskId)
                  const project = projectsById.get(item.projectId)
                  return (
                    <article
                      key={item.id}
                      className={`${styles.queueRow} ${draggingQueueId === item.id ? styles.queueRowDragging : ''} ${styles[`state_${item.state}`]}`}
                      draggable={item.state !== 'running'}
                      onDragStart={(event) => onQueueDragStart(event, item)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => onQueueDrop(event, index)}
                      onDragEnd={() => setDraggingQueueId(null)}
                    >
                      <span className={styles.queueIndex}><LuGripVertical size={14} /> {index + 1}</span>
                      <div><strong>{task?.title ?? item.taskId}</strong><span>{project?.name ?? item.projectId} - {item.message ?? item.state}</span></div>
                      <div className={styles.cardActions}>
                        <button type="button" onClick={() => moveQueueItem(item.id, -1)} disabled={index === 0 || item.state === 'running'} title="Move up"><LuArrowUp size={15} /></button>
                        <button type="button" onClick={() => moveQueueItem(item.id, 1)} disabled={index === queue.length - 1 || item.state === 'running'} title="Move down"><LuArrowDown size={15} /></button>
                        <button type="button" onClick={() => setDetailTarget({ projectId: item.projectId, taskId: item.taskId })} title="Open task details"><LuExternalLink size={15} /></button>
                        <button type="button" onClick={() => setQueue((current) => current.filter((row) => row.id !== item.id || row.state === 'running'))} disabled={item.state === 'running'} title="Remove from queue"><LuTrash2 size={15} /></button>
                      </div>
                    </article>
                  )
                }) : <div className={styles.emptyState}>Drop task cards here or add selected tasks from the left.</div>}
              </div>
            </div>
          ) : null}

          {activeStep === 'confirm' ? (
            <div className={styles.panel}>
              <header><div><strong>Running plans</strong><span>{runningRows.length} active plan record{runningRows.length === 1 ? '' : 's'}</span></div></header>
              <div className={styles.queueList}>
                {runningRows.length ? runningRows.map((row) => (
                  <article key={row.gatewayConversationId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.liveStatus}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} - {row.latestActivitySummary} - {formatDate(row.latestAt)}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Open task details"><LuExternalLink size={15} /></button>
                      <button type="button" onClick={() => void stopRunningRow(row)} title="Stop"><LuCircleStop size={15} /></button>
                    </div>
                  </article>
                )) : <div className={styles.emptyState}>No active planning run is currently visible.</div>}
              </div>
            </div>
          ) : null}

          {activeStep === 'confirm' ? (
            <div className={styles.panel}>
              <header><div><strong>Planned tasks</strong><span>{plannedRows.length} task{plannedRows.length === 1 ? '' : 's'}</span></div></header>
              <div className={styles.queueList}>
                {plannedRows.length ? plannedRows.map((row) => (
                  <article key={row.taskId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.runnable ? 'Ready' : 'Missing'}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} - {row.runnable ? 'Çalıştırma kuyruğunda kullanılabilir' : row.missing.join(', ')}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Open task details"><LuExternalLink size={15} /></button>
                    </div>
                  </article>
                )) : <div className={styles.emptyState}>No planned tasks are visible yet.</div>}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <nav className={styles.flowNav} aria-label="Plan kuyruğu navigasyonu">
        <button type="button" onClick={() => goToRelativeStep(-1)} disabled={activeStepIndex === 0}>Previous</button>
        <span>{stepLabels[activeStep]}</span>
        <button type="button" onClick={() => goToRelativeStep(1)} disabled={activeStepIndex === stepOrder.length - 1 || ((stepOrder[activeStepIndex + 1] === 'queue' || stepOrder[activeStepIndex + 1] === 'confirm') && queue.length === 0)}>Next</button>
      </nav>

      {projectPickerOpen ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.projectModal} role="dialog" aria-modal="true" aria-label="Choose project">
            <header>
              <div><strong>Choose project</strong><span>Default task lists only show the selected project.</span></div>
              <button type="button" onClick={() => setProjectPickerOpen(false)}>Close</button>
            </header>
            <div className={styles.projectModalList}>
              {projects.map((project) => (
                <button key={project.id} type="button" className={project.id === currentProjectId ? styles.projectModalActive : ''} onClick={() => {
                  setCurrentProjectId(project.id)
                  setProjectPickerOpen(false)
                  setActiveStep('tasks')
                }}>
                  <strong>{project.name}</strong>
                  <span>{project.description?.trim() || 'No description'}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {detailTarget ? <GlobalTaskDetailModal taskId={detailTarget.taskId} projectId={detailTarget.projectId} onClose={() => setDetailTarget(null)} /> : null}
    </section>
  )
}
