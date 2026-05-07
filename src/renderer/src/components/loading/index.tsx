import type { CSSProperties } from 'react'
import styles from './index.module.scss'

export const LOADER_MESSAGES = [
  'Veriler hazırlanıyor.',
  'Akış toparlanıyor.',
  'Kısa bir kontrol yapılıyor.',
  'Görünüm güncelleniyor.',
  'Son bilgiler eşleştiriliyor.'
] as const

type LoaderVariant = 'spinner' | 'skeleton'
type LoaderSize = 'compact' | 'default'

interface LoadingStateProps {
  variant?: LoaderVariant
  size?: LoaderSize
  message?: string
  messageIndex?: number
  rows?: number
  columns?: number
  className?: string
  'aria-label'?: string
}

function messageFor(index = 0) {
  const safeIndex = Math.abs(index) % LOADER_MESSAGES.length
  return LOADER_MESSAGES[safeIndex]
}

export function LoadingState({
  variant = 'spinner',
  size = 'default',
  message,
  messageIndex,
  rows = 4,
  columns = 3,
  className,
  'aria-label': ariaLabel
}: LoadingStateProps) {
  const resolvedMessage = message ?? messageFor(messageIndex)
  const hasMessage = resolvedMessage.trim().length > 0

  if (variant === 'skeleton') {
    const safeRows = Math.max(1, rows)
    const safeColumns = Math.max(1, columns)
    return (
      <div
        className={`${styles.loader} ${styles.skeletonLoader} ${className ?? ''}`}
        role="status"
        aria-label={ariaLabel ?? (hasMessage ? resolvedMessage : messageFor(messageIndex))}
      >
        {Array.from({ length: safeRows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className={styles.skeletonRow}
            style={{ '--loader-columns': safeColumns } as CSSProperties}
          >
            {Array.from({ length: safeColumns }).map((__, columnIndex) => (
              <span key={columnIndex} className={styles.skeletonCell} />
            ))}
          </div>
        ))}
        <span className={styles.srOnly}>{hasMessage ? resolvedMessage : messageFor(messageIndex)}</span>
      </div>
    )
  }

  return (
    <div
      className={`${styles.loader} ${styles.spinnerLoader} ${size === 'compact' ? styles.compact : ''} ${className ?? ''}`}
      role="status"
      aria-label={ariaLabel ?? (hasMessage ? resolvedMessage : messageFor(messageIndex))}
    >
      <span className={styles.spinner} aria-hidden="true" />
      {hasMessage ? <span className={styles.message}>{resolvedMessage}</span> : null}
    </div>
  )
}
