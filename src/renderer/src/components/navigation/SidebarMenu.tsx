import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { IPC_CHANNELS, type McpStatusResponse } from '@shared/contracts/ipc'
import { NAV_BY_GROUP, NAV_GROUP_ORDER } from '@renderer/navigation/nav.config'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge } from '@renderer/utils/api'
import styles from '@renderer/App.module.scss'

export function SidebarMenu() {
  const { token } = useAuth()
  const [mcpStatus, setMcpStatus] = useState<McpStatusResponse | null>(null)
  const [mcpChecking, setMcpChecking] = useState(false)
  const [mcpRefreshIndex, setMcpRefreshIndex] = useState(0)

  useEffect(() => {
    let cancelled = false

    const refreshMcpStatus = async () => {
      if (!token) {
        setMcpStatus(null)
        setMcpChecking(false)
        return
      }
      setMcpChecking(true)
      const response = await invokeBridge<McpStatusResponse>(IPC_CHANNELS.appSettings.getMcpStatus, { actorToken: token })
      if (cancelled) return
      setMcpChecking(false)
      setMcpStatus(response.ok && response.data
        ? response.data
        : {
            available: false,
            name: 'openmissioncontrol',
            bridgeUrl: null,
            checkedAt: new Date().toISOString(),
            startedAt: null,
            message: response.error?.message ?? 'MCP status could not be checked.'
          })
    }

    void refreshMcpStatus()
    const timer = window.setInterval(() => void refreshMcpStatus(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [token, mcpRefreshIndex])

  const mcpAvailable = Boolean(mcpStatus?.available)
  const mcpLabel = mcpChecking && !mcpStatus ? 'MCP checking' : mcpAvailable ? 'MCP online' : 'MCP offline'
  const mcpTitle = mcpStatus?.bridgeUrl
    ? `${mcpStatus.message} ${mcpStatus.bridgeUrl}`
    : mcpStatus?.message ?? 'Checking MCP bridge status.'

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
      <footer className={styles.sidebarFooter}>
        <button
          type="button"
          className={`${styles.sidebarMcpStatus} ${mcpAvailable ? styles.sidebarMcpStatusOnline : styles.sidebarMcpStatusOffline}`}
          onClick={() => setMcpRefreshIndex((current) => current + 1)}
          title={mcpTitle}
          aria-label={mcpTitle}
        >
          <span className={styles.sidebarMcpStatusDot} aria-hidden="true" />
          <span>{mcpLabel}</span>
        </button>
      </footer>
    </aside>
  )
}
