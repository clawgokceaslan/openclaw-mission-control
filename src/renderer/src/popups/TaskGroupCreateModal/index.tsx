import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { LuLayers, LuPlus, LuX } from 'react-icons/lu'
import styles from './index.module.scss'

interface TaskGroupCreateModalProps {
  open: boolean
  titleDraft: string
  saving: boolean
  error: string | null
  onTitleDraftChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function TaskGroupCreateModal({
  open,
  titleDraft,
  saving,
  error,
  onTitleDraftChange,
  onClose,
  onSubmit
}: TaskGroupCreateModalProps) {
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
      className={styles.taskGroupCreateModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-group-create-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <form
        className={styles.taskGroupCreateModal__dialog}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <header className={styles.taskGroupCreateModal__header}>
          <span className={styles.taskGroupCreateModal__icon}>
            <LuLayers size={18} />
          </span>
          <div className={styles.taskGroupCreateModal__titleBlock}>
            <h2 id="task-group-create-title">Task grubu oluştur</h2>
            <p>Sıralı task akışını yönetmek için proje içinde bağımsız bir grup aç.</p>
          </div>
          <button
            type="button"
            className={styles.taskGroupCreateModal__close}
            onClick={onClose}
            disabled={saving}
            aria-label="Task grubu modalını kapat"
            title="Kapat"
          >
            <LuX size={17} />
          </button>
        </header>

        <div className={styles.taskGroupCreateModal__body}>
          <label className={styles.taskGroupCreateModal__field}>
            <span>Grup adı</span>
            <input
              value={titleDraft}
              onChange={(event) => onTitleDraftChange(event.target.value)}
              placeholder="Örn. Sprint teslim akışı"
              aria-label="Yeni task grubu adı"
              disabled={saving}
              autoFocus
            />
          </label>
          {error ? <p className={styles.taskGroupCreateModal__error}>{error}</p> : null}
        </div>

        <footer className={styles.taskGroupCreateModal__actions}>
          <button type="button" onClick={onClose} disabled={saving}>
            Vazgeç
          </button>
          <button type="submit" disabled={saving || !titleDraft.trim()}>
            <LuPlus size={16} />
            <span>{saving ? 'Oluşturuluyor' : 'Grup oluştur'}</span>
          </button>
        </footer>
      </form>
    </div>
  )

  return target ? createPortal(modal, target) : modal
}
