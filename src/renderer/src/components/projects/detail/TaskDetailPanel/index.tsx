import type { ReactNode } from 'react'

export interface TaskDetailPanelProps {
  children: ReactNode
}

export function TaskDetailPanel({ children }: TaskDetailPanelProps) {
  return <>{children}</>
}
