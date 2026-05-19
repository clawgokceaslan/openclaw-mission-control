import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { LuArrowRight, LuCheck, LuCode, LuDownload, LuPencil, LuPlus, LuSave, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse } from '@shared/contracts/ipc'
import type { Agent, AiTool, AiToolStatus, AiToolType } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { LoadingState } from '@renderer/components/loading'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { buildSingleToolMarkdown } from '@renderer/utils/entityMarkdown'
import { downloadMarkdownFile } from '../projects/detail/taskExport'
import { toolTypeLabel } from './toolFilters'
import styles from './ToolsPage.module.scss'

type ToolTab = 'basics' | 'implementation' | 'context'

type ToolFormState = {
  id?: string
  name: string
  status: AiToolStatus
  toolType: AiToolType
  descriptionMarkdown: string
  codeLanguage: string
  codeBody: string
  functionName: string
  commandTemplate: string
  prepareCommand: string
  workingDirectoryHint: string
  inputSchemaJson: string
  outputSchemaJson: string
  executionFlowMarkdown: string
  approvalRequired: boolean
  timeoutSeconds: string
  agentIds: string[]
}

const PAGE_SIZE = 20
const emptyForm: ToolFormState = {
  name: '',
  status: 'active',
  toolType: 'local_command',
  descriptionMarkdown: '',
  codeLanguage: 'typescript',
  codeBody: '',
  functionName: '',
  commandTemplate: '',
  prepareCommand: '',
  workingDirectoryHint: '',
  inputSchemaJson: '',
  outputSchemaJson: '',
  executionFlowMarkdown: '',
  approvalRequired: true,
  timeoutSeconds: '120',
  agentIds: []
}

const STATUS_OPTIONS: AppSelectOption[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' }
]

const TOOL_TYPE_OPTIONS: AppSelectOption[] = [
  { label: 'All types', value: 'all' },
  { label: 'Local command', value: 'local_command' },
  { label: 'Function', value: 'function' },
  { label: 'Code', value: 'code' },
  { label: 'Reference', value: 'reference' }
]

const FORM_TOOL_TYPE_OPTIONS = TOOL_TYPE_OPTIONS.filter((option) => option.value !== 'all')
const FORM_STATUS_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== 'all')
const TABS: Array<{ id: ToolTab; label: string; summary: string }> = [
  { id: 'basics', label: 'Define', summary: 'Name, type, purpose, status and approval policy.' },
  { id: 'implementation', label: 'Configure', summary: 'Code, command templates and JSON schemas.' },
  { id: 'context', label: 'Connect', summary: 'Runbook, workspace hint and agent links.' }
]

const TAB_GUIDANCE: Record<ToolTab, { title: string; body: string; checklist: string[] }> = {
  basics: {
    title: 'Start with the AI-facing contract',
    body: 'Define what this capability is, when an agent should consider it, and what boundary applies while execution is disabled.',
    checklist: ['Use a clear action-oriented name.', 'Pick the closest tool type.', 'Write usage notes as instructions for the agent.']
  },
  implementation: {
    title: 'Shape the runnable surface',
    body: 'Keep code, commands and schemas together so the implementation details are easy to review without blocking the rest of the form.',
    checklist: ['Keep schemas as JSON objects.', 'Separate preparation from command execution.', 'Leave drafts inactive until the contract is ready.']
  },
  context: {
    title: 'Connect it to project context',
    body: 'Add the operational runbook, workspace hint and agent links that tell Codex when this tool belongs in exported context.',
    checklist: ['Attach only relevant agents.', 'Write execution steps as a short runbook.', 'Save unfinished work as draft when details are still missing.']
  }
}

const TAB_ORDER: ToolTab[] = TABS.map((tab) => tab.id)

function formFromTool(tool: AiTool): ToolFormState {
  return {
    id: tool.id,
    name: tool.name,
    status: tool.status,
    toolType: tool.toolType,
    descriptionMarkdown: tool.descriptionMarkdown ?? '',
    codeLanguage: tool.codeLanguage ?? 'typescript',
    codeBody: tool.codeBody ?? '',
    functionName: tool.functionName ?? '',
    commandTemplate: tool.commandTemplate ?? '',
    prepareCommand: tool.prepareCommand ?? '',
    workingDirectoryHint: tool.workingDirectoryHint ?? '',
    inputSchemaJson: tool.inputSchemaJson ? JSON.stringify(tool.inputSchemaJson, null, 2) : '',
    outputSchemaJson: tool.outputSchemaJson ? JSON.stringify(tool.outputSchemaJson, null, 2) : '',
    executionFlowMarkdown: tool.executionFlowMarkdown ?? '',
    approvalRequired: tool.approvalRequired,
    timeoutSeconds: tool.timeoutSeconds ? String(tool.timeoutSeconds) : '',
    agentIds: tool.agentIds ?? (tool.agents ?? []).map((agent) => agent.id)
  }
}

function parseSchema(value: string, label: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function agentNames(tool: AiTool): string {
  return (tool.agents ?? []).map((agent) => agent.name).filter(Boolean).join(', ') || 'No agents'
}

function isDraftTool(tool: AiTool): boolean {
  if (tool.status !== 'inactive') return false
  return !tool.descriptionMarkdown?.trim()
    || !(tool.codeBody?.trim() || tool.commandTemplate?.trim() || tool.functionName?.trim() || tool.executionFlowMarkdown?.trim())
}

function lineCount(value: string): number {
  return Math.max(1, value.split('\n').length)
}

function codeLineNumbers(value: string): string {
  return Array.from({ length: lineCount(value) }, (_, index) => String(index + 1)).join('\n')
}

type CodeEditorProps = {
  label: string
  language: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  action?: ReactNode
}

function CodeEditor({ label, language, value, onChange, placeholder, rows = 12, action }: CodeEditorProps) {
  return (
    <div className={styles.editorField}>
      <div className={styles.editorLabel}>
        <span>{label}</span>
        {action}
      </div>
      <div className={styles.codeEditorShell}>
        <div className={styles.codeToolbar}>
          <span><LuCode size={14} /> {language || 'text'}</span>
          <span>{lineCount(value)} lines</span>
        </div>
        <div className={styles.codeEditorBody}>
          <pre className={styles.lineNumbers} aria-hidden="true">{codeLineNumbers(value)}</pre>
          <textarea
            className={styles.codeEditorTextarea}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={rows}
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
      </div>
    </div>
  )
}

export function ToolsPage() {
  const { token } = useAuth()
  const [rows, setRows] = useState<AiTool[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AppSelectOption>(STATUS_OPTIONS[0])
  const [toolType, setToolType] = useState<AppSelectOption>(TOOL_TYPE_OPTIONS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<ToolFormState>(emptyForm)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [activeTab, setActiveTab] = useState<ToolTab>('basics')
  const [deleteTarget, setDeleteTarget] = useState<AiTool | null>(null)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = total === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1
  const end = Math.min(total, page * PAGE_SIZE)

  const agentOptions: AppSelectOption[] = useMemo(() => agents.map((agent) => ({ label: agent.name, value: agent.id })), [agents])
  const selectedAgentOptions = useMemo(() => agentOptions.filter((option) => form.agentIds.includes(option.value)), [agentOptions, form.agentIds])
  const activeTabIndex = TAB_ORDER.indexOf(activeTab)
  const activeGuidance = TAB_GUIDANCE[activeTab]

  const tabComplete = (tab: ToolTab): boolean => {
    if (tab === 'basics') return Boolean(form.name.trim() && form.descriptionMarkdown.trim())
    if (tab === 'implementation') return Boolean(form.functionName.trim() || form.inputSchemaJson.trim() || form.outputSchemaJson.trim() || form.commandTemplate.trim() || form.codeBody.trim())
    return Boolean(form.executionFlowMarkdown.trim() || form.workingDirectoryHint.trim() || form.agentIds.length > 0)
  }

  const goToNextTab = () => {
    setActiveTab(TAB_ORDER[Math.min(TAB_ORDER.length - 1, activeTabIndex + 1)])
  }

  const loadTools = async () => {
    setLoading(true)
    const response = await invokeBridge<PaginatedResponse<AiTool>>(IPC_CHANNELS.tools.listPage, {
      actorToken: token,
      page,
      pageSize: PAGE_SIZE,
      query,
      status: status.value === 'active' || status.value === 'inactive' ? status.value : undefined,
      toolType: ['local_command', 'function', 'code', 'reference'].includes(toolType.value) ? toolType.value : undefined
    })
    setLoading(false)
    if (!response.ok || !response.data) {
      setRows([])
      setTotal(0)
      setError(response.error?.message ?? 'Unable to load tools')
      return
    }
    setRows(response.data.rows)
    setTotal(response.data.total)
    setError(null)
  }

  const loadAgents = async () => {
    const response = await loadList<Agent[]>(IPC_CHANNELS.agents.list, token)
    if (response.ok) setAgents(Array.isArray(response.data) ? response.data : [])
  }

  useEffect(() => {
    void loadTools()
  }, [token, page, query, status.value, toolType.value])

  useEffect(() => {
    void loadAgents()
  }, [token])

  const openCreate = () => {
    setForm(emptyForm)
    setActiveTab('basics')
    setModalMode('create')
  }

  const openEdit = (tool: AiTool) => {
    setForm(formFromTool(tool))
    setActiveTab('basics')
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setForm(emptyForm)
    setError(null)
  }

  const updateForm = <K extends keyof ToolFormState>(key: K, value: ToolFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const formatJsonField = (key: 'inputSchemaJson' | 'outputSchemaJson') => {
    try {
      const value = form[key]
      if (!value.trim()) return
      updateForm(key, JSON.stringify(parseSchema(value, key === 'inputSchemaJson' ? 'Input schema' : 'Output schema'), null, 2))
      setError(null)
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Schema must be valid JSON.')
      setActiveTab(key === 'inputSchemaJson' || key === 'outputSchemaJson' ? 'implementation' : activeTab)
    }
  }

  const saveTool = async (saveAsDraft: boolean) => {
    const name = form.name.trim() || (saveAsDraft ? 'Untitled tool draft' : '')
    if (!name) {
      setError('Tool name is required.')
      return
    }
    let inputSchemaJson: Record<string, unknown> | undefined
    let outputSchemaJson: Record<string, unknown> | undefined
    try {
      inputSchemaJson = parseSchema(form.inputSchemaJson, 'Input schema')
      outputSchemaJson = parseSchema(form.outputSchemaJson, 'Output schema')
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Schema must be valid JSON.')
      setActiveTab('implementation')
      return
    }
    setLoading(true)
    const response = await invokeBridge<AiTool>(modalMode === 'edit' ? IPC_CHANNELS.tools.update : IPC_CHANNELS.tools.create, {
      actorToken: token,
      ...(modalMode === 'edit' ? { id: form.id } : {}),
      name,
      status: saveAsDraft ? 'inactive' : form.status,
      toolType: form.toolType,
      descriptionMarkdown: form.descriptionMarkdown,
      codeLanguage: form.codeLanguage,
      codeBody: form.codeBody,
      functionName: form.functionName,
      commandTemplate: form.commandTemplate,
      prepareCommand: form.prepareCommand,
      workingDirectoryHint: form.workingDirectoryHint,
      inputSchemaJson,
      outputSchemaJson,
      executionFlowMarkdown: form.executionFlowMarkdown,
      approvalRequired: form.approvalRequired,
      timeoutSeconds: form.timeoutSeconds.trim() ? Number(form.timeoutSeconds) : null,
      agentIds: form.agentIds
    })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to save tool')
      return
    }
    closeModal()
    setNotice(saveAsDraft ? 'Draft tool saved.' : 'Tool saved.')
    await loadTools()
    await loadAgents()
  }

  const submitTool = async (event: FormEvent) => {
    event.preventDefault()
    await saveTool(false)
  }

  const removeTool = async () => {
    if (!deleteTarget) return
    setLoading(true)
    const response = await invokeBridge<{ ok: true }>(IPC_CHANNELS.tools.remove, { actorToken: token, id: deleteTarget.id })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete tool')
      return
    }
    setDeleteTarget(null)
    setNotice('Tool deleted.')
    await loadTools()
    await loadAgents()
  }

  const downloadTool = (tool: AiTool) => {
    downloadMarkdownFile('TOOL.md', buildSingleToolMarkdown(tool))
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Tools</h1>
          <p>{total} AI tool definitions configured. Catalog only; execution is disabled in this phase.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryButton} onClick={openCreate}>
            <LuPlus size={16} />
            Add tool
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}

      <section className={styles.guideStrip} aria-label="Tool catalog flow">
        <div>
          <strong>1. Define</strong>
          <span>Name the capability and write AI-facing usage notes.</span>
        </div>
        <div>
          <strong>2. Shape</strong>
          <span>Add code, schemas, commands and the execution runbook.</span>
        </div>
        <div>
          <strong>3. Attach</strong>
          <span>Link active agents so exports include the tool as catalog context.</span>
        </div>
      </section>

      <section className={styles.filterBar}>
        <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search tools..." />
        <AppSelect className={styles.filterSelect} mode="single" value={status} options={STATUS_OPTIONS} onChange={(value) => { setStatus(value ?? STATUS_OPTIONS[0]); setPage(1) }} />
        <AppSelect className={styles.filterSelect} mode="single" value={toolType} options={TOOL_TYPE_OPTIONS} onChange={(value) => { setToolType(value ?? TOOL_TYPE_OPTIONS[0]); setPage(1) }} />
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <span>Tool</span>
          <span>Type</span>
          <span>Status</span>
          <span>Linked agents</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {loading && rows.length === 0 ? (
          <LoadingState variant="skeleton" rows={5} columns={6} messageIndex={1} />
        ) : rows.length > 0 ? rows.map((tool) => (
          <div key={tool.id} className={styles.tableRow}>
            <span className={styles.primaryCell}>
              <strong>{tool.name} {isDraftTool(tool) ? <b className={styles.draftBadge}>Draft</b> : null}</strong>
              <small>{tool.descriptionMarkdown || tool.slug}</small>
            </span>
            <span><b className={styles.typePill}>{toolTypeLabel(tool.toolType)}</b></span>
            <span><b className={`${styles.statusPill} ${tool.status === 'inactive' ? styles.inactive : ''}`}>{tool.status}</b></span>
            <span className={styles.mutedCell}><small>{agentNames(tool)}</small></span>
            <span className={styles.mutedCell}><small>{new Date(tool.updatedAt).toLocaleString()}</small></span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => downloadTool(tool)} aria-label={`Download ${tool.name}`}>
                <LuDownload size={15} />
              </button>
              <button type="button" className={styles.iconButton} onClick={() => openEdit(tool)} aria-label={`Edit ${tool.name}`}>
                <LuPencil size={15} />
              </button>
              <button type="button" className={`${styles.iconButton} ${styles.dangerIconButton}`} onClick={() => setDeleteTarget(tool)} aria-label={`Delete ${tool.name}`}>
                <LuTrash2 size={15} />
              </button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>No tools found.</div>
        )}
      </section>

      <footer className={styles.pagination}>
        <span>{start}-{end} of {total}</span>
        <button type="button" className={styles.secondaryButton} onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>Previous</button>
        <span>Page {page} / {totalPages}</span>
        <button type="button" className={styles.secondaryButton} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>Next</button>
      </footer>

      {modalMode ? (
        <>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <section className={styles.toolModal} role="dialog" aria-modal="true" aria-label={modalMode === 'edit' ? 'Edit tool' : 'Add tool'}>
            <header className={styles.modalHeader}>
              <div>
                <h2>{modalMode === 'edit' ? 'Edit tool' : 'Add tool'}</h2>
                <p>Catalog-only definition. Commands and code are exported as context, not executed.</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={closeModal} aria-label="Close tool modal"><LuX size={16} /></button>
            </header>
            <form className={styles.toolForm} onSubmit={submitTool}>
              <div className={styles.toolFormContent}>
                <nav className={styles.stepRail} aria-label="Tool editor sections">
                  {TABS.map((tab, index) => {
                    const complete = tabComplete(tab.id)
                    return (
                      <button key={tab.id} type="button" className={`${styles.stepButton} ${activeTab === tab.id ? styles.activeStep : ''}`} onClick={() => setActiveTab(tab.id)}>
                        <span className={`${styles.stepBadge} ${complete ? styles.stepComplete : ''}`}>{complete ? <LuCheck size={13} /> : index + 1}</span>
                        <span>
                          <strong>{tab.label}</strong>
                          <small>{tab.summary}</small>
                        </span>
                      </button>
                    )
                  })}
                </nav>

                <section className={styles.editorPane}>
                  <div className={styles.guidanceCard}>
                    <div>
                      <span className={styles.stepKicker}>Step {activeTabIndex + 1} of {TABS.length}</span>
                      <h3>{activeGuidance.title}</h3>
                      <p>{activeGuidance.body}</p>
                    </div>
                    <ul>
                      {activeGuidance.checklist.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>

                  {activeTab === 'basics' ? (
                    <>
                      <div className={styles.formGrid}>
                        <label>
                          <span>Name *</span>
                          <input autoFocus value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="e.g. List changed files" />
                        </label>
                        <label>
                          <span>Type</span>
                          <AppSelect mode="single" value={FORM_TOOL_TYPE_OPTIONS.find((option) => option.value === form.toolType)} options={FORM_TOOL_TYPE_OPTIONS} onChange={(value) => updateForm('toolType', (value?.value as AiToolType | undefined) ?? 'local_command')} />
                        </label>
                      </div>
                      <div className={styles.formGrid}>
                        <label>
                          <span>Status</span>
                          <AppSelect mode="single" value={FORM_STATUS_OPTIONS.find((option) => option.value === form.status)} options={FORM_STATUS_OPTIONS} onChange={(value) => updateForm('status', (value?.value as AiToolStatus | undefined) ?? 'active')} />
                        </label>
                        <label>
                          <span>Timeout seconds</span>
                          <input value={form.timeoutSeconds} onChange={(event) => updateForm('timeoutSeconds', event.target.value)} placeholder="120" inputMode="numeric" />
                        </label>
                      </div>
                      <label>
                        <span>AI usage notes</span>
                        <textarea value={form.descriptionMarkdown} onChange={(event) => updateForm('descriptionMarkdown', event.target.value)} rows={7} placeholder={'When to use:\nInputs needed:\nExpected result:\nDo not use when:'} />
                      </label>
                      <label className={styles.checkboxField}>
                        <input type="checkbox" checked={form.approvalRequired} onChange={(event) => updateForm('approvalRequired', event.target.checked)} />
                        <span>Approval required before future execution</span>
                      </label>
                    </>
                  ) : null}

                  {activeTab === 'implementation' ? (
                    <>
                      <label>
                        <span>Code language</span>
                        <input value={form.codeLanguage} onChange={(event) => updateForm('codeLanguage', event.target.value)} placeholder="typescript" />
                      </label>
                      <CodeEditor
                        label="Code body"
                        language={form.codeLanguage}
                        value={form.codeBody}
                        onChange={(value) => updateForm('codeBody', value)}
                        rows={18}
                        placeholder={'// Tool implementation notes or code snippet\nexport async function run(input) {\n  return input\n}'}
                      />
                    </>
                  ) : null}

                  {activeTab === 'implementation' ? (
                    <>
                      <label>
                        <span>Function name</span>
                        <input value={form.functionName} onChange={(event) => updateForm('functionName', event.target.value)} placeholder="list_changed_files" />
                      </label>
                      <div className={styles.editorGrid}>
                        <CodeEditor
                          label="Input schema JSON"
                          language="json"
                          value={form.inputSchemaJson}
                          onChange={(value) => updateForm('inputSchemaJson', value)}
                          rows={14}
                          placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
                          action={<button type="button" className={styles.editorAction} onClick={() => formatJsonField('inputSchemaJson')}>Format</button>}
                        />
                        <CodeEditor
                          label="Output schema JSON"
                          language="json"
                          value={form.outputSchemaJson}
                          onChange={(value) => updateForm('outputSchemaJson', value)}
                          rows={14}
                          placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
                          action={<button type="button" className={styles.editorAction} onClick={() => formatJsonField('outputSchemaJson')}>Format</button>}
                        />
                      </div>
                    </>
                  ) : null}

                  {activeTab === 'implementation' ? (
                    <>
                      <CodeEditor
                        label="Prepare command"
                        language="shell"
                        value={form.prepareCommand}
                        onChange={(value) => updateForm('prepareCommand', value)}
                        rows={7}
                        placeholder={'npm install\nnpm run build'}
                      />
                      <CodeEditor
                        label="Command template"
                        language="shell"
                        value={form.commandTemplate}
                        onChange={(value) => updateForm('commandTemplate', value)}
                        rows={9}
                        placeholder="npm test -- --runInBand"
                      />
                    </>
                  ) : null}

                  {activeTab === 'context' ? (
                    <>
                      <label>
                        <span>Working directory hint</span>
                        <input value={form.workingDirectoryHint} onChange={(event) => updateForm('workingDirectoryHint', event.target.value)} placeholder="Project runtime workspace" />
                      </label>
                      <CodeEditor
                        label="Execution flow"
                        language="markdown"
                        value={form.executionFlowMarkdown}
                        onChange={(value) => updateForm('executionFlowMarkdown', value)}
                        rows={18}
                        placeholder={'1. Prepare inputs\n2. Validate command and required files\n3. Ask for explicit approval before any future execution\n4. Parse output and report failures'}
                      />
                      <label>
                        <span>Attach to agents</span>
                        <AppSelect mode="multi" value={selectedAgentOptions} options={agentOptions} placeholder="Select active agents..." onChange={(options) => updateForm('agentIds', options.map((option) => option.value))} />
                        <small className={styles.fieldHelp}>Linked tools are exported as catalog context for the selected agents. They are not invoked in v1.</small>
                      </label>
                    </>
                  ) : null}

                  <div className={styles.sectionActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => setActiveTab(TAB_ORDER[Math.max(0, activeTabIndex - 1)])} disabled={activeTabIndex <= 0}>Previous step</button>
                    <button type="button" className={styles.secondaryButton} onClick={goToNextTab} disabled={activeTabIndex >= TAB_ORDER.length - 1}>
                      Next step
                      <LuArrowRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={closeModal}>Cancel</button>
                <button type="button" className={styles.secondaryButton} onClick={() => void saveTool(true)} disabled={loading}>
                  <LuSave size={14} />
                  Save draft
                </button>
                <button type="submit" className={styles.primaryButton} disabled={loading || !form.name.trim()}>{loading ? <LoadingState size="compact" messageIndex={2} /> : modalMode === 'edit' ? 'Save changes' : 'Add tool'}</button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteTarget(null)} />
          <section className={`${styles.toolModal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-label={`Delete ${deleteTarget.name}`}>
            <header className={styles.modalHeader}>
              <h2>Delete tool</h2>
              <button type="button" className={styles.iconButton} onClick={() => setDeleteTarget(null)} aria-label="Close delete modal"><LuX size={16} /></button>
            </header>
            <div className={styles.confirmBody}>
              <p>Delete <strong>{deleteTarget.name}</strong>? This only removes the catalog definition.</p>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button type="button" className={styles.dangerButton} onClick={() => void removeTool()} disabled={loading}>{loading ? <LoadingState size="compact" messageIndex={3} /> : 'Delete'}</button>
              </footer>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
