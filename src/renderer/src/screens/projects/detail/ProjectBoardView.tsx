import type { CSSProperties, DragEvent } from 'react'
import { Badge, Card } from 'react-bootstrap'
import { LuCalendarPlus, LuFlag, LuMessageSquare, LuPlus, LuUserPlus } from 'react-icons/lu'
import type { Agent, Tag, TaskEntity } from '@shared/types/entities'
import { TagPill } from '@renderer/components/tags/TagPill'
import type { ProjectStatusColumn } from './status'
import { formatTaskDate } from './status'
import styles from '../ProjectDetailPage.module.scss'

interface ProjectBoardViewProps {
  columns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
  agents: Agent[]
  onDropStatus: (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => void
  onOpenTask: (taskId: string) => void
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

export function ProjectBoardView({ columns, tasksByStatus, agents, onDropStatus, onOpenTask, onOpenCreateTask }: ProjectBoardViewProps) {
  const agentName = (task: TaskEntity) => agents.find((agent) => agent.id === task.agentId)?.name ?? 'Unassigned'

  return (
    <div className={styles.kanbanWrap}>
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
            </header>
            {column.title.toLowerCase().includes('review') ? (
              <div className={styles.reviewFilters}>
                <Badge pill bg="dark">All · {rows.length}</Badge>
                <Badge pill bg="light" text="dark">Lead review · 0</Badge>
                <Badge pill bg="light" text="dark">Blocked · 0</Badge>
              </div>
            ) : null}
            <div className={styles.columnBody}>
              {rows.map((task) => (
                <Card
                  key={task.id}
                  className={styles.taskCard}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                  onClick={() => onOpenTask(task.id)}
                >
                  <Card.Body>
                    <div className={styles.taskTop}>
                      <h3>{task.title}</h3>
                      <span className={styles.priorityIcon} title="Priority"><LuFlag size={14} /></span>
                    </div>
                    <div className={styles.projectTaskMeta}>
                      <span><LuUserPlus size={14} /> {agentName(task)}</span>
                      <span><LuCalendarPlus size={14} /> {formatTaskDate(task.updatedAt)}</span>
                    </div>
                    {renderTags(task.tags)}
                    <div className={styles.projectTaskFooter}>
                      <span>Subtasks {(task.subtasks ?? []).length}</span>
                      {(task.commentCount ?? task.comments?.length ?? 0) > 0 ? (
                        <span><LuMessageSquare size={13} /> {task.commentCount ?? task.comments?.length}</span>
                      ) : null}
                    </div>
                  </Card.Body>
                </Card>
              ))}
              <div className={styles.projectAddRow}>
                <button type="button" onClick={() => onOpenCreateTask(column.status)}>
                  <LuPlus size={15} />
                  Add task
                </button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
