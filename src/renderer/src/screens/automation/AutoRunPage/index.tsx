import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuSquareCheck, LuCircleStop, LuExternalLink, LuGripVertical, LuListFilter, LuPlay, LuRefreshCw, LuSquare, LuTrash2 } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse, type PlannedGatewayTaskRow, type RunningGatewayTaskRow, type RunningGatewayTasksResponse } from '@shared/contracts/ipc'
import type { Agent, CustomField, Project, ProjectStatus, Skill, Tag, TaskEntity } from '@shared/types/entities'
import { DEFAULT_GATEWAY_LANGUAGE } from '@shared/utils/gateway-language'
import { GlobalTaskDetailModal } from '@renderer/components/navigation/GlobalTaskDetailModal'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { buildProjectWorkspaceExportTaskPayload, buildTaskZipArchive } from '@renderer/screens/projects/detail/taskExport'
import { projectDefaultAgentId, projectDefaultSkillIds, projectGatewaySettings, taskGatewaySurfaceStatuses, withTaskMeta } from '@renderer/screens/projects/detail/projectDetailUtils'
import { automationQueueSnapshot, enqueueAutomationQueue, subscribeAutomationQueue } from '@renderer/screens/automation/automationQueueCoordinator'
import styles from './index.module.scss'

type StepKey = 'scope' | 'tasks' | 'queue' | 'confirm'
type QueueState = 'waiting' | 'running' | 'completed' | 'failed' | 'stopped'
type QueueItem = { id: string; taskId: string; projectId: string; state: QueueState; message?: string; conversationId?: string }
type GatewayRunResponse = { executionMode?: 'terminal' | 'exec'; runId?: string; conversationId?: string }
type DefaultProjectResponse = { projectId: string | null; project?: Project | null; fallbackProject?: Project | null; invalidStoredProjectId?: string | null }

const PAGE_SIZE = 60
const stepLabels: Record<StepKey, string> = { scope: 'Scope', tasks: 'Tasks', queue: 'Queue', confirm: 'Review' }
const stepDescriptions: Record<StepKey, string> = {
  scope: 'Project boundary',
  tasks: 'Pick work items',
  queue: 'Order the run',
  confirm: 'Start safely'
}
const stepOrder: StepKey[] = ['scope', 'tasks', 'queue', 'confirm']

function formatDate(value: number) {
  return new Date(value).toLocaleString()
}

function missingRunLabel(project: Project | undefined) {
  const codex = projectGatewaySettings(project ?? null)
  if (!codex.gatewayId && !(codex.runModel || codex.defaultModel)) return 'Project gateway and run model are missing'
  if (!codex.gatewayId) return 'Project gateway is missing'
  if (!(codex.runModel || codex.defaultModel)) return 'Project run model is missing'
  return ''
}

function isTaskWorking(task: TaskEntity) {
  return taskGatewaySurfaceStatuses(task).some((status) => (
    status.active === true
  ))
}

function hasRunHistory(task: TaskEntity) {
  return taskGatewaySurfaceStatuses(task).some((status) => status.key.startsWith('RUN:'))
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function AutoRunPage() {
  const { token } = useAuth()
  const [activeStep, setActiveStep] = useState<StepKey>('scope')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({})
  const [runningRows, setRunningRows] = useState<RunningGatewayTaskRow[]>([])
  const [plannedRows, setPlannedRows] = useState<PlannedGatewayTaskRow[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [currentProjectId, setCurrentProjectId] = useState('')
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
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
  const sameAutomationActive = automationSnapshot.active.run
  const otherAutomationActive = automationSnapshot.active.plan
  const activeAutomationLabel = sameAutomationActive ? 'Auto Run is already processing a queue' : otherAutomationActive ? 'Auto Plan is running independently' : null
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
    const [projectResponse, taskResponse, agentResponse, skillResponse, tagResponse, customFieldResponse, runningResponse, plannedResponse, defaultProjectResponse] = await Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token ?? null),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token ?? null),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token ?? null),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token ?? null),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token ?? null),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token ?? null),
      invokeBridge<RunningGatewayTasksResponse>(IPC_CHANNELS.tasks.listRunningGateway, { actorToken: token, page: 1, pageSize: PAGE_SIZE, group: 'all' }),
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
    setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
    setSkills(Array.isArray(skillResponse.data) ? skillResponse.data : [])
    setTags(Array.isArray(tagResponse.data) ? tagResponse.data : [])
    setCustomFields(Array.isArray(customFieldResponse.data) ? customFieldResponse.data : [])
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

  const secondStatusByProject = useMemo(() => Object.fromEntries(Object.entries(statusesByProject).map(([projectId, statuses]) => [
    projectId,
    [...statuses].sort((a, b) => a.sortOrder - b.sortOrder)[1]?.id ?? ''
  ])), [statusesByProject])

  const taskStatus = useCallback((task: TaskEntity) => statusesByProject[task.projectId]?.find((status) => status.id === task.status), [statusesByProject])

  const isTaskPlanned = useCallback((task: TaskEntity) => (
    taskGatewaySurfaceStatuses(task).some((status) => status.key === 'PLAN:planned')
  ), [])

  const isRunCandidate = useCallback((task: TaskEntity) => (
    task.projectId === currentProjectId
    && task.status === secondStatusByProject[task.projectId]
    && isTaskPlanned(task)
    && !isTaskWorking(task)
    && !hasRunHistory(task)
  ), [currentProjectId, isTaskPlanned, secondStatusByProject])

  const queryMatchesTask = useCallback((task: TaskEntity, normalizedQuery: string) => (
    !normalizedQuery || `${task.title} ${task.description ?? ''} ${projectsById.get(task.projectId)?.name ?? ''} ${taskStatus(task)?.name ?? ''}`.toLowerCase().includes(normalizedQuery)
  ), [projectsById, taskStatus])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks
      .filter((task) => task.projectId === currentProjectId)
      .filter(isRunCandidate)
      .filter((task) => queryMatchesTask(task, normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 80)
  }, [currentProjectId, isRunCandidate, query, queryMatchesTask, tasks])

  const otherTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks
      .filter((task) => task.projectId === currentProjectId)
      .filter((task) => !isRunCandidate(task))
      .filter((task) => queryMatchesTask(task, normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
  }, [currentProjectId, isRunCandidate, query, queryMatchesTask, tasks])

  useEffect(() => {
    setSelectedTaskIds((current) => current.filter((taskId) => filteredTasks.some((task) => task.id === taskId) && !queuedTaskIds.has(taskId)))
  }, [filteredTasks, queuedTaskIds])

  const isTaskClosed = useCallback((task: TaskEntity) => {
    const status = statusesByProject[task.projectId]?.find((item) => item.id === task.status)
    return status?.category === 'done' || status?.category === 'closed'
  }, [statusesByProject])

  const addToQueue = (task: TaskEntity) => {
    if (queuedTaskIds.has(task.id) || isTaskClosed(task) || missingRunLabel(projectsById.get(task.projectId))) return
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
      .filter((task) => !queuedTaskIds.has(task.id) && !isTaskClosed(task) && !missingRunLabel(projectsById.get(task.projectId)))
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

  const removeQueueItem = (itemId: string) => {
    setQueue((current) => current.filter((item) => item.id !== itemId || item.state === 'running'))
  }

  const runTask = useCallback(async (item: QueueItem) => {
    const task = tasksById.get(item.taskId)
    const project = projectsById.get(item.projectId)
    if (!task || !project) throw new Error('Task or project was not found.')
    const codex = projectGatewaySettings(project)
    const gatewayId = codex.gatewayId || ''
    const model = codex.runModel || codex.defaultModel || ''
    if (!gatewayId || !model) throw new Error('Project gateway or run model is missing.')

    const defaultSkillIds = new Set(projectDefaultSkillIds(project))
    const effectiveTask = {
      ...task,
      agentId: task.agentId || projectDefaultAgentId(project) || null,
      skills: (task.skills?.length ?? 0) > 0 ? task.skills : skills.filter((skill) => defaultSkillIds.has(skill.id))
    }
    const exportContext = {
      task: effectiveTask,
      project,
      projectGroup: null,
      agents,
      skills,
      tags,
      customFields,
      projectStatuses: statusesByProject[project.id] ?? [],
      gatewayLanguage: codex.language || DEFAULT_GATEWAY_LANGUAGE,
      gatewayRunReasoningEffort: codex.runReasoningEffort || 'medium'
    }
    const basePayload = {
      actorToken: token,
      taskId: item.taskId,
      projectId: item.projectId,
      gatewayId,
      model,
      language: codex.language || DEFAULT_GATEWAY_LANGUAGE,
      reasoningEffort: codex.runReasoningEffort || 'medium',
      generalContext: project.generalContext ?? '',
      generalPrompt: project.generalPrompt ?? '',
      defaultOutput: project.defaultOutput ?? ''
    }
    const snapshot = buildProjectWorkspaceExportTaskPayload(exportContext)
    let response = await invokeBridge<GatewayRunResponse>(IPC_CHANNELS.tasks.runGateway, {
      ...basePayload,
      taskMarkdown: snapshot.taskMarkdown,
      taskJson: snapshot.taskJson,
      taskToon: snapshot.taskToon,
      agentMarkdown: snapshot.agentMarkdown,
      skillsMarkdown: snapshot.skillsMarkdown,
      attachments: snapshot.attachments
    })
    if (!response.ok && /zip bytes|required/i.test(response.error?.message ?? '')) {
      const zip = await buildTaskZipArchive(exportContext)
      response = await invokeBridge<GatewayRunResponse>(IPC_CHANNELS.tasks.runGateway, { ...basePayload, zipName: zip.fileName, zipBytes: zip.archive })
    }
    if (!response.ok) throw new Error(response.error?.message ?? 'Codex run could not be started.')
    return response.data?.conversationId || response.data?.runId || ''
  }, [agents, customFields, projectsById, skills, statusesByProject, tags, tasksById, token])

  const waitForRunCompletion = useCallback(async (item: QueueItem, conversationId: string) => {
    if (!conversationId) return
    let observedRunningRow = false
    const startedAt = Date.now()
    while (!stopRequestedRef.current) {
      const response = await invokeBridge<RunningGatewayTasksResponse>(IPC_CHANNELS.tasks.listRunningGateway, { actorToken: token, page: 1, pageSize: PAGE_SIZE, group: 'all' })
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
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'running', message: 'Active: starting with project defaults...' } : row))
        try {
          const conversationId = await runTask(item)
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, conversationId, message: conversationId ? 'Active: run started, waiting for completion.' : 'Completed: run started without conversation tracking.' } : row))
          await waitForRunCompletion(item, conversationId)
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: stopRequestedRef.current ? 'stopped' : 'completed', conversationId, message: stopRequestedRef.current ? 'Stopped.' : 'Completed: run finished.' } : row))
        } catch (runError) {
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'failed', message: runError instanceof Error ? `Failed: ${runError.message}` : 'Failed: run start failed.' } : row))
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
    if (automationQueueSnapshot().active.run) {
      setQueue((current) => current.map((item) => item.state === 'waiting' ? { ...item, message: 'Pending: queued behind another Auto Run batch.' } : item))
    }
    const { promise } = enqueueAutomationQueue('run', executeQueue)
    await promise
  }

  const stopQueue = async () => {
    stopRequestedRef.current = true
    const active = queue.find((item) => item.state === 'running')
    if (active?.conversationId) {
      await invokeBridge(IPC_CHANNELS.tasks.gatewayChatStop, { actorToken: token, taskId: active.taskId, conversationId: active.conversationId })
    }
    setQueue((current) => current.map((item) => item.state === 'waiting' || item.state === 'running' ? { ...item, state: 'stopped', message: 'Stopped.' } : item))
    setQueueBusy(false)
  }

  const stopRunningRow = async (row: RunningGatewayTaskRow) => {
    await invokeBridge(IPC_CHANNELS.tasks.gatewayChatStop, { actorToken: token, taskId: row.taskId, conversationId: row.gatewayConversationId })
    await loadData()
  }

  const renderTaskCard = (task: TaskEntity) => {
    const project = projectsById.get(task.projectId)
    const status = taskStatus(task)
    const missing = missingRunLabel(project)
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
          <small>{missing || (queuedTaskIds.has(task.id) ? 'Already queued' : 'Planned and ready for auto run')}</small>
        </div>
        <div className={styles.cardActions}>
          <button type="button" onClick={(event) => {
            event.stopPropagation()
            addToQueue(task)
          }} disabled={disabled} title={missing || (queuedTaskIds.has(task.id) ? 'Already queued' : 'Add to queue')}>
            <LuPlay size={15} />
          </button>
        </div>
      </article>
    )
  }

  const runTaskReason = (task: TaskEntity) => {
    const secondStatusId = secondStatusByProject[task.projectId]
    if (task.projectId !== currentProjectId) return 'Different project'
    if (task.status !== secondStatusId) return `Status: ${taskStatus(task)?.name ?? 'Unknown'}`
    if (!isTaskPlanned(task)) return 'Plan is not ready'
    if (isTaskWorking(task)) return 'Codex is active'
    if (hasRunHistory(task)) return 'Already has run history'
    return ''
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
          <h1>Auto Run</h1>
          <p>Select never-run tasks from the current project and start them one at a time.</p>
        </div>
        <button type="button" onClick={() => void loadData()} disabled={loading}><LuRefreshCw size={15} /> Refresh</button>
      </header>

      {error ? <div className={styles.notice}>{error}</div> : null}
      {activeAutomationLabel ? <div className={styles.notice}>{activeAutomationLabel}. Auto Run queues stay serial; Auto Plan can continue separately.</div> : null}

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
          <small>planned run tasks</small>
        </div>
      </section>

      <section className={styles.stepperShell} aria-label="Auto Run progress">
        <header className={styles.stepperHeader}>
          <div>
            <span>Workflow</span>
            <strong>{stepLabels[activeStep]}</strong>
            <small>{stepDescriptions[activeStep]}</small>
          </div>
          <p>{queue.length} queued · {filteredTasks.length} eligible</p>
        </header>
        <div className={styles.stepperTrack} aria-hidden="true">
          <span style={{ width: stepProgress }} />
        </div>
        <div className={styles.stepper} role="tablist" aria-label="Auto Run steps">
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
            <div><strong>{activeStep === 'confirm' ? 'Review selection' : 'Task selection'}</strong><span>Drag cards to the queue target on the right.</span></div>
            <button type="button" onClick={addSelectedToQueue} disabled={selectedTaskIds.length === 0}>Add selected</button>
          </header>
          <div className={styles.taskList}>
            {loading ? <div className={styles.emptyState}>Loading tasks...</div> : filteredTasks.length ? filteredTasks.map(renderTaskCard) : <div className={styles.emptyState}>No second-status PLANNED tasks match this project.</div>}
            {otherTasks.length ? (
              <details className={styles.otherTasks}>
                <summary>Other current-project tasks <span>{otherTasks.length}</span></summary>
                <div className={styles.otherTaskList}>
                  {otherTasks.map((task) => (
                    <button key={task.id} type="button" onClick={() => setDetailTarget({ projectId: task.projectId, taskId: task.id })}>
                      <strong>{task.title}</strong>
                      <span>{runTaskReason(task)}</span>
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
                <div className={styles.emptyState}>Use the project picker only when you need tasks from another project. Task selection continues from the next step.</div>
              </div>
            </div>
          ) : null}

          {activeStep === 'queue' || activeStep === 'confirm' ? (
            <div className={`${styles.panel} ${draggingTaskId ? styles.dropReady : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onQueuePanelDrop}>
              <header>
                <div><strong>Run queue</strong><span>{queueSummary.waiting} pending · {queueSummary.running} active · {queueSummary.completed} completed · {queueSummary.failed} failed</span></div>
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
                        <button type="button" onClick={() => removeQueueItem(item.id)} disabled={item.state === 'running'} title="Remove from queue"><LuTrash2 size={15} /></button>
                      </div>
                    </article>
                  )
                }) : <div className={styles.emptyState}>Drop task cards here or add selected tasks from the left.</div>}
              </div>
            </div>
          ) : null}

          {activeStep === 'confirm' ? (
            <div className={styles.panel}>
              <header><div><strong>Running activity</strong><span>{runningRows.length} active record{runningRows.length === 1 ? '' : 's'}</span></div></header>
              <div className={styles.queueList}>
                {runningRows.length ? runningRows.map((row) => (
                  <article key={row.gatewayConversationId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.conversationType}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} - {row.latestActivitySummary} - {formatDate(row.latestAt)}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Open task details"><LuExternalLink size={15} /></button>
                      <button type="button" onClick={() => void stopRunningRow(row)} title="Stop"><LuCircleStop size={15} /></button>
                    </div>
                  </article>
                )) : <div className={styles.emptyState}>No active run is currently visible.</div>}
              </div>
            </div>
          ) : null}

          {activeStep === 'confirm' ? (
            <div className={styles.panel}>
              <header><div><strong>Planned run candidates</strong><span>{plannedRows.length} task{plannedRows.length === 1 ? '' : 's'}</span></div></header>
              <div className={styles.queueList}>
                {plannedRows.length ? plannedRows.map((row) => (
                  <article key={row.taskId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.runnable ? 'Ready' : 'Missing'}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} - {row.runnable ? 'Available from task details' : row.missing.join(', ')}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Open task details"><LuExternalLink size={15} /></button>
                    </div>
                  </article>
                )) : <div className={styles.emptyState}>No planned tasks are ready for review.</div>}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <nav className={styles.flowNav} aria-label="Auto Run navigation">
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
