import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { LuCheck, LuChevronDown, LuFlag, LuPlus } from 'react-icons/lu'
import type { Agent, TaskEntity } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from './status'
import { formatTaskDate, resolveProjectStatusColumn } from './status'
import styles from '../ProjectDetailPage.module.scss'

interface ProjectTableViewProps {
  tasks: TaskEntity[]
  columns: ProjectStatusColumn[]
  agents: Agent[]
  onOpenTask: (taskId: string) => void
  onOpenCreateTask: () => void
  onStatusChange: (taskId: string, status: TaskEntity['status']) => void
  onReorder: (sourceTaskId: string, targetTaskId: string) => void
}

function StatusPill({ status }: { status: TaskEntity['status'] }) {
  const column = resolveProjectStatusColumn(status)
  return (
    <span className={styles.tableStatusPill} style={{ '--status-accent': column.accent } as CSSProperties}>
      <span />
      {column.title}
    </span>
  )
}

export function ProjectTableView({ tasks, columns, agents, onOpenTask, onOpenCreateTask, onStatusChange, onReorder }: ProjectTableViewProps) {
  const agentName = (task: TaskEntity) => agents.find((agent) => agent.id === task.agentId)?.name ?? 'Unassigned'
  const [statusMenu, setStatusMenu] = useState<{ taskId: string; left: number; top: number } | null>(null)
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dropTaskId, setDropTaskId] = useState<string | null>(null)
  const statusMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!statusMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && statusMenuRef.current?.contains(target)) return
      setStatusMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [statusMenu])

  return (
    <section className={styles.tableView}>
      <div className={styles.tableToolbar}>
        <div className={styles.tableToolGroup}><span className={styles.tableToolIcon} /><span className={styles.tableToolIconAlt} /></div>
      </div>
      <div className={styles.tableGrid}>
        <div className={styles.tableHead}>
          <span /><span>Name</span><span>Assignee</span><span>Status</span><span>Due date</span><span>Tags</span><span>Subtasks</span><span>Priority</span><span>+</span>
        </div>
        {tasks.map((task, index) => {
          const column = resolveProjectStatusColumn(task.status)
          return (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              className={`${styles.tableRow} ${dragTaskId === task.id ? styles.tableRowDragging : ''} ${dropTaskId === task.id && dragTaskId !== task.id ? styles.tableRowDropTarget : ''}`}
              draggable
              onDragStart={(event) => {
                setDragTaskId(task.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', task.id)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTaskId(task.id)
              }}
              onDragLeave={() => {
                setDropTaskId((current) => current === task.id ? null : current)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceTaskId = event.dataTransfer.getData('text/plain')
                setDragTaskId(null)
                setDropTaskId(null)
                if (sourceTaskId) onReorder(sourceTaskId, task.id)
              }}
              onDragEnd={() => {
                setDragTaskId(null)
                setDropTaskId(null)
              }}
              onClick={() => onOpenTask(task.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onOpenTask(task.id)
              }}
            >
              <span className={styles.tableIndexCell}>{index + 1}</span>
              <span className={styles.tableNameCell}><span className={styles.tableTaskDot} style={{ background: column.accent }} /><span>{task.title}</span></span>
              <span className={styles.tableMutedCell}>{agentName(task)}</span>
              <span
                className={`${styles.tableStatusSelectCell} ${statusMenu?.taskId === task.id ? styles.tableStatusSelectOpen : ''}`}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className={styles.tableStatusTrigger}
                  aria-haspopup="listbox"
                  aria-expanded={statusMenu?.taskId === task.id}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setStatusMenu((current) => current?.taskId === task.id
                      ? null
                      : { taskId: task.id, left: rect.left, top: rect.bottom + 6 })
                  }}
                >
                  {columns.map((option) => (
                    option.status === task.status ? <StatusPill key={option.status} status={task.status} /> : null
                  ))}
                  <LuChevronDown size={14} />
                </button>
                {statusMenu?.taskId === task.id ? (
                  <div
                    ref={statusMenuRef}
                    className={styles.tableStatusMenu}
                    role="listbox"
                    style={{ left: statusMenu.left, top: statusMenu.top } as CSSProperties}
                  >
                    {columns.map((option) => {
                      const active = option.status === task.status
                      return (
                        <button
                          key={option.status}
                          type="button"
                          className={styles.tableStatusMenuItem}
                          style={{ '--status-accent': option.accent } as CSSProperties}
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            setStatusMenu(null)
                            if (!active) onStatusChange(task.id, option.status)
                          }}
                        >
                          <span className={styles.tableStatusMenuDot} />
                          <span>{option.title}</span>
                          {active ? <LuCheck size={14} /> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </span>
              <span className={styles.tableDateCell}>{formatTaskDate(task.updatedAt)}</span>
              <span className={styles.tableTagCell}>{(task.tags ?? []).slice(0, 3).map((tag) => <TagPill key={tag.id} tag={tag} compact />)}</span>
              <span className={styles.tableMutedCell}>{(task.subtasks ?? []).length}</span>
              <span className={styles.tablePriorityCell}><LuFlag size={15} /></span>
              <span />
            </div>
          )
        })}
        <div className={styles.tableAddRow}>
          <span />
          <button type="button" onClick={onOpenCreateTask}><LuPlus size={15} />Add task</button>
          <span /><span /><span /><span /><span /><span /><span />
        </div>
      </div>
    </section>
  )
}
