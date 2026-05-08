import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LuArrowDown, LuArrowUp, LuSquareCheck, LuCircleStop, LuExternalLink, LuGripVertical, LuListFilter, LuPlay, LuRefreshCw, LuSquare, LuTrash2 } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse, type PlanTaskGatewayRequest, type PlannedGatewayTaskRow, type RunningGatewayTaskRow, type RunningGatewayTasksResponse } from '@shared/contracts/ipc'
import type { Project, ProjectStatus, TaskEntity, TaskGroup } from '@shared/types/entities'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { DEFAULT_GATEWAY_LANGUAGE } from '@shared/utils/gateway-language'
import { GlobalTaskDetailModal } from '@renderer/components/navigation/GlobalTaskDetailModal'
import { LoadingState } from '@renderer/components/loading'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { projectGatewaySettings, taskGatewaySurfaceStatuses, withTaskMeta } from '@renderer/screens/projects/detail/projectDetailUtils'
import { automationQueueSnapshot, enqueueAutomationQueue, subscribeAutomationQueue } from '@renderer/screens/automation/automationQueueCoordinator'
import styles from './index.module.scss'

type StepKey = 'tasks' | 'queue' | 'confirm'
type PlanMode = NonNullable<PlanTaskGatewayRequest['clarificationMode']>
type QueueState = 'waiting' | 'running' | 'completed' | 'failed' | 'stopped'
type QueueItem = { id: string; taskId: string; projectId: string; groupId?: string | null; state: QueueState; message?: string; conversationId?: string }
type GatewayPlanResponse = { executionMode?: 'terminal' | 'exec'; runId?: string; conversationId?: string; runtimeWorkspacePath?: string }
type DefaultProjectResponse = { projectId: string | null; project?: Project | null; fallbackProject?: Project | null; invalidStoredProjectId?: string | null }

const PAGE_SIZE = 60
function formatDate(value: number) {
  return new Date(value).toLocaleString()
}

function missingPlanLabel(project: Project | undefined) {
  const codex = projectGatewaySettings(project ?? null)
  if (!codex.gatewayId && !(codex.planModel || codex.defaultModel)) return 'Proje gateway ve plan modeli eksik'
  if (!codex.gatewayId) return 'Proje gateway ayarı eksik'
  if (!(codex.planModel || codex.defaultModel)) return 'Proje plan modeli eksik'
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

function queueStateLabel(state: QueueState) {
  if (state === 'waiting') return 'Bekliyor'
  if (state === 'running') return 'Aktif'
  if (state === 'completed') return 'Tamamlandı'
  if (state === 'failed') return 'Hata'
  return 'Durduruldu'
}

function automationPath(path: string, projectId: string, groupId: string) {
  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  if (groupId) params.set('groupId', groupId)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function AutoPlansPage() {
  const { token } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeStep, setActiveStep] = useState<StepKey>('tasks')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({})
  const [runningRows, setRunningRows] = useState<RunningGatewayTaskRow[]>([])
  const [plannedRows, setPlannedRows] = useState<PlannedGatewayTaskRow[]>([])
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [currentProjectId, setCurrentProjectId] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
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
  const taskGroupsById = useMemo(() => new Map(taskGroups.map((group) => [group.groupId, group])), [taskGroups])
  const groupIdByTaskId = useMemo(() => {
    const next = new Map<string, string>()
    for (const group of taskGroups) {
      for (const taskId of group.orderedTaskIds) next.set(taskId, group.groupId)
    }
    for (const row of plannedRows) {
      if (row.groupId) next.set(row.taskId, row.groupId)
    }
    return next
  }, [plannedRows, taskGroups])
  const groupOrderByTaskId = useMemo(() => {
    const next = new Map<string, number>()
    for (const group of taskGroups) {
      group.orderedTaskIds.forEach((taskId, index) => next.set(taskId, index))
    }
    for (const row of plannedRows) {
      row.orderedTaskIds?.forEach((taskId, index) => {
        if (!next.has(taskId)) next.set(taskId, index)
      })
    }
    return next
  }, [plannedRows, taskGroups])
  const queuedTaskIds = useMemo(() => new Set(queue.filter((item) => item.state === 'waiting' || item.state === 'running').map((item) => item.taskId)), [queue])
  const currentProject = projectsById.get(currentProjectId)
  const selectedTaskGroup = selectedGroupId ? taskGroupsById.get(selectedGroupId) : null
  const selectedGroupTaskIds = useMemo(() => new Set(selectedTaskGroup?.orderedTaskIds ?? []), [selectedTaskGroup])
  const sameAutomationActive = automationSnapshot.active.plan
  const otherAutomationActive = automationSnapshot.active.run
  const activeAutomationLabel = sameAutomationActive ? 'Plan kuyruğu zaten çalışıyor' : otherAutomationActive ? 'Çalıştırma kuyruğu bağımsız ilerliyor' : null
  const requestedProjectId = searchParams.get('projectId') ?? ''
  const requestedGroupId = searchParams.get('groupId') ?? ''
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
      if (requestedProjectId && nextProjects.some((project) => project.id === requestedProjectId)) return requestedProjectId
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
  }, [requestedProjectId, token])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => subscribeAutomationQueue(() => setAutomationSnapshot(automationQueueSnapshot())), [])

  useEffect(() => {
    if (!currentProjectId) {
      setTaskGroups([])
      return
    }
    let cancelled = false
    invokeBridge<TaskGroup[]>(IPC_CHANNELS.taskGroups.list, { actorToken: token, projectId: currentProjectId })
      .then((response) => {
        if (!cancelled) setTaskGroups(response.ok && Array.isArray(response.data) ? response.data : [])
      })
      .catch(() => {
        if (!cancelled) setTaskGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [currentProjectId, token])

  useEffect(() => {
    if (selectedGroupId && !taskGroups.some((group) => group.groupId === selectedGroupId)) {
      setSelectedGroupId('')
    }
  }, [selectedGroupId, taskGroups])

  useEffect(() => {
    if (!requestedGroupId || selectedGroupId || !taskGroups.some((group) => group.groupId === requestedGroupId)) return
    setSelectedGroupId(requestedGroupId)
    setActiveStep('tasks')
  }, [requestedGroupId, selectedGroupId, taskGroups])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (currentProjectId) next.set('projectId', currentProjectId)
    else next.delete('projectId')
    if (selectedGroupId) next.set('groupId', selectedGroupId)
    else next.delete('groupId')
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [currentProjectId, searchParams, selectedGroupId, setSearchParams])

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

  const isInSelectedGroup = useCallback((task: TaskEntity) => (
    !selectedGroupId || selectedGroupTaskIds.has(task.id)
  ), [selectedGroupId, selectedGroupTaskIds])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks
      .filter((task) => task.projectId === currentProjectId)
      .filter(isInSelectedGroup)
      .filter(isPlanCandidate)
      .filter((task) => queryMatchesTask(task, normalizedQuery))
      .sort((a, b) => selectedGroupId ? (groupOrderByTaskId.get(a.id) ?? 0) - (groupOrderByTaskId.get(b.id) ?? 0) : b.updatedAt - a.updatedAt)
      .slice(0, 80)
  }, [currentProjectId, groupOrderByTaskId, isInSelectedGroup, isPlanCandidate, query, queryMatchesTask, selectedGroupId, tasks])
  const groupedCandidateCount = useMemo(() => filteredTasks.filter((task) => groupIdByTaskId.has(task.id)).length, [filteredTasks, groupIdByTaskId])
  const otherTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks
      .filter((task) => task.projectId === currentProjectId)
      .filter(isInSelectedGroup)
      .filter((task) => !isPlanCandidate(task))
      .filter((task) => queryMatchesTask(task, normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
  }, [currentProjectId, isInSelectedGroup, isPlanCandidate, query, queryMatchesTask, tasks])

  useEffect(() => {
    setSelectedTaskIds((current) => current.filter((taskId) => filteredTasks.some((task) => task.id === taskId) && !queuedTaskIds.has(taskId)))
  }, [filteredTasks, queuedTaskIds])

  const isTaskClosed = useCallback((task: TaskEntity) => {
    const status = statusesByProject[task.projectId]?.find((item) => item.id === task.status)
    return status?.category === 'done' || status?.category === 'closed'
  }, [statusesByProject])

  const addToQueue = (task: TaskEntity) => {
    if (queuedTaskIds.has(task.id) || isTaskClosed(task) || missingPlanLabel(projectsById.get(task.projectId))) return
    setQueue((current) => [...current, { id: `${task.id}-${Date.now()}`, taskId: task.id, projectId: task.projectId, groupId: groupIdByTaskId.get(task.id) ?? null, state: 'waiting' }])
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
      .sort((a, b) => {
        const groupA = groupIdByTaskId.get(a.id) ?? ''
        const groupB = groupIdByTaskId.get(b.id) ?? ''
        if (groupA && groupA === groupB) return (groupOrderByTaskId.get(a.id) ?? 0) - (groupOrderByTaskId.get(b.id) ?? 0)
        return selectedTaskIds.indexOf(a.id) - selectedTaskIds.indexOf(b.id)
      })
      .map((task, index) => ({ id: `${task.id}-${Date.now()}-${index}`, taskId: task.id, projectId: task.projectId, groupId: groupIdByTaskId.get(task.id) ?? null, state: 'waiting' as QueueState }))
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
    if (task.projectId !== currentProjectId) return 'Farklı proje'
    if (task.status !== firstStatusId) return `Durum: ${taskStatus(task)?.name ?? 'Bilinmiyor'}`
    if (!isTaskUnplanned(task)) return 'Planlandı veya kullanıcı yanıtı bekliyor'
    if (isTaskWorking(task)) return 'Ajan aktif'
    return ''
  }

  const runPlan = useCallback(async (item: QueueItem) => {
    const task = tasksById.get(item.taskId)
    const project = projectsById.get(item.projectId)
    if (!task || !project) throw new Error('Task veya proje bulunamadı.')
    const codex = projectGatewaySettings(project)
    const gatewayId = codex.gatewayId || ''
    const model = codex.planModel || codex.defaultModel || ''
    if (!gatewayId || !model) throw new Error('Proje gateway veya plan modeli eksik.')

    const response = await invokeBridge<GatewayPlanResponse>(IPC_CHANNELS.tasks.planWithGateway, {
      actorToken: token,
      taskId: item.taskId,
      projectId: item.projectId,
      groupId: item.groupId ?? undefined,
      gatewayId,
      model,
      language: codex.language || DEFAULT_GATEWAY_LANGUAGE,
      reasoningEffort: codex.planReasoningEffort || 'medium',
      clarificationMode: mode,
      generalContext: project.generalContext ?? '',
      generalPrompt: project.generalPrompt ?? '',
      defaultOutput: project.defaultOutput ?? ''
    })
    if (!response.ok) throw new Error(response.error?.message ?? 'Planlama başlatılamadı.')
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
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, message: `Aktif: ${activeRow.latestActivitySummary || activeRow.liveStatus}` } : row))
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
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'running', message: mode === 'ask-first' ? 'Aktif: önce sor modunda başlıyor.' : 'Aktif: doğrudan planlama başlıyor.' } : row))
        try {
          const conversationId = await runPlan(item)
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, conversationId, message: conversationId ? 'Aktif: plan başladı, tamamlanması bekleniyor.' : 'Tamamlandı: plan takip kaydı olmadan başlatıldı.' } : row))
          await waitForPlanCompletion(item, conversationId)
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: stopRequestedRef.current ? 'stopped' : 'completed', conversationId, message: stopRequestedRef.current ? 'Durduruldu.' : 'Tamamlandı: plan bitti.' } : row))
        } catch (planError) {
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'failed', message: planError instanceof Error ? `Hata: ${planError.message}` : 'Hata: plan başlatılamadı.' } : row))
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
    setQueue((current) => current.map((item) => item.state === 'waiting' || item.state === 'running' ? { ...item, state: 'stopped', message: 'Durduruldu.' } : item))
    setQueueBusy(false)
  }

  const stopRunningRow = async (row: RunningGatewayTaskRow) => {
    await invokeBridge(IPC_CHANNELS.tasks.gatewayChatStop, { actorToken: token, taskId: row.taskId, conversationId: row.gatewayConversationId })
    await loadData()
  }

  const groupContextLabel = (taskId: string) => {
    const groupId = groupIdByTaskId.get(taskId)
    const group = groupId ? taskGroupsById.get(groupId) : null
    if (!group) return 'Task grubu yok'
    const order = group.orderedTaskIds.indexOf(taskId)
    return `${group.title}${order >= 0 ? ` · P${order + 1}` : ''}`
  }

  const chooseProject = (projectId: string) => {
    setCurrentProjectId(projectId)
    setSelectedGroupId('')
    setProjectPickerOpen(false)
    setActiveStep('tasks')
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Plan Kuyruğu</h1>
          <p>Plan lane'i tek aktif task yürütür; seçili grup sırası korunarak bekleyen tasklar arka arkaya hazırlanır.</p>
        </div>
        <button type="button" onClick={() => void loadData()} disabled={loading}><LuRefreshCw size={15} /> Yenile</button>
      </header>

      {error ? <div className={styles.notice}>{error}<button type="button" onClick={() => void loadData()} disabled={loading}>Yeniden dene</button></div> : null}
      {activeAutomationLabel ? <div className={styles.notice}>{activeAutomationLabel}. Plan kuyrukları seri ilerler; çalıştırma kuyruğu ayrı kalır.</div> : null}

      <section className={styles.modeBar}>
        <div>
          <strong>Plan modu</strong>
          <span>Bu ayar hazırlanan kuyruktaki her task için geçerlidir.</span>
        </div>
        <div className={styles.modeButtons} role="radiogroup" aria-label="Genel plan modu">
          <button type="button" className={mode === 'ask-first' ? styles.modeActive : ''} onClick={() => setMode('ask-first')} disabled={queueBusy}>Önce sor</button>
          <button type="button" className={mode === 'direct' ? styles.modeActive : ''} onClick={() => setMode('direct')} disabled={queueBusy}>Doğrudan</button>
        </div>
      </section>

      <section className={styles.controls}>
        <div className={styles.scopeSummary}>
          <div className={styles.scopeIcon}><LuListFilter size={18} /></div>
          <div className={styles.scopeCopy}>
            <span>Geçerli proje</span>
            <strong>{currentProject?.name ?? 'Proje seçilmedi'}</strong>
            <small>Varsayılan sonuçlar bu kapsamda kalır.</small>
          </div>
          <button type="button" onClick={() => setProjectPickerOpen(true)}>Değiştir</button>
        </div>
        <label className={styles.searchBox}>
          <span>Task ara</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Başlık, açıklama veya proje" />
        </label>
        <label className={styles.groupScope}>
          <span>Task Grubu</span>
          <select value={selectedGroupId} onChange={(event) => {
            const nextGroupId = event.target.value
            setSelectedGroupId(nextGroupId)
            setSelectedTaskIds([])
            setQueue((current) => current.filter((item) => !nextGroupId || item.groupId === nextGroupId))
            setActiveStep('tasks')
          }}>
            <option value="">Tüm task grupları</option>
            {taskGroups.map((group) => (
              <option key={group.groupId} value={group.groupId}>{group.title}</option>
            ))}
          </select>
          <small>{selectedTaskGroup ? `${selectedTaskGroup.orderedTaskIds.length} task bu grup kapsamında` : `${taskGroups.length} grup taranıyor`}</small>
        </label>
        <div className={styles.controlStat}>
          <span>Uygun</span>
          <strong>{filteredTasks.length}</strong>
          <small>plan bekleyen task</small>
        </div>
      </section>

      <div className={styles.pipelineSummary} aria-label="Plan kuyruğu özeti">
        <div><span>Task Grubu</span><strong>{selectedTaskGroup ? selectedTaskGroup.title : `${taskGroups.length} grup`}</strong><small>{groupedCandidateCount} bağlı aday</small></div>
        <div><span>Plan Lane</span><strong>{queueSummary.running ? 'Aktif' : queueSummary.waiting ? 'Sırada' : 'Hazır'}</strong><small>{queueSummary.waiting} bekliyor · {queueSummary.completed} bitti · {queueSummary.failed} hata</small></div>
        <div><span>Sonraki Lane</span><strong>Çalıştırma Kuyruğu</strong><small><Link to={automationPath(APP_ROUTES.AUTO_RUN, currentProjectId, selectedGroupId)}>Aynı bağlamla aç</Link></small></div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.selector}>
          <header>
            <div><strong>{activeStep === 'confirm' ? 'Seçimi kontrol et' : 'Planlanacak tasklar'}</strong><span>Kartları sağdaki kuyruk alanına sürükle.</span></div>
            <button type="button" onClick={addSelectedToQueue} disabled={selectedTaskIds.length === 0}>Seçilenleri ekle</button>
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
                    <span>{project?.name ?? 'Proje yok'} · {status?.name ?? 'Durum yok'}</span>
                    <strong>{task.title}</strong>
                    <small>{groupContextLabel(task.id)} · {missing || (queuedTaskIds.has(task.id) ? 'Zaten kuyrukta' : 'Planlamaya hazır')}</small>
                  </div>
                  <div className={styles.cardActions}>
                    <button type="button" onClick={(event) => {
                      event.stopPropagation()
                      addToQueue(task)
                    }} disabled={disabled} title={missing || (queuedTaskIds.has(task.id) ? 'Zaten kuyrukta' : 'Plan kuyruğuna ekle')}><LuPlay size={15} /></button>
                  </div>
                </article>
              )
            }) : <div className={`${styles.emptyState} ${styles.emptyStateActionable}`}>
              <strong>Plan bekleyen uygun task yok</strong>
              <span>Proje kapsamını değiştir, listeyi yenile veya diğer taskların neden kuyruk dışında kaldığını aşağıdan kontrol et.</span>
              <div>
                <button type="button" onClick={() => setProjectPickerOpen(true)}>Projeyi değiştir</button>
                <button type="button" onClick={() => void loadData()} disabled={loading}>Yenile</button>
              </div>
            </div>}
            {otherTasks.length ? (
              <details className={styles.otherTasks}>
                <summary>Bu projedeki diğer tasklar <span>{otherTasks.length}</span></summary>
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
        </aside>

        <section className={styles.workbench}>
          {activeStep === 'tasks' || activeStep === 'queue' || activeStep === 'confirm' ? (
            <div className={`${styles.panel} ${draggingTaskId ? styles.dropReady : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onQueuePanelDrop}>
              <header>
                <div><strong>Plan kuyruğu</strong><span>{queueSummary.waiting} bekliyor · {queueSummary.running} aktif · {queueSummary.completed} tamamlandı · {queueSummary.failed} hatalı · {mode === 'ask-first' ? 'önce sor modu' : 'doğrudan mod'}</span></div>
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
                      <div><strong>{task?.title ?? item.taskId}</strong><span>{project?.name ?? item.projectId} - {groupContextLabel(item.taskId)} - {item.message ?? queueStateLabel(item.state)}</span></div>
                      <div className={styles.cardActions}>
                        <button type="button" onClick={() => moveQueueItem(item.id, -1)} disabled={index === 0 || item.state === 'running'} title="Yukarı taşı"><LuArrowUp size={15} /></button>
                        <button type="button" onClick={() => moveQueueItem(item.id, 1)} disabled={index === queue.length - 1 || item.state === 'running'} title="Aşağı taşı"><LuArrowDown size={15} /></button>
                        <button type="button" onClick={() => setDetailTarget({ projectId: item.projectId, taskId: item.taskId })} title="Task detayını aç"><LuExternalLink size={15} /></button>
                        <button type="button" onClick={() => setQueue((current) => current.filter((row) => row.id !== item.id || row.state === 'running'))} disabled={item.state === 'running'} title="Kuyruktan çıkar"><LuTrash2 size={15} /></button>
                      </div>
                    </article>
                  )
                }) : <div className={`${styles.emptyState} ${styles.emptyStateActionable}`}>
                  <strong>Plan kuyruğu boş</strong>
                  <span>Tasklar adımından plan bekleyen kayıtları seç; kuyruk sırası grup içi P sırasını korur.</span>
                  <div>
                    <button type="button" onClick={() => setActiveStep('tasks')}>Task seç</button>
                    <button type="button" onClick={() => setProjectPickerOpen(true)}>Projeyi değiştir</button>
                  </div>
                </div>}
              </div>
            </div>
          ) : null}

          {activeStep === 'tasks' || activeStep === 'queue' || activeStep === 'confirm' ? (
            <details className={styles.detailDrawer}>
              <summary>Detaylar ve sonuçlar</summary>
              <div>
            <div className={styles.panel}>
              <header><div><strong>Çalışan planlar</strong><span>{runningRows.length} aktif plan kaydı</span></div></header>
              <div className={styles.queueList}>
                {runningRows.length ? runningRows.map((row) => (
                  <article key={row.gatewayConversationId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.liveStatus}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} - {row.latestActivitySummary} - {formatDate(row.latestAt)}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Task detayını aç"><LuExternalLink size={15} /></button>
                      <button type="button" onClick={() => void stopRunningRow(row)} title="Durdur"><LuCircleStop size={15} /></button>
                    </div>
                  </article>
                )) : <div className={`${styles.emptyState} ${styles.emptyStateActionable}`}>
                  <strong>Aktif planlama yok</strong>
                  <span>Kuyruk tamamlandıysa planlanan taskları aşağıdan kontrol et; yeni iş için task seçimine dön.</span>
                  <div>
                    <button type="button" onClick={() => setActiveStep('tasks')}>Task seç</button>
                    <button type="button" onClick={() => void loadData()} disabled={loading}>Yenile</button>
                  </div>
                </div>}
              </div>
            </div>

            <div className={styles.panel}>
              <header><div><strong>Planlanan tasklar</strong><span>{plannedRows.length} task</span></div></header>
              <div className={styles.queueList}>
                {plannedRows.length ? plannedRows.map((row) => (
                  <article key={row.taskId} className={styles.queueRow}>
                    <span className={styles.queueIndex}>{row.runnable ? 'Hazır' : 'Eksik'}</span>
                    <div><strong>{row.taskTitle}</strong><span>{row.projectName} - {row.runnable ? 'Çalıştırma kuyruğunda kullanılabilir' : row.missing.join(', ')}</span></div>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => setDetailTarget({ projectId: row.projectId, taskId: row.taskId })} title="Task detayını aç"><LuExternalLink size={15} /></button>
                    </div>
                  </article>
                )) : <div className={`${styles.emptyState} ${styles.emptyStateActionable}`}>
                  <strong>Planlanan task görünmüyor</strong>
                  <span>Plan kuyruğu henüz sonuç üretmediyse kuyruk adımına dönüp bekleyen taskları başlat.</span>
                  <div>
                    <button type="button" onClick={() => setActiveStep(queue.length ? 'queue' : 'tasks')}>{queue.length ? 'Kuyruğa dön' : 'Task seç'}</button>
                    <button type="button" onClick={() => void loadData()} disabled={loading}>Yenile</button>
                  </div>
                </div>}
              </div>
            </div>
              </div>
            </details>
          ) : null}
        </section>
      </div>

      {projectPickerOpen ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.projectModal} role="dialog" aria-modal="true" aria-label="Proje seç">
            <header>
              <div><strong>Proje seç</strong><span>Varsayılan task listeleri yalnızca seçili projeyi gösterir.</span></div>
              <button type="button" onClick={() => setProjectPickerOpen(false)}>Kapat</button>
            </header>
            <div className={styles.projectModalList}>
              {projects.map((project) => (
                <button key={project.id} type="button" className={project.id === currentProjectId ? styles.projectModalActive : ''} onClick={() => chooseProject(project.id)}>
                  <strong>{project.name}</strong>
                  <span>{project.description?.trim() || 'Açıklama yok'}</span>
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
