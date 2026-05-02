import type { ReactNode } from 'react'

export interface ProjectSettingsModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function ProjectSettingsModal({ open, onClose, children }: ProjectSettingsModalProps) {
  if (!open) return null

  return (
    <div role="presentation" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
