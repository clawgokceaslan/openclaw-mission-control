import { CSSProperties, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { LuCheck, LuChevronRight, LuDownload, LuFileText, LuPencil, LuPlus, LuSave, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { AgentOutputFormatField, OutputFormat } from '@shared/types/entities'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import styles from './OutputFormatsPage.module.scss'

const FIELD_TYPES: NonNullable<AgentOutputFormatField['valueType']>[] = ['string', 'number', 'boolean', 'array', 'enum']
const AUTOSAVE_DELAY_MS = 700
const FORMAT_ROLES: OutputFormat['formatRole'][] = ['input', 'output']

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'draft'

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

function normalizeFormatRole(value: unknown): OutputFormat['formatRole'] {
  return value === 'input' ? 'input' : 'output'
}

function normalizeFields(fields: AgentOutputFormatField[]): AgentOutputFormatField[] {
  return fields
    .map((field) => ({
      ...field,
      key: field.key.trim(),
      description: field.description.trim(),
      defaultValue: field.defaultValue?.trim() ?? '',
      valueType: FIELD_TYPES.includes(field.valueType ?? 'string') ? field.valueType ?? 'string' : 'string',
      enumValues: (field.enumValues ?? []).map((value) => value.trim()).filter(Boolean),
      children: normalizeFields(field.children ?? [])
    }))
    .filter((field) => field.key || field.description || field.defaultValue || field.enumValues?.length || field.children.length)
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
    if (valueType === 'enum') {
      const enumValues = field.enumValues ?? []
      return enumValues.includes(field.defaultValue) ? field.defaultValue : enumValues[0] ?? field.defaultValue
    }
    return field.defaultValue
  }
  if (valueType === 'enum') return field.enumValues?.[0] ?? field.description
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

type ExportFormat = 'json' | 'yaml'

function sampleValue(field: AgentOutputFormatField): unknown {
  const children = field.children ?? []
  if (children.length > 0) {
    const childObject = fieldsToSampleObject(children)
    return field.valueType === 'array' ? [childObject] : childObject
  }

  const defaultValue = field.defaultValue?.trim() ?? ''
  const description = field.description?.trim() ?? ''
  const valueType = field.valueType ?? 'string'
  if (valueType === 'enum') {
    const enumValues = field.enumValues ?? []
    return defaultValue && enumValues.includes(defaultValue) ? defaultValue : enumValues[0] ?? ''
  }
  if (defaultValue) {
    if (valueType === 'number') {
      const numericValue = Number(defaultValue)
      return Number.isFinite(numericValue) ? numericValue : defaultValue
    }
    if (valueType === 'boolean') return defaultValue === 'true'
    if (valueType === 'array') return defaultValue.split(',').map((item) => item.trim()).filter(Boolean)
    return defaultValue
  }
  if (description) return description
  if (valueType === 'number') return 0
  if (valueType === 'boolean') return false
  if (valueType === 'array') return []
  return ''
}

function fieldsToSampleObject(fields: AgentOutputFormatField[]): Record<string, unknown> {
  return normalizeFields(fields).reduce<Record<string, unknown>>((acc, field) => {
    if (field.key) acc[field.key] = sampleValue(field)
    return acc
  }, {})
}

function markdownCell(value: unknown): string {
  const text = String(value ?? '').trim()
  return text ? text.replace(/\|/g, '\\|').replace(/\n/g, '<br>') : '-'
}

function flattenFieldRows(fields: AgentOutputFormatField[], prefix = ''): Array<{ path: string; field: AgentOutputFormatField; sample: unknown }> {
  return normalizeFields(fields).flatMap((field) => {
    const path = prefix ? `${prefix}.${field.key || 'untitled'}` : field.key || 'untitled'
    return [
      { path, field, sample: sampleValue(field) },
      ...flattenFieldRows(field.children ?? [], path)
    ]
  })
}

function buildInstructionsMarkdown(format: Pick<OutputFormat, 'name' | 'description' | 'formatRole' | 'fields'>): string {
  const rows = flattenFieldRows(format.fields)
  const role = normalizeFormatRole(format.formatRole)
  const contractRows = rows.length > 0
    ? rows.map(({ path, field, sample }) => `| ${markdownCell(path)} | ${markdownCell(field.valueType ?? 'string')} | ${field.required ? 'yes' : 'no'} | ${markdownCell((field.enumValues ?? []).join(', '))} | ${markdownCell(typeof sample === 'object' ? JSON.stringify(sample) : sample)} | ${markdownCell(field.description)} |`).join('\n')
    : '| - | - | no | - | - | - |'

  return `# ${role === 'input' ? 'Input' : 'Output'} Data Format Instructions: ${format.name}

## Metadata
| Field | Value |
| --- | --- |
| Name | ${markdownCell(format.name)} |
| Description | ${markdownCell(format.description)} |
| Type | ${role}-data-format |

## Generation Rules
- ${role === 'input' ? 'Read and validate incoming data matching this format.' : 'Return only valid data matching the sample file format.'}
- Do not include Markdown fences or explanations.
- Include all required fields.
- Use only allowed values for enum fields.
- Preserve the sample file structure and field keys.

## Field Contract
| Path | Type | Required | Allowed Values | Default/Sample | Description |
| --- | --- | --- | --- | --- | --- |
${contractRows}
`
}

function toYamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(String(value))
}

function toYaml(value: unknown, indent = 0): string {
  const padding = '  '.repeat(indent)
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return `${padding}${toYamlValue(value)}`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${padding}[]`
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          return `${padding}-\n${toYaml(item, indent + 1)}`
        }
        return `${padding}- ${toYamlValue(item)}`
      })
      .join('\n')
  }
  const objectEntries = Object.entries(value as Record<string, unknown>)
  if (objectEntries.length === 0) return `${padding}{}`
  return objectEntries
    .map(([key, fieldValue]) => {
      if (fieldValue === null || ['string', 'number', 'boolean'].includes(typeof fieldValue)) {
        return `${padding}${key}: ${toYamlValue(fieldValue)}`
      }
      if (Array.isArray(fieldValue) && fieldValue.length === 0) {
        return `${padding}${key}: []`
      }
      return `${padding}${key}:\n${toYaml(fieldValue, indent + 1)}`
    })
    .join('\n')
}

function toDownloadFileName(value: string, extension: string) {
  const safe = value.toLowerCase().trim().replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return `${safe || 'output-format'}-output-format.${extension}`
}

function toSafeFileBase(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'output-format'
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
      return 'Data format key is required when description, default value, or child fields are provided.'
    }
    if (field.key) {
      if (seen.has(field.key)) return `Duplicate data format key at ${path}: ${field.key}`
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
  const [isCreatingFormat, setIsCreatingFormat] = useState(false)
  const [deleteFormat, setDeleteFormat] = useState<OutputFormat | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [formatRole, setFormatRole] = useState<OutputFormat['formatRole']>('output')
  const [fields, setFields] = useState<AgentOutputFormatField[]>([])
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draftWarning, setDraftWarning] = useState<string | null>(null)
  const [closeNotice, setCloseNotice] = useState<string | null>(null)
  const [exportTarget, setExportTarget] = useState<OutputFormat | null>(null)
  const [instructionsTarget, setInstructionsTarget] = useState<OutputFormat | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json')
  const tableRef = useRef<HTMLElement | null>(null)
  const formatModalRef = useRef<HTMLElement | null>(null)
  const dragScrollRef = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveQueuedRef = useRef(false)
  const latestDraftRef = useRef({ name: '', description: '', formatRole: 'output' as OutputFormat['formatRole'], fields: [] as AgentOutputFormatField[] })
  const autosaveReadyRef = useRef(false)
  const saveTaskRef = useRef<Promise<boolean> | null>(null)

  const fieldNodes = useMemo(() => flattenFields(fields), [fields])
  const selectedField = useMemo(() => findField(fields, selectedFieldId), [fields, selectedFieldId])
  const readDraftSnapshot = () => ({
    ...latestDraftRef.current,
    fields
  })

  const setDraftName = (value: string) => {
    latestDraftRef.current = { ...latestDraftRef.current, name: value }
    setName(value)
  }

  const setDraftDescription = (value: string) => {
    latestDraftRef.current = { ...latestDraftRef.current, description: value }
    setDescription(value)
  }

  const setDraftFormatRole = (value: OutputFormat['formatRole']) => {
    latestDraftRef.current = { ...latestDraftRef.current, formatRole: value }
    setFormatRole(value)
  }

  const refresh = async () => {
    setLoading(true)
    const response = await loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token)
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to load data formats')
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
    latestDraftRef.current = { name, description, formatRole, fields }
    if (!editingFormat || !autosaveReadyRef.current) return
    setSaveState('dirty')
    setSaveError(null)
    setDraftWarning(null)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveDraft()
    }, AUTOSAVE_DELAY_MS)
  }, [name, description, formatRole, fields])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (closeNoticeTimerRef.current) clearTimeout(closeNoticeTimerRef.current)
  }, [])

  const showCloseNotice = (message: string) => {
    if (closeNoticeTimerRef.current) clearTimeout(closeNoticeTimerRef.current)
    setCloseNotice(message)
    closeNoticeTimerRef.current = setTimeout(() => {
      setCloseNotice(null)
    }, 3000)
  }

  const openBuilder = (format: OutputFormat) => {
    autosaveReadyRef.current = false
    setIsCreatingFormat(false)
    setEditingFormat(format)
    setDraftName(format.name)
    setDraftDescription(format.description ?? '')
    setDraftFormatRole(normalizeFormatRole(format.formatRole))
    setFields(format.fields ?? [])
    setSelectedFieldId(format.fields?.[0]?.id ?? null)
    setFormError(null)
    setSaveError(null)
    setDraftWarning(null)
    setSaveState('saved')
    latestDraftRef.current = { name: format.name, description: format.description ?? '', formatRole: normalizeFormatRole(format.formatRole), fields: format.fields ?? [] }
    window.setTimeout(() => {
      autosaveReadyRef.current = true
      formatModalRef.current?.focus()
    }, 0)
  }

  const openCreate = () => {
    autosaveReadyRef.current = false
    setEditingFormat(null)
    setIsCreatingFormat(true)
    setDraftName('')
    setDraftDescription('')
    setDraftFormatRole('output')
    setFields([])
    setSelectedFieldId(null)
    setFormError(null)
    setSaveError(null)
    setDraftWarning(null)
    setSaveState('draft')
    latestDraftRef.current = { name: '', description: '', formatRole: 'output', fields: [] }
    window.setTimeout(() => {
      formatModalRef.current?.focus()
    }, 0)
  }

  const createFormat = async (): Promise<boolean> => {
    const draft = readDraftSnapshot()
    if (!draft.name.trim()) {
      setSaveState('failed')
      setSaveError('Data format name is required.')
      setDraftWarning(null)
      return false
    }

    const normalized = normalizeFields(draft.fields)
    const validationError = validateFields(normalized)
    setDraftWarning(validationError ? `Saved as draft: ${validationError}` : null)
    setSaveState('saving')
    setSaveError(null)

    try {
      const response = await invokeBridge<OutputFormat>(IPC_CHANNELS.outputFormats.create, {
        actorToken: token,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        formatRole: draft.formatRole,
        fields: normalized
      })
      if (!response.ok || !response.data) {
        setSaveState('failed')
        setSaveError(response.error?.message ?? 'Unable to create data format')
        return false
      }

      setItems((current) => [response.data!, ...current])
      setIsCreatingFormat(false)
      openBuilder(response.data)
      setSaveState(validationError ? 'draft' : 'saved')
      setSaveError(null)
      return true
    } catch {
      setSaveState('failed')
      setSaveError('Unable to create data format')
      return false
    }
  }

  const persistFormat = async (): Promise<boolean> => {
    if (isCreatingFormat) return createFormat()
    if (!editingFormat) return true
    const draft = readDraftSnapshot()
    if (!draft.name.trim()) {
      setSaveState('failed')
      setSaveError('Data format name is required.')
      setDraftWarning(null)
      return false
    }

    const normalized = normalizeFields(draft.fields)
    const validationError = validateFields(normalized)
    setDraftWarning(validationError ? `Saved as draft: ${validationError}` : null)

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setSaveState('saving')
    setSaveError(null)

    try {
      const response = await invokeBridge<OutputFormat>(IPC_CHANNELS.outputFormats.update, {
        actorToken: token,
        id: editingFormat.id,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        formatRole: draft.formatRole,
        fields: normalized
      })
      if (!response.ok || !response.data) {
        setSaveState('failed')
        setSaveError(response.error?.message ?? 'Unable to save data format')
        return false
      }

      setEditingFormat(response.data)
      setItems((current) => current.map((item) => item.id === response.data!.id ? response.data! : item))
      setSaveState(validationError ? 'draft' : 'saved')
      setSaveError(null)
      return true
    } catch {
      setSaveState('failed')
      setSaveError('Unable to save data format')
      return false
    }
  }

  const saveDraft = async (): Promise<boolean> => {
    if (isCreatingFormat) return createFormat()
    if (!editingFormat) return true

    if (saveTaskRef.current) {
      saveQueuedRef.current = true
      return await saveTaskRef.current
    }

    const task = (async () => {
      let persisted = true
      do {
        saveQueuedRef.current = false
        persisted = await persistFormat()
      } while (saveQueuedRef.current && persisted)
      saveQueuedRef.current = false
      return persisted
    })()

    saveTaskRef.current = task
    const result = await task
    saveTaskRef.current = null
    return result
  }

  const requestCloseBuilder = async (forceClose = false) => {
    if (isCreatingFormat) {
      autosaveReadyRef.current = false
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      setEditingFormat(null)
      setIsCreatingFormat(false)
      setFields([])
      setDraftName('')
      setDraftDescription('')
      setDraftFormatRole('output')
      setSelectedFieldId(null)
      setFormError(null)
      setSaveError(null)
      setDraftWarning(null)
      setSaveState('idle')
      return
    }
    const shouldPersist = editingFormat && saveState !== 'idle' && saveState !== 'saved'
    if (shouldPersist) {
      const didPersist = await saveDraft()
      if (!didPersist) {
        const message = saveError ? `Could not save: ${saveError}` : 'Could not save data format before closing.'
        if (!forceClose) return
        showCloseNotice(message)
      }
    }

    autosaveReadyRef.current = false
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setEditingFormat(null)
    setIsCreatingFormat(false)
    setFields([])
    setDraftName('')
    setDraftDescription('')
    setDraftFormatRole('output')
    setSelectedFieldId(null)
    setFormError(null)
    setSaveError(null)
    setDraftWarning(null)
    setSaveState('idle')
  }

  const closeBuilder = () => {
    void requestCloseBuilder(true)
  }

  const handleBuilderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      void requestCloseBuilder(true)
    }
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
    const removedNode = fieldNodes.find((entry) => entry.field.id === id)
    const parentId = removedNode?.parentId ?? null
    const siblingsAtLevel = fieldNodes.filter((entry) => entry.parentId === parentId)
    const removedSiblingIndex = siblingsAtLevel.findIndex((entry) => entry.field.id === id)
    const fallbackSibling =
      removedSiblingIndex > 0
        ? siblingsAtLevel[removedSiblingIndex - 1]?.field.id
        : removedSiblingIndex > -1 && removedSiblingIndex + 1 < siblingsAtLevel.length
          ? siblingsAtLevel[removedSiblingIndex + 1]?.field.id
          : null
    const rootFallback = fieldNodes.find((entry) => entry.parentId === null && entry.field.id !== id)?.field.id ?? null
    const isSelectedInRemovedSubtree = (() => {
      let cursor = selectedFieldId
      while (cursor) {
        if (cursor === id) return true
        const parent = fieldNodes.find((entry) => entry.field.id === cursor)?.parentId ?? null
        if (!parent) return false
        cursor = parent
      }
      return false
    })()

    const nextSelectedId = isSelectedInRemovedSubtree
      ? (parentId && findField(fields, parentId)
        ? parentId
        : fallbackSibling ?? rootFallback)
      : selectedFieldId

    setFields((current) => removeFieldTree(current, id))

    setSelectedFieldId(nextSelectedId)
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
      setError(response.error?.message ?? 'Unable to delete data format')
      return
    }
    if (editingFormat?.id === deleteFormat.id) {
      await requestCloseBuilder(true)
      if (editingFormat?.id === deleteFormat.id) return
    }
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

  const saveLabel = saveState === 'saving'
    ? 'Saving...'
    : saveState === 'dirty'
      ? 'Unsaved changes'
      : saveState === 'failed'
        ? 'Save failed'
        : saveState === 'draft'
          ? 'Saved as draft'
          : saveState === 'saved'
        ? 'Saved'
        : 'Ready'

  const isDraftFormat = (format: OutputFormat) => Boolean(validateFields(format.fields))

  const openExport = (format: OutputFormat) => {
    setExportTarget(format)
    setExportFormat('json')
  }

  const downloadExport = () => {
    if (!exportTarget) return

    try {
      const isJson = exportFormat === 'json'
      const safeBase = toSafeFileBase(exportTarget.name)
      const sampleContent = isJson
        ? JSON.stringify(fieldsToSampleObject(exportTarget.fields), null, 2)
        : toYaml(fieldsToSampleObject(exportTarget.fields))
      const instructionsContent = exportTarget.instructionsMarkdown || buildInstructionsMarkdown(exportTarget)
      const archive = zipSync({
        [`${safeBase}-sample.${isJson ? 'json' : 'yaml'}`]: strToU8(sampleContent),
        [`${safeBase}-instruct.md`]: strToU8(instructionsContent)
      })
      const blob = new Blob([archive], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = toDownloadFileName(exportTarget.name, 'zip')
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setExportTarget(null)
      showCloseNotice(`Downloaded ${exportTarget.name} ZIP.`)
    } catch {
      setError('Unable to export data format')
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Data Formats</h1>
          <p>{items.length} data formats configured.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={() => void openCreate()} disabled={loading}>
          <LuPlus size={16} />
          Add data format
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {closeNotice ? <p className={styles.closeNotice}>{closeNotice}</p> : null}

      {editingFormat || isCreatingFormat ? (
        <>
          <div className={styles.modalBackdrop} onMouseDown={(event) => {
            if (event.target === event.currentTarget) void requestCloseBuilder(true)
          }} />
          <section
            className={`${styles.formatModal} ${styles.formatBuilderModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={isCreatingFormat ? 'Add data format' : `Edit data format ${name}`}
            tabIndex={-1}
            ref={formatModalRef}
            onKeyDown={handleBuilderKeyDown}
          >
            <header className={styles.builderHeader}>
              <div>
                <span className={styles.eyebrow}>{isCreatingFormat ? 'Add data format' : 'Schema builder'}</span>
                <input className={styles.builderTitleInput} value={name} onChange={(event) => setDraftName(event.target.value)} placeholder="Data format name" />
                <textarea className={styles.builderDescriptionInput} value={description} onChange={(event) => setDraftDescription(event.target.value)} placeholder="Optional description" rows={2} />
              </div>
              <div className={styles.builderActions}>
                <div className={styles.roleToggle} aria-label="Data format role">
                  {FORMAT_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={formatRole === role ? styles.roleToggleActive : undefined}
                      onClick={() => setDraftFormatRole(role)}
                    >
                      {role === 'input' ? 'Input' : 'Output'}
                    </button>
                  ))}
                </div>
                <span className={`${styles.saveStatus} ${styles[saveState]}`}>
                  {saveState === 'saved' ? <LuCheck size={14} /> : null}
                  {isCreatingFormat && saveState === 'draft' ? 'Not saved' : saveLabel}
                </span>
                <button type="button" className={styles.primaryButton} onClick={() => void saveDraft()} disabled={saveState === 'saving'}>
                  <LuSave size={14} />
                  {isCreatingFormat ? 'Create' : saveState === 'draft' ? 'Save as draft' : 'Save'}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={closeBuilder}>Close</button>
              </div>
            </header>
            {saveError ? <p className={styles.formError}>{saveError}</p> : null}
            {formError ? <p className={styles.formError}>{formError}</p> : null}

            <div className={styles.formatBuilderBody}>
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
                        <div
                          key={field.id}
                          role="button"
                          tabIndex={0}
                          className={`${styles.treeNode} ${selectedFieldId === field.id ? styles.selectedNode : ''}`}
                          style={{ '--level': cappedDepth } as CSSProperties}
                          onClick={() => setSelectedFieldId(field.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedFieldId(field.id)
                            }
                          }}
                        >
                          <span className={styles.levelBadge}>L{depth + 1}</span>
                          <span className={styles.nodeMain}>
                            <strong>{field.key || 'Untitled field'}</strong>
                            <small>{field.valueType ?? 'string'}{field.required ? ' / required' : ''}</small>
                          </span>
                          {field.children?.length ? <span className={styles.childCount}>{field.children.length}</span> : null}
                          <button
                            type="button"
                            className={styles.treeActionButton}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              removeField(field.id)
                            }}
                            aria-label={`Remove ${field.key || 'field'}`}
                          >
                            <LuTrash2 size={14} />
                          </button>
                          <LuChevronRight size={15} />
                        </div>
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
                        {selectedField.valueType === 'enum' ? (
                          <label className={styles.fullSpan}>
                            <span>Enum values</span>
                            <input
                              value={(selectedField.enumValues ?? []).join(', ')}
                              onChange={(event) => updateField(selectedField.id, { enumValues: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })}
                              placeholder="ready, blocked, done"
                            />
                          </label>
                        ) : null}
                        <label>
                          <span>Default value</span>
                          <input
                            value={selectedField.defaultValue ?? ''}
                            onChange={(event) => updateField(selectedField.id, { defaultValue: event.target.value })}
                            placeholder={selectedField.valueType === 'enum' ? 'Must match one enum value' : selectedField.children?.length ? 'Locked while nested fields exist' : 'Optional'}
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
                    {draftWarning ? <p className={styles.formNotice}>{draftWarning}</p> : null}
                    <pre>{jsonPreview(fields) || '{ }'}</pre>
                    <pre>{yamlPreview(fields) || '# YAML preview'}</pre>
                  </div>
                </section>
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section ref={tableRef} className={styles.tableCard} onMouseDown={startTableDrag} onMouseMove={moveTableDrag} onMouseUp={endTableDrag} onMouseLeave={endTableDrag}>
        <div className={styles.tableHead}>
          <span>Data format</span>
          <span>Description</span>
          <span>Fields</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {items.length > 0 ? items.map((item) => (
          <div key={item.id} className={styles.tableRow}>
            <span className={styles.formatNameContainer}>
              <span className={styles.formatName}>{item.name}</span>
              <span className={`${styles.roleBadge} ${normalizeFormatRole(item.formatRole) === 'input' ? styles.inputRole : styles.outputRole}`}>
                {normalizeFormatRole(item.formatRole) === 'input' ? 'Input' : 'Output'}
              </span>
              {isDraftFormat(item) ? <span className={styles.draftBadge}>Draft</span> : null}
            </span>
            <span className={styles.descriptionCell}>{item.description || 'No description.'}</span>
            <span className={styles.fieldChips}>
              {item.fields.length > 0 ? item.fields.slice(0, 2).map((field) => <span key={field.id}>{field.key}</span>) : <em>No fields</em>}
              {fieldCount(item.fields) > 2 ? <span>+{fieldCount(item.fields) - 2}</span> : null}
            </span>
            <span className={styles.mutedCell}>{new Date(item.updatedAt).toLocaleDateString()}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => openBuilder(item)} aria-label={`Edit ${item.name}`}><LuPencil size={15} /></button>
              <button type="button" className={styles.iconButton} onClick={() => setInstructionsTarget(item)} aria-label={`View instructions for ${item.name}`}><LuFileText size={15} /></button>
              <button type="button" className={styles.iconButton} onClick={() => openExport(item)} aria-label={`Export ${item.name}`}><LuDownload size={15} /></button>
              <button type="button" className={`${styles.iconButton} ${styles.dangerIconButton}`} onClick={() => setDeleteFormat(item)} aria-label={`Delete ${item.name}`}><LuTrash2 size={15} /></button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading data formats...' : 'No data formats configured.'}</div>
        )}
      </section>

      {deleteFormat ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteFormat(null)} />
          <section className={`${styles.formatModal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-label={`Delete ${deleteFormat.name}`}>
            <header className={styles.modalHeader}>
              <h2>Delete data format</h2>
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

      {exportTarget ? (
        <>
          <div
            className={styles.modalBackdrop}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setExportTarget(null)
            }}
          />
          <section
            className={`${styles.formatModal} ${styles.exportModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Export ${exportTarget.name}`}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setExportTarget(null)
            }}
          >
            <header className={styles.modalHeader}>
              <h2>Export data format</h2>
              <button type="button" onClick={() => setExportTarget(null)} aria-label="Close export modal"><LuX size={16} /></button>
            </header>
            <div className={styles.confirmBody}>
              <p>Export <strong>{exportTarget.name}</strong> as a ZIP with sample data and AI instructions.</p>
              <div className={styles.exportControls}>
                <label className={styles.exportField}>
                  <span>Format</span>
                  <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
                    <option value="json">JSON</option>
                    <option value="yaml">YAML</option>
                  </select>
                </label>
              </div>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setExportTarget(null)}>Cancel</button>
                <button type="button" className={styles.primaryButton} onClick={downloadExport}>Download</button>
              </footer>
            </div>
          </section>
        </>
      ) : null}

      {instructionsTarget ? (
        <>
          <div
            className={styles.modalBackdrop}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setInstructionsTarget(null)
            }}
          />
          <section
            className={`${styles.formatModal} ${styles.instructionsModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Instructions for ${instructionsTarget.name}`}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setInstructionsTarget(null)
            }}
          >
            <header className={styles.modalHeader}>
              <h2>AI instructions</h2>
              <button type="button" onClick={() => setInstructionsTarget(null)} aria-label="Close instructions modal"><LuX size={16} /></button>
            </header>
            <div className={styles.instructionsBody}>
              <pre>{instructionsTarget.instructionsMarkdown || buildInstructionsMarkdown(instructionsTarget)}</pre>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
