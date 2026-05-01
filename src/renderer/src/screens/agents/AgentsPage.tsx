import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuDownload, LuPencil, LuPlus, LuTrash2, LuUpload, LuX } from 'react-icons/lu'
import styles from './AgentsPage.module.scss'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Agent, AgentReasoningLevel, AgentStep } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { buildSingleAgentMarkdown } from '@renderer/utils/entityMarkdown'
import { downloadMarkdownFile } from '../projects/detail/taskExport'

const REASONING_OPTIONS: Array<AppSelectOption & { value: AgentReasoningLevel }> = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra high', value: 'extra_high' }
]

const STATUS_OPTIONS: Array<AppSelectOption & { value: Agent['status'] }> = [
  { label: 'Idle', value: 'idle' },
  { label: 'Busy', value: 'busy' },
  { label: 'Offline', value: 'offline' }
]

const AGENT_IMPORT_EXAMPLE = `{
  "name": "Research Agent",
  "title": "Research specialist",
  "description": "Agent scope",
  "prompt": "Agent-level operating prompt",
  "status": "idle",
  "reasoningLevel": "medium",
  "steps": [
    {
      "title": "Step title",
      "description": "Step description",
      "prompt": "Step prompt"
    },
    {
      "title": "Another step title",
      "description": "Another step description",
      "prompt": "Another step prompt"
    }
  ]
}`

type AgentImportPatch = {
  name: string
  title?: string
  description?: string
  prompt?: string
  status?: Agent['status']
  reasoningLevel?: AgentReasoningLevel
  steps?: AgentStep[]
}

function createStep(sortOrder: number): AgentStep {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${sortOrder}`,
    title: '',
    description: '',
    prompt: '',
    sortOrder
  }
}

function reasoningLabel(value?: AgentReasoningLevel) {
  return REASONING_OPTIONS.find((option) => option.value === value)?.label ?? 'Medium'
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}

function createImportedStep(raw: Record<string, unknown>, index: number): AgentStep {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-import-${index}`,
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    sortOrder: index
  }
}

function parseAgentImportJson(value: string): { ok: true; patch: AgentImportPatch } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { ok: false, error: 'Enter valid JSON.' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'JSON must be an object.' }
  }

  const source = parsed as Record<string, unknown>
  if (typeof source.name !== 'string' || !source.name.trim()) {
    return { ok: false, error: 'JSON must include a non-empty name.' }
  }

  const patch: AgentImportPatch = { name: source.name.trim() }

  for (const key of ['title', 'description', 'prompt'] as const) {
    if (source[key] !== undefined && typeof source[key] !== 'string') {
      return { ok: false, error: `${key} must be a string.` }
    }
  }

  if (typeof source.title === 'string') patch.title = source.title
  if (typeof source.description === 'string') patch.description = source.description
  if (typeof source.prompt === 'string') patch.prompt = source.prompt

  if (source.status !== undefined) {
    if (source.status !== 'idle' && source.status !== 'busy' && source.status !== 'offline') {
      return { ok: false, error: 'status must be idle, busy, or offline.' }
    }
    patch.status = source.status
  }

  if (source.reasoningLevel !== undefined) {
    if (source.reasoningLevel !== 'low' && source.reasoningLevel !== 'medium' && source.reasoningLevel !== 'high' && source.reasoningLevel !== 'extra_high') {
      return { ok: false, error: 'reasoningLevel must be low, medium, high, or extra_high.' }
    }
    patch.reasoningLevel = source.reasoningLevel
  }

  if (source.steps !== undefined) {
    if (!Array.isArray(source.steps)) {
      return { ok: false, error: 'steps must be an array.' }
    }
    const importedSteps: AgentStep[] = []
    for (const [index, rawStep] of source.steps.entries()) {
      if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
        return { ok: false, error: `steps[${index}] must be an object.` }
      }
      const step = rawStep as Record<string, unknown>
      for (const key of ['title', 'description', 'prompt'] as const) {
        if (step[key] !== undefined && typeof step[key] !== 'string') {
          return { ok: false, error: `steps[${index}].${key} must be a string.` }
        }
      }
      importedSteps.push(createImportedStep(step, index))
    }
    patch.steps = importedSteps
  }

  return { ok: true, patch }
}

export function AgentsPage() {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState<Agent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit'>('create')
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [deleteAgent, setDeleteAgent] = useState<Agent | null>(null)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [trainingMarkdown, setTrainingMarkdown] = useState('')
  const [status, setStatus] = useState<Agent['status']>('idle')
  const [reasoningLevel, setReasoningLevel] = useState<AgentReasoningLevel>('medium')
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const tableRef = useRef<HTMLElement | null>(null)
  const dragScrollRef = useRef({ active: false, startX: 0, scrollLeft: 0 })

  const refresh = async () => {
    setLoading(true)
    const response = await loadList<Agent[]>(IPC_CHANNELS.agents.list, token)
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to load agents')
      setItems([])
      return
    }
    setItems(Array.isArray(response.data) ? response.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const sortedItems = useMemo(() => [...items].sort((a, b) => b.updatedAt - a.updatedAt), [items])

  const resetForm = () => {
    setName('')
    setTitle('')
    setDescription('')
    setTrainingMarkdown('')
    setStatus('idle')
    setReasoningLevel('medium')
    setSteps([])
    setFormError(null)
    setIsImportModalOpen(false)
    setImportJson('')
    setImportError(null)
  }

  const openCreate = () => {
    setMode('create')
    setEditingAgent(null)
    resetForm()
    setIsModalOpen(true)
  }

  useEffect(() => {
    const state = location.state as { openCreate?: boolean; name?: string } | null
    const searchParams = new URLSearchParams(location.search)
    const shouldOpen = Boolean(state?.openCreate) || searchParams.get('create') === '1'
    if (!shouldOpen) return
    setMode('create')
    setEditingAgent(null)
    resetForm()
    setName(state?.name ?? searchParams.get('name') ?? '')
    setIsModalOpen(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate])

  const openEdit = (agent: Agent) => {
    setMode('edit')
    setEditingAgent(agent)
    setName(agent.name)
    setTitle(agent.title ?? '')
    setDescription(agent.description ?? '')
    setTrainingMarkdown(agent.trainingMarkdown ?? '')
    setStatus(agent.status)
    setReasoningLevel(agent.reasoningLevel ?? 'medium')
    setSteps([...(agent.steps ?? [])].sort((a, b) => a.sortOrder - b.sortOrder))
    setFormError(null)
    setIsImportModalOpen(false)
    setImportJson('')
    setImportError(null)
    setIsModalOpen(true)
  }

  useEffect(() => {
    const state = location.state as { openEditId?: string; agent?: Agent } | null
    const searchParams = new URLSearchParams(location.search)
    const editId = state?.openEditId ?? searchParams.get('edit')
    if (!editId) return
    const target = state?.agent ?? items.find((agent) => agent.id === editId)
    if (!target) return
    openEdit(target)
    navigate(location.pathname, { replace: true, state: null })
  }, [items, location.pathname, location.search, location.state, navigate])

  const closeModal = () => {
    setIsModalOpen(false)
    setIsImportModalOpen(false)
    setEditingAgent(null)
    setFormError(null)
    setImportJson('')
    setImportError(null)
  }

  const openImportModal = () => {
    setImportJson('')
    setImportError(null)
    setIsImportModalOpen(true)
  }

  const closeImportModal = () => {
    setIsImportModalOpen(false)
    setImportJson('')
    setImportError(null)
  }

  const importAgentJson = () => {
    const result = parseAgentImportJson(importJson)
    if (!result.ok) {
      setImportError(result.error)
      return
    }

    setName(result.patch.name)
    if (result.patch.title !== undefined) setTitle(result.patch.title)
    if (result.patch.description !== undefined) setDescription(result.patch.description)
    if (result.patch.prompt !== undefined) setTrainingMarkdown(result.patch.prompt)
    if (result.patch.status !== undefined) setStatus(result.patch.status)
    if (result.patch.reasoningLevel !== undefined) setReasoningLevel(result.patch.reasoningLevel)
    if (result.patch.steps !== undefined) setSteps(result.patch.steps)
    setFormError(null)
    closeImportModal()
  }

  const downloadAgent = (agent: Agent) => {
    downloadMarkdownFile('AGENT.md', buildSingleAgentMarkdown(agent))
  }

  const updateStep = (id: string, patch: Partial<AgentStep>) => {
    setSteps((prev) => prev.map((step) => step.id === id ? { ...step, ...patch } : step))
  }

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((step) => step.id !== id).map((step, index) => ({ ...step, sortOrder: index })))
  }

  const saveAgent = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setFormError('Agent name is required.')
      return
    }
    const normalizedSteps = steps
      .map((step, index) => ({ ...step, title: step.title.trim(), description: step.description.trim(), prompt: step.prompt?.trim() ?? '', sortOrder: index }))
      .filter((step) => step.title || step.description || step.prompt)

    setLoading(true)
    const response = await invokeBridge<Agent>(mode === 'edit' ? IPC_CHANNELS.agents.update : IPC_CHANNELS.agents.create, {
      actorToken: token,
      ...(mode === 'edit' ? { id: editingAgent?.id } : {}),
      name: name.trim(),
      title: title.trim(),
      description: description.trim(),
      trainingMarkdown,
      status,
      reasoningLevel,
      steps: normalizedSteps
    })
    setLoading(false)
    if (!response.ok) {
      setFormError(response.error?.message ?? `Unable to ${mode === 'edit' ? 'update' : 'create'} agent`)
      return
    }
    const savedAgent = response.data as Agent | undefined
    closeModal()
    await refresh()
    if (savedAgent?.id) setNotice('Agent saved.')
  }

  const removeAgent = async () => {
    if (!deleteAgent) return
    setLoading(true)
    const response = await invokeBridge(IPC_CHANNELS.agents.remove, {
      actorToken: token,
      id: deleteAgent.id
    })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete agent')
      return
    }
    setDeleteAgent(null)
    await refresh()
  }

  const startTableDrag = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select, [role="button"], [role="combobox"]')) return
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
          <h1>Agents</h1>
          <p>{items.length} agents configured.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryButton} onClick={openCreate} disabled={loading}>
            <LuPlus size={16} />
            Add agent
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}

      <section
        ref={tableRef}
        className={styles.tableCard}
        onMouseDown={startTableDrag}
        onMouseMove={moveTableDrag}
        onMouseUp={endTableDrag}
        onMouseLeave={endTableDrag}
      >
        <div className={styles.tableHead}>
          <span>Agent</span>
          <span>Title</span>
          <span>Reasoning</span>
          <span>Steps</span>
          <span>Status</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {sortedItems.length > 0 ? sortedItems.map((agent) => (
          <div key={agent.id} className={styles.tableRow}>
            <span className={styles.agentCell}>
              <strong>{agent.name}</strong>
              <small>{agent.trainingMarkdown ? 'Training added' : 'No training markdown'}</small>
            </span>
            <span className={styles.mutedCell}>{agent.title || 'No title'}</span>
            <span><span className={`${styles.reasoningPill} ${styles[`reasoning_${agent.reasoningLevel ?? 'medium'}`]}`}>{reasoningLabel(agent.reasoningLevel)}</span></span>
            <span className={styles.mutedCell}>{(agent.steps ?? []).length}</span>
            <span><span className={`${styles.statusPill} ${styles[`status_${agent.status}`]}`}>{agent.status}</span></span>
            <span className={styles.mutedCell}>{formatDate(agent.updatedAt)}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => downloadAgent(agent)} aria-label={`Download ${agent.name} AGENT.md`}>
                <LuDownload size={15} />
              </button>
              <button type="button" className={styles.iconButton} onClick={() => openEdit(agent)} aria-label={`Edit ${agent.name}`}>
                <LuPencil size={15} />
              </button>
              <button type="button" className={`${styles.iconButton} ${styles.dangerIconButton}`} onClick={() => setDeleteAgent(agent)} aria-label={`Delete ${agent.name}`}>
                <LuTrash2 size={15} />
              </button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading agents...' : 'No agents configured.'}</div>
        )}
      </section>

      {isModalOpen ? (
        <>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <section className={styles.agentModal} role="dialog" aria-modal="true" aria-label={mode === 'edit' ? 'Edit agent' : 'Add agent'}>
            <header className={styles.modalHeader}>
              <h2>{mode === 'edit' ? 'Edit agent' : 'Add agent'}</h2>
              <div className={styles.modalHeaderActions}>
                <button type="button" className={styles.headerActionButton} onClick={openImportModal}>
                  <LuUpload size={15} />
                  Import JSON
                </button>
                <button type="button" onClick={closeModal} aria-label="Close agent modal"><LuX size={16} /></button>
              </div>
            </header>
            <form className={styles.agentForm} onSubmit={saveAgent}>
              <div className={styles.agentFormContent}>
                {formError ? <p className={styles.formError}>{formError}</p> : null}
                <div className={styles.formGrid}>
                  <label>
                    <span>Agent name *</span>
                    <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Research agent" required />
                  </label>
                  <label>
                    <span>Title</span>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What this agent does" />
                  </label>
                  <label>
                    <span>Status</span>
                    <AppSelect
                      mode="single"
                      value={STATUS_OPTIONS.find((option) => option.value === status) ?? STATUS_OPTIONS[0]}
                      options={STATUS_OPTIONS}
                      onChange={(option) => {
                        if (option?.value === 'idle' || option?.value === 'busy' || option?.value === 'offline') setStatus(option.value)
                      }}
                    />
                  </label>
                  <label>
                    <span>Reasoning level</span>
                    <AppSelect
                      mode="single"
                      value={REASONING_OPTIONS.find((option) => option.value === reasoningLevel) ?? REASONING_OPTIONS[1]}
                      options={REASONING_OPTIONS}
                      onChange={(option) => {
                        if (option?.value === 'low' || option?.value === 'medium' || option?.value === 'high' || option?.value === 'extra_high') setReasoningLevel(option.value)
                      }}
                    />
                  </label>
                </div>
                <label>
                  <span>Description</span>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Describe the agent's scope, strengths, and boundaries." />
                </label>
                <label>
                  <span>Agent prompt</span>
                  <textarea value={trainingMarkdown} onChange={(event) => setTrainingMarkdown(event.target.value)} rows={7} placeholder="Describe the agent's operating rules, responsibilities, and expected behavior." />
                </label>
                <section className={styles.stepsBlock}>
                  <header>
                    <div>
                      <h3>Steps</h3>
                      <p>Add step-by-step guidance for this agent.</p>
                    </div>
                    <button type="button" className={styles.secondaryButton} onClick={() => setSteps((prev) => [...prev, createStep(prev.length)])}>
                      <LuPlus size={14} />
                      Add step
                    </button>
                  </header>
                  {steps.length > 0 ? steps.map((step, index) => (
                    <div key={step.id} className={styles.stepCard}>
                      <div className={styles.stepNumber}>Step {index + 1}</div>
                      <label>
                        <span>Step title</span>
                        <input value={step.title} onChange={(event) => updateStep(step.id, { title: event.target.value })} placeholder="Step title" />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea value={step.description} onChange={(event) => updateStep(step.id, { description: event.target.value })} rows={3} placeholder="Explain this step." />
                      </label>
                      <label>
                        <span>Prompt</span>
                        <textarea value={step.prompt ?? ''} onChange={(event) => updateStep(step.id, { prompt: event.target.value })} rows={3} placeholder="Prompt or instruction for this step." />
                      </label>
                      <button type="button" className={styles.stepRemoveButton} onClick={() => removeStep(step.id)}>Remove step</button>
                    </div>
                  )) : (
                    <p className={styles.emptySteps}>No steps yet.</p>
                  )}
                </section>
              </div>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={closeModal}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={loading || !name.trim()}>{mode === 'edit' ? 'Save changes' : 'Add agent'}</button>
              </footer>
            </form>
          </section>
          {isImportModalOpen ? (
            <>
              <div className={styles.importModalBackdrop} onClick={closeImportModal} />
              <section className={`${styles.agentModal} ${styles.importModal}`} role="dialog" aria-modal="true" aria-label="Import agent JSON">
                <header className={styles.modalHeader}>
                  <h2>Import agent JSON</h2>
                  <button type="button" onClick={closeImportModal} aria-label="Close import modal"><LuX size={16} /></button>
                </header>
                <div className={styles.importBody}>
                  {importError ? <p className={styles.formError}>{importError}</p> : null}
                  <label>
                    <span>JSON</span>
                    <textarea
                      autoFocus
                      value={importJson}
                      onChange={(event) => {
                        setImportJson(event.target.value)
                        setImportError(null)
                      }}
                      rows={14}
                      placeholder={AGENT_IMPORT_EXAMPLE}
                    />
                  </label>
                  <div className={styles.importExample}>
                    <span>Example schema</span>
                    <pre>{AGENT_IMPORT_EXAMPLE}</pre>
                  </div>
                  <footer className={styles.modalFooter}>
                    <button type="button" className={styles.secondaryButton} onClick={closeImportModal}>Cancel</button>
                    <button type="button" className={styles.primaryButton} onClick={importAgentJson} disabled={!importJson.trim()}>Import</button>
                  </footer>
                </div>
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {deleteAgent ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteAgent(null)} />
          <section className={`${styles.agentModal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-label={`Delete ${deleteAgent.name}`}>
            <header className={styles.modalHeader}>
              <h2>Delete agent</h2>
              <button type="button" onClick={() => setDeleteAgent(null)} aria-label="Close delete modal"><LuX size={16} /></button>
            </header>
            <div className={styles.confirmBody}>
              <p>Are you sure you want to delete <strong>{deleteAgent.name}</strong>?</p>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setDeleteAgent(null)}>Cancel</button>
                <button type="button" className={styles.dangerButton} onClick={() => void removeAgent()} disabled={loading}>Delete</button>
              </footer>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
