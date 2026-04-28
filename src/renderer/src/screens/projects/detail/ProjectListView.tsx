import type { CSSProperties, DragEvent } from 'react'
import { LuCalendarPlus, LuChevronDown, LuFlag, LuPlus, LuUserPlus } from 'react-icons/lu'
import type { Agent, TaskEntity } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from './status'
import { formatTaskDate } from './status'
import styles from '../ProjectDetailPage.module.scss'

interface ProjectListViewProps {
  columns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
  agents: Agent[]
  collapsedStatuses: TaskEntity['status'][]
  onToggleStatus: (status: TaskEntity['status']) => void
  onOpenTask: (taskId: string) => void
  onOpenCreateTask: (status: TaskEntity['status']) => void
  onDropStatus: (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => void
}

export function ProjectListView({ columns, tasksByStatus, agents, collapsedStatuses, onToggleStatus, onOpenTask, onOpenCreateTask, onDropStatus }: ProjectListViewProps) {
  const agentName = (task: TaskEntity) => agents.find((agent) => agent.id === task.agentId)?.name ?? 'Unassigned'

  return (
    <section className={styles.listView}>
      {columns.map((column) => {
        const rows = tasksByStatus[column.status]
        const collapsed = collapsedStatuses.includes(column.status)
        return (
          <article
            key={column.key}
            className={styles.listGroup}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropStatus(event, column.status)}
          >
            <button type="button" className={styles.listGroupHeader} onClick={() => onToggleStatus(column.status)}>
              <LuChevronDown className={collapsed ? styles.chevronClosed : styles.chevronOpen} size={15} />
              <span className={styles.listStatusPill} style={{ '--status-accent': column.accent } as CSSProperties}>
                <span />
                {column.title}
              </span>
              <span className={styles.listGroupCount}>{rows.length}</span>
            </button>
            {!collapsed ? (
              <div className={styles.listTable}>
                <div className={styles.listTableHead}>
                  <span>Name</span><span>Assignee</span><span>Due date</span><span>Tags</span><span>Subtasks</span><span>Priority</span>
                </div>
                {rows.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={styles.listRow}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                    onClick={() => onOpenTask(task.id)}
                  >
                    <span className={styles.listNameCell}><span className={styles.listTaskDot} style={{ background: column.accent }} /><span>{task.title}</span></span>
                    <span className={styles.listMutedCell}><LuUserPlus size={15} /> {agentName(task)}</span>
                    <span className={styles.listDateCell}><LuCalendarPlus size={15} /> {formatTaskDate(task.updatedAt)}</span>
                    <span className={styles.listTagCell}>{(task.tags ?? []).slice(0, 3).map((tag) => <TagPill key={tag.id} tag={tag} compact />)}</span>
                    <span className={styles.listMutedCell}>{(task.subtasks ?? []).length}</span>
                    <span className={styles.listPriorityCell}><LuFlag size={15} /></span>
                  </button>
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
