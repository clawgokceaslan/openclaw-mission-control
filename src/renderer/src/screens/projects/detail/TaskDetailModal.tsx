import { ReactNode, useEffect, useRef, useState } from 'react'
import { LuCopy, LuExternalLink, LuHistory, LuEllipsis, LuPencil, LuTrash2, LuX } from 'react-icons/lu'
import styles from './TaskDetailModal.module.scss'

interface TaskDetailModalProps {
  taskId: string
  children: ReactNode
  onClose: () => void
  onDeleteTask: () => void
  onEditTitle: () => void
  onOpenActivity: () => void
}

export function TaskDetailModal({
  taskId,
  children,
  onClose,
  onDeleteTask,
  onEditTitle,
  onOpenActivity
}: TaskDetailModalProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isMenuOpen) return
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setIsMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [isMenuOpen])

  const copyTaskId = () => {
    void navigator.clipboard?.writeText(taskId)
    setIsMenuOpen(false)
  }

  const copyTaskLink = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('task', taskId)
    void navigator.clipboard?.writeText(url.toString())
    setIsMenuOpen(false)
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <section className={styles.shell} role="dialog" aria-modal="true" aria-label="Task detail">
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerTitle}>Task detail</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.iconButton} onClick={onOpenActivity} aria-label="Open activity logs">
              <LuHistory size={16} />
            </button>
            <div className={styles.menuWrap} ref={menuRef}>
              <button
                type="button"
                className={`${styles.iconButton} ${isMenuOpen ? styles.iconButtonActive : ''}`}
                onClick={() => setIsMenuOpen((value) => !value)}
                aria-label="Task actions"
              >
                <LuEllipsis size={18} />
              </button>
              {isMenuOpen ? (
                <div className={styles.menu} role="menu">
                  <button type="button" onClick={copyTaskLink}><LuExternalLink size={15} /> Copy link</button>
                  <button type="button" onClick={copyTaskId}><LuCopy size={15} /> Copy task ID</button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false)
                      onEditTitle()
                    }}
                  >
                    <LuPencil size={15} /> Edit title
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false)
                      onOpenActivity()
                    }}
                  >
                    <LuHistory size={15} /> Open activity logs
                  </button>
                  <button
                    type="button"
                    className={styles.dangerAction}
                    onClick={() => {
                      setIsMenuOpen(false)
                      onDeleteTask()
                    }}
                  >
                    <LuTrash2 size={15} /> Delete task
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close task modal">
              <LuX size={18} />
            </button>
          </div>
        </header>
        {children}
      </section>
    </>
  )
}
