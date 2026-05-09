import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  LuArrowDown,
  LuArrowUp,
  LuCheck,
  LuChevronRight,
  LuCirclePause,
  LuGripVertical,
  LuListRestart,
  LuLoader,
  LuPause,
  LuPlay,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuTrash2,
  LuTriangleAlert,
  LuX
} from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Project, ProjectStatus, TaskEntity } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import styles from './index.module.scss'

type StepKey = 'scope' | 'tasks' | 'groups' | 'run' | 'review'
type RunMode = 'questioned' | 'silent'
type QueueStatus = 'idle' | 'running' | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled'
type RunItemStatus = 'pending' | 'waiting' | 'running' | 'completed' | 'failed' | 'skipped'

interface PipelineGroup {
  id: string
  name: string
  description: string
  taskIds: string[]
  status: RunItemStatus
  progress: number
  retryCount: number
  lastError?: string
  summaryContext?: string
  completedAt?: number
}

interface PipelineTaskRunState {
  status: RunItemStatus
  progress: number
  retryCount: number
  lastError?: string
}

interface PipelineDraft {
  name: string
  createdAt?: number
  createdByName?: string
  selectedProjectIds: string[]
  selectedTaskIds: string[]
  groups: PipelineGroup[]
  runMode: RunMode
  queueStatus: QueueStatus
  currentGroupId?: string
  waitingApprovalGroupId?: string
  taskRunState: Record<string, PipelineTaskRunState>
  updatedAt: number
}

interface ProjectLoadIssue {
  projectId: string
  message: string
}

const STORAGE_KEY = 'omc-plan-pipeline-state-v1'

const STEPS: Array<{ key: StepKey; label: string; detail: string }> = [
  { key: 'scope', label: 'Kapsam', detail: 'Projeleri seç' },
  { key: 'tasks', label: 'Task seçimi', detail: 'Plan havuzu' },
  { key: 'groups', label: 'Gruplar', detail: 'Sıra ve içerik' },
  { key: 'run', label: 'Çalıştırma', detail: 'Mod ve kuyruk' },
  { key: 'review', label: 'Gözden geçir', detail: 'Özet context' }
]

const defaultDraft: PipelineDraft = {
  name: 'Yeni plan pipeline',
  selectedProjectIds: [],
  selectedTaskIds: [],
  groups: [],
  runMode: 'questioned',
  queueStatus: 'idle',
  taskRunState: {},
  updatedAt: 0
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function readStoredDraft(): PipelineDraft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultDraft
    const parsed = JSON.parse(raw) as Partial<PipelineDraft>
    return {
      ...defaultDraft,
      ...parsed,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : defaultDraft.name,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
      createdByName: typeof parsed.createdByName === 'string' ? parsed.createdByName : undefined,
      selectedProjectIds: Array.isArray(parsed.selectedProjectIds) ? parsed.selectedProjectIds : [],
      selectedTaskIds: Array.isArray(parsed.selectedTaskIds) ? parsed.selectedTaskIds : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      taskRunState: parsed.taskRunState && typeof parsed.taskRunState === 'object' ? parsed.taskRunState : {}
    }
  } catch {
    return defaultDraft
  }
}

function statusText(status: QueueStatus | RunItemStatus) {
  const map: Record<string, string> = {
    idle: 'Hazır',
    running: 'Çalışıyor',
    paused: 'Duraklatıldı',
    blocked: 'Onay bekliyor',
    completed: 'Tamamlandı',
    failed: 'Hatalı',
    cancelled: 'İptal edildi',
    pending: 'Bekliyor',
    waiting: 'Onay bekliyor',
    skipped: 'Atlandı'
  }
  return map[status] ?? status
}

function formatTime(timestamp?: number) {
  if (!timestamp) return 'Henüz yok'
  return new Date(timestamp).toLocaleString()
}

function isDoneCategory(status?: ProjectStatus) {
  return status?.category === 'done' || status?.category === 'closed'
}

function summarizeTask(task: TaskEntity) {
  const subtaskCount = Array.isArray(task.subtasks) ? task.subtasks.length : 0
  const commentCount = task.commentCount ?? task.comments?.length ?? 0
  return `${subtaskCount} alt görev, ${commentCount} yorum`
}

function statusTone(status: QueueStatus | RunItemStatus) {
  if (status === 'completed') return 'success'
  if (status === 'running') return 'active'
  if (status === 'waiting' || status === 'blocked' || status === 'paused') return 'warning'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'idle'
}

export function PlanPipelinePage() {
  const { token, user } = useAuth()
  const [activeStep, setActiveStep] = useState<StepKey>('scope')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TaskEntity[]>([])
  const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({})
  const [issues, setIssues] = useState<ProjectLoadIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<PipelineDraft>(() => readStoredDraft())
  const [taskQuery, setTaskQuery] = useState('')
  const [groupQuery, setGroupQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [dragData, setDragData] = useState<string | null>(null)
  const [selectedDetailGroupId, setSelectedDetailGroupId] = useState<string | null>(draft.currentGroupId ?? null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    const [projectResponse, taskResponse] = await Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskEntity[]>(IPC_CHANNELS.tasks.list, token)
    ])

    if (!projectResponse.ok) {
      setError(projectResponse.error?.message ?? 'Projeler yüklenemedi')
      setProjects([])
      setTasks([])
      setLoading(false)
      return
    }

    const projectRows = Array.isArray(projectResponse.data) ? projectResponse.data : []
    const taskRows = taskResponse.ok && Array.isArray(taskResponse.data) ? taskResponse.data : []
    const statusEntries = await Promise.all(projectRows.map(async (project) => {
      const statusResponse = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, {
        actorToken: token,
        projectId: project.id
      })
      if (!statusResponse.ok) {
        return { projectId: project.id, statuses: [], issue: statusResponse.error?.message ?? 'Status bilgisi alınamadı' }
      }
      return { projectId: project.id, statuses: Array.isArray(statusResponse.data) ? statusResponse.data : [] }
    }))

    setProjects(projectRows)
    setTasks(taskRows)
    setStatusesByProject(Object.fromEntries(statusEntries.map((entry) => [entry.projectId, entry.statuses])))
    setIssues(statusEntries.filter((entry) => entry.issue).map((entry) => ({
      projectId: entry.projectId,
      message: entry.issue ?? 'Bilinmeyen hata'
    })))
    if (!taskResponse.ok) setError(taskResponse.error?.message ?? 'Task listesi yüklenemedi')
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [token])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }))
  }, [draft])

  useEffect(() => {
    if (!modalOpen) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [modalOpen])

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])

  const doneStatusIdsByProject = useMemo(() => {
    const entries = Object.entries(statusesByProject).map(([projectId, statuses]) => [
      projectId,
      new Set(statuses.filter(isDoneCategory).map((status) => status.id))
    ] as const)
    return Object.fromEntries(entries) as Record<string, Set<string>>
  }, [statusesByProject])

  const selectedProjects = useMemo(
    () => projects.filter((project) => draft.selectedProjectIds.includes(project.id)),
    [projects, draft.selectedProjectIds]
  )

  const scopedTasks = useMemo(() => {
    const selected = new Set(draft.selectedProjectIds)
    return tasks.filter((task) => selected.has(task.projectId))
  }, [tasks, draft.selectedProjectIds])

  const eligibleTasks = useMemo(() => scopedTasks.filter((task) => {
    const doneIds = doneStatusIdsByProject[task.projectId]
    if (doneIds?.has(task.status)) return false
    const normalized = task.status.toLowerCase()
    return normalized !== 'done' && normalized !== 'closed' && normalized !== 'completed'
  }), [scopedTasks, doneStatusIdsByProject])

  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase()
    const selected = new Set(draft.selectedTaskIds)
    return eligibleTasks
      .filter((task) => !query || task.title.toLowerCase().includes(query) || projectById.get(task.projectId)?.name.toLowerCase().includes(query))
      .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || b.updatedAt - a.updatedAt)
  }, [eligibleTasks, taskQuery, draft.selectedTaskIds, projectById])

  const assignedTaskIds = useMemo(() => new Set(draft.groups.flatMap((group) => group.taskIds)), [draft.groups])
  const unassignedSelectedTasks = useMemo(
    () => draft.selectedTaskIds.filter((taskId) => !assignedTaskIds.has(taskId) && taskById.has(taskId)),
    [draft.selectedTaskIds, assignedTaskIds, taskById]
  )

  const queueProgress = useMemo(() => {
    const totalTasks = draft.groups.reduce((sum, group) => sum + group.taskIds.length, 0)
    if (totalTasks === 0) return 0
    const totalProgress = draft.groups.reduce((sum, group) => {
      if (group.taskIds.length === 0) return sum
      return sum + group.taskIds.reduce((taskSum, taskId) => taskSum + (draft.taskRunState[taskId]?.progress ?? 0), 0)
    }, 0)
    return Math.round(totalProgress / totalTasks)
  }, [draft.groups, draft.taskRunState])

  const updateDraft = (updater: (current: PipelineDraft) => PipelineDraft) => {
    setDraft((current) => updater({ ...current, updatedAt: Date.now() }))
  }

  const toggleProject = (projectId: string) => {
    updateDraft((current) => {
      const selected = new Set(current.selectedProjectIds)
      selected.has(projectId) ? selected.delete(projectId) : selected.add(projectId)
      const selectedProjectIds = Array.from(selected)
      const allowedTaskIds = new Set(tasks.filter((task) => selectedProjectIds.includes(task.projectId)).map((task) => task.id))
      const selectedTaskIds = current.selectedTaskIds.filter((taskId) => allowedTaskIds.has(taskId))
      return {
        ...current,
        selectedProjectIds,
        selectedTaskIds,
        groups: current.groups.map((group) => ({ ...group, taskIds: group.taskIds.filter((taskId) => selectedTaskIds.includes(taskId)) }))
      }
    })
  }

  const toggleTask = (taskId: string) => {
    updateDraft((current) => {
      const selected = new Set(current.selectedTaskIds)
      selected.has(taskId) ? selected.delete(taskId) : selected.add(taskId)
      const selectedTaskIds = Array.from(selected)
      return {
        ...current,
        selectedTaskIds,
        groups: current.groups.map((group) => ({ ...group, taskIds: group.taskIds.filter((id) => selectedTaskIds.includes(id)) }))
      }
    })
  }

  const createGroup = (event?: FormEvent) => {
    event?.preventDefault()
    const name = groupName.trim()
    if (!name) return
    updateDraft((current) => ({
      ...current,
      groups: [
        ...current.groups,
        {
          id: createId('group'),
          name,
          description: groupDescription.trim(),
          taskIds: [],
          status: 'pending',
          progress: 0,
          retryCount: 0
        }
      ]
    }))
    setGroupName('')
    setGroupDescription('')
    setModalOpen(false)
  }

  const removeGroup = (groupId: string) => {
    updateDraft((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== groupId)
    }))
  }

  const moveGroup = (groupId: string, direction: -1 | 1) => {
    updateDraft((current) => {
      const groups = [...current.groups]
      const index = groups.findIndex((group) => group.id === groupId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= groups.length) return current
      const [item] = groups.splice(index, 1)
      groups.splice(nextIndex, 0, item)
      return { ...current, groups }
    })
  }

  const moveTaskWithinGroup = (groupId: string, taskId: string, direction: -1 | 1) => {
    updateDraft((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) return group
        const taskIds = [...group.taskIds]
        const index = taskIds.indexOf(taskId)
        const nextIndex = index + direction
        if (index < 0 || nextIndex < 0 || nextIndex >= taskIds.length) return group
        const [item] = taskIds.splice(index, 1)
        taskIds.splice(nextIndex, 0, item)
        return { ...group, taskIds }
      })
    }))
  }

  const assignTaskToGroup = (taskId: string, targetGroupId: string) => {
    if (!draft.selectedTaskIds.includes(taskId)) return
    updateDraft((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        const withoutTask = group.taskIds.filter((id) => id !== taskId)
        if (group.id !== targetGroupId) return { ...group, taskIds: withoutTask }
        return { ...group, taskIds: [...withoutTask, taskId] }
      })
    }))
  }

  const unassignTask = (taskId: string) => {
    updateDraft((current) => ({
      ...current,
      groups: current.groups.map((group) => ({ ...group, taskIds: group.taskIds.filter((id) => id !== taskId) }))
    }))
  }

  const handleDrop = (target: { groupId?: string; pool?: boolean }) => {
    if (!dragData) return
    const [kind, id] = dragData.split(':')
    if (kind === 'task') {
      if (target.pool) unassignTask(id)
      if (target.groupId) assignTaskToGroup(id, target.groupId)
    }
    if (kind === 'group' && target.groupId && id !== target.groupId) {
      updateDraft((current) => {
        const groups = [...current.groups]
        const from = groups.findIndex((group) => group.id === id)
        const to = groups.findIndex((group) => group.id === target.groupId)
        if (from < 0 || to < 0) return current
        const [item] = groups.splice(from, 1)
        groups.splice(to, 0, item)
        return { ...current, groups }
      })
    }
    setDragData(null)
  }

  const initializeRunState = (current: PipelineDraft): PipelineDraft => {
    const taskRunState = { ...current.taskRunState }
    current.groups.forEach((group) => {
      group.taskIds.forEach((taskId) => {
        taskRunState[taskId] = taskRunState[taskId] ?? { status: 'pending', progress: 0, retryCount: 0 }
      })
    })
    const firstGroup = current.groups.find((group) => group.taskIds.length > 0)
    return {
      ...current,
      queueStatus: current.runMode === 'questioned' ? 'blocked' : 'running',
      currentGroupId: firstGroup?.id,
      waitingApprovalGroupId: current.runMode === 'questioned' ? firstGroup?.id : undefined,
      groups: current.groups.map((group) => ({
        ...group,
        status: group.id === firstGroup?.id ? (current.runMode === 'questioned' ? 'waiting' : 'running') : 'pending',
        progress: group.id === firstGroup?.id ? group.progress : group.progress
      })),
      taskRunState
    }
  }

  const startQueue = () => {
    updateDraft((current) => initializeRunState({
      ...current,
      createdAt: current.createdAt ?? Date.now(),
      createdByName: current.createdByName ?? user?.name ?? user?.email ?? 'Yerel kullanıcı',
      groups: current.groups.map((group) => ({ ...group, status: 'pending', progress: 0, lastError: undefined, completedAt: undefined })),
      taskRunState: {}
    }))
  }

  const approveGroup = (groupId: string) => {
    updateDraft((current) => ({
      ...current,
      queueStatus: 'running',
      waitingApprovalGroupId: undefined,
      currentGroupId: groupId,
      groups: current.groups.map((group) => group.id === groupId ? { ...group, status: 'running' } : group)
    }))
  }

  const pauseQueue = () => {
    updateDraft((current) => ({ ...current, queueStatus: 'paused' }))
  }

  const resumeQueue = () => {
    updateDraft((current) => ({ ...current, queueStatus: current.waitingApprovalGroupId ? 'blocked' : 'running' }))
  }

  const cancelQueue = () => {
    updateDraft((current) => ({
      ...current,
      queueStatus: 'cancelled',
      groups: current.groups.map((group) => group.status === 'running' || group.status === 'waiting' ? { ...group, status: 'skipped' } : group)
    }))
  }

  const failGroup = (groupId: string) => {
    updateDraft((current) => ({
      ...current,
      queueStatus: 'failed',
      groups: current.groups.map((group) => group.id === groupId ? { ...group, status: 'failed', lastError: 'Kuyruk adımı manuel olarak hatalı işaretlendi.' } : group)
    }))
  }

  const retryGroup = (groupId: string) => {
    updateDraft((current) => ({
      ...current,
      queueStatus: current.runMode === 'questioned' ? 'blocked' : 'running',
      currentGroupId: groupId,
      waitingApprovalGroupId: current.runMode === 'questioned' ? groupId : undefined,
      groups: current.groups.map((group) => group.id === groupId ? {
        ...group,
        status: current.runMode === 'questioned' ? 'waiting' : 'running',
        retryCount: group.retryCount + 1,
        lastError: undefined
      } : group),
      taskRunState: Object.fromEntries(Object.entries(current.taskRunState).map(([taskId, state]) => {
        const target = current.groups.find((group) => group.id === groupId)?.taskIds.includes(taskId)
        return [taskId, target ? { ...state, status: 'pending', progress: 0, lastError: undefined, retryCount: state.retryCount + 1 } : state]
      }))
    }))
  }

  useEffect(() => {
    if (draft.queueStatus !== 'running' || draft.waitingApprovalGroupId) return
    const timer = window.setInterval(() => {
      setDraft((current) => {
        if (current.queueStatus !== 'running' || current.waitingApprovalGroupId) return current
        const runningGroup = current.groups.find((group) => group.id === current.currentGroupId && group.status === 'running')
        if (!runningGroup) return current
        const taskIds = runningGroup.taskIds
        const activeTaskId = taskIds.find((taskId) => current.taskRunState[taskId]?.status !== 'completed')
        if (!activeTaskId) {
          const completedIndex = current.groups.findIndex((group) => group.id === runningGroup.id)
          const summaryContext = runningGroup.taskIds
            .map((taskId, index) => `${index + 1}. ${taskById.get(taskId)?.title ?? taskId}`)
            .join('\n')
          const groups = current.groups.map((group) => group.id === runningGroup.id ? {
            ...group,
            status: 'completed' as RunItemStatus,
            progress: 100,
            completedAt: Date.now(),
            summaryContext: `Tamamlanan grup: ${group.name}\n${summaryContext || 'Task yok'}`
          } : group)
          const nextGroup = groups.slice(completedIndex + 1).find((group) => group.taskIds.length > 0 && group.status !== 'completed')
          if (!nextGroup) {
            return { ...current, groups, queueStatus: 'completed', currentGroupId: undefined, waitingApprovalGroupId: undefined, updatedAt: Date.now() }
          }
          return {
            ...current,
            groups: groups.map((group) => group.id === nextGroup.id ? { ...group, status: current.runMode === 'questioned' ? 'waiting' : 'running' } : group),
            queueStatus: current.runMode === 'questioned' ? 'blocked' : 'running',
            currentGroupId: nextGroup.id,
            waitingApprovalGroupId: current.runMode === 'questioned' ? nextGroup.id : undefined,
            updatedAt: Date.now()
          }
        }
        const activeState = current.taskRunState[activeTaskId] ?? { status: 'pending', progress: 0, retryCount: 0 }
        const nextProgress = Math.min(100, activeState.progress + 20)
        const taskRunState = {
          ...current.taskRunState,
          [activeTaskId]: {
            ...activeState,
            status: nextProgress >= 100 ? 'completed' as RunItemStatus : 'running' as RunItemStatus,
            progress: nextProgress
          }
        }
        const groupProgress = Math.round(taskIds.reduce((sum, taskId) => sum + (taskRunState[taskId]?.progress ?? 0), 0) / Math.max(taskIds.length, 1))
        return {
          ...current,
          taskRunState,
          groups: current.groups.map((group) => group.id === runningGroup.id ? { ...group, progress: groupProgress } : group),
          updatedAt: Date.now()
        }
      })
    }, 700)
    return () => window.clearInterval(timer)
  }, [draft.queueStatus, draft.waitingApprovalGroupId, taskById])

  const currentGroup = draft.groups.find((group) => group.id === draft.currentGroupId)
  const canStart = draft.groups.some((group) => group.taskIds.length > 0)
  const excludedCount = scopedTasks.length - eligibleTasks.length
  const groupedTaskCount = draft.groups.reduce((sum, group) => sum + group.taskIds.length, 0)
  const nextGroup = currentGroup ?? draft.groups.find((group) => group.taskIds.length > 0 && group.status !== 'completed')
  const runnerName = draft.createdByName ?? user?.name ?? user?.email ?? 'Atanmadı'
  const plannedGroups = draft.groups.filter((group) => group.taskIds.length > 0)
  const startedRows = draft.groups.filter((group) => ['running', 'completed', 'failed', 'skipped'].includes(group.status))
  const waitingRows = draft.groups.filter((group) => group.status === 'pending' || group.status === 'waiting')
  const detailGroup = draft.groups.find((group) => group.id === selectedDetailGroupId) ?? currentGroup ?? plannedGroups[0] ?? draft.groups[0]
  const activeStepIndex = STEPS.findIndex((step) => step.key === activeStep)
  const stageCompletionCount = draft.groups.filter((group) => group.status === 'completed').length
  const failedGroupCount = draft.groups.filter((group) => group.status === 'failed').length
  const waitingApprovalGroup = draft.waitingApprovalGroupId ? draft.groups.find((group) => group.id === draft.waitingApprovalGroupId) : undefined
  const stepValidity: Record<StepKey, boolean> = {
    scope: draft.name.trim().length > 0 && draft.selectedProjectIds.length > 0,
    tasks: draft.selectedTaskIds.length > 0,
    groups: draft.groups.length > 0 && groupedTaskCount > 0 && unassignedSelectedTasks.length === 0,
    run: canStart,
    review: canStart
  }
  const firstInvalidStepIndex = STEPS.findIndex((step) => !stepValidity[step.key])
  const maxAccessibleStepIndex = firstInvalidStepIndex === -1 ? STEPS.length - 1 : firstInvalidStepIndex + 1
  const activeStepMessage = (() => {
    if (activeStep === 'scope' && !stepValidity.scope) return 'Pipeline adı ve en az bir proje seçimi gerekli.'
    if (activeStep === 'tasks' && !stepValidity.tasks) return 'Devam etmek için task havuzuna en az bir task ekle.'
    if (activeStep === 'groups' && !stepValidity.groups) {
      if (draft.groups.length === 0) return 'Taskları yerleştirmek için en az bir grup oluştur.'
      if (groupedTaskCount === 0) return 'Oluşturulan gruba en az bir task ata.'
      return 'Atanmamış taskları gruplara taşıyarak akışı tamamla.'
    }
    if ((activeStep === 'run' || activeStep === 'review') && !canStart) return 'Başlatılabilir bir grup olmadığı için kuyruk hazır değil.'
    return null
  })()
  const goToStep = (index: number) => {
    const boundedIndex = Math.min(Math.max(index, 0), maxAccessibleStepIndex)
    setActiveStep(STEPS[boundedIndex].key)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Plan Pipeline</h1>
          <p>Planlanan, bekleyen ve çalışan otomasyon gruplarını tek ekrandan izle; detayda CodePipeline benzeri çalıştırma akışını gör.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadData()}>
            <LuRefreshCw size={15} />
            Yenile
          </button>
          <button className={styles.primaryButton} type="button" onClick={() => setModalOpen(true)}>
            <LuPlus size={16} />
            Pipeline oluştur
          </button>
        </div>
      </header>

      {error ? (
        <div className={styles.alert}>
          <LuTriangleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void loadData()}>Tekrar dene</button>
        </div>
      ) : null}

      <section className={styles.commandCenter}>
        <aside className={styles.pipelineSummary}>
          <div className={styles.summaryHead}>
            <span>Aktif plan</span>
            <strong>{draft.name}</strong>
            <small>{formatTime(draft.createdAt)} · {runnerName}</small>
          </div>
          <div className={styles.summaryMetrics}>
            <div>
              <span>Planlanan grup</span>
              <strong>{plannedGroups.length}</strong>
            </div>
            <div>
              <span>Başlatılan</span>
              <strong>{startedRows.length}</strong>
            </div>
            <div>
              <span>Bekleyen</span>
              <strong>{waitingRows.length}</strong>
            </div>
          </div>
          <div className={styles.queuePanel}>
            <div className={styles.queuePanelHead}>
              <span>Kuyruk durumu</span>
              <strong className={styles[`tone-${statusTone(draft.queueStatus)}`]}>{statusText(draft.queueStatus)}</strong>
            </div>
            <div className={styles.progressTrack}>
              <i style={{ width: `${queueProgress}%` }} />
            </div>
            <small>{queueProgress}% kalıcı ilerleme · {groupedTaskCount}/{draft.selectedTaskIds.length} task gruplandı</small>
          </div>
          <div className={styles.queueControls}>
            <button className={styles.primaryButton} type="button" disabled={!canStart || draft.queueStatus === 'running'} onClick={startQueue}>
              <LuPlay size={15} />
              Başlat
            </button>
            {draft.queueStatus === 'paused' ? (
              <button className={styles.secondaryButton} type="button" onClick={resumeQueue}><LuPlay size={15} /> Sürdür</button>
            ) : (
              <button className={styles.secondaryButton} type="button" disabled={draft.queueStatus !== 'running'} onClick={pauseQueue}><LuPause size={15} /> Duraklat</button>
            )}
          </div>
        </aside>

        <main className={styles.pipelineDashboard}>
          <section className={styles.tableSection}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Planlananlar</h2>
                <p>Gruplanmış ve sıraya alınmış çalıştırma adımları.</p>
              </div>
              <span className={styles.statePill}>{statusText(draft.queueStatus)}</span>
            </div>
            <div className={styles.pipelineTable}>
              <div className={styles.tableHeader}>
                <span>Sıra</span>
                <span>Grup</span>
                <span>Çalıştıran</span>
                <span>Durum</span>
                <span>Progress</span>
              </div>
              {plannedGroups.length > 0 ? plannedGroups.map((group, index) => (
                <button
                  key={group.id}
                  type="button"
                  className={`${styles.tableRow} ${detailGroup?.id === group.id ? styles.tableRowActive : ''}`}
                  onClick={() => setSelectedDetailGroupId(group.id)}
                >
                  <span>#{index + 1}</span>
                  <strong>{group.name}<small>{group.taskIds.length} task · Retry {group.retryCount}</small></strong>
                  <span>{runnerName}</span>
                  <em className={`${styles.statusBadge} ${styles[`tone-${statusTone(group.status)}`]}`}>{statusText(group.status)}</em>
                  <span>{group.progress}%</span>
                </button>
              )) : (
                <div className={styles.emptyState}>Henüz planlanmış grup yok. Oluştur akışından proje, task ve grup seçimi yap.</div>
              )}
            </div>
          </section>

          <section className={styles.splitTables}>
            <div className={styles.tableSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Başlatılanlar</h2>
                  <p>Çalışan, tamamlanan veya hata alan gruplar.</p>
                </div>
              </div>
              <div className={styles.compactTable}>
                {startedRows.length > 0 ? startedRows.map((group) => (
                  <button key={group.id} type="button" onClick={() => setSelectedDetailGroupId(group.id)}>
                    <strong>{group.name}</strong>
                    <span>{statusText(group.status)} · {group.progress}%</span>
                  </button>
                )) : <div className={styles.emptyState}>Başlatılmış grup yok.</div>}
              </div>
            </div>
            <div className={styles.tableSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Bekleyenler</h2>
                  <p>Sırada veya onay bekleyen gruplar.</p>
                </div>
              </div>
              <div className={styles.compactTable}>
                {waitingRows.length > 0 ? waitingRows.map((group) => (
                  <button key={group.id} type="button" onClick={() => setSelectedDetailGroupId(group.id)}>
                    <strong>{group.name}</strong>
                    <span>{statusText(group.status)} · {group.taskIds.length} task</span>
                  </button>
                )) : <div className={styles.emptyState}>Bekleyen grup yok.</div>}
              </div>
            </div>
          </section>

          <section className={styles.detailSection}>
            <div className={styles.sectionHead}>
              <div>
                <h2>{detailGroup?.name ?? 'Pipeline detayı'}</h2>
                <p>{detailGroup?.description || 'Çalıştırılacak ve çalışan adımlar detayda görünür.'}</p>
              </div>
              {detailGroup ? <span className={`${styles.statusBadge} ${styles[`tone-${statusTone(detailGroup.status)}`]}`}>{statusText(detailGroup.status)}</span> : null}
            </div>
            <div className={styles.detailMetrics}>
              <div>
                <span>Stage tamamlandı</span>
                <strong>{stageCompletionCount}/{plannedGroups.length}</strong>
              </div>
              <div>
                <span>Onay bekleyen</span>
                <strong>{waitingApprovalGroup ? '1' : '0'}</strong>
              </div>
              <div>
                <span>Retry / hata</span>
                <strong>{draft.groups.reduce((sum, group) => sum + group.retryCount, 0)} / {failedGroupCount}</strong>
              </div>
            </div>
            {plannedGroups.length > 0 ? (
              <div className={styles.stageMap} aria-label="Pipeline stage akışı">
                {plannedGroups.map((group, index) => (
                  <button
                    key={group.id}
                    type="button"
                    className={`${styles.stageNode} ${detailGroup?.id === group.id ? styles.stageNodeActive : ''}`}
                    onClick={() => setSelectedDetailGroupId(group.id)}
                  >
                    <span className={`${styles.stageMarker} ${styles[`tone-${statusTone(group.status)}`]}`}>{index + 1}</span>
                    <strong>{group.name}</strong>
                    <small>{group.taskIds.length} task · {group.progress}%</small>
                  </button>
                ))}
              </div>
            ) : null}
            {waitingApprovalGroup ? (
              <div className={styles.approvalBox}>
                <strong>{waitingApprovalGroup.name} onay bekliyor</strong>
                <span>Sorulu mod, bu stage başlamadan önce kullanıcı kararını bekliyor.</span>
                <button type="button" onClick={() => approveGroup(waitingApprovalGroup.id)}>Grubu çalıştır</button>
              </div>
            ) : null}
            {detailGroup ? (
              <div className={styles.pipelineDetail}>
                {detailGroup.taskIds.map((taskId, index) => {
                  const task = taskById.get(taskId)
                  const state = draft.taskRunState[taskId] ?? { status: 'pending' as RunItemStatus, progress: 0, retryCount: 0 }
                  return (
                    <article key={taskId} className={`${styles.detailStage} ${styles[`detailStage-${statusTone(state.status)}`]}`}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{task?.title ?? taskId}</strong>
                        <small>{projectById.get(task?.projectId ?? '')?.name ?? 'Proje yok'} · {task ? summarizeTask(task) : 'Task detayı yok'} · Retry {state.retryCount}</small>
                      </div>
                      <em className={`${styles.statusBadge} ${styles[`tone-${statusTone(state.status)}`]}`}>{statusText(state.status)}</em>
                      <div className={styles.progressTrack}>
                        <i style={{ width: `${state.progress}%` }} />
                      </div>
                      {state.lastError ? <p>{state.lastError}</p> : null}
                    </article>
                  )
                })}
                {detailGroup.taskIds.length === 0 ? <div className={styles.emptyState}>Bu gruba henüz task atanmadı.</div> : null}
                {detailGroup.lastError ? <p className={styles.errorText}>{detailGroup.lastError}</p> : null}
                <div className={styles.runActions}>
                  <button type="button" disabled={detailGroup.status !== 'running'} onClick={() => failGroup(detailGroup.id)}>Hata simüle et</button>
                  <button type="button" disabled={detailGroup.status !== 'failed'} onClick={() => retryGroup(detailGroup.id)}><LuListRestart size={14} /> Yeniden dene</button>
                  <button type="button" disabled={draft.queueStatus === 'idle'} onClick={cancelQueue}><LuCirclePause size={15} /> İptal et</button>
                </div>
              </div>
            ) : (
              <div className={styles.emptyState}>Detay için planlanmış bir grup seç.</div>
            )}
          </section>
        </main>
      </section>

      {modalOpen ? (
        <>
          <button className={styles.modalBackdrop} type="button" aria-label="Kapat" onClick={() => setModalOpen(false)} />
          <section className={`${styles.modal} ${styles.flowModal}`} role="dialog" aria-modal="true" aria-label="Pipeline oluştur">
            <header>
              <div>
                <h2>Pipeline oluştur</h2>
                <p>Proje kapsamı, task havuzu, grup sırası ve çalıştırma modunu tek akışta hazırla.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)}><LuX size={16} /></button>
            </header>
            <section className={styles.stepper}>
              {STEPS.map((step, index) => (
                <button
                  key={step.key}
                  className={`${styles.stepButton} ${activeStep === step.key ? styles.stepButtonActive : ''} ${activeStepIndex > index ? styles.stepButtonDone : ''}`}
                  type="button"
                  disabled={index > maxAccessibleStepIndex}
                  onClick={() => goToStep(index)}
                >
                  <span>{activeStepIndex > index ? <LuCheck size={14} /> : index + 1}</span>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </button>
              ))}
            </section>
            <section className={styles.stepIntro}>
              <div>
                <span>Adım {activeStepIndex + 1} / {STEPS.length}</span>
                <strong>{STEPS[activeStepIndex].label}</strong>
              </div>
              {activeStepMessage ? <p>{activeStepMessage}</p> : <p>Bu adım hazır; ileri geçebilirsin.</p>}
            </section>
            <section className={styles.workspace}>
              <aside className={styles.rail}>
                <div className={styles.flowBrief}>
                  <span>Pipeline</span>
                  <strong>{draft.name}</strong>
                  <small>{draft.runMode === 'questioned' ? 'Sorulu mod' : 'Sorusuz mod'} · {statusText(draft.queueStatus)}</small>
                </div>
                <div className={styles.metric}>
                  <span>Seçili proje</span>
                  <strong>{draft.selectedProjectIds.length}</strong>
                </div>
                <div className={styles.metric}>
                  <span>Task havuzu</span>
                  <strong>{draft.selectedTaskIds.length}</strong>
                </div>
                <div className={styles.metric}>
                  <span>Grup</span>
                  <strong>{draft.groups.length}</strong>
                </div>
                <div className={styles.flowBrief}>
                  <span>Sıradaki adım</span>
                  <strong>{nextGroup?.name ?? 'Hazırlanıyor'}</strong>
                  <small>{groupedTaskCount}/{draft.selectedTaskIds.length} task gruplandı</small>
                </div>
              </aside>

              <main className={styles.panel}>
                {activeStep === 'scope' ? (
            <section className={styles.panelSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Temel bilgiler ve proje kapsamı</h2>
                  <p>Pipeline adını netleştir, sonra başlangıçta kullanılacak projeleri seç.</p>
                </div>
                {loading ? <span className={styles.statePill}><LuLoader size={14} /> Yükleniyor</span> : null}
              </div>
              <label className={styles.nameField}>
                <span>Pipeline adı</span>
                <input value={draft.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Örn. Sprint hazırlık pipeline" />
              </label>
              {issues.length > 0 ? (
                <div className={styles.issueList}>
                  {issues.map((issue) => (
                    <p key={issue.projectId}>{projectById.get(issue.projectId)?.name ?? issue.projectId}: {issue.message}</p>
                  ))}
                </div>
              ) : null}
              <div className={styles.projectGrid}>
                {projects.map((project) => {
                  const selected = draft.selectedProjectIds.includes(project.id)
                  const projectTaskCount = tasks.filter((task) => task.projectId === project.id).length
                  const eligibleProjectTaskCount = eligibleTasks.filter((task) => task.projectId === project.id).length
                  return (
                    <button
                      key={project.id}
                      className={`${styles.projectTile} ${selected ? styles.projectTileSelected : ''}`}
                      type="button"
                      onClick={() => toggleProject(project.id)}
                    >
                      <span>{selected ? <LuCheck size={15} /> : null}</span>
                      <strong>{project.name}</strong>
                      <small>{eligibleProjectTaskCount}/{projectTaskCount} planlanabilir · {project.archived ? 'Arşivli' : 'Aktif'}</small>
                    </button>
                  )
                })}
                {!loading && projects.length === 0 ? (
                  <div className={styles.emptyState}>Henüz proje yok. Pipeline kapsamı oluşturmak için önce proje eklenmesi gerekir.</div>
                ) : null}
              </div>
            </section>
          ) : null}

                {activeStep === 'tasks' ? (
            <section className={styles.panelSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Task seçimi</h2>
                  <p>Yalnızca seçili projelerdeki tamamlanmamış tasklar listelenir. {excludedCount > 0 ? `${excludedCount} tamamlanmış task gizlendi.` : ''}</p>
                </div>
                <label className={styles.searchBox}>
                  <LuSearch size={15} />
                  <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Task veya proje ara" />
                </label>
              </div>
              <div className={styles.taskList}>
                {filteredTasks.length > 0 ? filteredTasks.map((task) => {
                  const selected = draft.selectedTaskIds.includes(task.id)
                  return (
                    <button
                      key={task.id}
                      className={`${styles.taskRow} ${selected ? styles.taskRowSelected : ''}`}
                      type="button"
                      onClick={() => toggleTask(task.id)}
                    >
                      <span className={styles.checkSlot}>{selected ? <LuCheck size={14} /> : null}</span>
                      <span>
                        <strong>{task.title}</strong>
                        <small>{projectById.get(task.projectId)?.name ?? 'Proje yok'} · {summarizeTask(task)}</small>
                      </span>
                      <em>{assignedTaskIds.has(task.id) ? 'Gruplandı' : task.status}</em>
                    </button>
                  )
                }) : (
                  <div className={styles.emptyState}>Seçili proje kapsamında uygun task bulunamadı.</div>
                )}
              </div>
            </section>
          ) : null}

                {activeStep === 'groups' ? (
            <section className={styles.panelSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Grup düzeni</h2>
                  <p>Taskları grup içine, gruplar arasında veya atanmamış havuza sürükle.</p>
                </div>
                <label className={styles.searchBox}>
                  <LuSearch size={15} />
                  <input value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="Grup içinde ara" />
                </label>
              </div>
              <div className={styles.inlineComposer}>
                <label>
                  <span>Grup adı</span>
                  <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Örn. Ön hazırlık" />
                </label>
                <label>
                  <span>Özet amacı</span>
                  <input value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder="Bu grup hangi context'i üretecek?" />
                </label>
                <button className={styles.primaryButton} type="button" onClick={() => createGroup()}><LuPlus size={15} /> Grup ekle</button>
              </div>
              <div
                className={styles.unassignedPool}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop({ pool: true })}
              >
                <div>
                  <strong>Atanmamış tasklar</strong>
                  <small>{unassignedSelectedTasks.length} task</small>
                </div>
                <div className={styles.poolItems}>
                  {unassignedSelectedTasks.map((taskId) => {
                    const task = taskById.get(taskId)
                    if (!task) return null
                    return (
                      <button
                        key={taskId}
                        draggable
                        type="button"
                        className={styles.poolTask}
                        onDragStart={() => setDragData(`task:${taskId}`)}
                        onClick={() => draft.groups[0] ? assignTaskToGroup(taskId, draft.groups[0].id) : undefined}
                      >
                        <LuGripVertical size={14} />
                        {task.title}
                      </button>
                    )
                  })}
                  {unassignedSelectedTasks.length === 0 ? <span>Seçili taskların tamamı gruplara atanmış.</span> : null}
                </div>
              </div>
              <div className={styles.groupBoard}>
                {draft.groups.map((group) => {
                  const visibleTaskIds = group.taskIds.filter((taskId) => {
                    const task = taskById.get(taskId)
                    if (!task) return false
                    const query = groupQuery.trim().toLowerCase()
                    return !query || task.title.toLowerCase().includes(query)
                  })
                  return (
                    <article
                      key={group.id}
                      draggable
                      className={`${styles.groupCard} ${group.id === draft.currentGroupId ? styles.groupCardActive : ''}`}
                      onDragStart={() => setDragData(`group:${group.id}`)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop({ groupId: group.id })}
                    >
                      <header>
                        <div>
                          <span><LuGripVertical size={15} /> Grup {draft.groups.findIndex((item) => item.id === group.id) + 1}</span>
                          <h3>{group.name}</h3>
                          <p>{group.description || 'Açıklama yok'}</p>
                        </div>
                        <div className={styles.groupMeta}>
                          <span className={`${styles.statusBadge} ${styles[`tone-${statusTone(group.status)}`]}`}>{statusText(group.status)}</span>
                          <strong>{group.taskIds.length} task</strong>
                        </div>
                        <div className={styles.iconActions}>
                          <button type="button" title="Yukarı al" onClick={() => moveGroup(group.id, -1)}><LuArrowUp size={14} /></button>
                          <button type="button" title="Aşağı al" onClick={() => moveGroup(group.id, 1)}><LuArrowDown size={14} /></button>
                          <button type="button" title="Sil" onClick={() => removeGroup(group.id)}><LuTrash2 size={14} /></button>
                        </div>
                      </header>
                      <div className={styles.groupProgress}>
                        <div className={styles.progressTrack}>
                          <i style={{ width: `${group.progress}%` }} />
                        </div>
                        <small>{group.progress}%</small>
                      </div>
                      <div className={styles.groupTasks}>
                        {visibleTaskIds.map((taskId) => {
                          const task = taskById.get(taskId)
                          if (!task) return null
                          return (
                            <div key={taskId} className={styles.groupTask} draggable onDragStart={() => setDragData(`task:${taskId}`)}>
                              <LuGripVertical size={14} />
                              <span>
                                <strong>{task.title}</strong>
                                <small>{projectById.get(task.projectId)?.name ?? 'Proje yok'} · {task.description ? task.description.slice(0, 96) : summarizeTask(task)}</small>
                              </span>
                              <em className={`${styles.statusBadge} ${styles[`tone-${statusTone(draft.taskRunState[taskId]?.status ?? 'pending')}`]}`}>
                                {statusText(draft.taskRunState[taskId]?.status ?? 'pending')}
                              </em>
                              <div className={styles.iconActions}>
                                <button type="button" title="Yukarı al" onClick={() => moveTaskWithinGroup(group.id, taskId, -1)}><LuArrowUp size={13} /></button>
                                <button type="button" title="Aşağı al" onClick={() => moveTaskWithinGroup(group.id, taskId, 1)}><LuArrowDown size={13} /></button>
                                <button type="button" title="Atanmamışa taşı" onClick={() => unassignTask(taskId)}><LuX size={13} /></button>
                              </div>
                            </div>
                          )
                        })}
                        {group.taskIds.length === 0 ? <div className={styles.dropHint}>Taskları buraya bırak</div> : null}
                      </div>
                    </article>
                  )
                })}
                {draft.groups.length === 0 ? (
                  <div className={styles.emptyState}>Henüz grup yok. Yukarıdaki alanla ilk stage'i oluştur, sonra taskları bu stage'e ata.</div>
                ) : null}
              </div>
            </section>
          ) : null}

                {activeStep === 'run' ? (
            <section className={styles.panelSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Çalıştırma ayarları</h2>
                  <p>Varsayılan davranış sıralı ve onaylıdır. Sorusuz modda bir sonraki grup otomatik devam eder.</p>
                </div>
              </div>
              <div className={styles.modeGrid}>
                <button
                  type="button"
                  className={`${styles.modeCard} ${draft.runMode === 'questioned' ? styles.modeCardActive : ''}`}
                  onClick={() => updateDraft((current) => ({ ...current, runMode: 'questioned' }))}
                >
                  <strong>Sorulu mod</strong>
                  <span>Her grup başında kullanıcı onayı bekler.</span>
                </button>
                <button
                  type="button"
                  className={`${styles.modeCard} ${draft.runMode === 'silent' ? styles.modeCardActive : ''}`}
                  onClick={() => updateDraft((current) => ({ ...current, runMode: 'silent' }))}
                >
                  <strong>Sorusuz mod</strong>
                  <span>Varsayılan kararlarla sıradaki gruba geçer.</span>
                </button>
              </div>
              <div className={styles.queueControls}>
                <button className={styles.primaryButton} type="button" disabled={!canStart || draft.queueStatus === 'running'} onClick={startQueue}>
                  <LuPlay size={15} />
                  Kuyruğu başlat
                </button>
                {draft.queueStatus === 'paused' ? (
                  <button className={styles.secondaryButton} type="button" onClick={resumeQueue}><LuPlay size={15} /> Sürdür</button>
                ) : (
                  <button className={styles.secondaryButton} type="button" disabled={draft.queueStatus !== 'running'} onClick={pauseQueue}><LuPause size={15} /> Duraklat</button>
                )}
                <button className={styles.secondaryButton} type="button" disabled={draft.queueStatus === 'idle'} onClick={cancelQueue}>
                  <LuCirclePause size={15} />
                  İptal et
                </button>
              </div>
              {draft.waitingApprovalGroupId ? (
                <div className={styles.approvalBox}>
                  <strong>{draft.groups.find((group) => group.id === draft.waitingApprovalGroupId)?.name} onay bekliyor</strong>
                  <button type="button" onClick={() => approveGroup(draft.waitingApprovalGroupId!)}>Grubu çalıştır</button>
                </div>
              ) : null}
              <div className={styles.runList}>
                {draft.groups.map((group) => (
                  <article key={group.id} className={styles.runGroup}>
                    <div>
                      <strong>{group.name}</strong>
                      <span className={`${styles.statusBadge} ${styles[`tone-${statusTone(group.status)}`]}`}>{statusText(group.status)} · {group.progress}% · Retry {group.retryCount}</span>
                    </div>
                    <div className={styles.progressTrack}>
                      <i style={{ width: `${group.progress}%` }} />
                    </div>
                    {group.lastError ? <p>{group.lastError}</p> : null}
                    <div className={styles.runActions}>
                      <button type="button" disabled={group.status !== 'running'} onClick={() => failGroup(group.id)}>Hata simüle et</button>
                      <button type="button" disabled={group.status !== 'failed'} onClick={() => retryGroup(group.id)}><LuListRestart size={14} /> Yeniden dene</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

                {activeStep === 'review' ? (
            <section className={styles.panelSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Gözden geçirme</h2>
                  <p>Sıra, progress ve gruplar arası özet context aktarımı.</p>
                </div>
                <span className={styles.statePill}>{formatTime(draft.updatedAt)}</span>
              </div>
              <div className={styles.reviewTimeline}>
                {draft.groups.map((group, index) => (
                  <article key={group.id} className={styles.reviewItem}>
                    <span>{index + 1}</span>
                    <div>
                      <h3>{group.name}</h3>
                      <p>{group.taskIds.length} task · {statusText(group.status)} · tamamlanma: {formatTime(group.completedAt)}</p>
                      <pre>{group.summaryContext || 'Bu grup tamamlandığında sonraki gruplara aktarılacak özet burada görünür.'}</pre>
                      {index > 0 ? (
                        <small>Önceki context: {draft.groups[index - 1]?.summaryContext ? draft.groups[index - 1].name : 'Henüz oluşmadı'}</small>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
              </main>
            </section>
            <footer className={styles.footerNav}>
              {STEPS.map((step, index) => {
                if (step.key !== activeStep) return null
                const previous = STEPS[index - 1]
                const next = STEPS[index + 1]
                const nextDisabled = Boolean(next && !stepValidity[step.key])
                return (
                  <div key={step.key}>
                    <button className={styles.secondaryButton} type="button" disabled={!previous} onClick={() => previous && goToStep(index - 1)}>
                      Geri
                    </button>
                    <button className={next ? styles.primaryButton : styles.secondaryButton} type="button" disabled={nextDisabled} onClick={() => next ? goToStep(index + 1) : setModalOpen(false)}>
                      {next ? 'İleri' : 'Detayı görüntüle'}
                      {next ? <LuChevronRight size={15} /> : null}
                    </button>
                  </div>
                )
              })}
            </footer>
          </section>
        </>
      ) : null}
    </section>
  )
}
