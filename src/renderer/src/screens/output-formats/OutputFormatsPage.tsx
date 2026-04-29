import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { LuCheck, LuChevronRight, LuPencil, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { AgentOutputFormatField, OutputFormat } from '@shared/types/entities'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import styles from './OutputFormatsPage.module.scss'

const FIELD_TYPES: NonNullable<AgentOutputFormatField['valueType']>[] = ['string', 'number', 'boolean', 'array']
const AUTOSAVE_DELAY_MS = 700

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed'

interface FieldNode {
  field: AgentOutputFormatField
  depth: number
  parentId: string | null
}

function createField(index: number): AgentOutputFormatField {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${index}`,
    key: '',
    description: '',
    defaultValue: '',
    valueType: 'string',
    required: false,
    children: []
  }
}

function normalizeFields(fields: AgentOutputFormatField[]): AgentOutputFormatField[] {
  return fields
    .map((field) => ({
      ...field,
      key: field.key.trim(),
      description: field.description.trim(),
      defaultValue: field.defaultValue?.trim() ?? '',
      valueType: FIELD_TYPES.includes(field.valueType ?? 'string') ? field.valueType ?? 'string' : 'string',
      children: normalizeFields(field.children ?? [])
    }))
    .filter((field) => field.key || field.description || field.defaultValue || field.children.length)
}

function fieldCount(fields: AgentOutputFormatField[]): number {
  return fields.reduce((count, field) => count + 1 + fieldCount(field.children ?? []), 0)
}

function flattenFields(fields: AgentOutputFormatField[], depth = 0, parentId: string | null = null): FieldNode[] {
  return fields.flatMap((field) => [
    { field, depth, parentId },
    ...flattenFields(field.children ?? [], depth + 1, field.id)
  ])
}

function findField(fields: AgentOutputFormatField[], id: string | null): AgentOutputFormatField | null {
  if (!id) return null
  for (const field of fields) {
    if (field.id === id) return field
    const child = findField(field.children ?? [], id)
    if (child) return child
  }
  return null
}

function fieldsToObject(fields: AgentOutputFormatField[]): Record<string, unknown> {
  return normalizeFields(fields).reduce<Record<string, unknown>>((acc, field) => {
    acc[field.key] = previewValue(field)
    return acc
  }, {})
}

function previewValue(field: AgentOutputFormatField): unknown {
  const valueType = field.valueType ?? 'string'
  if (field.children?.length) {
    const childObject = fieldsToObject(field.children)
    return valueType === 'array' ? [childObject] : childObject
  }
  if (field.defaultValue) {
    if (valueType === 'number') {
      const numericValue = Number(field.defaultValue)
      return Number.isFinite(numericValue) ? numericValue : field.defaultValue
    }
    if (valueType === 'boolean') return field.defaultValue === 'true'
    if (valueType === 'array') return field.defaultValue.split(',').map((item) => item.trim()).filter(Boolean)
    return field.defaultValue
  }
  if (valueType === 'number') return field.description || 0
  if (valueType === 'boolean') return field.description || false
  if (valueType === 'array') return []
  return field.description
}

function jsonPreview(fields: AgentOutputFormatField[]) {
  return JSON.stringify(fieldsToObject(fields), null, 2)
}

function yamlPreview(fields: AgentOutputFormatField[], depth = 0): string {
  const rows = normalizeFields(fields)
  return rows.length > 0
    ? rows.map((field) => {
      const indent = '  '.repeat(depth)
      if (field.children.length > 0) {
        if (field.valueType === 'array') return `${indent}${field.key}:\n${indent}  -\n${yamlPreview(field.children, depth + 2)}`
        return `${indent}${field.key}:\n${yamlPreview(field.children, depth + 1)}`
      }
      const value = previewValue(field)
      if (Array.isArray(value)) {
        if (value.length === 0) return `${indent}${field.key}: []`
        return `${indent}${field.key}:\n${value.map((item) => `${indent}  - "${item}"`).join('\n')}`
      }
      if (typeof value === 'object' && value !== null) return `${indent}${field.key}: {}`
      if (typeof value === 'number' || typeof value === 'boolean') return `${indent}${field.key}: ${value}`
      return `${indent}${field.key}: "${value}"`
    }).join('\n')
    : ''
}

function updateFieldTree(fields: AgentOutputFormatField[], id: string, patch: Partial<AgentOutputFormatField>): AgentOutputFormatField[] {
  return fields.map((field) => field.id === id
    ? { ...field, ...patch }
    : { ...field, children: updateFieldTree(field.children ?? [], id, patch) })
}

function addChildFieldTree(fields: AgentOutputFormatField[], id: string, child: AgentOutputFormatField): AgentOutputFormatField[] {
  return fields.map((field) => field.id === id
    ? { ...field, children: [...(field.children ?? []), child] }
    : { ...field, children: addChildFieldTree(field.children ?? [], id, child) })
}

function removeFieldTree(fields: AgentOutputFormatField[], id: string): AgentOutputFormatField[] {
  return fields
    .filter((field) => field.id !== id)
    .map((field) => ({ ...field, children: removeFieldTree(field.children ?? [], id) }))
}

function validateFields(fields: AgentOutputFormatField[], path = 'root'): string | null {
  const seen = new Set<string>()
  for (const field of fields) {
    if (!field.key && (field.description || field.defaultValue || field.children?.length)) {
      return 'Output format key is required when description, default value, or child fields are provided.'
    }
    if (field.key) {
      if (seen.has(field.key)) return `Duplicate output format key at ${path}: ${field.key}`
      seen.add(field.key)
    }
    const childError = validateFields(field.children ?? [], field.key || path)
    if (childError) return childError
  }
  return null
}

export function OutputFormatsPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<OutputFormat[]>([])
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editingFormat, setEditingFormat] = useState<OutputFormat | null>(null)
  const [deleteFormat, setDeleteFormat] = useState<OutputFormat | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<AgentOutputFormatField[]>([])
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const tableRef = useRef<HTMLElement | null>(null)
  const dragScrollRef = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDraftRef = useRef({ name: '', description: '', fields: [] as AgentOutputFormatField[] })
  const autosaveReadyRef = useRef(false)

  const fieldNodes = useMemo(() => flattenFields(fields), [fields])
  const selectedField = useMemo(() => findField(fields, selectedFieldId), [fields, selectedFieldId])

  const refresh = async () => {
    setLoading(true)
    const response = await loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token)
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to load output formats')
      setItems([])
      return
    }
    setItems(Array.isArray(response.data) ? response.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  useEffect(() => {
    latestDraftRef.current = { name, description, fields }
    if (!editingFormat || !autosaveReadyRef.current) return
    setSaveState('dirty')
    setSaveError(null)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveDraft()
    }, AUTOSAVE_DELAY_MS)
  }, [name, description, fields, editingFormat])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  const openBuilder = (format: OutputFormat) => {
    autosaveReadyRef.current = false
    setEditingFormat(format)
    setName(format.name)
    setDescription(format.description ?? '')
    setFields(format.fields ?? [])
    setSelectedFieldId(format.fields?.[0]?.id ?? null)
    setFormError(null)
    setSaveError(null)
    setSaveState('saved')
    latestDraftRef.current = { name: format.name, description: format.description ?? '', fields: format.fields ?? [] }
    window.setTimeout(() => {
      autosaveReadyRef.current = true
    }, 0)
  }

  const openCreate = async () => {
    setLoading(true)
    const response = await invokeBridge<OutputFormat>(IPC_CHANNELS.outputFormats.create, {
      actorToken: token,
      name: `Output format ${items.length + 1}`,
      description: undefined,
      fields: []
    })
    setLoading(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to create output format')
      return
    }
    setItems((current) => [response.data!, ...current])
    openBuilder(response.data)
  }

  const saveDraft = async () => {
    if (!editingFormat) return
    const draft = latestDraftRef.current
    if (!draft.name.trim()) {
      setSaveState('failed')
      setSaveError('Output format name is required.')
      return
    }
    const normalized = normalizeFields(draft.fields)
    const validationError = validateFields(normalized)
    if (validationError) {
      setSaveState('failed')
      setSaveError(validationError)
      return
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setSaveState('saving')
    const response = await invokeBridge<OutputFormat>(IPC_CHANNELS.outputFormats.update, {
      actorToken: token,
      id: editingFormat.id,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      fields: normalized
    })
    if (!response.ok || !response.data) {
      setSaveState('failed')
      setSaveError(response.error?.message ?? 'Unable to save output format')
      return
    }
    setEditingFormat(response.data)
    setItems((current) => current.map((item) => item.id === response.data!.id ? response.data! : item))
    setSaveState('saved')
    setSaveError(null)
  }

  const closeBuilder = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (editingFormat && saveState === 'dirty') void saveDraft()
    autosaveReadyRef.current = false
    setEditingFormat(null)
    setSelectedFieldId(null)
    setFormError(null)
    setSaveError(null)
    setSaveState('idle')
  }

  const updateField = (id: string, patch: Partial<AgentOutputFormatField>) => {
    setFields((current) => updateFieldTree(current, id, patch))
  }

  const addRootField = () => {
    const field = createField(fields.length)
    setFields((current) => [...current, field])
    setSelectedFieldId(field.id)
  }

  const addChildField = (parentId: string) => {
    const parent = findField(fields, parentId)
    const child = createField(parent?.children?.length ?? 0)
    setFields((current) => addChildFieldTree(current, parentId, child))
    setSelectedFieldId(child.id)
  }

  const removeField = (id: string) => {
    setFields((current) => removeFieldTree(current, id))
    if (selectedFieldId === id) setSelectedFieldId(null)
  }

  const removeFormat = async () => {
    if (!deleteFormat) return
    setLoading(true)
    const response = await invokeBridge(IPC_CHANNELS.outputFormats.remove, {
      actorToken: token,
      id: deleteFormat.id
    })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete output format')
      return
    }
    if (editingFormat?.id === deleteFormat.id) closeBuilder()
    setItems((current) => current.filter((item) => item.id !== deleteFormat.id))
    setDeleteFormat(null)
  }

  const startTableDrag = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, [role="button"]')) return
    if (!tableRef.current) return
    dragScrollRef.current = { active: true, startX: event.pageX, scrollLeft: tableRef.current.scrollLeft }
    tableRef.current.classList.add(styles.dragging)
  }

  const moveTableDrag = (event: MouseEvent<HTMLElement>) => {
    if (!dragScrollRef.current.active || !tableRef.current) return
    event.preventDefault()
    tableRef.current.scrollLeft = dragScrollRef.current.scrollLeft - (event.pageX - dragScrollRef.current.startX)
  }

  const endTableDrag = () => {
    dragScrollRef.current.active = false
    tableRef.current?.classList.remove(styles.dragging)
  }

  const saveLabel = saveState === 'saving' ? 'Saving...' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'failed' ? 'Save failed' : saveState === 'saved' ? 'Saved' : 'Ready'

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Output formats</h1>
          <p>{items.length} output formats configured.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={() => void openCreate()} disabled={loading}>
          <LuPlus size={16} />
          Add format
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      {editingFormat ? (
        <section className={styles.builderShell}>
          <header className={styles.builderHeader}>
            <div>
              <span className={styles.eyebrow}>Schema builder</span>
              <input className={styles.builderTitleInput} value={name} onChange={(event) => setName(event.target.value)} placeholder="Output format name" />
              <input className={styles.builderDescriptionInput} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" />
            </div>
            <div className={styles.builderActions}>
              <span className={`${styles.saveStatus} ${styles[saveState]}`}>
                {saveState === 'saved' ? <LuCheck size={14} /> : null}
                {saveLabel}
              </span>
              <button type="button" className={styles.secondaryButton} onClick={closeBuilder}>Close builder</button>
            </div>
          </header>
          {saveError ? <p className={styles.formError}>{saveError}</p> : null}
          {formError ? <p className={styles.formError}>{formError}</p> : null}

          <div className={styles.builderGrid}>
            <aside className={styles.treePanel}>
              <header>
                <div>
                  <h2>Field tree</h2>
                  <p>{fieldCount(fields)} fields</p>
                </div>
                <button type="button" className={styles.compactButton} onClick={addRootField}>
                  <LuPlus size={14} />
                  Root
                </button>
              </header>
              <div className={styles.treeList}>
                {fieldNodes.length > 0 ? fieldNodes.map(({ field, depth }) => {
                  const cappedDepth = Math.min(depth, 4)
                  return (
                    <button
                      key={field.id}
                      type="button"
                      className={`${styles.treeNode} ${selectedFieldId === field.id ? styles.selectedNode : ''}`}
                      style={{ '--level': cappedDepth } as React.CSSProperties}
                      onClick={() => setSelectedFieldId(field.id)}
                    >
                      <span className={styles.levelBadge}>L{depth + 1}</span>
                      <span className={styles.nodeMain}>
                        <strong>{field.key || 'Untitled field'}</strong>
                        <small>{field.valueType ?? 'string'}{field.required ? ' / required' : ''}</small>
                      </span>
                      {field.children?.length ? <span className={styles.childCount}>{field.children.length}</span> : null}
                      <LuChevronRight size={15} />
                    </button>
                  )
                }) : <p className={styles.emptyFields}>No fields yet. Add a root field to start.</p>}
              </div>
            </aside>

            <section className={styles.detailPanel}>
              {selectedField ? (
                <>
                  <header className={styles.detailHeader}>
                    <div>
                      <span className={styles.eyebrow}>Selected field</span>
                      <h2>{selectedField.key || 'Untitled field'}</h2>
                    </div>
                    <div className={styles.detailActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => addChildField(selectedField.id)}>
                        <LuPlus size={14} />
                        Add child
                      </button>
                      <button type="button" className={`${styles.iconButton} ${styles.dangerIconButton}`} onClick={() => removeField(selectedField.id)} aria-label={`Remove ${selectedField.key || 'field'}`}>
                        <LuTrash2 size={15} />
                      </button>
                    </div>
                  </header>
                  <div className={styles.fieldEditorGrid}>
                    <label><span>Key *</span><input value={selectedField.key} onChange={(event) => updateField(selectedField.id, { key: event.target.value })} placeholder="summary" /></label>
                    <label><span>Type</span><select value={selectedField.valueType ?? 'string'} onChange={(event) => updateField(selectedField.id, { valueType: event.target.value as AgentOutputFormatField['valueType'] })}>{FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                    <label>
                      <span>Default value</span>
                      <input
                        value={selectedField.defaultValue ?? ''}
                        onChange={(event) => updateField(selectedField.id, { defaultValue: event.target.value })}
                        placeholder={selectedField.children?.length ? 'Locked while nested fields exist' : 'Optional'}
                        disabled={Boolean(selectedField.children?.length)}
                      />
                    </label>
                    <label className={styles.requiredToggle}><input type="checkbox" checked={Boolean(selectedField.required)} onChange={(event) => updateField(selectedField.id, { required: event.target.checked })} /> Required field</label>
                    <label className={styles.fullSpan}><span>Description</span><textarea value={selectedField.description} onChange={(event) => updateField(selectedField.id, { description: event.target.value })} placeholder="Explain what this value should contain" /></label>
                  </div>
                  {selectedField.valueType === 'array' || selectedField.children?.length ? (
                    <button type="button" className={styles.addNestedCallout} onClick={() => addChildField(selectedField.id)}>
                      <LuPlus size={15} />
                      Add nested field inside this {selectedField.children?.length && selectedField.valueType !== 'array' ? 'object' : selectedField.valueType}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className={styles.emptyDetail}>
                  <h2>Select a field or add root field</h2>
                  <p>Use the tree to edit nested schema fields without horizontal drift.</p>
                  <button type="button" className={styles.primaryButton} onClick={addRootField}>
                    <LuPlus size={16} />
                    Add root field
                  </button>
                </div>
              )}

              <div className={styles.previewGrid}>
                <pre>{jsonPreview(fields) || '{ }'}</pre>
                <pre>{yamlPreview(fields) || '# YAML preview'}</pre>
              </div>
            </section>
          </div>
        </section>
      ) : null}

      <section ref={tableRef} className={styles.tableCard} onMouseDown={startTableDrag} onMouseMove={moveTableDrag} onMouseUp={endTableDrag} onMouseLeave={endTableDrag}>
        <div className={styles.tableHead}>
          <span>Format</span>
          <span>Description</span>
          <span>Fields</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {items.length > 0 ? items.map((item) => (
          <div key={item.id} className={styles.tableRow}>
            <span className={styles.formatName}>{item.name}</span>
            <span className={styles.descriptionCell}>{item.description || 'No description.'}</span>
            <span className={styles.fieldChips}>
              {item.fields.length > 0 ? item.fields.slice(0, 2).map((field) => <span key={field.id}>{field.key}</span>) : <em>No fields</em>}
              {fieldCount(item.fields) > 2 ? <span>+{fieldCount(item.fields) - 2}</span> : null}
            </span>
            <span className={styles.mutedCell}>{new Date(item.updatedAt).toLocaleDateString()}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => openBuilder(item)} aria-label={`Edit ${item.name}`}><LuPencil size={15} /></button>
              <button type="button" className={`${styles.iconButton} ${styles.dangerIconButton}`} onClick={() => setDeleteFormat(item)} aria-label={`Delete ${item.name}`}><LuTrash2 size={15} /></button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading output formats...' : 'No output formats configured.'}</div>
        )}
      </section>

      {deleteFormat ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteFormat(null)} />
          <section className={`${styles.formatModal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-label={`Delete ${deleteFormat.name}`}>
            <header className={styles.modalHeader}>
              <h2>Delete output format</h2>
              <button type="button" onClick={() => setDeleteFormat(null)} aria-label="Close delete modal"><LuX size={16} /></button>
            </header>
            <div className={styles.confirmBody}>
              <p>Are you sure you want to delete <strong>{deleteFormat.name}</strong>?</p>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setDeleteFormat(null)}>Cancel</button>
                <button type="button" className={styles.dangerButton} onClick={() => void removeFormat()} disabled={loading}>Delete</button>
              </footer>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
