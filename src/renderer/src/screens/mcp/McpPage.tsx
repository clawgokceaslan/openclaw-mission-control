import { FormEvent, useEffect, useMemo, useState } from 'react'
import { LuActivity, LuCheck, LuKeyRound, LuLink, LuPencil, LuPlay, LuPlus, LuRefreshCw, LuServer, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, McpAuditEvent, McpCapability, McpRiskTier, McpServer, McpTransport, Project, Skill } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { LoadingState } from '@renderer/components/loading'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import styles from './McpPage.module.scss'

type Tab = 'servers' | 'discovery' | 'links' | 'oauth'

type ServerForm = {
  id?: string
  name: string
  transport: McpTransport
  command: string
  args: string
  cwd: string
  url: string
  authType: 'none' | 'bearer_env' | 'oauth'
  bearerTokenEnvVar: string
  riskTier: McpRiskTier
  enabled: boolean
  required: boolean
  startupTimeoutSec: string
  toolTimeoutSec: string
}

const emptyForm: ServerForm = {
  name: '',
  transport: 'stdio',
  command: 'npx',
  args: '',
  cwd: '',
  url: '',
  authType: 'none',
  bearerTokenEnvVar: '',
  riskTier: 'medium',
  enabled: true,
  required: false,
  startupTimeoutSec: '10',
  toolTimeoutSec: '60'
}

const tabs: Array<{ id: Tab; label: string; icon: typeof LuServer }> = [
  { id: 'servers', label: 'Servers', icon: LuServer },
  { id: 'discovery', label: 'Discovery', icon: LuRefreshCw },
  { id: 'links', label: 'Links & Policy', icon: LuLink },
  { id: 'oauth', label: 'OAuth & Audit', icon: LuActivity }
]

const SERVER_STEPS = [
  { id: 0, label: 'Basics', summary: 'Name, transport and risk tier.' },
  { id: 1, label: 'Connection', summary: 'Local command or remote URL and auth.' },
  { id: 2, label: 'Policy', summary: 'Timeout, enabled and required behavior.' }
] as const

const SERVER_STEP_GUIDANCE: Record<number, { title: string; body: string; checklist: string[] }> = {
  0: {
    title: 'Define the MCP boundary',
    body: 'Choose whether OMC hosts a local stdio process or a remote Streamable HTTP endpoint, then set the risk tier used by approval policy.',
    checklist: ['Use a recognizable server name.', 'Select stdio for local subprocesses.', 'Mark risky or destructive servers as high or critical.']
  },
  1: {
    title: 'Configure the connection',
    body: 'Local servers run with command allowlisting and absolute cwd validation. Remote servers are HTTPS-first and can use bearer env refs or OAuth.',
    checklist: ['Keep secrets in environment variables.', 'Use absolute cwd for stdio servers.', 'Use OAuth only for remote Streamable HTTP servers.']
  },
  2: {
    title: 'Set runtime policy',
    body: 'Timeouts and required/enabled flags decide what the OMC proxy can expose during Codex runs without changing Codex config.toml.',
    checklist: ['Disable experiments until discovery passes.', 'Use required for baseline project capability.', 'Keep tool timeouts strict for unknown servers.']
  }
}

const transportOptions: AppSelectOption[] = [
  { label: 'Local stdio', value: 'stdio' },
  { label: 'Remote Streamable HTTP', value: 'streamable_http' }
]

const authOptions: AppSelectOption[] = [
  { label: 'No auth', value: 'none' },
  { label: 'Bearer token env ref', value: 'bearer_env' },
  { label: 'OAuth PKCE', value: 'oauth' }
]

const riskOptions: AppSelectOption[] = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' }
]

function formFromServer(server: McpServer): ServerForm {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? '',
    args: (server.args ?? []).join(' '),
    cwd: server.cwd ?? '',
    url: server.url ?? '',
    authType: server.auth.type,
    bearerTokenEnvVar: server.auth.bearerTokenEnvVar ?? '',
    riskTier: server.riskTier,
    enabled: server.enabled,
    required: server.required,
    startupTimeoutSec: server.startupTimeoutSec ? String(server.startupTimeoutSec) : '',
    toolTimeoutSec: server.toolTimeoutSec ? String(server.toolTimeoutSec) : ''
  }
}

function option(value: string, options: AppSelectOption[]): AppSelectOption {
  return options.find((item) => item.value === value) ?? options[0]
}

function splitArgs(value: string): string[] {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
}

function capabilityRows(server?: McpServer): McpCapability[] {
  return server?.capabilities ?? []
}

function serverNames(servers: McpServer[] | undefined): string {
  return servers?.map((server) => server.name).join(', ') || 'No MCP servers'
}

function formStepComplete(form: ServerForm, step: number): boolean {
  if (step === 0) return Boolean(form.name.trim() && form.transport && form.riskTier)
  if (step === 1) {
    if (form.transport === 'stdio') return Boolean(form.command.trim())
    return Boolean(form.url.trim() && (form.authType !== 'bearer_env' || form.bearerTokenEnvVar.trim()))
  }
  return Boolean(form.startupTimeoutSec || form.toolTimeoutSec || form.enabled || form.required)
}

export function McpPage() {
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('servers')
  const [servers, setServers] = useState<McpServer[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [audit, setAudit] = useState<McpAuditEvent[]>([])
  const [selectedServerId, setSelectedServerId] = useState('')
  const [selectedOwnerKind, setSelectedOwnerKind] = useState<'agent' | 'skill' | 'project'>('agent')
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [form, setForm] = useState<ServerForm>(emptyForm)
  const [serverModalOpen, setServerModalOpen] = useState(false)
  const [formStep, setFormStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedServer = useMemo(() => servers.find((server) => server.id === selectedServerId) ?? servers[0], [servers, selectedServerId])
  const serverOptions = useMemo(() => servers.map((server) => ({ label: server.name, value: server.id })), [servers])
  const ownerOptions = useMemo(() => {
    const rows = selectedOwnerKind === 'agent' ? agents : selectedOwnerKind === 'skill' ? skills : projects
    return rows.map((row) => ({ label: row.name, value: row.id }))
  }, [agents, projects, selectedOwnerKind, skills])
  const activeStepGuidance = SERVER_STEP_GUIDANCE[formStep]

  const openCreateModal = () => {
    setForm(emptyForm)
    setFormStep(0)
    setServerModalOpen(true)
  }

  const openEditModal = (server: McpServer) => {
    setSelectedServerId(server.id)
    setForm(formFromServer(server))
    setFormStep(0)
    setServerModalOpen(true)
  }

  const refresh = async () => {
    setLoading(true)
    setError(null)
    const [serverResult, agentResult, skillResult, projectResult, auditResult] = await Promise.all([
      loadList<McpServer[]>(IPC_CHANNELS.mcp.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      invokeBridge<McpAuditEvent[]>(IPC_CHANNELS.mcp.audit, { actorToken: token, limit: 50 })
    ])
    setLoading(false)
    if (!serverResult.ok) {
      setError(serverResult.error?.message ?? 'MCP servers could not be loaded.')
      return
    }
    setServers(serverResult.data ?? [])
    setAgents(agentResult.ok ? agentResult.data ?? [] : [])
    setSkills(skillResult.ok ? skillResult.data ?? [] : [])
    setProjects(projectResult.ok ? projectResult.data ?? [] : [])
    setAudit(auditResult.ok ? auditResult.data ?? [] : [])
    if (!selectedServerId && serverResult.data?.[0]) setSelectedServerId(serverResult.data[0].id)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const saveServer = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)
    setError(null)
    const payload = {
      actorToken: token,
      id: form.id,
      name: form.name,
      transport: form.transport,
      command: form.transport === 'stdio' ? form.command : '',
      args: form.transport === 'stdio' ? splitArgs(form.args) : [],
      cwd: form.transport === 'stdio' ? form.cwd : '',
      url: form.transport === 'streamable_http' ? form.url : '',
      authType: form.transport === 'streamable_http' ? form.authType : 'none',
      bearerTokenEnvVar: form.authType === 'bearer_env' ? form.bearerTokenEnvVar : '',
      riskTier: form.riskTier,
      enabled: form.enabled,
      required: form.required,
      startupTimeoutSec: form.startupTimeoutSec ? Number(form.startupTimeoutSec) : null,
      toolTimeoutSec: form.toolTimeoutSec ? Number(form.toolTimeoutSec) : null
    }
    const result = await invokeBridge<McpServer>(form.id ? IPC_CHANNELS.mcp.update : IPC_CHANNELS.mcp.create, payload)
    if (!result.ok) {
      setError(result.error?.message ?? 'MCP server could not be saved.')
      return
    }
    setNotice('MCP server saved.')
    setForm(emptyForm)
    setServerModalOpen(false)
    setFormStep(0)
    setSelectedServerId(result.data?.id ?? selectedServerId)
    await refresh()
  }

  const removeServer = async (server: McpServer) => {
    const result = await invokeBridge<{ ok: true }>(IPC_CHANNELS.mcp.remove, { actorToken: token, id: server.id })
    if (!result.ok) {
      setError(result.error?.message ?? 'MCP server could not be removed.')
      return
    }
    setNotice('MCP server removed.')
    setForm(emptyForm)
    await refresh()
  }

  const runAction = async (channel: string, success: string, serverOverride?: McpServer) => {
    const targetServer = serverOverride ?? selectedServer
    if (!targetServer) return
    setSelectedServerId(targetServer.id)
    setNotice(null)
    setError(null)
    const result = await invokeBridge(channel, { actorToken: token, id: targetServer.id })
    if (!result.ok) {
      setError(result.error?.message ?? success)
      return
    }
    setNotice(success)
    await refresh()
  }

  const linkSelected = async () => {
    if (!selectedOwnerId || !selectedServer) return
    const channel = selectedOwnerKind === 'agent'
      ? IPC_CHANNELS.mcp.linkAgents
      : selectedOwnerKind === 'skill'
        ? IPC_CHANNELS.mcp.linkSkills
        : IPC_CHANNELS.mcp.linkProjects
    const result = await invokeBridge(channel, {
      actorToken: token,
      ownerId: selectedOwnerId,
      links: [{ serverId: selectedServer.id, approvalPolicy: selectedServer.riskTier === 'low' ? 'auto' : 'ask', linkType: selectedOwnerKind === 'skill' ? 'recommended' : undefined }]
    })
    if (!result.ok) {
      setError(result.error?.message ?? 'MCP link could not be saved.')
      return
    }
    setNotice('MCP policy link saved.')
    await refresh()
  }

  const loginOAuth = async (serverOverride?: McpServer) => {
    const targetServer = serverOverride ?? selectedServer
    if (!targetServer) return
    setSelectedServerId(targetServer.id)
    const result = await invokeBridge<{ authorizationUrl: string }>(IPC_CHANNELS.mcp.oauthStart, { actorToken: token, id: targetServer.id })
    if (!result.ok) {
      setError(result.error?.message ?? 'OAuth login could not start.')
      return
    }
    setNotice('OAuth login opened in the browser.')
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>MCP</h1>
          <p>{servers.length} MCP servers configured. OMC hosts discovery, OAuth and Codex proxy policy without editing Codex config.toml.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryButton} onClick={openCreateModal}>
            <LuPlus size={16} /> New server
          </button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="MCP sections">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button key={tab.id} type="button" className={activeTab === tab.id ? styles.activeTab : ''} onClick={() => setActiveTab(tab.id)}>
              <Icon size={16} /> {tab.label}
            </button>
          )
        })}
      </nav>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {loading && <LoadingState label="Loading MCP configuration..." />}

      <section className={styles.guideStrip} aria-label="MCP host flow">
        <div>
          <strong>1. Register</strong>
          <span>Add local stdio or remote Streamable HTTP servers in OMC.</span>
        </div>
        <div>
          <strong>2. Discover</strong>
          <span>Cache tools, resources and prompts before exposing them to runs.</span>
        </div>
        <div>
          <strong>3. Link</strong>
          <span>Attach servers to agents, skills or projects with policy scope.</span>
        </div>
        <div>
          <strong>4. Proxy</strong>
          <span>Codex receives only the transient OMC MCP proxy per run.</span>
        </div>
      </section>

      <section className={styles.layout}>
        <div className={styles.content}>
          {activeTab === 'servers' && (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>Servers</h2>
                <div className={styles.actions}>
                  <button type="button" onClick={refresh}><LuRefreshCw size={15} /> Refresh</button>
                  <button type="button" className={styles.primaryButton} onClick={openCreateModal}><LuPlus size={15} /> New server</button>
                </div>
              </div>
              <div className={styles.tableCard}>
                <div className={styles.serverTableHead}>
                  <span>Name</span>
                  <span>Transport</span>
                  <span>Status</span>
                  <span>Risk</span>
                  <span>Capabilities</span>
                  <span>Actions</span>
                </div>
                {servers.map((server) => (
                  <div key={server.id} className={`${styles.serverTableRow} ${selectedServer?.id === server.id ? styles.selectedServerRow : ''}`}>
                    <button type="button" className={styles.serverNameButton} onClick={() => setSelectedServerId(server.id)}>
                      <strong>{server.name}</strong>
                      <small>{server.url || [server.command, ...(server.args ?? [])].filter(Boolean).join(' ') || server.slug}</small>
                    </button>
                    <span>{server.transport}</span>
                    <span>{server.status}{server.enabled ? '' : ' · disabled'}</span>
                    <span>{server.riskTier}{server.required ? ' · required' : ''}</span>
                    <span>{server.capabilities?.length ?? 0}</span>
                    <div className={styles.actionsCell}>
                      <button type="button" className={styles.iconButton} onClick={() => openEditModal(server)} aria-label={`Edit ${server.name}`}><LuPencil size={15} /></button>
                      <button type="button" onClick={() => runAction(IPC_CHANNELS.mcp.test, 'MCP test completed.', server)}>Test</button>
                      <button type="button" onClick={() => runAction(IPC_CHANNELS.mcp.discover, 'MCP discovery refreshed.', server)}>Discover</button>
                      {server.auth.type === 'oauth' && <button type="button" onClick={() => loginOAuth(server)}>OAuth</button>}
                      <button type="button" className={`${styles.iconButton} ${styles.dangerIconButton}`} onClick={() => removeServer(server)} aria-label={`Remove ${server.name}`}><LuTrash2 size={15} /></button>
                    </div>
                  </div>
                ))}
                {servers.length === 0 && <p className={styles.empty}>No MCP servers yet.</p>}
              </div>
            </section>
          )}

          {activeTab === 'discovery' && (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>Discovery</h2>
                <div className={styles.actions}>
                  <AppSelect value={selectedServer ? { label: selectedServer.name, value: selectedServer.id } : serverOptions[0]} options={serverOptions} onChange={(next) => setSelectedServerId(next.value)} />
                  <button type="button" onClick={() => runAction(IPC_CHANNELS.mcp.test, 'MCP test completed.')}><LuPlay size={15} /> Test</button>
                  <button type="button" onClick={() => runAction(IPC_CHANNELS.mcp.discover, 'MCP discovery refreshed.')}><LuRefreshCw size={15} /> Refresh</button>
                </div>
              </div>
              <div className={styles.capabilityTable}>
                <div className={styles.tableHead}><span>Type</span><span>Name</span><span>Description</span></div>
                {capabilityRows(selectedServer).map((capability) => (
                  <div key={capability.id} className={styles.tableRow}>
                    <span>{capability.capabilityType}</span>
                    <strong>{capability.title || capability.name}</strong>
                    <span>{capability.description || '-'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'links' && (
            <section className={styles.panel}>
              <h2>Links & Policy</h2>
              <div className={styles.grid}>
                <label>Target type<AppSelect value={{ label: selectedOwnerKind, value: selectedOwnerKind }} options={[{ label: 'Agent', value: 'agent' }, { label: 'Skill', value: 'skill' }, { label: 'Project', value: 'project' }]} onChange={(next) => { setSelectedOwnerKind(next.value as typeof selectedOwnerKind); setSelectedOwnerId('') }} /></label>
                <label>Target<AppSelect value={ownerOptions.find((item) => item.value === selectedOwnerId) ?? ownerOptions[0]} options={ownerOptions} onChange={(next) => setSelectedOwnerId(next.value)} /></label>
                <label>Server<AppSelect value={selectedServer ? { label: selectedServer.name, value: selectedServer.id } : serverOptions[0]} options={serverOptions} onChange={(next) => setSelectedServerId(next.value)} /></label>
              </div>
              <button type="button" className={styles.primaryButton} onClick={linkSelected}><LuLink size={16} /> Link selected server</button>
              <div className={styles.linkLists}>
                <h3>Agent MCP</h3>
                {agents.map((agent) => <p key={agent.id}><strong>{agent.name}</strong><span>{serverNames(agent.mcpServers)}</span></p>)}
                <h3>Skill MCP</h3>
                {skills.map((skill) => <p key={skill.id}><strong>{skill.name}</strong><span>{serverNames(skill.mcpServers)}</span></p>)}
                <h3>Project MCP</h3>
                {projects.map((project) => <p key={project.id}><strong>{project.name}</strong><span>{serverNames(project.mcpServers as McpServer[] | undefined)}</span></p>)}
              </div>
            </section>
          )}

          {activeTab === 'oauth' && (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>OAuth & Audit</h2>
                <div className={styles.actions}>
                  <button type="button" onClick={loginOAuth}><LuKeyRound size={15} /> Login</button>
                  <button type="button" onClick={() => runAction(IPC_CHANNELS.mcp.oauthLogout, 'OAuth token removed.')}><LuTrash2 size={15} /> Logout</button>
                </div>
              </div>
              <div className={styles.auditList}>
                {audit.map((event) => (
                  <article key={event.id}>
                    <time>{new Date(event.createdAt).toLocaleString()}</time>
                    <strong>{event.eventType} · {event.status}</strong>
                    <span>{event.summary || '-'}</span>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>

      {serverModalOpen && (
        <>
          <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setServerModalOpen(false)} />
          <section className={styles.serverModal} role="dialog" aria-modal="true" aria-label={form.id ? 'Edit MCP server' : 'Create MCP server'}>
          <form className={styles.serverForm} onSubmit={saveServer}>
            <header className={styles.modalHeader}>
              <div>
                <h2>{form.id ? 'Edit MCP server' : 'Create MCP server'}</h2>
                <p>OMC-managed MCP server. Local, remote, OAuth and proxy policy stay scoped to OMC.</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={() => setServerModalOpen(false)} aria-label="Close MCP server modal"><LuX size={16} /></button>
            </header>
            <div className={styles.serverFormContent}>
              <aside className={styles.stepRail} aria-label="MCP server editor sections">
                {SERVER_STEPS.map((step) => {
                  const complete = formStepComplete(form, step.id)
                  return (
                    <button key={step.id} type="button" className={`${styles.stepButton} ${formStep === step.id ? styles.activeStep : ''}`} onClick={() => setFormStep(step.id)}>
                      <span className={`${styles.stepBadge} ${complete ? styles.stepComplete : ''}`}>{complete ? <LuCheck size={13} /> : step.id + 1}</span>
                      <span>
                        <strong>{step.label}</strong>
                        <small>{step.summary}</small>
                      </span>
                    </button>
                  )
                })}
              </aside>
              <section className={styles.editorPane}>
                <div className={styles.guidanceCard}>
                  <div>
                    <span className={styles.stepKicker}>Step {formStep + 1} of {SERVER_STEPS.length}</span>
                    <h3>{activeStepGuidance.title}</h3>
                    <p>{activeStepGuidance.body}</p>
                  </div>
                  <ul>
                    {activeStepGuidance.checklist.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                {formStep === 0 && (
                  <div className={styles.formStep}>
                    <label><span>Name</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>
                    <div className={styles.grid}>
                      <label><span>Transport</span><AppSelect value={option(form.transport, transportOptions)} options={transportOptions} onChange={(next) => setForm((current) => ({ ...current, transport: next.value as McpTransport }))} /></label>
                      <label><span>Risk tier</span><AppSelect value={option(form.riskTier, riskOptions)} options={riskOptions} onChange={(next) => setForm((current) => ({ ...current, riskTier: next.value as McpRiskTier }))} /></label>
                    </div>
                  </div>
                )}
                {formStep === 1 && (
                  <div className={styles.formStep}>
                    {form.transport === 'stdio' ? (
                      <div className={styles.grid}>
                        <label><span>Command</span><input value={form.command} onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))} /></label>
                        <label><span>Args</span><input value={form.args} onChange={(event) => setForm((current) => ({ ...current, args: event.target.value }))} placeholder="-y @scope/server" /></label>
                        <label className={styles.full}><span>CWD</span><input value={form.cwd} onChange={(event) => setForm((current) => ({ ...current, cwd: event.target.value }))} placeholder="/absolute/project/path" /></label>
                      </div>
                    ) : (
                      <div className={styles.grid}>
                        <label className={styles.full}><span>URL</span><input value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://example.com/mcp" /></label>
                        <label><span>Auth</span><AppSelect value={option(form.authType, authOptions)} options={authOptions} onChange={(next) => setForm((current) => ({ ...current, authType: next.value as ServerForm['authType'] }))} /></label>
                        <label><span>Bearer env</span><input value={form.bearerTokenEnvVar} onChange={(event) => setForm((current) => ({ ...current, bearerTokenEnvVar: event.target.value }))} placeholder="MCP_API_TOKEN" /></label>
                      </div>
                    )}
                  </div>
                )}
                {formStep === 2 && (
                  <div className={styles.formStep}>
                    <div className={styles.grid}>
                      <label><span>Startup timeout</span><input type="number" min="1" value={form.startupTimeoutSec} onChange={(event) => setForm((current) => ({ ...current, startupTimeoutSec: event.target.value }))} /></label>
                      <label><span>Tool timeout</span><input type="number" min="1" value={form.toolTimeoutSec} onChange={(event) => setForm((current) => ({ ...current, toolTimeoutSec: event.target.value }))} /></label>
                    </div>
                    <div className={styles.switches}>
                      <label className={styles.checkboxField}><input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /> Enabled</label>
                      <label className={styles.checkboxField}><input type="checkbox" checked={form.required} onChange={(event) => setForm((current) => ({ ...current, required: event.target.checked }))} /> Required</label>
                    </div>
                  </div>
                )}
              </section>
            </div>
            <div className={styles.modalFooter}>
              <button type="button" disabled={formStep === 0} onClick={() => setFormStep((current) => Math.max(0, current - 1))}>Back</button>
              {formStep < 2 ? (
                <button type="button" className={styles.primaryButton} onClick={() => setFormStep((current) => Math.min(2, current + 1))}>Next</button>
              ) : (
                <button type="submit" className={styles.primaryButton}>Save server</button>
              )}
            </div>
          </form>
          </section>
        </>
      )}
    </section>
  )
}
