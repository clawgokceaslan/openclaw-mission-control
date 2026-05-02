import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import type { TaskSubtask } from '@shared/types/entities'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

type AddSubtaskInput = {
  title: string
  description: string
  status: TaskSubtask['status']
  agentId?: string | null
  dueAt?: number
}

type SubtaskRow = {
  id: string
  title: string
}

interface AddSubtaskPopupProps {
  open: boolean
  projectName: string
  taskTitle: string
  defaultStatus: TaskSubtask['status']
  busy: boolean
  onClose: () => void
  onCreate: (input: AddSubtaskInput) => void
  onCreateMany?: (inputs: AddSubtaskInput[]) => void
}

function createRow(): SubtaskRow {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: ''
  }
}

export function AddSubtaskPopup({ open, projectName, taskTitle, defaultStatus, busy, onClose, onCreate, onCreateMany }: AddSubtaskPopupProps) {
  const [rows, setRows] = useState<SubtaskRow[]>([createRow()])
  const nextFocusRowIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!nextFocusRowIdRef.current) return
    const input = document.querySelector<HTMLInputElement>(`[data-subtask-row-id="${nextFocusRowIdRef.current}"]`)
    if (!input) return
    input.focus()
    nextFocusRowIdRef.current = null
  }, [rows])

  useEffect(() => {
    if (!open) return
    setRows([createRow()])
  }, [open])

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const inputs = rows
      .map((row) => row.title.trim())
      .filter(Boolean)
      .map((title) => ({
        title,
        description: '',
        status: defaultStatus
      }))
    if (inputs.length === 0) return
    if (onCreateMany) {
      onCreateMany(inputs)
      return
    }
    onCreate({
      title: inputs[0].title,
      description: '',
      status: defaultStatus
    })
  }

  const updateRow = (rowId: string, title: string) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, title } : row))
  }

  const addRow = () => {
    const row = createRow()
    nextFocusRowIdRef.current = row.id
    setRows((current) => [...current, row])
  }

  const removeRow = (rowId: string) => {
    setRows((current) => current.length > 1 ? current.filter((row) => row.id !== rowId) : [createRow()])
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

  const hasValidRows = rows.some((row) => row.title.trim())

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add subtask">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Subtask</span></div>
          <button type="button" onClick={onClose} aria-label="Close add subtask"><LuX size={17} /></button>
        </header>
        <form className={styles.createTaskBody} onSubmit={submit}>
          <div className={styles.createTaskContext}>
            <span>{projectName}</span>
            <span>{taskTitle}</span>
            <span>Subtask</span>
          </div>
          <div className={styles.multiAddList}>
            {rows.map((row, index) => (
              <div key={row.id} className={styles.multiAddRow}>
                <span>{index + 1}</span>
                <input
                  autoFocus={index === 0}
                  data-subtask-row-id={row.id}
                  value={row.title}
                  onChange={(event) => updateRow(row.id, event.target.value)}
                  onKeyDown={handleRowKeyDown}
                  placeholder="Subtask name"
                />
                <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove subtask row">
                  <LuTrash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className={styles.modalAddRowButton} onClick={addRow}>
            <LuPlus size={15} />
            Add row
          </button>
          <div className={styles.createTaskFooter}>
            <span>Enter adds another row.</span>
            <button type="submit" disabled={busy || !hasValidRows}>Save all</button>
          </div>
        </form>
      </section>
    </>
  )
}
