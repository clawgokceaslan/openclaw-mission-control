import type { ReactNode } from 'react'
import { TopHeader } from '@renderer/components/navigation/TopHeader'
import { SidebarMenu } from '@renderer/components/navigation/SidebarMenu'
import { useAuth } from '@renderer/providers/auth/auth-state'
import styles from '@renderer/App.module.scss'

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  return (
    <div className={styles.appFrame}>
      <TopHeader user={user} />
      <div className={styles.shell}>
        <SidebarMenu />
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  )
}
