import { LuPlus, LuX } from 'react-icons/lu'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import type { DataFormatRole } from '../../detail/types'
import styles from '../../ProjectDetailPage.module.scss'

interface OutputFormatPopupProps {
  role: DataFormatRole
  draftOption: AppSelectOption | null
  options: AppSelectOption[]
  createOpen: boolean
  quickName: string
  quickDescription: string
  onDraftOptionChange: (option: AppSelectOption | null) => void
  onCreateOpenChange: (open: boolean) => void
  onQuickNameChange: (value: string) => void
  onQuickDescriptionChange: (value: string) => void
  onClose: () => void
  onSave: () => void
  onCreate: () => void
}

export function OutputFormatPopup({
  role,
  draftOption,
  options,
  createOpen,
  quickName,
  quickDescription,
  onDraftOptionChange,
  onCreateOpenChange,
  onQuickNameChange,
  onQuickDescriptionChange,
  onClose,
  onSave,
  onCreate
}: OutputFormatPopupProps) {
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
            <AppSelect mode="single" value={draftOption} options={options} onChange={(option) => { if (!Array.isArray(option)) onDraftOptionChange(option) }} placeholder="No data format" isClearable />
          </div>
          <div className={styles.modalInlineActions}>
            <button type="button" className={styles.modalAddRowButton} onClick={() => { onQuickNameChange(''); onQuickDescriptionChange(''); onCreateOpenChange(true) }}>
              <LuPlus size={15} />
              Add new data format
            </button>
          </div>
          <footer className={styles.modalFooterActions}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className={styles.primaryModalAction} onClick={onSave}>Save</button>
          </footer>
          {createOpen ? (
            <>
              <div className={styles.nestedCreateBackdrop} onClick={() => onCreateOpenChange(false)} />
              <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new data format">
                <header>
                  <h4>Add new data format</h4>
                  <button type="button" onClick={() => onCreateOpenChange(false)} aria-label="Close data format create popup"><LuX size={15} /></button>
                </header>
                <div className={styles.nestedCreateBody}>
                  <input autoFocus value={quickName} onChange={(event) => onQuickNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onCreate() } }} placeholder="Format name" />
                  <input value={quickDescription} onChange={(event) => onQuickDescriptionChange(event.target.value)} placeholder="Description (optional)" />
                </div>
                <footer>
                  <button type="button" onClick={() => onCreateOpenChange(false)}>Cancel</button>
                  <button type="button" onClick={onCreate} disabled={!quickName.trim()}>Create</button>
                </footer>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </>
  )
}
