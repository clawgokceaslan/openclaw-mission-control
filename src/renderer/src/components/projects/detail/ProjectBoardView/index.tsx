import { useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { Card } from 'react-bootstrap'
import { LuCalendarPlus, LuChevronDown, LuMessageSquare, LuPlus, LuUserPlus } from 'react-icons/lu'
import type { Agent, Tag, TaskEntity } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { formatTaskDate } from '@renderer/screens/projects/detail/status'
import { type TaskDropPosition } from '@renderer/screens/projects/detail/projectDetailUtils'
import { TaskCodexStatus, taskCodexActivityClass, taskCodexActivityTone } from '@renderer/components/projects/detail/TaskCodexStatus'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectBoardViewProps {
  columns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
  agents: Agent[]
  onDropStatus: (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => void
  onReorder: (sourceTaskId: string, targetTaskId: string, position: TaskDropPosition) => void
  onOpenTask: (taskId: string) => void
  onOpenTaskChat: (taskId: string, conversationId: string) => void
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

export function ProjectBoardView({ columns, tasksByStatus, agents, onDropStatus, onReorder, onOpenTask, onOpenTaskChat, onOpenCreateTask }: ProjectBoardViewProps) {
  const agentName = (task: TaskEntity) => agents.find((agent) => agent.id === task.agentId)?.name ?? 'Unassigned'
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const [dropTarget, setDropTarget] = useState<{ taskId: string; position: TaskDropPosition } | null>(null)
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(() => new Set())

  const canStartPan = (event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    return !target.closest('button,a,input,textarea,select,[draggable="true"]')
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
              {rows.map((task) => (
                (() => {
                  const subtasks = task.subtasks ?? []
                  const subtasksOpen = expandedSubtasks.has(task.id)
                  const activityTone = taskCodexActivityTone(task)
                  return (
                <Card
                  key={task.id}
                  className={`${styles.taskCard} ${activityTone ? `${styles.taskCardActive} ${taskCodexActivityClass(activityTone)}` : ''} ${dropTarget?.taskId === task.id ? dropTarget.position === 'before' ? styles.taskCardDropBefore : styles.taskCardDropAfter : ''}`}
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
                    <TaskCodexStatus task={task} onOpenTaskChat={onOpenTaskChat} />
                    <div className={styles.projectTaskMeta}>
                      <span><LuUserPlus size={14} /> {agentName(task)}</span>
                      <span><LuCalendarPlus size={14} /> {formatTaskDate(task.updatedAt)}</span>
                    </div>
                    {renderTags(task.tags)}
                    <div className={styles.projectTaskFooter}>
                      <button
                        type="button"
                        className={styles.subtaskToggle}
                        aria-expanded={subtasksOpen}
                        disabled={subtasks.length === 0}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (subtasks.length === 0) return
                          setExpandedSubtasks((current) => {
                            const next = new Set(current)
                            if (next.has(task.id)) next.delete(task.id)
                            else next.add(task.id)
                            return next
                          })
                        }}
                      >
                        <LuChevronDown className={subtasksOpen ? styles.subtaskChevronOpen : styles.subtaskChevronClosed} size={13} />
                        Subtasks {subtasks.length}
                      </button>
                      {(task.commentCount ?? task.comments?.length ?? 0) > 0 ? (
                        <span><LuMessageSquare size={13} /> {task.commentCount ?? task.comments?.length}</span>
                      ) : null}
                    </div>
                    {subtasksOpen ? (
                      <div className={styles.subtaskMiniList}>
                        {subtasks.map((subtask) => (
                          <div key={subtask.id} className={styles.subtaskMiniCard}>
                            <strong>{subtask.title}</strong>
                            <span>{subtask.status}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Card.Body>
                </Card>
                  )
                })()
              ))}
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
