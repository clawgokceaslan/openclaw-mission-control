import { FormEvent, MouseEvent, useEffect, useRef, useState } from 'react'
import { LuEye, LuPencil, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import type { CustomField } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import styles from './CustomFieldsPage.module.scss'

const TYPE_OPTIONS: Array<AppSelectOption & { value: CustomField['type'] }> = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'JSON', value: 'json' }
]

function defaultValueSnippet(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'No default'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

function previewForType(type: CustomField['type']): string {
  if (type === 'number') return '123'
  if (type === 'boolean') return 'True / False'
  if (type === 'json') return '{ }'
  return 'Sample text'
}

function defaultValueToDraft(field?: CustomField): string {
  if (!field || field.defaultValue === undefined || field.defaultValue === null) return ''
  if (field.type === 'boolean') return field.defaultValue === true ? 'true' : field.defaultValue === false ? 'false' : ''
  if (field.type === 'json') {
    try {
      return JSON.stringify(field.defaultValue, null, 2)
    } catch {
      return ''
    }
  }
  return String(field.defaultValue)
}

function parseDefaultValue(type: CustomField['type'], rawValue: string): { ok: true; value?: unknown; draft?: string } | { ok: false; error: string } {
  const rawDefault = rawValue.trim()
  if (!rawDefault) return { ok: true }
  if (type === 'number') {
    const value = Number(rawDefault)
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'Default value must be a valid number.' }
  }
  if (type === 'boolean') {
    return { ok: true, value: rawDefault === 'true' }
  }
  if (type === 'json') {
    try {
      const value = JSON.parse(rawDefault)
      return { ok: true, value, draft: JSON.stringify(value, null, 2) }
    } catch {
      return { ok: false, error: 'Default value JSON is invalid.' }
    }
  }
  return { ok: true, value: rawValue }
}

export function CustomFieldsPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<CustomField[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<CustomField['type']>('text')
  const [defaultValueText, setDefaultValueText] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingField, setEditingField] = useState<CustomField | null>(null)
  const [previewField, setPreviewField] = useState<CustomField | null>(null)
  const [deleteField, setDeleteField] = useState<CustomField | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const tableRef = useRef<HTMLElement | null>(null)
  const dragScrollRef = useRef({ active: false, startX: 0, scrollLeft: 0 })

  const refresh = async () => {
    setLoading(true)
    const response = await loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token)
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to load custom fields')
      setItems([])
      return
    }
    setItems(Array.isArray(response.data) ? response.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const openCreateModal = () => {
    setModalMode('create')
    setEditingField(null)
    setName('')
    setDescription('')
    setType('text')
    setDefaultValueText('')
    setFormError(null)
    setIsModalOpen(true)
  }

  const openEditModal = (field: CustomField) => {
    setModalMode('edit')
    setEditingField(field)
    setName(field.name)
    setDescription(field.description ?? '')
    setType(field.type)
    setDefaultValueText(defaultValueToDraft(field))
    setFormError(null)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingField(null)
    setFormError(null)
  }

  const saveField = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const parsed = parseDefaultValue(type, defaultValueText)
    if (!parsed.ok) {
      setFormError(parsed.error)
      return
    }
    if (parsed.draft) {
      setDefaultValueText(parsed.draft)
    }

    setLoading(true)
    const channel = modalMode === 'edit' ? IPC_CHANNELS.customFields.update : IPC_CHANNELS.customFields.create
    const response = await invokeBridge(channel, {
      actorToken: token,
      ...(modalMode === 'edit' ? { id: editingField?.id } : {}),
      name: name.trim(),
      type,
      description: description.trim(),
      ...(Object.prototype.hasOwnProperty.call(parsed, 'value') ? { defaultValue: parsed.value } : {})
    })
    setLoading(false)
    if (!response.ok) {
      setFormError(response.error?.message ?? `Unable to ${modalMode === 'edit' ? 'update' : 'create'} custom field`)
      return
    }
    closeModal()
    await refresh()
  }

  const removeField = async () => {
    if (!deleteField) return
    setLoading(true)
    const response = await invokeBridge(IPC_CHANNELS.customFields.remove, {
      actorToken: token,
      id: deleteField.id
    })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete custom field')
      return
    }
    setDeleteField(null)
    await refresh()
  }

  const startTableDrag = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, [role="button"]')) return
    if (!tableRef.current) return
    dragScrollRef.current = {
      active: true,
      startX: event.pageX,
      scrollLeft: tableRef.current.scrollLeft
    }
    tableRef.current.classList.add(styles.dragging)
  }

  const moveTableDrag = (event: MouseEvent<HTMLElement>) => {
    if (!dragScrollRef.current.active || !tableRef.current) return
    event.preventDefault()
    const delta = event.pageX - dragScrollRef.current.startX
    tableRef.current.scrollLeft = dragScrollRef.current.scrollLeft - delta
  }

  const endTableDrag = () => {
    dragScrollRef.current.active = false
    tableRef.current?.classList.remove(styles.dragging)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Custom fields</h1>
          <p>{items.length} custom fields configured.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openCreateModal} disabled={loading}>
          <LuPlus size={16} />
          Add field
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section
        ref={tableRef}
        className={styles.tableCard}
        onMouseDown={startTableDrag}
        onMouseMove={moveTableDrag}
        onMouseUp={endTableDrag}
        onMouseLeave={endTableDrag}
      >
        <div className={styles.tableHead}>
          <span>Field</span>
          <span>Description</span>
          <span>Type</span>
          <span>Default value</span>
          <span>Preview</span>
          <span>Actions</span>
        </div>
        {items.length > 0 ? items.map((item) => (
          <div key={item.id} className={styles.tableRow}>
            <span className={styles.fieldName}>{item.name}</span>
            <span className={styles.descriptionCell}>{item.description || 'No description.'}</span>
            <span>
              <span className={`${styles.typePill} ${styles[`type_${item.type}`]}`}>
                {item.type}
              </span>
            </span>
            <span className={styles.configCell}>{defaultValueSnippet(item.defaultValue)}</span>
            <span className={styles.previewCell}>{previewForType(item.type)}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => setPreviewField(item)} aria-label={`Preview ${item.name}`}>
                <LuEye size={15} />
              </button>
              <button type="button" className={styles.iconButton} onClick={() => openEditModal(item)} aria-label={`Edit ${item.name}`}>
                <LuPencil size={15} />
              </button>
              <button type="button" className={`${styles.textIconButton} ${styles.dangerIconButton}`} onClick={() => setDeleteField(item)} aria-label={`Delete ${item.name}`}>
                <LuTrash2 size={15} />
                Delete
              </button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading custom fields...' : 'No custom fields configured.'}</div>
        )}
      </section>

      {isModalOpen ? (
        <>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <section className={styles.fieldModal} role="dialog" aria-modal="true" aria-label={modalMode === 'edit' ? 'Edit custom field' : 'Add custom field'}>
            <header className={styles.modalHeader}>
              <h2>{modalMode === 'edit' ? 'Edit field' : 'Add field'}</h2>
              <button type="button" onClick={closeModal} aria-label="Close custom field modal">
                <LuX size={16} />
              </button>
            </header>
            <form className={styles.fieldForm} onSubmit={saveField}>
              {formError ? <p className={styles.formError}>{formError}</p> : null}
              <label>
                <span>Field name *</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Impact score"
                  required
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="Explain when and how this field should be used."
                />
              </label>
              <label>
                <span>Type</span>
                <AppSelect
                  mode="single"
                  value={TYPE_OPTIONS.find((option) => option.value === type) ?? TYPE_OPTIONS[0]}
                  options={TYPE_OPTIONS}
                  onChange={(value) => {
                    if (value?.value === 'text' || value?.value === 'number' || value?.value === 'boolean' || value?.value === 'json') {
                      setType(value.value)
                      setDefaultValueText('')
                    }
                  }}
                />
              </label>
              <label>
                <span>Default value</span>
                {type === 'boolean' ? (
                  <AppSelect
                    mode="single"
                    value={defaultValueText === 'true' ? { label: 'True', value: 'true' } : defaultValueText === 'false' ? { label: 'False', value: 'false' } : null}
                    options={[{ label: 'True', value: 'true' }, { label: 'False', value: 'false' }]}
                    onChange={(value) => setDefaultValueText(value?.value ?? 'false')}
                    isClearable
                    placeholder="No default"
                  />
                ) : (
                  <textarea
                    value={defaultValueText}
                    onChange={(event) => setDefaultValueText(event.target.value)}
                    rows={type === 'json' ? 5 : 3}
                    placeholder={type === 'json' ? '{ "value": true }' : 'Optional default value'}
                  />
                )}
              </label>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={closeModal}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={loading || !name.trim()}>
                  {modalMode === 'edit' ? 'Save changes' : 'Add field'}
                </button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {previewField ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setPreviewField(null)} />
          <section className={styles.fieldModal} role="dialog" aria-modal="true" aria-label={`Preview ${previewField.name}`}>
            <header className={styles.modalHeader}>
              <h2>Field preview</h2>
              <button type="button" onClick={() => setPreviewField(null)} aria-label="Close preview modal">
                <LuX size={16} />
              </button>
            </header>
            <div className={styles.previewModalBody}>
              <div className={styles.previewTitleRow}>
                <div>
                  <h3>{previewField.name}</h3>
                  <p>{previewField.description || 'No description.'}</p>
                </div>
                <span className={`${styles.typePill} ${styles[`type_${previewField.type}`]}`}>{previewField.type}</span>
              </div>
              <div className={styles.previewBlock}>
                <span>Default value</span>
                <pre>{defaultValueSnippet(previewField.defaultValue)}</pre>
              </div>
              <div className={styles.previewBlock}>
                <span>Preview</span>
                <strong>{previewForType(previewField.type)}</strong>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {deleteField ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteField(null)} />
          <section className={`${styles.fieldModal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-label={`Delete ${deleteField.name}`}>
            <header className={styles.modalHeader}>
              <h2>Delete custom field</h2>
              <button type="button" onClick={() => setDeleteField(null)} aria-label="Close delete modal">
                <LuX size={16} />
              </button>
            </header>
            <div className={styles.confirmBody}>
              <p>Are you sure you want to delete <strong>{deleteField.name}</strong>? Existing task and subtask values for this field will be removed.</p>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setDeleteField(null)}>Cancel</button>
                <button type="button" className={styles.dangerButton} onClick={() => void removeField()} disabled={loading}>Delete</button>
              </footer>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
