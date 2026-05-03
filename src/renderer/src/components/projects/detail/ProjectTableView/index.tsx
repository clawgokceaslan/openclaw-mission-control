import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { LuCheck, LuChevronDown, LuGripVertical, LuPlus } from 'react-icons/lu'
import type { Agent, CustomField, TaskEntity } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { formatTaskDate, resolveProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectTableViewProps {
  tasks: TaskEntity[]
  columns: ProjectStatusColumn[]
  tableColumns: Array<{ id: string; kind: string; label: string; width: number; required?: boolean; customFieldId?: string }>
  customFields: CustomField[]
  agents: Agent[]
  onOpenTask: (taskId: string) => void
  onOpenCreateTask: () => void
  onStatusChange: (taskId: string, status: TaskEntity['status']) => void
  onReorder: (sourceTaskId: string, targetTaskId: string) => void
  onOpenColumnPicker: () => void
  onColumnWidthChange: (columnId: string, width: number) => void
}

function StatusPill({ status, columns }: { status: TaskEntity['status']; columns: ProjectStatusColumn[] }) {
  const column = resolveProjectStatusColumn(status, columns)
  return (
    <span className={styles.tableStatusPill} style={{ '--status-accent': column.accent } as CSSProperties}>
      <span className={styles.tableStatusPillDot} />
      <span className={styles.tableStatusPillLabel}>{column.title}</span>
    </span>
  )
}

export function ProjectTableView({ tasks, columns, tableColumns, customFields, agents, onOpenTask, onOpenCreateTask, onStatusChange, onReorder, onOpenColumnPicker, onColumnWidthChange }: ProjectTableViewProps) {
  const agentName = (task: TaskEntity) => agents.find((agent) => agent.id === task.agentId)?.name ?? 'Unassigned'
  const [statusMenu, setStatusMenu] = useState<{ taskId: string; left: number; top: number } | null>(null)
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dropTaskId, setDropTaskId] = useState<string | null>(null)
  const resizeRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null)
  const statusMenuRef = useRef<HTMLDivElement | null>(null)
  const gridTemplate = useMemo(() => tableColumns.map((column) => `${Math.max(42, column.width)}px`).join(' '), [tableColumns])

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

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!resizeRef.current) return
      const nextWidth = resizeRef.current.startWidth + (event.clientX - resizeRef.current.startX)
      onColumnWidthChange(resizeRef.current.columnId, nextWidth)
    }
    const onUp = () => {
      resizeRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [onColumnWidthChange])

  const renderCell = (task: TaskEntity, tableColumn: ProjectTableViewProps['tableColumns'][number], index: number) => {
    const column = resolveProjectStatusColumn(task.status, columns)
    if (tableColumn.kind === 'index') return <span className={styles.tableIndexCell}>{index + 1}</span>
    if (tableColumn.kind === 'name') return <span className={styles.tableNameCell}><span className={styles.tableTaskDot} style={{ background: column.accent }} /><span>{task.title}</span></span>
    if (tableColumn.kind === 'assignee') return <span className={styles.tableMutedCell}>{agentName(task)}</span>
    if (tableColumn.kind === 'status') {
      return (
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
              option.status === task.status ? <StatusPill key={option.status} status={task.status} columns={columns} /> : null
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
      )
    }
    if (tableColumn.kind === 'due') return <span className={styles.tableDateCell}>{formatTaskDate(task.updatedAt)}</span>
    if (tableColumn.kind === 'tags') return <span className={styles.tableTagCell}>{(task.tags ?? []).slice(0, 3).map((tag) => <TagPill key={tag.id} tag={tag} compact />)}</span>
    if (tableColumn.kind === 'subtasks') return <span className={styles.tableMutedCell}>{(task.subtasks ?? []).length}</span>
    if (tableColumn.kind === 'priority') {
      const value = task.customFieldValues?.priority ?? task.payload?.priority
      return <span className={styles.tableMutedCell}>{value == null || value === '' ? '-' : String(value)}</span>
    }
    if (tableColumn.kind === 'custom') {
      const field = customFields.find((item) => item.id === tableColumn.customFieldId)
      const value = field ? task.customFieldValues?.[field.id] : undefined
      return <span className={styles.tableMutedCell}>{value == null || value === '' ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
    }
    return <span />
  }

  return (
    <section className={styles.tableView}>
      <div className={styles.tableToolbar}>
        <div className={styles.tableToolGroup}><span className={styles.tableToolIcon} /><span className={styles.tableToolIconAlt} /></div>
      </div>
      <div className={styles.tableGrid}>
        <div className={styles.tableHead} style={{ gridTemplateColumns: `${gridTemplate} 42px` }}>
          {tableColumns.map((column) => (
            <span key={column.id}>
              {column.label}
              {!column.required ? (
                <i
                  className={styles.tableResizeHandle}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    resizeRef.current = { columnId: column.id, startX: event.clientX, startWidth: column.width }
                  }}
                />
              ) : null}
            </span>
          ))}
          <button type="button" className={styles.tableAddColumnButton} onClick={onOpenColumnPicker}><LuPlus size={14} /></button>
        </div>
        {tasks.map((task, index) => {
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
              style={{ gridTemplateColumns: `${gridTemplate} 42px` }}
            >
              {tableColumns.map((column) => <span key={column.id}>{renderCell(task, column, index)}</span>)}
              <span className={styles.tableRowActionCell} aria-hidden="true" />
            </div>
          )
        })}
        <div className={styles.tableAddRow}>
          <button type="button" onClick={onOpenCreateTask}><LuPlus size={15} />Add task</button>
          <span><LuGripVertical size={14} /></span>
        </div>
      </div>
    </section>
  )
}
