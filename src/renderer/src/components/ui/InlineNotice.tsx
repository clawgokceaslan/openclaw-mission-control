import styles from './PagePrimitives.module.scss'

export function InlineNotice({
  tone,
  children
}: {
  tone: 'error' | 'warn' | 'info' | 'success'
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'error'
      ? styles.noticeError
      : tone === 'warn'
        ? styles.noticeWarn
        : tone === 'success'
          ? styles.noticeSuccess
          : styles.noticeInfo

  return <p className={`${styles.inlineNotice} ${toneClass}`}>{children}</p>
}
