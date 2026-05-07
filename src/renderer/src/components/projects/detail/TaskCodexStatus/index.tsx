import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { LuCircleDashed, LuEllipsis, LuFileText, LuPlay } from 'react-icons/lu'
import type { TaskEntity } from '@shared/types/entities'
import { taskCodexActionChips, taskCodexPlanBadge, taskCodexStatusItems, type TaskCodexStatusTone } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from './index.module.scss'

type TaskCodexStatusProps = {
  task: TaskEntity
  onOpenTaskChat: (taskId: string, conversationId: string) => void
  compact?: boolean
}

export function taskCodexActivityClass(tone?: TaskCodexStatusTone | null): string {
  if (tone === 'planning') return styles.activityPlanning
  if (tone === 'running') return styles.activityRunning
  if (tone === 'post-running') return styles.activityPostRunning
  if (tone === 'follow-up') return styles.activityFollowUp
  return ''
}

export function taskCodexActivityTone(task: TaskEntity): TaskCodexStatusTone | null {
  return taskCodexStatusItems(task).at(-1)?.tone ?? null
}

export function TaskCodexStatus({ task, onOpenTaskChat, compact = false }: TaskCodexStatusProps) {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const menuRef = useRef<HTMLSpanElement | null>(null)
  const planBadge = taskCodexPlanBadge(task)
  const statusItems = taskCodexStatusItems(task)
  const actions = taskCodexActionChips(task)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (!planBadge && statusItems.length === 0 && actions.length === 0) return null

  const openChat = (event: MouseEvent<HTMLButtonElement>, conversationId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    onOpenTaskChat(task.id, conversationId)
  }

  return (
    <span className={`${styles.codexStatus} ${compact ? styles.compact : ''}`}>
      {planBadge?.state === 'planned' ? (
        <span className={styles.plannedIcon} title="Planned" aria-label="Planned">
          <LuCircleDashed size={13} />
        </span>
      ) : null}
      {statusItems.map((item) => (
        <span key={item.key} className={`${styles.statusPill} ${taskCodexActivityClass(item.tone)}`}>
          <span />
          {item.label}
        </span>
      ))}
      {actions.length > 0 ? (
        <span ref={menuRef} className={styles.actionMenu}>
          <button
            type="button"
            className={styles.actionTrigger}
            title="Task chat actions"
            aria-label="Task chat actions"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              setMenuPosition({ left: rect.right, top: rect.bottom + 6 })
              setOpen((current) => !current)
            }}
          >
            <LuEllipsis size={15} />
          </button>
          {open ? (
            <span className={styles.actionMenuPanel} role="menu" style={{ left: menuPosition?.left ?? 0, top: menuPosition?.top ?? 0 } as CSSProperties}>
              {actions.map((action) => (
                <button
                  key={action.source}
                  type="button"
                  role="menuitem"
                  className={styles.actionMenuItem}
                  onClick={(event) => openChat(event, action.conversationId)}
                >
                  {action.source === 'codex-plan' ? <LuFileText size={14} /> : <LuPlay size={14} />}
                  Open {action.label} chat
                </button>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}
