import { useMemo, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuFileText, LuPlus, LuRoute, LuTrash2 } from 'react-icons/lu'
import type { TaskEntity, TaskGroup } from '@shared/types/entities'
import styles from './index.module.scss'

interface TaskGroupsPanelProps {
  groups: TaskGroup[]
  saving: boolean
  error: string | null
  tasks: TaskEntity[]
  updatingGroupId: string | null
  onUpdate: (groupId: string, orderedTaskIds: string[]) => void
}

function formatGroupDate(value: number): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

export function TaskGroupsPanel({
  groups,
  saving,
  error,
  tasks,
  updatingGroupId,
  onUpdate
}: TaskGroupsPanelProps) {
  const [selectedTaskByGroup, setSelectedTaskByGroup] = useState<Record<string, string>>({})
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])

  const updateGroupTasks = (group: TaskGroup, orderedTaskIds: string[]) => {
    onUpdate(group.groupId, orderedTaskIds)
  }

  return (
    <section className={styles.taskGroupsPanel} aria-label="Task grupları">
      <div className={styles.taskGroupsPanel__header}>
        <div className={styles.taskGroupsPanel__heading}>
          <span className={styles.taskGroupsPanel__icon}>
            <LuRoute size={16} />
          </span>
          <div className={styles.taskGroupsPanel__titleBlock}>
            <h2 className={styles.taskGroupsPanel__title}>Task grupları</h2>
            <p className={styles.taskGroupsPanel__description}>Proje detayına bağlı bağımsız iş paketleri.</p>
          </div>
        </div>
        <span className={styles.taskGroupsPanel__count}>{groups.length} grup</span>
      </div>

      {error ? <p className={styles.taskGroupsPanel__error}>{error}</p> : null}

      <div className={styles.taskGroupsPanel__list}>
        {groups.length > 0 ? (
          groups.map((group) => (
            <article key={group.groupId} className={styles.taskGroupsPanel__item}>
              <div className={styles.taskGroupsPanel__itemHeader}>
                <div className={styles.taskGroupsPanel__itemMain}>
                  <h3 className={styles.taskGroupsPanel__itemTitle}>{group.title}</h3>
                  <p className={styles.taskGroupsPanel__itemMeta}>Oluşturuldu {formatGroupDate(group.createdAt)}</p>
                </div>
                <div className={styles.taskGroupsPanel__contract}>
                  <span>{group.orderedTaskIds.length} task</span>
                  <span>plan: {group.planningQueueState.state}</span>
                  <span>run: {group.executionQueueState.state}</span>
                </div>
              </div>

              <div className={styles.taskGroupsPanel__scope}>
                <LuFileText size={14} />
                <span>{group.groupContextMdPath || 'groupContext.md hazırlanıyor'}</span>
              </div>

              <ol className={styles.taskGroupsPanel__taskList}>
                {group.orderedTaskIds.map((taskId, index) => {
                  const task = tasksById.get(taskId)
                  return (
                    <li key={taskId} className={styles.taskGroupsPanel__taskItem}>
                      <span className={styles.taskGroupsPanel__taskOrder}>{index + 1}</span>
                      <span className={styles.taskGroupsPanel__taskTitle}>{task?.title ?? taskId}</span>
                      <span className={styles.taskGroupsPanel__taskStatus}>{task?.status ?? 'unknown'}</span>
                      <div className={styles.taskGroupsPanel__taskActions}>
                        <button type="button" onClick={() => {
                          if (index <= 0) return
                          const next = [...group.orderedTaskIds]
                          const previous = next[index - 1]
                          next[index - 1] = taskId
                          next[index] = previous
                          updateGroupTasks(group, next)
                        }} disabled={saving || index === 0 || updatingGroupId === group.groupId} aria-label="Taskı yukarı taşı" title="Yukarı taşı">
                          <LuArrowUp size={14} />
                        </button>
                        <button type="button" onClick={() => {
                          if (index >= group.orderedTaskIds.length - 1) return
                          const next = [...group.orderedTaskIds]
                          const following = next[index + 1]
                          next[index + 1] = taskId
                          next[index] = following
                          updateGroupTasks(group, next)
                        }} disabled={saving || index === group.orderedTaskIds.length - 1 || updatingGroupId === group.groupId} aria-label="Taskı aşağı taşı" title="Aşağı taşı">
                          <LuArrowDown size={14} />
                        </button>
                        <button type="button" onClick={() => updateGroupTasks(group, group.orderedTaskIds.filter((id) => id !== taskId))} disabled={saving || updatingGroupId === group.groupId} aria-label="Taskı gruptan çıkar" title="Gruptan çıkar">
                          <LuTrash2 size={14} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ol>

              <div className={styles.taskGroupsPanel__addTask}>
                <select
                  value={selectedTaskByGroup[group.groupId] ?? ''}
                  onChange={(event) => setSelectedTaskByGroup((current) => ({ ...current, [group.groupId]: event.target.value }))}
                  disabled={saving || updatingGroupId === group.groupId}
                  aria-label={`${group.title} grubuna task ekle`}
                >
                  <option value="">Task seç</option>
                  {tasks.filter((task) => !group.orderedTaskIds.includes(task.id)).map((task) => (
                    <option key={task.id} value={task.id}>{task.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving || updatingGroupId === group.groupId || !selectedTaskByGroup[group.groupId]}
                  onClick={() => {
                    const taskId = selectedTaskByGroup[group.groupId]
                    if (!taskId) return
                    updateGroupTasks(group, [...group.orderedTaskIds, taskId])
                    setSelectedTaskByGroup((current) => ({ ...current, [group.groupId]: '' }))
                  }}
                >
                  <LuPlus size={14} />
                  <span>Ekle</span>
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className={styles.taskGroupsPanel__empty}>Bu projede henüz task grubu yok.</p>
        )}
      </div>
    </section>
  )
}
