import { LuSparkles, LuX } from 'react-icons/lu'
import type { PlannerClarificationMode } from '@renderer/screens/projects/detail/types'
import styles from './index.module.scss'

interface PlanChoiceModalProps {
  open: boolean
  loading?: boolean
  onClose: () => void
  onSelect: (mode: PlannerClarificationMode) => void
}

export function PlanChoiceModal({ open, loading = false, onClose, onSelect }: PlanChoiceModalProps) {
  if (!open) return null

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Choose Codex planning mode" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={styles.dialog}>
        <header className={styles.header}>
          <span className={styles.icon}><LuSparkles size={18} /></span>
          <div>
            <h3>How should Codex plan this task?</h3>
            <p>Choose whether Codex should pause for clarification before updating the task plan.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close planning mode dialog" title="Close"><LuX size={16} /></button>
        </header>
        <div className={styles.options}>
          <button type="button" onClick={() => onSelect('ask-first')} disabled={loading}>
            <b>Continue with questions</b>
            <span>Codex will ask concise clarification questions first.</span>
          </button>
          <button type="button" onClick={() => onSelect('direct')} disabled={loading}>
            <b>Continue without questions</b>
            <span>Codex will plan immediately from the current task context.</span>
          </button>
        </div>
      </div>
    </div>
  )
}
