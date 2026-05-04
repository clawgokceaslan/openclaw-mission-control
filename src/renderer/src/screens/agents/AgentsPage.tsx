import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuDownload, LuPencil, LuPlus, LuTrash2, LuUpload, LuX } from 'react-icons/lu'
import styles from './AgentsPage.module.scss'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Agent, Tag } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { buildSingleAgentMarkdown } from '@renderer/utils/entityMarkdown'
import { downloadMarkdownFile } from '../projects/detail/taskExport'
import { AGENT_IMPORT_EXAMPLE, parseAgentImportJson } from './agentImport'
import { TagPill } from '@renderer/components/tags/TagPill'

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}

export function AgentsPage() {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState<Agent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [tagsError, setTagsError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit'>('create')
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [deleteAgent, setDeleteAgent] = useState<Agent | null>(null)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [trainingMarkdown, setTrainingMarkdown] = useState('')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [selectedTags, setSelectedTags] = useState<AppSelectOption[]>([])
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

  const refreshTags = async () => {
    setTagsLoading(true)
    const response = await loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token)
    setTagsLoading(false)
    if (!response.ok) {
      setTagsError(response.error?.message ?? 'Unable to load tags')
      return
    }
    setTags(Array.isArray(response.data) ? response.data : [])
    setTagsError(null)
  }

  useEffect(() => {
    void refresh()
    void refreshTags()
  }, [token])

  const sortedItems = useMemo(() => [...items].sort((a, b) => b.updatedAt - a.updatedAt), [items])
  const tagOptions = useMemo<AppSelectOption[]>(() => tags.map((tag) => ({ label: tag.name, value: tag.id, color: tag.color })), [tags])

  const resetForm = () => {
    setName('')
    setTitle('')
    setDescription('')
    setTrainingMarkdown('')
    setConfig({})
    setSelectedTags([])
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
    setConfig(agent.config ?? {})
    setSelectedTags((agent.tags ?? []).map((tag) => ({ label: tag.name, value: tag.id, color: tag.color })))
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

  const createTagOption = async (name: string): Promise<AppSelectOption | null> => {
    const response = await invokeBridge<Tag>(IPC_CHANNELS.customFields.tagsCreate, {
      actorToken: token,
      name
    })
    if (!response.ok || !response.data) {
      setTagsError(response.error?.message ?? `Unable to create tag ${name}`)
      return null
    }
    const tag = response.data
    setTags((prev) => [...prev.filter((item) => item.id !== tag.id), tag])
    return { label: tag.name, value: tag.id, color: tag.color }
  }

  const resolveImportedTags = async (tagValues: string[] | undefined): Promise<AppSelectOption[] | null> => {
    if (!tagValues) return null
    const resolved: AppSelectOption[] = []
    let knownTags = tags
    for (const rawValue of tagValues) {
      const value = rawValue.trim()
      if (!value) continue
      const existing = knownTags.find((tag) => tag.id === value || tag.name.toLocaleLowerCase('tr') === value.toLocaleLowerCase('tr'))
      if (existing) {
        resolved.push({ label: existing.name, value: existing.id, color: existing.color })
        continue
      }
      const created = await createTagOption(value)
      if (!created) return null
      resolved.push(created)
      knownTags = [...knownTags, { id: created.value, organizationId: '', name: created.label, color: created.color, updatedAt: Date.now() }]
    }
    return resolved
  }

  const handleCreateTag = async (value: string) => {
    const name = value.trim()
    if (!name) return
    const existing = tags.find((tag) => tag.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))
    if (existing) {
      setSelectedTags((prev) => [...prev.filter((option) => option.value !== existing.id), { label: existing.name, value: existing.id, color: existing.color }])
      return
    }
    const created = await createTagOption(name)
    if (created) setSelectedTags((prev) => [...prev, created])
  }

  const importAgentJson = async () => {
    const result = parseAgentImportJson(importJson)
    if (!result.ok) {
      setImportError(result.error)
      return
    }

    setName(result.patch.name)
    if (result.patch.title !== undefined) setTitle(result.patch.title)
    if (result.patch.description !== undefined) setDescription(result.patch.description)
    if (result.patch.prompt !== undefined) setTrainingMarkdown(result.patch.prompt)
    if (result.patch.config !== undefined) setConfig(result.patch.config)
    const importedTags = await resolveImportedTags(result.patch.tags)
    if (importedTags) setSelectedTags(importedTags)
    setFormError(null)
    if (result.patch.warnings.length > 0) setNotice(result.patch.warnings.join(' '))
    closeImportModal()
  }

  const downloadAgent = (agent: Agent) => {
    downloadMarkdownFile('AGENT.md', buildSingleAgentMarkdown(agent))
  }

  const saveAgent = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setFormError('Agent name is required.')
      return
    }
    setLoading(true)
    const response = await invokeBridge<Agent>(mode === 'edit' ? IPC_CHANNELS.agents.update : IPC_CHANNELS.agents.create, {
      actorToken: token,
      ...(mode === 'edit' ? { id: editingAgent?.id } : {}),
      name: name.trim(),
      title: title.trim(),
      description: description.trim(),
      trainingMarkdown,
      config,
      tagIds: selectedTags.map((tag) => tag.value)
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
          <span>Title / description</span>
          <span>Tags</span>
          <span>Prompt</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {sortedItems.length > 0 ? sortedItems.map((agent) => (
          <div key={agent.id} className={styles.tableRow}>
            <span className={styles.agentCell}>
              <strong>{agent.name}</strong>
              <small>{agent.trainingMarkdown ? 'Prompt added' : 'No prompt'}</small>
            </span>
            <span className={styles.agentCell}>
              <strong>{agent.title || 'No title'}</strong>
              <small>{agent.description || 'No description'}</small>
            </span>
            <span className={styles.tagList}>
              {(agent.tags ?? []).length > 0 ? (agent.tags ?? []).slice(0, 3).map((tag) => <TagPill key={tag.id} tag={tag} compact />) : <em>No tags</em>}
              {(agent.tags ?? []).length > 3 ? <small>+{(agent.tags ?? []).length - 3}</small> : null}
            </span>
            <span className={styles.mutedCell}>{agent.trainingMarkdown?.trim() ? 'Ready' : 'Not set'}</span>
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
                </div>
                <label>
                  <span>Description</span>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Describe the agent's scope, strengths, and boundaries." />
                </label>
                <label>
                  <span>Tags</span>
                  <AppSelect
                    mode="multi"
                    creatable
                    value={selectedTags}
                    options={tagOptions}
                    placeholder={tagsLoading ? 'Loading tags...' : tags.length ? 'Search or create tags...' : 'Create a tag...'}
                    isDisabled={tagsLoading}
                    onChange={setSelectedTags}
                    onCreateOption={(value) => void handleCreateTag(value)}
                  />
                  {tagsError ? (
                    <small className={styles.fieldHelp}>
                      {tagsError} <button type="button" onClick={() => void refreshTags()}>Retry</button>
                    </small>
                  ) : tags.length === 0 && !tagsLoading ? (
                    <small className={styles.fieldHelp}>No tags exist yet. Type a tag name and press Enter to create one.</small>
                  ) : null}
                </label>
                <label>
                  <span>Agent prompt</span>
                  <textarea value={trainingMarkdown} onChange={(event) => setTrainingMarkdown(event.target.value)} rows={7} placeholder="Describe the agent's operating rules, responsibilities, and expected behavior." />
                </label>
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
                    <button type="button" className={styles.primaryButton} onClick={() => void importAgentJson()} disabled={!importJson.trim()}>Import</button>
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
