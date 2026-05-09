import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type UIEvent } from 'react'
import { Card } from 'react-bootstrap'
import { LuCalendarPlus, LuChevronDown, LuMessageSquare, LuPlus, LuUserPlus } from 'react-icons/lu'
import type { Agent, Tag, TaskEntity } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { formatTaskDate } from '@renderer/screens/projects/detail/status'
import { taskGatewayActiveTone, taskGatewayLatestSurfaceStatus, type TaskGatewaySurfaceStatus, type TaskDropPosition } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

const BOARD_INITIAL_VISIBLE_TASKS = 36
const BOARD_VISIBLE_TASK_STEP = 36
const BOARD_LOAD_MORE_THRESHOLD_PX = 220

interface ProjectBoardViewProps {
  columns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
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

interface BoardTaskCardProps {
  task: TaskEntity
  agentName: string
  expanded: boolean
  dropPosition: TaskDropPosition | null
  onExpandToggle: (taskId: string) => void
  onDropTargetChange: (target: { taskId: string; position: TaskDropPosition } | null) => void
  onReorder: (sourceTaskId: string, targetTaskId: string, position: TaskDropPosition) => void
  onOpenTask: (taskId: string) => void
  onOpenSubtask: (taskId: string, subtaskId: string) => void
}

const BoardTaskCard = memo(function BoardTaskCard({
  task,
  agentName,
  expanded,
  dropPosition,
  onExpandToggle,
  onDropTargetChange,
  onReorder,
  onOpenTask,
  onOpenSubtask
}: BoardTaskCardProps) {
  const subtasks = task.subtasks ?? []
  const activeTone = taskGatewayActiveTone(task)
  const chatStatus = taskGatewayLatestSurfaceStatus(task)

  const openSubtaskFromCard = useCallback((event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, subtaskId: string) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenSubtask(task.id, subtaskId)
  }, [onOpenSubtask, task.id])

  const handleDragStart = useCallback((event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData('text/plain', task.id)
  }, [task.id])

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    onDropTargetChange({ taskId: task.id, position: eventDropPosition(event) })
  }, [onDropTargetChange, task.id])

  const handleDragLeave = useCallback(() => {
    if (dropPosition) onDropTargetChange(null)
  }, [dropPosition, onDropTargetChange])

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const sourceTaskId = event.dataTransfer.getData('text/plain')
    const position = eventDropPosition(event)
    onDropTargetChange(null)
    if (sourceTaskId && sourceTaskId !== task.id) onReorder(sourceTaskId, task.id, position)
  }, [onDropTargetChange, onReorder, task.id])

  const handleDragEnd = useCallback(() => onDropTargetChange(null), [onDropTargetChange])
  const handleOpenTask = useCallback(() => onOpenTask(task.id), [onOpenTask, task.id])
  const handleToggleSubtasks = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onExpandToggle(task.id)
  }, [onExpandToggle, task.id])

  return (
    <Card
      className={`${styles.taskCard} ${activeTaskClass(activeTone)} ${dropPosition ? dropPosition === 'before' ? styles.taskCardDropBefore : styles.taskCardDropAfter : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onClick={handleOpenTask}
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
          <span><LuUserPlus size={14} /> {agentName}</span>
          <span><LuCalendarPlus size={14} /> {formatTaskDate(task.updatedAt)}</span>
        </div>
        {renderTags(task.tags)}
        <div className={styles.projectTaskFooter}>
          {subtasks.length > 0 ? (
            <button
              type="button"
              className={styles.subtaskToggleButton}
              onClick={handleToggleSubtasks}
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
                onClick={(event) => openSubtaskFromCard(event, subtask.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') openSubtaskFromCard(event, subtask.id)
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
})

export function ProjectBoardView({ columns, tasksByStatus, agents, onDropStatus, onReorder, onOpenTask, onOpenSubtask, onOpenCreateTask }: ProjectBoardViewProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const [dropTarget, setDropTarget] = useState<{ taskId: string; position: TaskDropPosition } | null>(null)
  const [expandedSubtasks, setExpandedSubtasks] = useState<Record<string, boolean>>({})
  const [visibleTaskLimits, setVisibleTaskLimits] = useState<Record<string, number>>({})
  const agentNameById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])

  const toggleExpandedSubtasks = useCallback((taskId: string) => {
    setExpandedSubtasks((current) => ({ ...current, [taskId]: !current[taskId] }))
  }, [])

  const updateDropTarget = useCallback((target: { taskId: string; position: TaskDropPosition } | null) => {
    setDropTarget((current) => (
      current?.taskId === target?.taskId && current?.position === target?.position ? current : target
    ))
  }, [])

  const expandVisibleTasks = useCallback((status: TaskEntity['status'], total: number) => {
    setVisibleTaskLimits((current) => {
      const currentLimit = current[status] ?? BOARD_INITIAL_VISIBLE_TASKS
      if (currentLimit >= total) return current
      return {
        ...current,
        [status]: Math.min(total, currentLimit + BOARD_VISIBLE_TASK_STEP)
      }
    })
  }, [])

  const handleColumnScroll = useCallback((event: UIEvent<HTMLDivElement>, status: TaskEntity['status'], total: number) => {
    const target = event.currentTarget
    if (target.scrollHeight - target.scrollTop - target.clientHeight > BOARD_LOAD_MORE_THRESHOLD_PX) return
    expandVisibleTasks(status, total)
  }, [expandVisibleTasks])

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
        const visibleLimit = Math.min(rows.length, visibleTaskLimits[column.status] ?? BOARD_INITIAL_VISIBLE_TASKS)
        const visibleRows = rows.slice(0, visibleLimit)
        const hiddenCount = rows.length - visibleRows.length
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
            <div className={styles.columnBody} onScroll={(event) => handleColumnScroll(event, column.status, rows.length)}>
              {visibleRows.map((task) => (
                <BoardTaskCard
                  key={task.id}
                  task={task}
                  agentName={task.agentId ? agentNameById.get(task.agentId) ?? 'Unassigned' : 'Unassigned'}
                  expanded={Boolean(expandedSubtasks[task.id])}
                  dropPosition={dropTarget?.taskId === task.id ? dropTarget.position : null}
                  onExpandToggle={toggleExpandedSubtasks}
                  onDropTargetChange={updateDropTarget}
                  onReorder={onReorder}
                  onOpenTask={onOpenTask}
                  onOpenSubtask={onOpenSubtask}
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className={styles.columnLoadMore}
                  onClick={() => expandVisibleTasks(column.status, rows.length)}
                >
                  {hiddenCount} more task{hiddenCount === 1 ? '' : 's'}
                </button>
              ) : null}
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
