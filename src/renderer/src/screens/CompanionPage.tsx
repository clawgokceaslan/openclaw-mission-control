import { UniversalCommand } from '@renderer/components/navigation/UniversalCommand'
import styles from '@renderer/App.module.scss'

export function CompanionPage() {
  return (
    <main className={styles.companionPage}>
      <UniversalCommand embedded />
    </main>
  )
}
