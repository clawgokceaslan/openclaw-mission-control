import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { LuRoute, LuX } from 'react-icons/lu'
import { TaskGroupsPanel } from '@renderer/components/projects/detail/TaskGroupsPanel'
import type { TaskEntity, TaskGroup } from '@shared/types/entities'
import styles from './index.module.scss'

interface TaskGroupsModalProps {
  open: boolean
  groups: TaskGroup[]
  saving: boolean
  error: string | null
  tasks: TaskEntity[]
  updatingGroupId: string | null
  onUpdate: (groupId: string, orderedTaskIds: string[], activeTaskId?: string | null) => void
  onOpenTask?: (taskId: string) => void
  onCreateGroup?: () => void
  onClose: () => void
}

export function TaskGroupsModal({
  open,
  groups,
  saving,
  error,
  tasks,
  updatingGroupId,
  onUpdate,
  onOpenTask,
  onCreateGroup,
  onClose
}: TaskGroupsModalProps) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open, saving])

  if (!open) return null
  const target = typeof document === 'undefined' ? null : document.body

  const modal = (
    <div
      className={styles.taskGroupsModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-groups-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <section className={styles.taskGroupsModal__dialog}>
        <header className={styles.taskGroupsModal__header}>
          <span className={styles.taskGroupsModal__icon}>
            <LuRoute size={18} />
          </span>
          <div className={styles.taskGroupsModal__titleBlock}>
            <h2 id="task-groups-title">Task yürütme merkezi</h2>
            <p>Task Grubu, Plan Kuyruğu ve Çalışma Kuyruğu bağlamını tek yerden izle.</p>
          </div>
          <button
            type="button"
            className={styles.taskGroupsModal__close}
            onClick={onClose}
            disabled={saving}
            aria-label="Task grupları modalını kapat"
            title="Kapat"
          >
            <LuX size={17} />
          </button>
        </header>

        <TaskGroupsPanel
          className={styles.taskGroupsModal__panel}
          groups={groups}
          saving={saving}
          error={error}
          tasks={tasks}
          updatingGroupId={updatingGroupId}
          onUpdate={onUpdate}
          onOpenTask={onOpenTask}
          onCreateGroup={onCreateGroup}
        />
      </section>
    </div>
  )

  return target ? createPortal(modal, target) : modal
}
