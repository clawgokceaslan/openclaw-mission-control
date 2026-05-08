import { useMemo, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuCircleDot, LuFileText, LuFolderTree, LuListChecks, LuPlus, LuRoute, LuTrash2, LuWorkflow } from 'react-icons/lu'
import type { TaskEntity, TaskGroup, TaskGroupQueueState } from '@shared/types/entities'
import styles from './index.module.scss'

interface TaskGroupsPanelProps {
  groups: TaskGroup[]
  saving: boolean
  error: string | null
  tasks: TaskEntity[]
  updatingGroupId: string | null
  className?: string
  onUpdate: (groupId: string, orderedTaskIds: string[], activeTaskId?: string | null) => void
  onOpenTask?: (taskId: string) => void
}

function formatGroupDate(value: number): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function queueStateLabel(state: TaskGroupQueueState['state']): string {
  if (state === 'not_configured') return 'Hazır değil'
  if (state === 'idle') return 'Hazır'
  if (state === 'queued') return 'Sırada'
  if (state === 'running') return 'Aktif'
  if (state === 'completed') return 'Tamamlandı'
  if (state === 'failed') return 'Hata'
  return state
}

function isDoneStatus(status?: string): boolean {
  return ['done', 'closed', 'completed'].includes(String(status ?? '').toLowerCase())
}

export function TaskGroupsPanel({
  groups,
  saving,
  error,
  tasks,
  updatingGroupId,
  className,
  onUpdate,
  onOpenTask
}: TaskGroupsPanelProps) {
  const [selectedTaskByGroup, setSelectedTaskByGroup] = useState<Record<string, string>>({})
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const totals = useMemo(() => {
    const taskIds = new Set<string>()
    let activeGroups = 0
    for (const group of groups) {
      group.orderedTaskIds.forEach((taskId) => taskIds.add(taskId))
      if (group.activeTaskId) activeGroups += 1
    }
    return { taskCount: taskIds.size, activeGroups }
  }, [groups])

  const updateGroupTasks = (group: TaskGroup, orderedTaskIds: string[], activeTaskId = group.activeTaskId) => {
    onUpdate(group.groupId, orderedTaskIds, activeTaskId)
  }

  return (
    <section className={`${styles.taskGroupsPanel} ${className ?? ''}`} aria-label="Task grupları">
      <div className={styles.taskGroupsPanel__header}>
        <div className={styles.taskGroupsPanel__heading}>
          <span className={styles.taskGroupsPanel__icon}>
            <LuRoute size={16} />
          </span>
          <div className={styles.taskGroupsPanel__titleBlock}>
            <h2 className={styles.taskGroupsPanel__title}>Task yürütme merkezi</h2>
            <p className={styles.taskGroupsPanel__description}>Task Grubu, Plan Kuyruğu ve Çalışma Kuyruğu aynı bağlamda izlenir.</p>
          </div>
        </div>
        <div className={styles.taskGroupsPanel__summary}>
          <span>{groups.length} grup</span>
          <span>{totals.taskCount} task</span>
          <span>{totals.activeGroups} aktif bağlam</span>
        </div>
      </div>

      {error ? <p className={styles.taskGroupsPanel__error}>{error}</p> : null}

      <div className={styles.taskGroupsPanel__model} aria-label="Temel kavramlar">
        <div>
          <LuFolderTree size={15} />
          <strong>Task Grubu</strong>
          <span>Ortak amaç ve sıra</span>
        </div>
        <div>
          <LuWorkflow size={15} />
          <strong>Plan Kuyruğu</strong>
          <span>Planlama hazırlığı</span>
        </div>
        <div>
          <LuListChecks size={15} />
          <strong>Çalışma Kuyruğu</strong>
          <span>Aktif uygulama sırası</span>
        </div>
      </div>

      <div className={styles.taskGroupsPanel__scopeBoundary} aria-label="Fırsat kapsamı">
        <div>
          <strong>Temel davranış</strong>
          <span>Kullanıcı seçili grubu, aktif kuyruğu ve sıradaki taskı aynı panelde görür.</span>
        </div>
        <div>
          <strong>Kapsam sınırı</strong>
          <span>Öneri motoru, favoriler ve otomasyonlar sonraki faza bırakıldı.</span>
        </div>
        <div>
          <strong>Doğrulama</strong>
          <span>Boş, hata, aktif ve tamamlanmış durumlar aksiyon ya da açıklanabilir bağlam üretir.</span>
        </div>
      </div>

      <div className={styles.taskGroupsPanel__list}>
        {groups.length > 0 ? (
          groups.map((group) => {
            const activeTaskId = group.activeTaskId && group.orderedTaskIds.includes(group.activeTaskId) ? group.activeTaskId : group.orderedTaskIds[0] ?? null
            const activeTask = activeTaskId ? tasksById.get(activeTaskId) : null
            const doneCount = group.orderedTaskIds.filter((taskId) => isDoneStatus(tasksById.get(taskId)?.status)).length
            const missingCount = group.orderedTaskIds.filter((taskId) => !tasksById.has(taskId)).length

            return (
              <article key={group.groupId} className={styles.taskGroupsPanel__item}>
                <div className={styles.taskGroupsPanel__itemHeader}>
                  <div className={styles.taskGroupsPanel__itemMain}>
                    <h3 className={styles.taskGroupsPanel__itemTitle}>{group.title}</h3>
                    <p className={styles.taskGroupsPanel__itemMeta}>Oluşturuldu {formatGroupDate(group.createdAt)}</p>
                  </div>
                  <div className={styles.taskGroupsPanel__contract}>
                    <span>{doneCount}/{group.orderedTaskIds.length} tamam</span>
                    <span>Aktif: {activeTask?.title ?? activeTaskId ?? 'yok'}</span>
                    {missingCount ? <span>{missingCount} eksik kayıt</span> : null}
                  </div>
                </div>

                <div className={styles.taskGroupsPanel__queueGrid}>
                  <div className={`${styles.taskGroupsPanel__queueCard} ${styles[`taskGroupsPanel__queueCard_${group.planningQueueState.state}`] ?? ''}`}>
                    <span>Plan Kuyruğu</span>
                    <strong>{queueStateLabel(group.planningQueueState.state)}</strong>
                    <small>{group.planningQueueState.updatedAt ? formatGroupDate(group.planningQueueState.updatedAt) : 'Henüz çalışmadı'}</small>
                  </div>
                  <div className={`${styles.taskGroupsPanel__queueCard} ${styles[`taskGroupsPanel__queueCard_${group.executionQueueState.state}`] ?? ''}`}>
                    <span>Çalışma Kuyruğu</span>
                    <strong>{queueStateLabel(group.executionQueueState.state)}</strong>
                    <small>{activeTask?.title ?? 'Aktif task seçilmedi'}</small>
                  </div>
                </div>

                <div className={styles.taskGroupsPanel__scope}>
                  <LuFileText size={14} />
                  <span>{group.groupContextMdPath || 'groupContext.md hazırlanıyor'}</span>
                </div>

                {group.orderedTaskIds.length > 0 ? (
                  <ol className={styles.taskGroupsPanel__taskList}>
                    {group.orderedTaskIds.map((taskId, index) => {
                      const task = tasksById.get(taskId)
                      const isActive = activeTaskId === taskId
                      return (
                        <li key={taskId} className={`${styles.taskGroupsPanel__taskItem} ${isActive ? styles.taskGroupsPanel__taskItem_active : ''}`}>
                          <span className={styles.taskGroupsPanel__taskOrder}>P{index + 1}</span>
                          <button
                            type="button"
                            className={styles.taskGroupsPanel__taskMainButton}
                            onClick={() => task && onOpenTask?.(task.id)}
                            disabled={!task || !onOpenTask}
                            title={task ? 'Task detayını aç' : 'Task kaydı bulunamadı'}
                          >
                            <span className={styles.taskGroupsPanel__taskTitle}>{task?.title ?? taskId}</span>
                            <span className={styles.taskGroupsPanel__taskMeta}>{isActive ? 'Aktif çalışma bağlamı' : 'Sıradaki bağlam'}</span>
                          </button>
                          <span className={styles.taskGroupsPanel__taskStatus}>{task?.status ?? 'unknown'}</span>
                          <div className={styles.taskGroupsPanel__taskActions}>
                            <button type="button" onClick={() => updateGroupTasks(group, group.orderedTaskIds, taskId)} disabled={saving || isActive || updatingGroupId === group.groupId} aria-label="Taskı aktif çalışma bağlamı yap" title="Aktif yap">
                              <LuCircleDot size={14} />
                            </button>
                            <button type="button" onClick={() => {
                              if (index <= 0) return
                              const next = [...group.orderedTaskIds]
                              const previous = next[index - 1]
                              next[index - 1] = taskId
                              next[index] = previous
                              updateGroupTasks(group, next, activeTaskId)
                            }} disabled={saving || index === 0 || updatingGroupId === group.groupId} aria-label="Taskı yukarı taşı" title="Yukarı taşı">
                              <LuArrowUp size={14} />
                            </button>
                            <button type="button" onClick={() => {
                              if (index >= group.orderedTaskIds.length - 1) return
                              const next = [...group.orderedTaskIds]
                              const following = next[index + 1]
                              next[index + 1] = taskId
                              next[index] = following
                              updateGroupTasks(group, next, activeTaskId)
                            }} disabled={saving || index === group.orderedTaskIds.length - 1 || updatingGroupId === group.groupId} aria-label="Taskı aşağı taşı" title="Aşağı taşı">
                              <LuArrowDown size={14} />
                            </button>
                            <button type="button" onClick={() => {
                              const next = group.orderedTaskIds.filter((id) => id !== taskId)
                              updateGroupTasks(group, next, isActive ? next[0] ?? null : activeTaskId)
                            }} disabled={saving || updatingGroupId === group.groupId} aria-label="Taskı gruptan çıkar" title="Gruptan çıkar">
                              <LuTrash2 size={14} />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className={styles.taskGroupsPanel__emptyInline}>Bu grupta task yok. Plan ve çalışma kuyruğu için önce task ekle.</p>
                )}

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
                      const next = [...group.orderedTaskIds, taskId]
                      updateGroupTasks(group, next, activeTaskId ?? taskId)
                      setSelectedTaskByGroup((current) => ({ ...current, [group.groupId]: '' }))
                    }}
                  >
                    <LuPlus size={14} />
                    <span>Ekle</span>
                  </button>
                </div>
              </article>
            )
          })
        ) : (
          <p className={styles.taskGroupsPanel__empty}>Bu projede henüz task grubu yok. Önce bir Task Grubu oluşturup plan ve çalışma kuyruğunu aynı bağlama bağla.</p>
        )}
      </div>
    </section>
  )
}
