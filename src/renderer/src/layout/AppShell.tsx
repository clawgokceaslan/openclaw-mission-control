import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { TopHeader } from '@renderer/components/navigation/TopHeader'
import { SidebarMenu } from '@renderer/components/navigation/SidebarMenu'
import { PlannerQuestionHost, PlannerQuestionProvider } from '@renderer/components/planner/PlannerQuestionHost'
import { GlobalGatewayChatProvider } from '@renderer/providers/gateway-global-chat'
import { useAuth } from '@renderer/providers/auth/auth-state'
import styles from '@renderer/App.module.scss'

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!sidebarOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sidebarOpen])

  return (
    <GlobalGatewayChatProvider>
      <PlannerQuestionProvider>
        <div className={styles.appFrame}>
          <TopHeader
            user={user}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((current) => !current)}
          />
          <div className={styles.shell}>
            <SidebarMenu open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
            <button
              type="button"
              className={`${styles.sidebarBackdrop} ${sidebarOpen ? styles.sidebarBackdropOpen : ''}`}
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation menu"
            />
            <main className={styles.content}>{children}</main>
          </div>
          <PlannerQuestionHost />
        </div>
      </PlannerQuestionProvider>
    </GlobalGatewayChatProvider>
  )
}
