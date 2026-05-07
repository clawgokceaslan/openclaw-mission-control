import { useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { LuCalendarPlus, LuChevronDown, LuCircleCheck, LuFileText, LuEllipsis, LuPlay, LuPlus, LuUserPlus } from 'react-icons/lu'
import type { Agent, TaskEntity } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { formatTaskDate } from '@renderer/screens/projects/detail/status'
import { taskCodexActionChips, taskCodexActiveTone, taskCodexSurfaceStatuses, type TaskCodexSurfaceStatus, type TaskDropPosition } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectListViewProps {
  columns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
  agents: Agent[]
  collapsedStatuses: TaskEntity['status'][]
  onToggleStatus: (status: TaskEntity['status']) => void
  onOpenTask: (taskId: string) => void
  onOpenTaskChat: (taskId: string, conversationId: string) => void
  onOpenCreateTask: (status: TaskEntity['status']) => void
  onDropStatus: (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => void
  onReorder: (sourceTaskId: string, targetTaskId: string, position: TaskDropPosition) => void
}

function eventDropPosition(event: DragEvent<HTMLElement>): TaskDropPosition {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function TaskCodexStrip({ task, onOpenTaskChat }: { task: TaskEntity; onOpenTaskChat: (taskId: string, conversationId: string) => void }) {
  const statuses = taskCodexSurfaceStatuses(task)
  const actions = taskCodexActionChips(task)
  const [open, setOpen] = useState(false)
  if (statuses.length === 0 && actions.length === 0) return null
  const openChat = (event: MouseEvent<HTMLButtonElement>, conversationId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    onOpenTaskChat(task.id, conversationId)
  }
  return (
    <span className={styles.taskCodexStrip}>
      {statuses.map((status) => (
        <span key={status.key} className={`${styles.taskCodexStateBadge} ${styles[`taskCodexTone_${status.tone}`] ?? ''}`} title={status.label} aria-label={status.label}>
          {status.iconOnly ? <LuCircleCheck size={13} /> : status.label}
        </span>
      ))}
      {actions.length > 0 ? (
        <span className={styles.taskCodexMenuWrap}>
          <button type="button" className={styles.taskCodexMenuButton} onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen((current) => !current)
          }} aria-label="Task Codex actions" aria-expanded={open}>
            <LuEllipsis size={14} />
          </button>
          {open ? (
            <span className={styles.taskCodexMenu}>
              {actions.map((action) => (
                <button key={action.source} type="button" onClick={(event) => openChat(event, action.conversationId)}>
                  {action.source === 'codex-plan' ? <LuFileText size={13} /> : <LuPlay size={13} />}
                  {action.label} chat
                </button>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}

function activeRowClass(tone: TaskCodexSurfaceStatus['tone'] | null) {
  return tone ? `${styles.listRowActive} ${styles[`listRowActive_${tone}`] ?? ''}` : ''
}

export function ProjectListView({ columns, tasksByStatus, agents, collapsedStatuses, onToggleStatus, onOpenTask, onOpenTaskChat, onOpenCreateTask, onDropStatus, onReorder }: ProjectListViewProps) {
  const agentName = (task: TaskEntity) => agents.find((agent) => agent.id === task.agentId)?.name ?? 'Unassigned'
  const [dropTarget, setDropTarget] = useState<{ taskId: string; position: TaskDropPosition } | null>(null)

  return (
    <section className={styles.listView}>
      {columns.map((column) => {
        const rows = tasksByStatus[column.status] ?? []
        const collapsed = collapsedStatuses.includes(column.status)
        return (
          <article
            key={column.key}
            className={styles.listGroup}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropStatus(event, column.status)}
          >
            <div className={styles.listGroupHeaderRow}>
              <button type="button" className={styles.listGroupHeader} onClick={() => onToggleStatus(column.status)}>
                <LuChevronDown className={collapsed ? styles.chevronClosed : styles.chevronOpen} size={15} />
                <span className={styles.listStatusPill} style={{ '--status-accent': column.accent } as CSSProperties}>
                  <span />
                  {column.title}
                </span>
                <span className={styles.listGroupCount}>{rows.length}</span>
              </button>
              <button
                type="button"
                className={styles.listGroupAdd}
                onClick={() => onOpenCreateTask(column.status)}
                title={`Add task to ${column.title}`}
                aria-label={`Add task to ${column.title}`}
              >
                <LuPlus size={15} />
              </button>
            </div>
            {!collapsed ? (
              <div className={styles.listTable}>
                <div className={styles.listTableHead}>
                  <span>Name</span><span>Assignee</span><span>Due date</span><span>Tags</span><span>Subtasks</span>
                </div>
                {rows.map((task) => (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    className={`${styles.listRow} ${activeRowClass(taskCodexActiveTone(task))} ${dropTarget?.taskId === task.id ? dropTarget.position === 'before' ? styles.listRowDropBefore : styles.listRowDropAfter : ''}`}
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
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onOpenTask(task.id)
                    }}
                  >
                    <span className={styles.listNameCell}><span className={styles.listTaskDot} style={{ background: column.accent }} /><span><b>{task.title}</b><TaskCodexStrip task={task} onOpenTaskChat={onOpenTaskChat} /></span></span>
                    <span className={styles.listMutedCell}><LuUserPlus size={15} /> {agentName(task)}</span>
                    <span className={styles.listDateCell}><LuCalendarPlus size={15} /> {formatTaskDate(task.updatedAt)}</span>
                    <span className={styles.listTagCell}>{(task.tags ?? []).slice(0, 3).map((tag) => <TagPill key={tag.id} tag={tag} compact />)}</span>
                    <span className={styles.listMutedCell}>{(task.subtasks ?? []).length}</span>
                  </div>
                ))}
                <div className={styles.listAddRow}><button type="button" onClick={() => onOpenCreateTask(column.status)}><LuPlus size={15} />Add task</button></div>
              </div>
            ) : null}
          </article>
        )
      })}
    </section>
  )
}
