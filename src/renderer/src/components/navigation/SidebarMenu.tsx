import { NavLink } from 'react-router-dom'
import { NAV_BY_GROUP, NAV_GROUP_ORDER } from '@renderer/navigation/nav.config'
import styles from '@renderer/App.module.scss'

export function SidebarMenu() {
  return (
    <aside className={styles.sidebar}>
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
