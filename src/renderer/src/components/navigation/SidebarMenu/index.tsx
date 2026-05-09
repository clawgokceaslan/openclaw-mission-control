import { NavLink } from 'react-router-dom'
import { NAV_BY_GROUP, NAV_GROUP_ORDER } from '@renderer/navigation/nav.config'
import styles from './index.module.scss'

export function SidebarMenu() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarEyebrow}>Start menu</span>
        <strong className={styles.sidebarTitle}>Mission workspace</strong>
      </div>
      <div className={styles.sidebarScroll}>
        {NAV_GROUP_ORDER.map((group) => (
          <section key={group} className={styles.navGroup}>
            <div className={styles.navGroupHeader}>
              <h3 className={styles.navGroupTitle}>{group}</h3>
              <span className={styles.navGroupCount}>{NAV_BY_GROUP[group].length}</span>
            </div>
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
                  >
                    <span className={styles.navIcon}><Icon size={16} /></span>
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
