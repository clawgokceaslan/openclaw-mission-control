import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { LuCheck, LuChevronLeft, LuPencil, LuPlus, LuSave, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, CustomField, OutputFormat, Skill, Tag, TaskChecklistItem, TaskTemplate, TaskTemplatePayload } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import styles from './TaskTemplatesPage.module.scss'

type SaveState = 'saved' | 'dirty' | 'saving' | 'failed'
type BuilderTab = 'subtasks' | 'customFields' | 'checklist' | 'outputFormat'
type SubtaskTab = 'details' | 'customFields' | 'outputFormat'
type DraftSubtask = NonNullable<TaskTemplatePayload['subtasks']>[number] & { uiId: string }

const SAVE_DELAY_MS = 700

function defaultTemplate(): TaskTemplatePayload {
  return {
    title: '',
    description: '',
    status: '',
    agentId: null,
    tagIds: [],
    skillIds: [],
    customFieldValues: {},
    checklistItems: [],
    outputFormatId: null,
    subtasks: []
  }
}

function createLocalId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeTemplate(value?: TaskTemplatePayload): TaskTemplatePayload {
  return {
    ...defaultTemplate(),
    ...(value ?? {}),
    tagIds: Array.isArray(value?.tagIds) ? value.tagIds : [],
    skillIds: Array.isArray(value?.skillIds) ? value.skillIds : [],
    customFieldValues: value?.customFieldValues && typeof value.customFieldValues === 'object' && !Array.isArray(value.customFieldValues) ? value.customFieldValues : {},
    checklistItems: Array.isArray(value?.checklistItems) ? value.checklistItems : [],
    subtasks: Array.isArray(value?.subtasks) ? value.subtasks : []
  }
}

function toDraftSubtasks(template: TaskTemplatePayload): DraftSubtask[] {
  return (template.subtasks ?? []).map((subtask) => ({ ...subtask, uiId: createLocalId() }))
}

function stripDraftSubtasks(subtasks: DraftSubtask[]) {
  return subtasks.map(({ uiId: _uiId, ...subtask }) => subtask)
}

function checklistItem(title: string): TaskChecklistItem {
  return { id: createLocalId(), title, checked: false }
}

function customFieldValueToDraft(field: CustomField, value: unknown): string {
  if (field.type === 'boolean') return value === true ? 'true' : value === false ? 'false' : ''
  if (field.type === 'json') {
    if (value === undefined) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  return value == null ? '' : String(value)
}

function customFieldValueLabel(field: CustomField, value: unknown): string {
  if (value === undefined) return 'Empty'
  if (field.type === 'boolean') return value ? 'True' : 'False'
  if (field.type === 'json') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return 'Invalid JSON'
    }
  }
  return String(value)
}

function parseCustomFieldValue(field: CustomField, draft: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (field.type === 'boolean') return { ok: true, value: draft === 'true' }
  if (field.type === 'number') {
    if (!draft.trim()) return { ok: true, value: null }
    const numeric = Number(draft)
    return Number.isFinite(numeric) ? { ok: true, value: numeric } : { ok: false, error: 'Enter a valid number.' }
  }
  if (field.type === 'json') {
    if (!draft.trim()) return { ok: true, value: null }
    try {
      return { ok: true, value: JSON.parse(draft) }
    } catch {
      return { ok: false, error: 'Enter valid JSON.' }
    }
  }
  return { ok: true, value: draft }
}

function getSubtaskPayload(subtask: DraftSubtask): Record<string, unknown> {
  return subtask.payload && typeof subtask.payload === 'object' && !Array.isArray(subtask.payload) ? subtask.payload : {}
}

function getSubtaskCustomFields(subtask: DraftSubtask | null): Record<string, unknown> {
  if (!subtask) return {}
  const values = getSubtaskPayload(subtask).customFields
  return values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : {}
}

function getSubtaskDescription(subtask: DraftSubtask | null) {
  if (!subtask) return ''
  const description = getSubtaskPayload(subtask).description
  return typeof description === 'string' ? description : ''
}

function getSubtaskAgentId(subtask: DraftSubtask | null) {
  if (!subtask) return undefined
  const payload = getSubtaskPayload(subtask)
  if (typeof payload.agentId === 'string' && payload.agentId) return payload.agentId
  return subtask.agentId ?? undefined
}

function getSubtaskDueAt(subtask: DraftSubtask | null) {
  if (!subtask) return undefined
  const payload = getSubtaskPayload(subtask)
  return typeof payload.dueAt === 'number' ? payload.dueAt : subtask.dueAt
}

function getSubtaskOutputFormatId(subtask: DraftSubtask | null) {
  if (!subtask) return undefined
  const value = getSubtaskPayload(subtask).outputFormatId ?? subtask.outputFormatId
  return typeof value === 'string' && value ? value : undefined
}

function formatDateInput(timestamp?: number) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function TaskTemplatesPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<TaskTemplate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TaskTemplate | null>(null)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [editing, setEditing] = useState<TaskTemplate | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [templateDraft, setTemplateDraft] = useState<TaskTemplatePayload>(defaultTemplate())
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([])
  const [activeTab, setActiveTab] = useState<BuilderTab>('subtasks')
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null)
  const [subtaskTab, setSubtaskTab] = useState<SubtaskTab>('details')
  const [checklistDraft, setChecklistDraft] = useState('')
  const [subtaskTitleDraft, setSubtaskTitleDraft] = useState('')
  const [customFieldDraft, setCustomFieldDraft] = useState('')
  const [selectedCustomField, setSelectedCustomField] = useState<AppSelectOption | null>(null)
  const [customFieldError, setCustomFieldError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const editingRef = useRef<TaskTemplate | null>(null)
  const nameRef = useRef('')
  const descriptionRef = useRef('')
  const templateRef = useRef<TaskTemplatePayload>(defaultTemplate())
  const subtasksRef = useRef<DraftSubtask[]>([])

  const refresh = async () => {
    setLoading(true)
    const [templatesResponse, agentsResponse, tagsResponse, skillsResponse, customFieldsResponse, outputFormatsResponse] = await Promise.all([
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token),
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token)
    ])
    setLoading(false)
    if (!templatesResponse.ok) {
      setError(templatesResponse.error?.message ?? 'Unable to load task templates')
      setItems([])
      return
    }
    setItems(Array.isArray(templatesResponse.data) ? templatesResponse.data : [])
    setAgents(Array.isArray(agentsResponse.data) ? agentsResponse.data : [])
    setTags(Array.isArray(tagsResponse.data) ? tagsResponse.data : [])
    setSkills(Array.isArray(skillsResponse.data) ? skillsResponse.data : [])
    setCustomFields(Array.isArray(customFieldsResponse.data) ? customFieldsResponse.data : [])
    setOutputFormats(Array.isArray(outputFormatsResponse.data) ? outputFormatsResponse.data : [])
    setError(!agentsResponse.ok
      ? agentsResponse.error?.message ?? 'Unable to load agents'
      : !tagsResponse.ok
        ? tagsResponse.error?.message ?? 'Unable to load tags'
        : !skillsResponse.ok
          ? skillsResponse.error?.message ?? 'Unable to load skills'
          : !customFieldsResponse.ok
            ? customFieldsResponse.error?.message ?? 'Unable to load custom fields'
            : !outputFormatsResponse.ok
              ? outputFormatsResponse.error?.message ?? 'Unable to load output formats'
              : null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  useEffect(() => {
    editingRef.current = editing
    nameRef.current = nameDraft
    descriptionRef.current = descriptionDraft
    templateRef.current = templateDraft
    subtasksRef.current = draftSubtasks
  }, [editing, nameDraft, descriptionDraft, templateDraft, draftSubtasks])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!editing) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void closeBuilder()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [editing])

  const tagOptions = useMemo(() => tags.map((tag) => ({ label: tag.name, value: tag.id, color: tag.color })), [tags])
  const agentOptions = useMemo(() => agents.map((agent) => ({ label: agent.name, value: agent.id })), [agents])
  const skillOptions = useMemo(() => skills.map((skill) => ({ label: skill.name, value: skill.id })), [skills])
  const customFieldOptions = useMemo(() => customFields.map((field) => ({ label: field.name, value: field.id })), [customFields])
  const outputFormatOptions = useMemo(() => outputFormats.map((format) => ({ label: format.name, value: format.id })), [outputFormats])
  const selectedSubtask = useMemo(() => draftSubtasks.find((subtask) => subtask.uiId === selectedSubtaskId) ?? null, [draftSubtasks, selectedSubtaskId])

  const selectedAgent = agentOptions.find((option) => option.value === templateDraft.agentId) ?? null
  const selectedTags = tagOptions.filter((option) => (templateDraft.tagIds ?? []).includes(option.value))
  const selectedSkills = skillOptions.filter((option) => (templateDraft.skillIds ?? []).includes(option.value))
  const selectedOutputFormat = outputFormatOptions.find((option) => option.value === templateDraft.outputFormatId) ?? null
  const selectedSubtaskAgent = agentOptions.find((option) => option.value === getSubtaskAgentId(selectedSubtask)) ?? null
  const selectedSubtaskOutputFormat = outputFormatOptions.find((option) => option.value === getSubtaskOutputFormatId(selectedSubtask)) ?? null

  const persistNow = async () => {
    const target = editingRef.current
    if (!target) return true
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!nameRef.current.trim()) {
      setSaveState('failed')
      setSaveError('Template name is required.')
      return false
    }
    if (inFlightRef.current) {
      pendingRef.current = true
      return true
    }
    inFlightRef.current = true
    setSaveState('saving')
    const payload = {
      ...normalizeTemplate(templateRef.current),
      subtasks: stripDraftSubtasks(subtasksRef.current)
    }
    const response = await invokeBridge<TaskTemplate>(IPC_CHANNELS.taskTemplates.update, {
      actorToken: token,
      id: target.id,
      name: nameRef.current.trim(),
      description: descriptionRef.current.trim(),
      template: payload
    })
    inFlightRef.current = false
    if (!response.ok || !response.data) {
      setSaveState('failed')
      setSaveError(response.error?.message ?? 'Unable to save task template')
      return false
    }
    setEditing(response.data)
    setItems((current) => current.map((item) => item.id === response.data?.id ? response.data : item))
    setSaveState('saved')
    setSaveError(null)
    if (pendingRef.current) {
      pendingRef.current = false
      return persistNow()
    }
    return true
  }

  const scheduleSave = () => {
    setSaveState('dirty')
    setSaveError(null)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void persistNow()
    }, SAVE_DELAY_MS)
  }

  const patchTemplate = (patch: Partial<TaskTemplatePayload>) => {
    setTemplateDraft((current) => {
      const next = normalizeTemplate({ ...current, ...patch })
      templateRef.current = next
      return next
    })
    scheduleSave()
  }

  const patchSubtasks = (updater: (current: DraftSubtask[]) => DraftSubtask[]) => {
    setDraftSubtasks((current) => {
      const next = updater(current)
      subtasksRef.current = next
      return next
    })
    scheduleSave()
  }

  const openCreate = () => {
    setCreateName('')
    setCreateDescription('')
    setFormError(null)
    setCreateOpen(true)
  }

  const createTemplate = async (event: FormEvent) => {
    event.preventDefault()
    if (!createName.trim()) {
      setFormError('Template name is required.')
      return
    }
    setLoading(true)
    const response = await invokeBridge<TaskTemplate>(IPC_CHANNELS.taskTemplates.create, {
      actorToken: token,
      name: createName.trim(),
      description: createDescription.trim(),
      template: defaultTemplate()
    })
    setLoading(false)
    if (!response.ok || !response.data) {
      setFormError(response.error?.message ?? 'Unable to create task template')
      return
    }
    setCreateOpen(false)
    setItems((current) => [response.data as TaskTemplate, ...current])
    openBuilder(response.data)
  }

  const openBuilder = (template: TaskTemplate) => {
    const normalized = normalizeTemplate(template.template)
    const nextSubtasks = toDraftSubtasks(normalized)
    editingRef.current = template
    nameRef.current = template.name
    descriptionRef.current = template.description ?? ''
    templateRef.current = normalized
    subtasksRef.current = nextSubtasks
    setEditing(template)
    setNameDraft(template.name)
    setDescriptionDraft(template.description ?? '')
    setTemplateDraft(normalized)
    setDraftSubtasks(nextSubtasks)
    setActiveTab('subtasks')
    setSelectedSubtaskId(null)
    setSubtaskTab('details')
    setChecklistDraft('')
    setSubtaskTitleDraft('')
    setCustomFieldDraft('')
    setSelectedCustomField(null)
    setCustomFieldError(null)
    setSaveState('saved')
    setSaveError(null)
  }

  const closeBuilder = async () => {
    await persistNow()
    setEditing(null)
    setSelectedSubtaskId(null)
    setSaveState('saved')
    await refresh()
  }

  const deleteTemplate = async () => {
    if (!deleteTarget) return
    setLoading(true)
    const response = await invokeBridge(IPC_CHANNELS.taskTemplates.remove, { actorToken: token, id: deleteTarget.id })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete task template')
      return
    }
    setDeleteTarget(null)
    await refresh()
  }

  const addCustomFieldValue = (isSubtask = false) => {
    const field = customFields.find((item) => item.id === selectedCustomField?.value)
    if (!field) return
    const parsed = parseCustomFieldValue(field, customFieldDraft)
    if (!parsed.ok) {
      setCustomFieldError(parsed.error)
      return
    }
    setCustomFieldError(null)
    if (isSubtask && selectedSubtask) {
      patchSubtasks((current) => current.map((subtask) => {
        if (subtask.uiId !== selectedSubtask.uiId) return subtask
        const payload = getSubtaskPayload(subtask)
        const customFieldsValue = payload.customFields && typeof payload.customFields === 'object' && !Array.isArray(payload.customFields) ? payload.customFields as Record<string, unknown> : {}
        return { ...subtask, payload: { ...payload, customFields: { ...customFieldsValue, [field.id]: parsed.value } } }
      }))
    } else {
      patchTemplate({ customFieldValues: { ...(templateDraft.customFieldValues ?? {}), [field.id]: parsed.value } })
    }
    setSelectedCustomField(null)
    setCustomFieldDraft('')
  }

  const removeCustomFieldValue = (fieldId: string, isSubtask = false) => {
    if (isSubtask && selectedSubtask) {
      patchSubtasks((current) => current.map((subtask) => {
        if (subtask.uiId !== selectedSubtask.uiId) return subtask
        const payload = getSubtaskPayload(subtask)
        const values = { ...(payload.customFields as Record<string, unknown> | undefined) }
        delete values[fieldId]
        return { ...subtask, payload: { ...payload, customFields: values } }
      }))
      return
    }
    const values = { ...(templateDraft.customFieldValues ?? {}) }
    delete values[fieldId]
    patchTemplate({ customFieldValues: values })
  }

  const addSubtask = () => {
    const title = subtaskTitleDraft.trim()
    if (!title) return
    const subtask: DraftSubtask = { uiId: createLocalId(), title, status: '', payload: {} }
    patchSubtasks((current) => [...current, subtask])
    setSelectedSubtaskId(subtask.uiId)
    setSubtaskTitleDraft('')
  }

  const updateSelectedSubtask = (patch: Partial<DraftSubtask>) => {
    if (!selectedSubtask) return
    patchSubtasks((current) => current.map((subtask) => subtask.uiId === selectedSubtask.uiId ? { ...subtask, ...patch } : subtask))
  }

  const updateSelectedSubtaskPayload = (patch: Record<string, unknown>) => {
    if (!selectedSubtask) return
    patchSubtasks((current) => current.map((subtask) => {
      if (subtask.uiId !== selectedSubtask.uiId) return subtask
      return { ...subtask, payload: { ...getSubtaskPayload(subtask), ...patch } }
    }))
  }

  const renderCustomFields = (values: Record<string, unknown>, isSubtask = false) => (
    <div className={styles.panel}>
      {customFieldError ? <p className={styles.formError}>{customFieldError}</p> : null}
      <div className={styles.inlineForm}>
        <AppSelect
          mode="single"
          options={customFieldOptions}
          value={selectedCustomField}
          onChange={(option) => {
            if (Array.isArray(option)) return
            setSelectedCustomField(option)
            const field = customFields.find((item) => item.id === option?.value)
            setCustomFieldDraft(field ? customFieldValueToDraft(field, field.defaultValue) : '')
          }}
          placeholder="Add custom field..."
        />
        {selectedCustomField ? (
          <input value={customFieldDraft} onChange={(event) => setCustomFieldDraft(event.target.value)} placeholder="Value" />
        ) : null}
        <button type="button" className={styles.secondaryButton} onClick={() => addCustomFieldValue(isSubtask)} disabled={!selectedCustomField}>Add</button>
      </div>
      <div className={styles.fieldList}>
        {Object.entries(values).length > 0 ? Object.entries(values).map(([fieldId, value]) => {
          const field = customFields.find((item) => item.id === fieldId)
          return (
            <div key={fieldId} className={styles.fieldRow}>
              <div>
                <strong>{field?.name ?? 'Missing custom field'}</strong>
                <span>{field?.type ?? 'missing'}</span>
              </div>
              <pre>{field ? customFieldValueLabel(field, value) : String(value)}</pre>
              <button type="button" className={styles.iconButton} onClick={() => removeCustomFieldValue(fieldId, isSubtask)}><LuTrash2 size={14} /></button>
            </div>
          )
        }) : <p className={styles.emptyText}>No custom fields added.</p>}
      </div>
    </div>
  )

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Task templates</h1>
          <p>{items.length} templates configured.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openCreate} disabled={loading}>
          <LuPlus size={16} />
          Add template
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <span>Template</span>
          <span>Description</span>
          <span>Subtasks</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {items.length > 0 ? items.map((item) => (
          <div key={item.id} className={styles.tableRow}>
            <span className={styles.nameCell}>{item.name}</span>
            <span className={styles.mutedCell}>{item.description || 'No description.'}</span>
            <span className={styles.mutedCell}>{item.template.subtasks?.length ?? 0}</span>
            <span className={styles.mutedCell}>{new Date(item.updatedAt).toLocaleDateString()}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => openBuilder(item)} aria-label={`Edit ${item.name}`}><LuPencil size={15} /></button>
              <button type="button" className={styles.iconButton} onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.name}`}><LuTrash2 size={15} /></button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading task templates...' : 'No task templates configured.'}</div>
        )}
      </section>

      {createOpen ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setCreateOpen(false)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Create task template">
            <header className={styles.modalHeader}>
              <h2>Create task template</h2>
              <button type="button" className={styles.modalClose} onClick={() => setCreateOpen(false)} aria-label="Close create modal"><LuX size={16} /></button>
            </header>
            <form className={styles.form} onSubmit={createTemplate}>
              {formError ? <p className={styles.formError}>{formError}</p> : null}
              <label>Template name *<input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} required /></label>
              <label>Description<textarea rows={3} value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} /></label>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={loading || !createName.trim()}>Create and edit</button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {editing ? (
        <>
          <div className={styles.modalBackdrop} onMouseDown={() => void closeBuilder()} />
          <section className={styles.builderModal} role="dialog" aria-modal="true" aria-label="Task template builder">
            <header className={styles.builderHeader}>
              <div>
                <span className={styles.kicker}>Task template builder</span>
                <input className={styles.builderName} value={nameDraft} onChange={(event) => {
                  setNameDraft(event.target.value)
                  nameRef.current = event.target.value
                  scheduleSave()
                }} />
              </div>
              <div className={styles.builderActions}>
                <span className={`${styles.savePill} ${styles[`savePill_${saveState}`]}`}>
                  {saveState === 'saving' ? 'Saving...' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'failed' ? 'Failed' : 'Saved'}
                </span>
                <button type="button" className={styles.secondaryButton} onClick={() => void persistNow()}><LuSave size={15} /> Save</button>
                <button type="button" className={styles.iconButton} onClick={() => void closeBuilder()} aria-label="Close builder"><LuX size={16} /></button>
              </div>
            </header>
            {saveError ? <p className={styles.builderError}>{saveError}</p> : null}
            <div className={styles.builderBody}>
              <aside className={styles.builderAside}>
                <label>Template description<textarea rows={4} value={descriptionDraft} onChange={(event) => {
                  setDescriptionDraft(event.target.value)
                  descriptionRef.current = event.target.value
                  scheduleSave()
                }} /></label>
                <label>Task title<input value={templateDraft.title ?? ''} onChange={(event) => patchTemplate({ title: event.target.value })} placeholder="Task title from template" /></label>
                <label>Task description<textarea rows={7} value={templateDraft.description ?? ''} onChange={(event) => patchTemplate({ description: event.target.value })} placeholder="Task description..." /></label>
              </aside>
              <main className={styles.builderMain}>
                <section className={styles.metaGrid}>
                  <label>Agent<AppSelect mode="single" isClearable options={agentOptions} value={selectedAgent} onChange={(option) => !Array.isArray(option) && patchTemplate({ agentId: option?.value ?? null })} placeholder="No agent" /></label>
                  <label>Tags<AppSelect mode="multi" options={tagOptions} value={selectedTags} onChange={(value) => patchTemplate({ tagIds: Array.isArray(value) ? value.map((item) => item.value) : [] })} placeholder="No tags" /></label>
                  <label>Skills<AppSelect mode="multi" options={skillOptions} value={selectedSkills} onChange={(value) => patchTemplate({ skillIds: Array.isArray(value) ? value.map((item) => item.value) : [] })} placeholder="No skills" /></label>
                  <label>Output format<AppSelect mode="single" isClearable options={outputFormatOptions} value={selectedOutputFormat} onChange={(option) => !Array.isArray(option) && patchTemplate({ outputFormatId: option?.value ?? null })} placeholder="No output format" /></label>
                </section>
                <nav className={styles.tabs}>
                  <button type="button" className={activeTab === 'subtasks' ? styles.tabActive : ''} onClick={() => setActiveTab('subtasks')}>Subtasks</button>
                  <button type="button" className={activeTab === 'customFields' ? styles.tabActive : ''} onClick={() => setActiveTab('customFields')}>Custom fields</button>
                  <button type="button" className={activeTab === 'checklist' ? styles.tabActive : ''} onClick={() => setActiveTab('checklist')}>Checklist</button>
                  <button type="button" className={activeTab === 'outputFormat' ? styles.tabActive : ''} onClick={() => setActiveTab('outputFormat')}>Output format</button>
                </nav>
                {activeTab === 'subtasks' ? (
                  <section className={styles.panel}>
                    {selectedSubtask ? (
                      <>
                        <button type="button" className={styles.backButton} onClick={() => setSelectedSubtaskId(null)}><LuChevronLeft size={15} /> Back to subtasks</button>
                        <input className={styles.detailTitle} value={selectedSubtask.title ?? ''} onChange={(event) => updateSelectedSubtask({ title: event.target.value })} />
                        <nav className={styles.tabs}>
                          <button type="button" className={subtaskTab === 'details' ? styles.tabActive : ''} onClick={() => setSubtaskTab('details')}>Details</button>
                          <button type="button" className={subtaskTab === 'customFields' ? styles.tabActive : ''} onClick={() => setSubtaskTab('customFields')}>Custom fields</button>
                          <button type="button" className={subtaskTab === 'outputFormat' ? styles.tabActive : ''} onClick={() => setSubtaskTab('outputFormat')}>Output format</button>
                        </nav>
                        {subtaskTab === 'details' ? (
                          <div className={styles.metaGrid}>
                            <label>Description<textarea rows={5} value={getSubtaskDescription(selectedSubtask)} onChange={(event) => updateSelectedSubtaskPayload({ description: event.target.value })} /></label>
                            <label>Agent<AppSelect mode="single" isClearable options={agentOptions} value={selectedSubtaskAgent} onChange={(option) => {
                              if (Array.isArray(option)) return
                              updateSelectedSubtaskPayload({ agentId: option?.value ?? '', assigneeId: option?.value ?? '' })
                            }} placeholder="No agent" /></label>
                            <label>Due date<input type="date" value={formatDateInput(getSubtaskDueAt(selectedSubtask))} onChange={(event) => updateSelectedSubtaskPayload({ dueAt: event.target.value ? new Date(event.target.value).getTime() : undefined })} /></label>
                          </div>
                        ) : subtaskTab === 'customFields' ? renderCustomFields(getSubtaskCustomFields(selectedSubtask), true) : (
                          <div className={styles.panel}>
                            <label>Output format<AppSelect mode="single" isClearable options={outputFormatOptions} value={selectedSubtaskOutputFormat} onChange={(option) => !Array.isArray(option) && updateSelectedSubtaskPayload({ outputFormatId: option?.value ?? '' })} placeholder="No output format" /></label>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className={styles.inlineForm}>
                          <input value={subtaskTitleDraft} onChange={(event) => setSubtaskTitleDraft(event.target.value)} placeholder="Add subtask title..." />
                          <button type="button" className={styles.secondaryButton} onClick={addSubtask} disabled={!subtaskTitleDraft.trim()}><LuPlus size={15} /> Add</button>
                        </div>
                        <div className={styles.subtaskList}>
                          {draftSubtasks.length > 0 ? draftSubtasks.map((subtask) => (
                            <div key={subtask.uiId} className={styles.subtaskRow}>
                              <button type="button" onClick={() => {
                                setSelectedSubtaskId(subtask.uiId)
                                setSubtaskTab('details')
                              }}>{subtask.title || 'Untitled subtask'}</button>
                              <button type="button" className={styles.iconButton} onClick={() => patchSubtasks((current) => current.filter((item) => item.uiId !== subtask.uiId))}><LuTrash2 size={14} /></button>
                            </div>
                          )) : <p className={styles.emptyText}>No subtasks in this template.</p>}
                        </div>
                      </>
                    )}
                  </section>
                ) : activeTab === 'customFields' ? renderCustomFields(templateDraft.customFieldValues ?? {}) : activeTab === 'checklist' ? (
                  <section className={styles.panel}>
                    <div className={styles.inlineForm}>
                      <input value={checklistDraft} onChange={(event) => setChecklistDraft(event.target.value)} placeholder="Add checklist item..." />
                      <button type="button" className={styles.secondaryButton} onClick={() => {
                        if (!checklistDraft.trim()) return
                        patchTemplate({ checklistItems: [...(templateDraft.checklistItems ?? []), checklistItem(checklistDraft.trim())] })
                        setChecklistDraft('')
                      }} disabled={!checklistDraft.trim()}><LuPlus size={15} /> Add</button>
                    </div>
                    <div className={styles.fieldList}>
                      {(templateDraft.checklistItems ?? []).length > 0 ? (templateDraft.checklistItems ?? []).map((item) => (
                        <div key={item.id} className={styles.checklistRow}>
                          <button type="button" className={item.checked ? styles.checkButtonActive : styles.checkButton} onClick={() => patchTemplate({ checklistItems: (templateDraft.checklistItems ?? []).map((entry) => entry.id === item.id ? { ...entry, checked: !entry.checked } : entry) })}><LuCheck size={13} /></button>
                          <span>{item.title}</span>
                          <button type="button" className={styles.iconButton} onClick={() => patchTemplate({ checklistItems: (templateDraft.checklistItems ?? []).filter((entry) => entry.id !== item.id) })}><LuTrash2 size={14} /></button>
                        </div>
                      )) : <p className={styles.emptyText}>No checklist items in this template.</p>}
                    </div>
                  </section>
                ) : (
                  <section className={styles.panel}>
                    <label>Output format<AppSelect mode="single" isClearable options={outputFormatOptions} value={selectedOutputFormat} onChange={(option) => !Array.isArray(option) && patchTemplate({ outputFormatId: option?.value ?? null })} placeholder="No output format" /></label>
                    <p className={styles.emptyText}>This output format will be copied to the created task payload.</p>
                  </section>
                )}
              </main>
            </div>
          </section>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteTarget(null)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={`Delete ${deleteTarget.name}`}>
            <header className={styles.modalHeader}>
              <h2>Delete task template</h2>
              <button type="button" className={styles.modalClose} onClick={() => setDeleteTarget(null)} aria-label="Close delete modal"><LuX size={16} /></button>
            </header>
            <div className={styles.form}>
              <p>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button type="button" className={styles.dangerButton} onClick={() => void deleteTemplate()}>Delete</button>
              </footer>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
