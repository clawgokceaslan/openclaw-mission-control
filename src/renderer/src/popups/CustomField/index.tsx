import { useEffect, useState } from 'react'
import { LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import { AppSelect } from '@renderer/components/select/AppSelect'
import type { CustomField } from '@shared/types/entities'
import type { CustomFieldDraftRow } from '@renderer/screens/projects/detail/types'
import { customFieldValueToDraft } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface CustomFieldPopupProps {
  open: boolean
  customFields: CustomField[]
  assignedFieldIds: Set<string>
  error?: string | null
  onClose: () => void
  onSave: (rows: CustomFieldDraftRow[]) => void
  onCreateField: (input: { name: string; type: CustomField['type'] }) => Promise<CustomField | null | void> | CustomField | null | void
  onErrorClear: () => void
}

function createRow(): CustomFieldDraftRow {
  return { id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`, field: null, value: '' }
}

export function CustomFieldPopup({
  open,
  customFields,
  assignedFieldIds,
  error,
  onClose,
  onSave,
  onCreateField,
  onErrorClear
}: CustomFieldPopupProps) {
  const [rows, setRows] = useState<CustomFieldDraftRow[]>([createRow()])
  const [createOpen, setCreateOpen] = useState(false)
  const [quickFieldName, setQuickFieldName] = useState('')
  const [quickFieldType, setQuickFieldType] = useState<CustomField['type']>('text')

  useEffect(() => {
    if (!open) return
    setRows([createRow()])
    setCreateOpen(false)
    setQuickFieldName('')
    setQuickFieldType('text')
  }, [open])

  if (!open) return null

  const addRow = () => setRows((current) => [...current, createRow()])

  const createField = async () => {
    const name = quickFieldName.trim()
    if (!name) return
    const field = await onCreateField({ name, type: quickFieldType })
    if (!field) return
    const nextOption = { value: field.id, label: field.name }
    setRows((current) => {
      const emptyIndex = current.findIndex((row) => !row.field)
      if (emptyIndex === -1) return [...current, { ...createRow(), field: nextOption, value: customFieldValueToDraft(field, field.defaultValue) }]
      return current.map((row, index) => index === emptyIndex ? { ...row, field: nextOption, value: customFieldValueToDraft(field, field.defaultValue) } : row)
    })
    setQuickFieldName('')
    setQuickFieldType('text')
    setCreateOpen(false)
  }

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
                          setRows((current) => current.map((entry) => entry.id === row.id
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
                        <select value={row.value || 'false'} onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}>
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : (
                        <textarea
                          rows={field?.type === 'json' ? 4 : 1}
                          value={row.value}
                          onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}
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
                  <button type="button" onClick={() => setRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [createRow()])} aria-label="Remove custom field row">
                    <LuTrash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className={styles.modalInlineActions}>
            <button type="button" className={styles.modalAddRowButton} onClick={addRow}><LuPlus size={15} /> Add row</button>
            <button type="button" className={styles.modalAddRowButton} onClick={() => { setQuickFieldName(''); setQuickFieldType('text'); setCreateOpen(true) }}>
              <LuPlus size={15} />
              Add new custom field
            </button>
          </div>
          <footer className={styles.modalFooterActions}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className={styles.primaryModalAction} onClick={() => onSave(rows)}>Save all</button>
          </footer>
          {createOpen ? (
            <>
              <div className={styles.nestedCreateBackdrop} onClick={() => setCreateOpen(false)} />
              <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new custom field">
                <header>
                  <h4>Add new custom field</h4>
                  <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close custom field create popup"><LuX size={15} /></button>
                </header>
                <div className={styles.nestedCreateBody}>
                  <input autoFocus value={quickFieldName} onChange={(event) => setQuickFieldName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createField() } }} placeholder="Field name" />
                  <select value={quickFieldType} onChange={(event) => setQuickFieldType(event.target.value as CustomField['type'])}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
                <footer>
                  <button type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
                  <button type="button" onClick={() => void createField()} disabled={!quickFieldName.trim()}>Create</button>
                </footer>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </>
  )
}
