import type { ReactNode } from 'react'

export interface SubtaskDetailPanelProps {
  children: ReactNode
}

export function SubtaskDetailPanel({ children }: SubtaskDetailPanelProps) {
  return <>{children}</>
}
