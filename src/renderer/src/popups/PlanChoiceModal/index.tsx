import { LuSparkles, LuX } from 'react-icons/lu'
import { createPortal } from 'react-dom'
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
  const target = typeof document === 'undefined' ? null : document.body

  const modal = (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Planlama kontrol noktası seç" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={styles.dialog}>
        <header className={styles.header}>
          <span className={styles.icon}><LuSparkles size={18} /></span>
          <div>
            <h3>Planlama nasıl ilerlesin?</h3>
            <p>Task planı güncellenmeden önce onay sorusu beklensin mi, yoksa mevcut bağlamla doğrudan planlansın mı?</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Planlama seçimini kapat" title="Kapat"><LuX size={16} /></button>
        </header>
        <div className={styles.options}>
          <button type="button" onClick={() => onSelect('ask-first')} disabled={loading}>
            <b>Onay sorularıyla planla</b>
            <span>AI önce kısa karar soruları çıkarır; yanıtın plan güncellemesini yönlendirir.</span>
          </button>
          <button type="button" onClick={() => onSelect('direct')} disabled={loading}>
            <b>Doğrudan planla</b>
            <span>AI mevcut task bağlamından hareketle planı hemen günceller.</span>
          </button>
        </div>
      </div>
    </div>
  )

  return target ? createPortal(modal, target) : modal
}
