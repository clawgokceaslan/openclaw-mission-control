import { FormEvent } from 'react'
import { LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import type { TextDraftRow } from '../../detail/types'
import styles from '../../ProjectDetailPage.module.scss'

interface ChecklistPopupProps {
  rows: TextDraftRow[]
  onRowsChange: (updater: (current: TextDraftRow[]) => TextDraftRow[]) => void
  onCreateRow: () => TextDraftRow
  onClose: () => void
  onSave: () => void
}

export function ChecklistPopup({ rows, onRowsChange, onCreateRow, onClose, onSave }: ChecklistPopupProps) {
  const addRow = () => onRowsChange((current) => [...current, onCreateRow()])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave()
  }

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add checklist items">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Checklist</span></div>
          <button type="button" onClick={onClose} aria-label="Close checklist modal"><LuX size={17} /></button>
        </header>
        <form className={styles.createTaskBody} onSubmit={submit}>
          <div className={styles.multiAddList}>
            {rows.map((row, index) => (
              <div key={row.id} className={styles.multiAddRow}>
                <span>{index + 1}</span>
                <input
                  autoFocus={index === 0}
                  value={row.title}
                  onChange={(event) => onRowsChange((current) => current.map((entry) => entry.id === row.id ? { ...entry, title: event.target.value } : entry))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addRow()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      onClose()
                    }
                  }}
                  placeholder="Checklist item title"
                />
                <button type="button" onClick={() => onRowsChange((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [onCreateRow()])} aria-label="Remove checklist row">
                  <LuTrash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className={styles.modalAddRowButton} onClick={addRow}><LuPlus size={15} /> Add row</button>
          <footer className={styles.createTaskFooter}>
            <span>Enter adds another row.</span>
            <button type="submit" disabled={!rows.some((row) => row.title.trim())}>Save all</button>
          </footer>
        </form>
      </section>
    </>
  )
}
