import { LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import { AppSelect } from '@renderer/components/select/AppSelect'
import type { CustomField } from '@shared/types/entities'
import type { CustomFieldDraftRow } from '../../detail/types'
import { customFieldValueToDraft } from '../../detail/projectDetailUtils'
import styles from '../../ProjectDetailPage.module.scss'

interface CustomFieldPopupProps {
  rows: CustomFieldDraftRow[]
  customFields: CustomField[]
  assignedFieldIds: Set<string>
  error?: string | null
  createOpen: boolean
  quickFieldName: string
  quickFieldType: CustomField['type']
  onRowsChange: (updater: (current: CustomFieldDraftRow[]) => CustomFieldDraftRow[]) => void
  onCreateRow: () => CustomFieldDraftRow
  onCreateOpenChange: (open: boolean) => void
  onQuickFieldNameChange: (value: string) => void
  onQuickFieldTypeChange: (value: CustomField['type']) => void
  onClose: () => void
  onSave: () => void
  onCreateField: () => void
  onErrorClear: () => void
}

export function CustomFieldPopup({
  rows,
  customFields,
  assignedFieldIds,
  error,
  createOpen,
  quickFieldName,
  quickFieldType,
  onRowsChange,
  onCreateRow,
  onCreateOpenChange,
  onQuickFieldNameChange,
  onQuickFieldTypeChange,
  onClose,
  onSave,
  onCreateField,
  onErrorClear
}: CustomFieldPopupProps) {
  const addRow = () => onRowsChange((current) => [...current, onCreateRow()])

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add custom field">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Custom field</span></div>
          <button type="button" onClick={onClose} aria-label="Close custom field modal"><LuX size={17} /></button>
        </header>
        <div className={styles.createTaskBody}>
          {error ? <p className={styles.customFieldError}>{error}</p> : null}
          <div className={styles.multiAddList}>
            {rows.map((row, index) => {
              const field = customFields.find((item) => item.id === row.field?.value)
              const selectedOtherIds = new Set(rows.filter((entry) => entry.id !== row.id && entry.field).map((entry) => entry.field?.value ?? ''))
              const rowOptions = customFields
                .filter((item) => !assignedFieldIds.has(item.id) && !selectedOtherIds.has(item.id))
                .map((item) => ({ value: item.id, label: item.name }))
              return (
                <div key={row.id} className={styles.multiCustomFieldRow}>
                  <span>{index + 1}</span>
                  <div className={styles.multiCustomFieldMain}>
                    <label className={styles.multiCustomFieldControl}>
                      <span>Field</span>
                      <AppSelect
                        mode="single"
                        value={row.field}
                        options={rowOptions}
                        onChange={(option) => {
                          if (Array.isArray(option)) return
                          const nextField = customFields.find((item) => item.id === option?.value)
                          onRowsChange((current) => current.map((entry) => entry.id === row.id
                            ? { ...entry, field: option, value: nextField ? customFieldValueToDraft(nextField, nextField.defaultValue) : '' }
                            : entry))
                          onErrorClear()
                        }}
                        placeholder="Choose field..."
                      />
                    </label>
                    <label className={styles.multiCustomFieldControl}>
                      <span>
                        Value
                        {field ? <em>{field.type}</em> : null}
                      </span>
                      {field?.type === 'boolean' ? (
                        <select value={row.value || 'false'} onChange={(event) => onRowsChange((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}>
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : (
                        <textarea
                          rows={field?.type === 'json' ? 4 : 1}
                          value={row.value}
                          onChange={(event) => onRowsChange((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey && field?.type !== 'json') {
                              event.preventDefault()
                              addRow()
                            }
                          }}
                          placeholder={field?.type === 'json' ? '{ "value": true }' : 'Value'}
                        />
                      )}
                    </label>
                  </div>
                  <button type="button" onClick={() => onRowsChange((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [onCreateRow()])} aria-label="Remove custom field row">
                    <LuTrash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className={styles.modalInlineActions}>
            <button type="button" className={styles.modalAddRowButton} onClick={addRow}><LuPlus size={15} /> Add row</button>
            <button type="button" className={styles.modalAddRowButton} onClick={() => { onQuickFieldNameChange(''); onQuickFieldTypeChange('text'); onCreateOpenChange(true) }}>
              <LuPlus size={15} />
              Add new custom field
            </button>
          </div>
          <footer className={styles.modalFooterActions}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className={styles.primaryModalAction} onClick={onSave}>Save all</button>
          </footer>
          {createOpen ? (
            <>
              <div className={styles.nestedCreateBackdrop} onClick={() => onCreateOpenChange(false)} />
              <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new custom field">
                <header>
                  <h4>Add new custom field</h4>
                  <button type="button" onClick={() => onCreateOpenChange(false)} aria-label="Close custom field create popup"><LuX size={15} /></button>
                </header>
                <div className={styles.nestedCreateBody}>
                  <input autoFocus value={quickFieldName} onChange={(event) => onQuickFieldNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onCreateField() } }} placeholder="Field name" />
                  <select value={quickFieldType} onChange={(event) => onQuickFieldTypeChange(event.target.value as CustomField['type'])}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
                <footer>
                  <button type="button" onClick={() => onCreateOpenChange(false)}>Cancel</button>
                  <button type="button" onClick={onCreateField} disabled={!quickFieldName.trim()}>Create</button>
                </footer>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </>
  )
}
