import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuTriangleAlert, LuX } from 'react-icons/lu'
import styles from './index.module.scss'

export interface ConfirmationOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
}

type PendingConfirmation = ConfirmationOptions & {
  resolve: (confirmed: boolean) => void
}

const ConfirmationContext = createContext<((options: ConfirmationOptions) => Promise<boolean>) | null>(null)

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const pendingResolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  const close = useCallback((confirmed: boolean) => {
    setPending((current) => {
      pendingResolveRef.current = null
      current?.resolve(confirmed)
      return null
    })
  }, [])

  const confirm = useCallback((options: ConfirmationOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending((current) => {
        current?.resolve(false)
        pendingResolveRef.current = resolve
        return { ...options, resolve }
      })
    })
  }, [])

  useEffect(() => {
    if (!pending) return
    const focusTimer = window.setTimeout(() => confirmButtonRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [close, pending])

  useEffect(() => () => {
    pendingResolveRef.current?.(false)
    pendingResolveRef.current = null
  }, [])

  const target = typeof document === 'undefined' ? null : document.body
  const modal = pending ? (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(false)
      }}
    >
      <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-label={pending.title}>
        <header className={styles.header}>
          <span className={styles.icon} aria-hidden="true"><LuTriangleAlert size={18} /></span>
          <div className={styles.heading}>
            <h3>{pending.title}</h3>
            <p>{pending.message}</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={() => close(false)} aria-label="Close confirmation">
            <LuX size={16} />
          </button>
        </header>
        <footer className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={() => close(false)}>
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            ref={confirmButtonRef}
            className={`${styles.confirmButton} ${pending.tone === 'danger' ? styles.confirmButtonDanger : ''}`}
            onClick={() => close(true)}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </footer>
      </section>
    </div>
  ) : null

  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      {modal && target ? createPortal(modal, target) : modal}
    </ConfirmationContext.Provider>
  )
}

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext)
  if (!confirm) throw new Error('useConfirmation must be used inside ConfirmationProvider')
  return confirm
}
