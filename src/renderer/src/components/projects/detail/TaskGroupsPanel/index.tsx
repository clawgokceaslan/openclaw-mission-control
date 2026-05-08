import { LuPlus, LuRoute } from 'react-icons/lu'
import type { TaskGroup } from '@shared/types/entities'
import styles from './index.module.scss'

interface TaskGroupsPanelProps {
  groups: TaskGroup[]
  titleDraft: string
  saving: boolean
  error: string | null
  onTitleDraftChange: (value: string) => void
  onCreate: () => void
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
  titleDraft,
  saving,
  error,
  onTitleDraftChange,
  onCreate
}: TaskGroupsPanelProps) {
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
        <form
          className={styles.taskGroupsPanel__form}
          onSubmit={(event) => {
            event.preventDefault()
            onCreate()
          }}
        >
          <input
            className={styles.taskGroupsPanel__input}
            value={titleDraft}
            onChange={(event) => onTitleDraftChange(event.target.value)}
            placeholder="Grup adı"
            aria-label="Yeni task grubu adı"
            disabled={saving}
          />
          <button type="submit" className={styles.taskGroupsPanel__button} disabled={saving}>
            <LuPlus size={16} />
            <span>{saving ? 'Ekleniyor' : 'Grup oluştur'}</span>
          </button>
        </form>
      </div>

      {error ? <p className={styles.taskGroupsPanel__error}>{error}</p> : null}

      <div className={styles.taskGroupsPanel__list}>
        {groups.length > 0 ? (
          groups.map((group) => (
            <article key={group.groupId} className={styles.taskGroupsPanel__item}>
              <div className={styles.taskGroupsPanel__itemMain}>
                <h3 className={styles.taskGroupsPanel__itemTitle}>{group.title}</h3>
                <p className={styles.taskGroupsPanel__itemMeta}>Oluşturuldu {formatGroupDate(group.createdAt)}</p>
              </div>
              <div className={styles.taskGroupsPanel__contract}>
                <span>{group.orderedTaskIds.length} task</span>
                <span>{group.planningQueueState.state}</span>
                <span>{group.executionQueueState.state}</span>
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
