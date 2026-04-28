import type { ReactNode } from 'react'
import styles from './PagePrimitives.module.scss'

export function SectionCard({
  title,
  subtitle,
  actions,
  children
}: {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const hasHeader = Boolean(title || subtitle || actions)

  return (
    <section className={styles.sectionCard}>
      {hasHeader ? (
        <header className={styles.cardHeader}>
          <div className={styles.cardTitleWrap}>
            {title ? <h2 className={styles.cardTitle}>{title}</h2> : null}
            {subtitle ? <p className={styles.cardSubtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.cardActions}>{actions}</div> : null}
        </header>
      ) : null}
      <div className={styles.cardBody}>{children}</div>
    </section>
  )
}
