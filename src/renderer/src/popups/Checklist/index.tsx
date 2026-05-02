import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import type { TextDraftRow } from '@renderer/screens/projects/detail/types'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ChecklistPopupProps {
  open: boolean
  onClose: () => void
  onSave: (titles: string[]) => void
}

function createRow(): TextDraftRow {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: ''
  }
}

export function ChecklistPopup({ open, onClose, onSave }: ChecklistPopupProps) {
  const [rows, setRows] = useState<TextDraftRow[]>([createRow()])
  const nextFocusRowIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRows([createRow()])
  }, [open])

  useEffect(() => {
    if (!nextFocusRowIdRef.current) return
    const input = document.querySelector<HTMLInputElement>(`[data-checklist-row-id="${nextFocusRowIdRef.current}"]`)
    if (!input) return
    input.focus()
    nextFocusRowIdRef.current = null
  }, [rows])

  if (!open) return null

  const addRow = () => {
    const row = createRow()
    nextFocusRowIdRef.current = row.id
    setRows((current) => [...current, row])
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const titles = rows.map((row) => row.title.trim()).filter(Boolean)
    if (titles.length === 0) return
    onSave(titles)
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      addRow()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
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
                  data-checklist-row-id={row.id}
                  value={row.title}
                  onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, title: event.target.value } : entry))}
                  onKeyDown={handleRowKeyDown}
                  placeholder="Checklist item title"
                />
                <button type="button" onClick={() => setRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [createRow()])} aria-label="Remove checklist row">
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
