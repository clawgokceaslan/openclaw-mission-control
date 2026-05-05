import { useEffect, useMemo, useState } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, Project, ProjectStatus, Skill, Tag, TaskEntity } from '@shared/types/entities'
import { TaskDetailPopup } from '@renderer/popups/TaskDetail'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { columnsFromProjectStatuses, resolveProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import styles from './GlobalTaskDetailModal.module.scss'

interface GlobalTaskDetailModalProps {
  taskId: string | null
  projectId: string | null
  onClose: () => void
}

function acceptanceCriteriaOf(task: TaskEntity | null): string {
  const agenticInputs = task?.payload?.agenticInputs
  if (!agenticInputs || typeof agenticInputs !== 'object' || Array.isArray(agenticInputs)) return ''
  const value = (agenticInputs as Record<string, unknown>).acceptanceCriteria
  return typeof value === 'string' ? value : ''
}

export function GlobalTaskDetailModal({ taskId, projectId, onClose }: GlobalTaskDetailModalProps) {
  const { token } = useAuth()
  const [task, setTask] = useState<TaskEntity | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!taskId || !projectId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.get, { actorToken: token, id: taskId }),
      invokeBridge<Project>(IPC_CHANNELS.projects.get, { actorToken: token, id: projectId }),
      invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId }),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token)
    ])
      .then(([taskResponse, projectResponse, statusResponse, agentResponse, skillResponse, tagResponse]) => {
        if (cancelled) return
        if (!taskResponse.ok || !taskResponse.data) {
          setTask(null)
          setError(taskResponse.error?.message ?? 'Task detail could not be loaded.')
          return
        }
        setTask(taskResponse.data)
        setProject(projectResponse.ok && projectResponse.data ? projectResponse.data : null)
        setStatuses(statusResponse.ok && Array.isArray(statusResponse.data) ? statusResponse.data : [])
        setAgents(agentResponse.ok && Array.isArray(agentResponse.data) ? agentResponse.data : [])
        setSkills(skillResponse.ok && Array.isArray(skillResponse.data) ? skillResponse.data : [])
        setTags(tagResponse.ok && Array.isArray(tagResponse.data) ? tagResponse.data : [])
        if (!projectResponse.ok) setError(projectResponse.error?.message ?? 'Project detail could not be loaded.')
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Task detail could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, taskId, token])

  const statusColumns = useMemo(() => columnsFromProjectStatuses(statuses), [statuses])
  const assignedAgent = task?.agentId ? agents.find((agent) => agent.id === task.agentId) ?? null : null
  const assignedSkills = task?.skills?.length ? task.skills : skills.filter((skill) => task?.skills?.some((item) => item.id === skill.id))
  const taskTags = task?.tags?.length ? task.tags : tags.filter((tag) => task?.tags?.some((item) => item.id === tag.id))
  const acceptanceCriteria = acceptanceCriteriaOf(task)

  if (!taskId) return null

  return (
    <TaskDetailPopup
      taskId={taskId}
      title="Task detail"
      hideTaskActions
      onClose={onClose}
      onDeleteTask={() => undefined}
      onEditTitle={() => undefined}
      onOpenChat={() => undefined}
    >
      <div className={styles.globalTaskDetail}>
        {loading ? (
          <div className={styles.state}>
            <strong>Loading task detail</strong>
            <span>Preparing the created task and project data.</span>
          </div>
        ) : error ? (
          <div className={styles.state}>
            <strong>Task detail could not be opened</strong>
            <span>{error}</span>
          </div>
        ) : task ? (
          <>
            <section className={styles.summary}>
              <h3>{task.title}</h3>
              <div className={styles.metaGrid}>
                <div><span>Project</span><strong>{project?.name ?? task.projectId}</strong></div>
                <div><span>Status</span><strong>{resolveProjectStatusColumn(task.status, statusColumns).title}</strong></div>
                <div><span>Assignee</span><strong>{assignedAgent?.name ?? 'Unassigned'}</strong></div>
              </div>
            </section>
            <section className={styles.section}>
              <h4>Description</h4>
              {task.description?.trim() ? <p>{task.description}</p> : <p className={styles.empty}>No description yet.</p>}
            </section>
            <section className={styles.section}>
              <h4>Acceptance criteria</h4>
              {acceptanceCriteria.trim() ? <p>{acceptanceCriteria}</p> : <p className={styles.empty}>No acceptance criteria added.</p>}
            </section>
            <section className={styles.section}>
              <h4>Tags and skills</h4>
              {taskTags.length || assignedSkills.length ? (
                <div className={styles.tagRow}>
                  {taskTags.map((tag) => <span key={`tag-${tag.id}`}>{tag.name}</span>)}
                  {assignedSkills.map((skill) => <span key={`skill-${skill.id}`}>{skill.name}</span>)}
                </div>
              ) : <p className={styles.empty}>No tags or skills assigned.</p>}
            </section>
            <section className={styles.section}>
              <h4>Task contents</h4>
              <p>{(task.subtasks ?? []).length} subtasks · {(task.checklistItems ?? []).length} checklist items · {task.commentCount ?? (task.comments ?? []).length} comments</p>
            </section>
            <div className={styles.footerActions}>
              <button type="button" onClick={onClose}>Close</button>
            </div>
          </>
        ) : null}
      </div>
    </TaskDetailPopup>
  )
}
