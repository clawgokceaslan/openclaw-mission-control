import { FormEvent, useEffect, useMemo, useState } from 'react'
import { LuActivity, LuKeyRound, LuLink, LuPlay, LuPlus, LuRefreshCw, LuServer, LuTrash2 } from 'react-icons/lu'
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
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedServer = useMemo(() => servers.find((server) => server.id === selectedServerId) ?? servers[0], [servers, selectedServerId])
  const serverOptions = useMemo(() => servers.map((server) => ({ label: server.name, value: server.id })), [servers])
  const ownerOptions = useMemo(() => {
    const rows = selectedOwnerKind === 'agent' ? agents : selectedOwnerKind === 'skill' ? skills : projects
    return rows.map((row) => ({ label: row.name, value: row.id }))
  }, [agents, projects, selectedOwnerKind, skills])

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

  const runAction = async (channel: string, success: string) => {
    if (!selectedServer) return
    setNotice(null)
    setError(null)
    const result = await invokeBridge(channel, { actorToken: token, id: selectedServer.id })
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

  const loginOAuth = async () => {
    if (!selectedServer) return
    const result = await invokeBridge<{ authorizationUrl: string }>(IPC_CHANNELS.mcp.oauthStart, { actorToken: token, id: selectedServer.id })
    if (!result.ok) {
      setError(result.error?.message ?? 'OAuth login could not start.')
      return
    }
    setNotice('OAuth login opened in the browser.')
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Capabilities</p>
          <h1>MCP</h1>
          <p>Local stdio and remote Streamable HTTP MCP servers, scoped to agents, skills and projects.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={() => setForm(emptyForm)}>
          <LuPlus size={16} /> New server
        </button>
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

      <section className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.panelHeader}>
            <h2>Servers</h2>
            <button type="button" onClick={refresh} aria-label="Refresh MCP servers"><LuRefreshCw size={16} /></button>
          </div>
          <div className={styles.serverList}>
            {servers.map((server) => (
              <button key={server.id} type="button" className={selectedServer?.id === server.id ? styles.selectedServer : ''} onClick={() => setSelectedServerId(server.id)}>
                <span>{server.name}</span>
                <small>{server.transport} · {server.status} · {server.riskTier}</small>
              </button>
            ))}
            {servers.length === 0 && <p className={styles.empty}>No MCP servers yet.</p>}
          </div>
        </aside>

        <div className={styles.content}>
          {activeTab === 'servers' && (
            <form className={styles.form} onSubmit={saveServer}>
              <div className={styles.panelHeader}>
                <h2>{form.id ? 'Edit server' : 'Create server'}</h2>
                {selectedServer && (
                  <div className={styles.actions}>
                    <button type="button" onClick={() => setForm(formFromServer(selectedServer))}>Edit selected</button>
                    <button type="button" className={styles.dangerButton} onClick={() => removeServer(selectedServer)}><LuTrash2 size={15} /> Remove</button>
                  </div>
                )}
              </div>
              <label>
                Name
                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <div className={styles.grid}>
                <label>
                  Transport
                  <AppSelect value={option(form.transport, transportOptions)} options={transportOptions} onChange={(next) => setForm((current) => ({ ...current, transport: next.value as McpTransport }))} />
                </label>
                <label>
                  Risk tier
                  <AppSelect value={option(form.riskTier, riskOptions)} options={riskOptions} onChange={(next) => setForm((current) => ({ ...current, riskTier: next.value as McpRiskTier }))} />
                </label>
              </div>
              {form.transport === 'stdio' ? (
                <div className={styles.grid}>
                  <label>Command<input value={form.command} onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))} /></label>
                  <label>Args<input value={form.args} onChange={(event) => setForm((current) => ({ ...current, args: event.target.value }))} placeholder="-y @scope/server" /></label>
                  <label className={styles.full}>CWD<input value={form.cwd} onChange={(event) => setForm((current) => ({ ...current, cwd: event.target.value }))} placeholder="/absolute/project/path" /></label>
                </div>
              ) : (
                <div className={styles.grid}>
                  <label className={styles.full}>URL<input value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://example.com/mcp" /></label>
                  <label>Auth<AppSelect value={option(form.authType, authOptions)} options={authOptions} onChange={(next) => setForm((current) => ({ ...current, authType: next.value as ServerForm['authType'] }))} /></label>
                  <label>Bearer env<input value={form.bearerTokenEnvVar} onChange={(event) => setForm((current) => ({ ...current, bearerTokenEnvVar: event.target.value }))} placeholder="MCP_API_TOKEN" /></label>
                </div>
              )}
              <div className={styles.grid}>
                <label>Startup timeout<input type="number" min="1" value={form.startupTimeoutSec} onChange={(event) => setForm((current) => ({ ...current, startupTimeoutSec: event.target.value }))} /></label>
                <label>Tool timeout<input type="number" min="1" value={form.toolTimeoutSec} onChange={(event) => setForm((current) => ({ ...current, toolTimeoutSec: event.target.value }))} /></label>
              </div>
              <div className={styles.switches}>
                <label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /> Enabled</label>
                <label><input type="checkbox" checked={form.required} onChange={(event) => setForm((current) => ({ ...current, required: event.target.checked }))} /> Required</label>
              </div>
              <button type="submit" className={styles.primaryButton}>Save server</button>
            </form>
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
    </main>
  )
}
