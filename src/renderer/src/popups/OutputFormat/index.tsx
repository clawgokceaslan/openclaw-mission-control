import { useEffect, useState } from 'react'
import { LuPlus, LuX } from 'react-icons/lu'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import type { OutputFormat } from '@shared/types/entities'
import type { DataFormatRole } from '@renderer/screens/projects/detail/types'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface OutputFormatPopupProps {
  open: boolean
  role: DataFormatRole
  initialOption: AppSelectOption | null
  options: AppSelectOption[]
  onClose: () => void
  onSave: (option: AppSelectOption | null) => void
  onCreate: (input: { name: string; description: string; role: DataFormatRole }) => Promise<OutputFormat | null | void> | OutputFormat | null | void
}

export function OutputFormatPopup({
  open,
  role,
  initialOption,
  options,
  onClose,
  onSave,
  onCreate
}: OutputFormatPopupProps) {
  const [draftOption, setDraftOption] = useState<AppSelectOption | null>(initialOption)
  const [createOpen, setCreateOpen] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickDescription, setQuickDescription] = useState('')

  useEffect(() => {
    if (!open) return
    setDraftOption(initialOption)
    setCreateOpen(false)
    setQuickName('')
    setQuickDescription('')
  }, [initialOption, open])

  if (!open) return null

  const createFormat = async () => {
    const name = quickName.trim()
    if (!name) return
    const format = await onCreate({ name, description: quickDescription.trim(), role })
    if (!format) return
    setDraftOption({ value: format.id, label: format.name })
    setQuickName('')
    setQuickDescription('')
    setCreateOpen(false)
  }

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Set data format">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>{role === 'input' ? 'Input data format' : 'Output data format'}</span></div>
          <button type="button" onClick={onClose} aria-label="Close data format modal"><LuX size={17} /></button>
        </header>
        <div className={styles.createTaskBody}>
          <div className={styles.modalField}>
            <span>Select data format</span>
            <AppSelect mode="single" value={draftOption} options={options} onChange={(option) => { if (!Array.isArray(option)) setDraftOption(option) }} placeholder="No data format" isClearable />
          </div>
          <div className={styles.modalInlineActions}>
            <button type="button" className={styles.modalAddRowButton} onClick={() => { setQuickName(''); setQuickDescription(''); setCreateOpen(true) }}>
              <LuPlus size={15} />
              Add new data format
            </button>
          </div>
          <footer className={styles.modalFooterActions}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className={styles.primaryModalAction} onClick={() => onSave(draftOption)}>Save</button>
          </footer>
          {createOpen ? (
            <>
              <div className={styles.nestedCreateBackdrop} onClick={() => setCreateOpen(false)} />
              <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new data format">
                <header>
                  <h4>Add new data format</h4>
                  <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close data format create popup"><LuX size={15} /></button>
                </header>
                <div className={styles.nestedCreateBody}>
                  <input autoFocus value={quickName} onChange={(event) => setQuickName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createFormat() } }} placeholder="Format name" />
                  <input value={quickDescription} onChange={(event) => setQuickDescription(event.target.value)} placeholder="Description (optional)" />
                </div>
                <footer>
                  <button type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
                  <button type="button" onClick={() => void createFormat()} disabled={!quickName.trim()}>Create</button>
                </footer>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </>
  )
}
