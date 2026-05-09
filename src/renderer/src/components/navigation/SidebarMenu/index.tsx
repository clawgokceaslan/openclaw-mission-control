import { NavLink } from 'react-router-dom'
import { NAV_BY_GROUP, NAV_GROUP_ORDER } from '@renderer/navigation/nav.config'
import styles from './index.module.scss'

type SidebarMenuProps = {
  open?: boolean
  onNavigate?: () => void
}

export function SidebarMenu({ open = false, onNavigate }: SidebarMenuProps) {
  return (
    <aside id="primary-navigation" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
      <div className={styles.sidebarScroll}>
        {NAV_GROUP_ORDER.map((group) => (
          <section key={group} className={styles.navGroup}>
            <h3 className={styles.navGroupTitle}>{group}</h3>
            <nav className={styles.navList} aria-label={`${group} navigation`}>
              {NAV_BY_GROUP[group].map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    aria-label={item.label}
                    className={({ isActive }) =>
                      `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                    }
                    end={item.path === '/dashboard'}
                    onClick={onNavigate}
                  >
                    <span className={styles.navIcon}><Icon size={15} /></span>
                    <span className={styles.navLabel}>{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>
          </section>
        ))}
      </div>
    </aside>
  )
}
