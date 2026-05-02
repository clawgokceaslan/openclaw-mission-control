import type { ReactNode } from 'react'

export interface TaskModalsProps {
  open: boolean
  children: ReactNode
}

export function TaskModals({ open, children }: TaskModalsProps) {
  if (!open) return null
  return <>{children}</>
}
