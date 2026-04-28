import type { ReactNode } from 'react'
import styles from './PagePrimitives.module.scss'

export function ActionRow({ children }: { children: ReactNode }) {
  return <div className={styles.actionRow}>{children}</div>
}
