import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Card } from 'react-bootstrap'
import { LuCalendarPlus, LuChevronDown, LuLayers, LuMessageSquare, LuPlus, LuUserPlus } from 'react-icons/lu'
import type { Agent, Tag, TaskEntity, TaskGroup } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { formatTaskDate } from '@renderer/screens/projects/detail/status'
import { taskGatewayActiveTone, taskGatewayLatestSurfaceStatus, type TaskGatewaySurfaceStatus, type TaskDropPosition } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectBoardViewProps {
  columns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
  taskGroups: TaskGroup[]
  agents: Agent[]
  onDropStatus: (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => void
  onReorder: (sourceTaskId: string, targetTaskId: string, position: TaskDropPosition) => void
  onOpenTask: (taskId: string) => void
  onOpenSubtask: (taskId: string, subtaskId: string) => void
  onOpenCreateTask: (status: TaskEntity['status']) => void
}

function renderTags(tags: Tag[] | undefined) {
  if (!tags?.length) return null
  return (
    <div className={styles.tagRow}>
      {tags.slice(0, 3).map((tag) => (
        <TagPill key={tag.id} tag={tag} />
      ))}
    </div>
  )
}

function eventDropPosition(event: DragEvent<HTMLElement>): TaskDropPosition {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function activeTaskClass(tone: TaskGatewaySurfaceStatus['tone'] | null) {
  return tone ? `${styles.taskCardActive} ${styles[`taskCardActive_${tone}`] ?? ''}` : ''
}

function codexStatusClass(status: TaskGatewaySurfaceStatus) {
  return `${styles.taskGatewayStateBadge} ${styles[`taskGatewayTone_${status.tone}`] ?? ''}`
}

function queueLabel(state: TaskGroup['planningQueueState']['state']) {
  if (state === 'not_configured') return 'hazır değil'
  if (state === 'idle') return 'hazır'
  if (state === 'queued') return 'sırada'
  if (state === 'running') return 'aktif'
  if (state === 'completed') return 'tamamlandı'
  if (state === 'failed') return 'hata'
  return state
}

export function ProjectBoardView({ columns, tasksByStatus, taskGroups, agents, onDropStatus, onReorder, onOpenTask, onOpenSubtask, onOpenCreateTask }: ProjectBoardViewProps) {
  const agentName = (task: TaskEntity) => agents.find((agent) => agent.id === task.agentId)?.name ?? 'Unassigned'
  const allTasks = useMemo(() => Object.values(tasksByStatus).flat(), [tasksByStatus])
  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks])
  const groupsByStatus = useMemo(() => {
    const result: Record<string, TaskGroup[]> = {}
    for (const group of taskGroups) {
      const activeTask = (group.activeTaskId ? taskById.get(group.activeTaskId) : undefined)
        ?? group.orderedTaskIds.map((taskId) => taskById.get(taskId)).find((task): task is TaskEntity => Boolean(task))
      if (!activeTask) continue
      result[activeTask.status] = [...(result[activeTask.status] ?? []), group]
    }
    return result
  }, [taskById, taskGroups])
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const [dropTarget, setDropTarget] = useState<{ taskId: string; position: TaskDropPosition } | null>(null)
  const [expandedSubtasks, setExpandedSubtasks] = useState<Record<string, boolean>>({})

  const canStartPan = (event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    return !target.closest('button,a,input,textarea,select,[draggable="true"]')
  }

  const openSubtaskFromCard = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, taskId: string, subtaskId: string) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenSubtask(taskId, subtaskId)
  }

  return (
    <div
      ref={wrapRef}
      className={styles.kanbanWrap}
      onPointerDown={(event) => {
        if (event.button !== 0 || !canStartPan(event)) return
        panRef.current = { active: true, startX: event.clientX, scrollLeft: wrapRef.current?.scrollLeft ?? 0 }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.classList.add(styles.kanbanPanning)
      }}
      onPointerMove={(event) => {
        if (!panRef.current.active || !wrapRef.current) return
        wrapRef.current.scrollLeft = panRef.current.scrollLeft - (event.clientX - panRef.current.startX)
      }}
      onPointerUp={(event) => {
        panRef.current.active = false
        event.currentTarget.classList.remove(styles.kanbanPanning)
      }}
      onPointerCancel={(event) => {
        panRef.current.active = false
        event.currentTarget.classList.remove(styles.kanbanPanning)
      }}
    >
      {columns.map((column) => {
        const rows = tasksByStatus[column.status] ?? []
        const groupRows = groupsByStatus[column.status] ?? []
        return (
          <article
            key={column.key}
            className={styles.column}
            style={{ '--column-accent': column.accent } as CSSProperties}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropStatus(event, column.status)}
          >
            <header className={styles.columnHeader}>
              <div className={styles.columnTitle}>
                <span className={styles.dot} />
                <span>{column.title}</span>
                <strong>{rows.length}</strong>
              </div>
              <button
                type="button"
                className={styles.columnHeaderAdd}
                onClick={() => onOpenCreateTask(column.status)}
                title={`Add task to ${column.title}`}
                aria-label={`Add task to ${column.title}`}
              >
                <LuPlus size={15} />
              </button>
            </header>
            {column.title.toLowerCase().includes('review') ? (
              <div className={styles.reviewFilters}>
                <span className={`${styles.reviewBadge} ${styles.reviewBadgeActive}`}>All · {rows.length}</span>
                <span className={styles.reviewBadge}>Lead review · 0</span>
                <span className={styles.reviewBadge}>Blocked · 0</span>
              </div>
            ) : null}
            <div className={styles.columnBody}>
              {groupRows.map((group) => {
                const doneCount = group.orderedTaskIds.filter((taskId) => {
                  const task = taskById.get(taskId)
                  return task ? ['done', 'closed', 'completed'].includes(String(task.status).toLowerCase()) : false
                }).length
                const activeTask = group.activeTaskId ? taskById.get(group.activeTaskId) : undefined
                return (
                  <article key={group.groupId} className={styles.taskGroupBoardCard}>
                    <header className={styles.taskGroupBoardCard__header}>
                      <span className={styles.taskGroupBoardCard__icon}><LuLayers size={15} /></span>
                      <div className={styles.taskGroupBoardCard__titleBlock}>
                        <h3>{group.title}</h3>
                        <p>{doneCount}/{group.orderedTaskIds.length} task tamamlandı</p>
                      </div>
                    </header>
                    <div className={styles.taskGroupBoardCard__contract}>
                      <span>Plan Kuyruğu: {queueLabel(group.planningQueueState.state)}</span>
                      <span>Çalışma Kuyruğu: {queueLabel(group.executionQueueState.state)}</span>
                      <span>Aktif task: {activeTask?.title ?? group.activeTaskId ?? 'yok'}</span>
                    </div>
                    <ol className={styles.taskGroupBoardCard__tasks}>
                      {group.orderedTaskIds.slice(0, 5).map((taskId, index) => {
                        const task = taskById.get(taskId)
                        return (
                          <li key={taskId}>
                            <button type="button" onClick={() => task && onOpenTask(task.id)} disabled={!task}>
                              <span>{index + 1}</span>
                              <strong>{task?.title ?? taskId}</strong>
                            </button>
                          </li>
                        )
                      })}
                    </ol>
                  </article>
                )
              })}
              {rows.map((task) => {
                const subtasks = task.subtasks ?? []
                const expanded = Boolean(expandedSubtasks[task.id])
                const activeTone = taskGatewayActiveTone(task)
                const chatStatus = taskGatewayLatestSurfaceStatus(task)
                return (
                  <Card
                  key={task.id}
                  className={`${styles.taskCard} ${activeTaskClass(activeTone)} ${dropTarget?.taskId === task.id ? dropTarget.position === 'before' ? styles.taskCardDropBefore : styles.taskCardDropAfter : ''}`}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    event.dataTransfer.dropEffect = 'move'
                    setDropTarget({ taskId: task.id, position: eventDropPosition(event) })
                  }}
                  onDragLeave={() => {
                    setDropTarget((current) => current?.taskId === task.id ? null : current)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const sourceTaskId = event.dataTransfer.getData('text/plain')
                    const position = eventDropPosition(event)
                    setDropTarget(null)
                    if (sourceTaskId && sourceTaskId !== task.id) onReorder(sourceTaskId, task.id, position)
                  }}
                  onDragEnd={() => {
                    setDropTarget(null)
                  }}
                  onClick={() => onOpenTask(task.id)}
                >
                  <Card.Body>
                    <div className={styles.taskTop}>
                      <h3>{task.title}</h3>
                    </div>
                    {chatStatus ? (
                      <div className={styles.taskStatusRow}>
                        <span className={codexStatusClass(chatStatus)}>{chatStatus.label}</span>
                      </div>
                    ) : null}
                    <div className={styles.projectTaskMeta}>
                      <span><LuUserPlus size={14} /> {agentName(task)}</span>
                      <span><LuCalendarPlus size={14} /> {formatTaskDate(task.updatedAt)}</span>
                    </div>
                    {renderTags(task.tags)}
                    <div className={styles.projectTaskFooter}>
                      {subtasks.length > 0 ? (
                        <button
                          type="button"
                          className={styles.subtaskToggleButton}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setExpandedSubtasks((current) => ({ ...current, [task.id]: !expanded }))
                          }}
                          aria-expanded={expanded}
                        >
                          <LuChevronDown size={13} className={expanded ? styles.subtaskToggleOpen : styles.subtaskToggleClosed} />
                          Subtasks {subtasks.length}
                        </button>
                      ) : (
                        <span>Subtasks 0</span>
                      )}
                      {(task.commentCount ?? task.comments?.length ?? 0) > 0 ? (
                        <span><LuMessageSquare size={13} /> {task.commentCount ?? task.comments?.length}</span>
                      ) : null}
                    </div>
                    {expanded ? (
                      <div className={styles.subtaskInlineList}>
                        {subtasks.map((subtask) => (
                          <article
                            key={subtask.id}
                            className={styles.subtaskInlineCard}
                            role="button"
                            tabIndex={0}
                            onClick={(event) => openSubtaskFromCard(event, task.id, subtask.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') openSubtaskFromCard(event, task.id, subtask.id)
                            }}
                          >
                            <strong>{subtask.title}</strong>
                            <span>{subtask.status}{subtask.assigneeName ? ` · ${subtask.assigneeName}` : ''}</span>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </Card.Body>
                </Card>
                )
              })}
            </div>
            <div className={styles.projectAddRow}>
              <button type="button" onClick={() => onOpenCreateTask(column.status)}>
                <LuPlus size={15} />
                Add task
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
