import { Link } from 'react-router-dom'
import { Navbar, Container } from 'react-bootstrap'
import { useEffect, useState } from 'react'
import { LuSearch } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import type { User } from '@shared/types/entities'
import styles from '@renderer/App.module.scss'
import { GlobalCreateTaskModal } from './GlobalCreateTaskModal'
import { UniversalCommand, type GlobalTaskCreateInitial } from './UniversalCommand'

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'MC'
}

export function TopHeader({ user }: { user: User | null }) {
  const userName = user?.name?.trim() || 'Mission Operator'
  const initials = initialsFromName(userName)
  const [open, setOpen] = useState(false)
  const [taskCreateInitial, setTaskCreateInitial] = useState<GlobalTaskCreateInitial | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <Navbar className={styles.topbar}>
      <Container fluid className={styles.topbarInner}>
        <div className={styles.brandArea}>
          <div className={styles.brandMark}>OM</div>
          <div className={styles.brandText}>
            <p className={styles.brandTitle}>Open Mission Control</p>
          </div>
        </div>

        <button type="button" className={styles.universalSearchButton} onClick={() => setOpen(true)}>
          <LuSearch size={15} />
          <span>Search or create...</span>
          <kbd>⌘K</kbd>
        </button>

        <Link className={styles.userArea} to={APP_ROUTES.PROFILE} aria-label="Open profile">
          <div className={styles.userMeta}>
            <span className={styles.userName}>{userName}</span>
            <span className={styles.userRole}>{user?.role ?? 'operator'}</span>
          </div>
          <div className={styles.userAvatar}>{initials}</div>
        </Link>
      </Container>

      {open ? (
        <>
          <div className={styles.commandBackdrop} onClick={() => setOpen(false)} />
          <UniversalCommand
            onClose={() => setOpen(false)}
            onOpenTaskCreate={(initial) => {
              setOpen(false)
              setTaskCreateInitial(initial)
            }}
          />
        </>
      ) : null}
      <GlobalCreateTaskModal
        open={Boolean(taskCreateInitial)}
        initial={taskCreateInitial}
        onClose={() => setTaskCreateInitial(null)}
      />
    </Navbar>
  )
}
