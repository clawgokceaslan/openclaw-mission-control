import { Navbar, Container, Dropdown } from 'react-bootstrap'
import { LuBriefcase } from 'react-icons/lu'
import type { User } from '@shared/types/entities'
import styles from '@renderer/App.module.scss'

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

  return (
    <Navbar className={styles.topbar}>
      <Container fluid className={styles.topbarInner}>
        <div className={styles.brandArea}>
          <div className={styles.brandMark}>OC</div>
          <div>
            <p className={styles.brandTitle}>OPENCLAW</p>
            <p className={styles.brandSubtitle}>Mission Control</p>
          </div>
        </div>

        <Dropdown align="start">
          <Dropdown.Toggle className={styles.workspaceButton} variant="light" id="workspace-dropdown">
            <span className={styles.workspaceLabel}><LuBriefcase size={13} /> Personal</span>
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item active>Personal</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

        <div className={styles.userArea}>
          <div className={styles.userMeta}>
            <span className={styles.userName}>{userName}</span>
            <span className={styles.userRole}>{user?.role ?? 'operator'}</span>
          </div>
          <div className={styles.userAvatar}>{initials}</div>
        </div>
      </Container>
    </Navbar>
  )
}
