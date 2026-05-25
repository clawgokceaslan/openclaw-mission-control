import { FormEvent, useEffect, useMemo, useState } from 'react'
import styles from './GatewayDetailPage.module.scss'
import { useNavigate, useParams } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import {
  ClaudeCliGatewayConfig,
  CodexCliGatewayConfig,
  CodexCliModel,
  Gateway,
  OpenAiCompatibleGatewayConfig,
  GatewayHistoryItem
} from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'

type TabKey = 'overview' | 'events' | 'settings'

interface SettingsState {
  name: string
  provider: 'codex_cli' | 'claude_cli' | 'openai_compatible'
  executionMode: 'terminal' | 'exec'
  apiBaseUrl: string
  apiKey: string
  defaultModel: string
}

type GatewayModelsResponse = { gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }

function providerLabel(provider: SettingsState['provider']): string {
  if (provider === 'claude_cli') return 'Claude CLI'
  if (provider === 'openai_compatible') return 'OpenAI-compatible'
  return 'Codex CLI'
}

function configOf(gateway: Gateway): (CodexCliGatewayConfig | ClaudeCliGatewayConfig | OpenAiCompatibleGatewayConfig) & { commandPath: string } {
  const template = gateway.template && typeof gateway.template === 'object' && !Array.isArray(gateway.template)
    ? gateway.template as Partial<CodexCliGatewayConfig & ClaudeCliGatewayConfig & OpenAiCompatibleGatewayConfig>
    : {}
  if (template.provider === 'openai_compatible') {
    return {
      provider: 'openai_compatible',
      apiBaseUrl: typeof template.apiBaseUrl === 'string' ? template.apiBaseUrl : gateway.endpoint,
      commandPath: typeof template.apiBaseUrl === 'string' ? template.apiBaseUrl : gateway.endpoint,
      codexPath: typeof template.codexPath === 'string' ? template.codexPath : 'codex',
      executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal',
      defaultModel: typeof template.defaultModel === 'string' ? template.defaultModel : '',
      models: Array.isArray(template.models) ? template.models : [],
      lastModelRefreshAt: typeof template.lastModelRefreshAt === 'number' ? template.lastModelRefreshAt : undefined,
      lastModelRefreshError: typeof template.lastModelRefreshError === 'string' ? template.lastModelRefreshError : undefined
    }
  }
  if (template.provider === 'claude_cli') {
    return {
      provider: 'claude_cli',
      claudePath: typeof template.claudePath === 'string' && template.claudePath.trim() ? template.claudePath : gateway.endpoint || 'claude',
      commandPath: typeof template.claudePath === 'string' && template.claudePath.trim() ? template.claudePath : gateway.endpoint || 'claude',
      executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal',
      apiKeyEnvVar: typeof template.apiKeyEnvVar === 'string' ? template.apiKeyEnvVar : 'ANTHROPIC_API_KEY',
      models: Array.isArray(template.models) ? template.models : [],
      lastModelRefreshAt: typeof template.lastModelRefreshAt === 'number' ? template.lastModelRefreshAt : undefined,
      lastModelRefreshError: typeof template.lastModelRefreshError === 'string' ? template.lastModelRefreshError : undefined
    }
  }
  return {
    provider: 'codex_cli',
    codexPath: typeof template.codexPath === 'string' && template.codexPath.trim() ? template.codexPath : gateway.endpoint || 'codex',
    commandPath: typeof template.codexPath === 'string' && template.codexPath.trim() ? template.codexPath : gateway.endpoint || 'codex',
    executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal',
    models: Array.isArray(template.models) ? template.models : [],
    lastModelRefreshAt: typeof template.lastModelRefreshAt === 'number' ? template.lastModelRefreshAt : undefined,
    lastModelRefreshError: typeof template.lastModelRefreshError === 'string' ? template.lastModelRefreshError : undefined
  }
}

function settingsFromGateway(gateway: Gateway): SettingsState {
  return {
    name: gateway.name,
    provider: configOf(gateway).provider === 'claude_cli' ? 'claude_cli' : configOf(gateway).provider === 'openai_compatible' ? 'openai_compatible' : 'codex_cli',
    executionMode: configOf(gateway).executionMode ?? 'terminal',
    apiBaseUrl: configOf(gateway).provider === 'openai_compatible' ? (configOf(gateway) as OpenAiCompatibleGatewayConfig).apiBaseUrl : '',
    apiKey: '',
    defaultModel: configOf(gateway).provider === 'openai_compatible' ? ((configOf(gateway) as OpenAiCompatibleGatewayConfig).defaultModel ?? '') : ''
  }
}

function formatTime(value?: number): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value ?? {}, null, 2)}</pre>
}

interface GatewayDetailPageProps {
  gatewayId?: string
  embedded?: boolean
  onBack?: () => void
}

export function GatewayDetailPage({ gatewayId: gatewayIdProp, embedded = false, onBack }: GatewayDetailPageProps) {
  const params = useParams<{ gatewayId?: string }>()
  const gatewayId = gatewayIdProp ?? params.gatewayId
  const { token } = useAuth()
  const navigate = useNavigate()
  const [gateway, setGateway] = useState<Gateway | null>(null)
  const [history, setHistory] = useState<GatewayHistoryItem[]>([])
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const config = useMemo(() => (gateway ? configOf(gateway) : null), [gateway])

  const refresh = async () => {
    if (!gatewayId) return
    const [gatewayResponse, historyResponse] = await Promise.all([
      invokeBridge<Gateway>(IPC_CHANNELS.gateways.get, { actorToken: token, id: gatewayId }),
      invokeBridge<GatewayHistoryItem[]>(IPC_CHANNELS.gateways.commandsHistory, { actorToken: token, gatewayId })
    ])
    if (!gatewayResponse.ok) {
      setError(gatewayResponse.error?.message ?? 'Gateway not found.')
      return
    }
    const nextGateway = gatewayResponse.data as Gateway
    setGateway(nextGateway)
    setSettings(settingsFromGateway(nextGateway))
    setHistory(Array.isArray(historyResponse.data) ? historyResponse.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [gatewayId, token])

  const action = async (channel: string, payload: Record<string, unknown>, success: string) => {
    const response = await invokeBridge(channel, { actorToken: token, ...payload })
    if (!response.ok) {
      setError(response.error?.message ?? 'Gateway action failed.')
      return false
    }
    setNotice(success)
    setError(null)
    await refresh()
    return true
  }

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    if (!gatewayId || !settings) return
    await action(IPC_CHANNELS.gateways.update, {
      id: gatewayId,
      name: settings.name,
      endpoint: settings.provider === 'openai_compatible' ? settings.apiBaseUrl : settings.provider === 'claude_cli' ? 'claude' : 'codex',
      apiBaseUrl: settings.apiBaseUrl,
      token: settings.apiKey,
      defaultModel: settings.defaultModel,
      codexPath: 'codex',
      claudePath: 'claude',
      provider: settings.provider,
      codexExecutionMode: settings.executionMode,
      claudeExecutionMode: settings.executionMode,
      apiKeyEnvVar: 'ANTHROPIC_API_KEY'
    }, 'Gateway settings saved.')
  }

  const refreshModels = async () => {
    if (!gatewayId) return
    const response = await invokeBridge<GatewayModelsResponse>(IPC_CHANNELS.gateways.gatewayModels, { actorToken: token, gatewayId })
    if (!response.ok) {
      setError(response.error?.message ?? 'Model refresh failed.')
      return
    }
    if (response.data?.error) {
      setError(response.data.error)
      setNotice(response.data.cached ? 'Model refresh failed; cached models are still available.' : null)
    } else {
      setError(null)
      setNotice(`${response.data?.models.length ?? 0} model(s) refreshed.`)
    }
    await refresh()
  }

  if (!gatewayId) return <section className={styles.page}><h1>Gateway</h1><p>Gateway id is missing.</p></section>

  return (
    <section className={`${styles.page} ${embedded ? styles.embeddedPage : ''}`}>
      <header className={styles.header}>
        <div>
          <button className={styles.backButton} onClick={() => onBack ? onBack() : navigate(APP_ROUTES.GATEWAYS)}>← Gateways</button>
          <h1>{gateway?.name ?? 'Gateway'}</h1>
          <p>Named local CLI gateway</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {gateway && config && (
        <div className={styles.overview}>
          <div><small>Status</small><b className={`${styles.statusPill} ${styles[gateway.status]}`}>{gateway.status}</b></div>
          <div><small>Provider</small><b>{providerLabel(config.provider as SettingsState['provider'])}</b></div>
          <div><small>Command</small><b>{config.commandPath}</b></div>
          <div><small>Mode</small><b>{config.executionMode === 'exec' ? 'Exec / Headless' : 'Terminal'}</b></div>
          <div><small>Models</small><b>{config.models?.length ?? 0} cached</b></div>
          <div><small>Updated</small><b>{formatTime(gateway.updatedAt)}</b></div>
        </div>
      )}

      <nav className={styles.tabs}>
        {(['overview', 'events', 'settings'] as TabKey[]).map((key) => (
          <button key={key} className={tab === key ? styles.activeTab : ''} onClick={() => setTab(key)}>{key[0].toUpperCase() + key.slice(1)}</button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className={styles.card}>
          <h2>{config.provider === 'claude_cli' ? 'Claude CLI documentation' : config.provider === 'openai_compatible' ? 'OpenAI-compatible endpoint' : 'Codex CLI documentation'}</h2>
          <p className={styles.empty}>{config.provider === 'claude_cli' ? 'This gateway uses the local Claude CLI in print mode for headless runs or Terminal.app for interactive sessions.' : config.provider === 'openai_compatible' ? 'This gateway points Codex runs at a self-hosted OpenAI-compatible /v1 endpoint and discovers models from /v1/models.' : 'This gateway uses the already configured local Codex terminal. Open Mission Control inspects model metadata from the CLI.'}</p>
          <div className={styles.identityGrid}>
            {config.provider === 'openai_compatible' ? (
              <>
                <span><b>Base URL</b><small><code>{(config as OpenAiCompatibleGatewayConfig).apiBaseUrl}</code></small></span>
                <span><b>Discovery</b><small><code>/v1/models</code> is queried with the configured bearer token when present.</small></span>
                <span><b>Fallback model</b><small>{(config as OpenAiCompatibleGatewayConfig).defaultModel || 'No manual default model set.'}</small></span>
                <span><b>Runtime</b><small>Codex CLI runs with <code>OPENAI_BASE_URL</code> and <code>OPENAI_API_KEY</code> scoped to this gateway.</small></span>
              </>
            ) : config.provider === 'claude_cli' ? (
              <>
                <span><b>Print mode</b><small><code>claude -p</code> runs non-interactively and streams JSON back to Chat.</small></span>
                <span><b>Authentication</b><small>Use <code>claude auth login</code> or set <code>ANTHROPIC_API_KEY</code>.</small></span>
                <span><b>Model aliases</b><small><code>sonnet</code> and <code>opus</code> are cached as defaults; full model ids can be typed per project.</small></span>
                <span><b>Permissions</b><small>OMC launches Claude with tool permissions aligned to the current gateway run mode.</small></span>
                <span><b>MCP</b><small>OMC exports MCP catalog context and keeps project policy gates active.</small></span>
                <span><b>Exec / Headless</b><small><code>claude -p --output-format stream-json</code> runs without opening Terminal.</small></span>
              </>
            ) : (
              <>
                <span><b>Interactive mode</b><small><code>codex</code> opens the terminal UI for repo-aware chat, edits, and command review.</small></span>
                <span><b>Model inspect</b><small><code>codex debug models</code> reads the model catalog used by Gateway settings.</small></span>
                <span><b>Resume</b><small><code>codex resume</code> reopens saved local transcripts.</small></span>
                <span><b>Image input</b><small><code>codex -i screenshot.png</code> attaches screenshots or design specs.</small></span>
                <span><b>Permissions</b><small><code>/permissions</code> controls approval and sandbox behavior inside the CLI.</small></span>
                <span><b>Slash commands</b><small><code>/review</code>, <code>/model</code>, <code>/status</code>, and related commands remain CLI-owned.</small></span>
                <span><b>Remote app-server</b><small>Documented by Codex, but not used by Open Mission Control in this phase.</small></span>
                <span><b>Exec / Headless</b><small><code>codex exec</code> runs without opening Terminal when this gateway mode is enabled.</small></span>
              </>
            )}
            <span><b>Last model refresh</b><small>{formatTime(config?.lastModelRefreshAt)}</small></span>
          </div>
          <button type="button" onClick={() => void refreshModels()}>Refresh models</button>
          {config?.lastModelRefreshError ? <p className={styles.error}>{config.lastModelRefreshError}</p> : null}
          <div className={styles.identityGrid}>
            {(config?.models ?? []).map((model) => (
              <span key={model.id}><b>{model.label}</b><small>{model.id}{model.recommended ? ' · recommended' : ''}</small></span>
            ))}
          </div>
        </div>
      )}

      {tab === 'events' && <div className={styles.card}><h2>Events</h2>{history.map((event) => <details className={styles.eventRow} key={event.id}><summary><b>{event.eventType}</b><span>{formatTime(event.createdAt)}</span></summary><JsonBlock value={event.payload} /></details>)}{history.length === 0 && <p className={styles.empty}>No gateway events cached yet.</p>}</div>}

      {tab === 'settings' && settings && (
        <form className={styles.settingsForm} onSubmit={saveSettings}>
          <label>Name<input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} /></label>
          <label>Provider<input value={providerLabel(settings.provider)} disabled /></label>
          {settings.provider === 'openai_compatible' ? (
            <>
              <label>Base URL<input value={settings.apiBaseUrl} onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })} placeholder="http://localhost:8000/v1" /></label>
              <label>API key<input value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder="Leave blank to keep current key" type="password" /></label>
              <label>Default model<input value={settings.defaultModel} onChange={(event) => setSettings({ ...settings, defaultModel: event.target.value })} /></label>
            </>
          ) : null}
          <div className={styles.modeField}>
            <span>Execution mode</span>
            <div className={styles.segmentedControl}>
              <button
                type="button"
                className={settings.executionMode === 'terminal' ? styles.segmentActive : ''}
                onClick={() => setSettings({ ...settings, executionMode: 'terminal' })}
              >
                Terminal
              </button>
              <button
                type="button"
                className={settings.executionMode === 'exec' ? styles.segmentActive : ''}
                onClick={() => setSettings({ ...settings, executionMode: 'exec' })}
              >
                Exec / Headless
              </button>
            </div>
            <small>{settings.executionMode === 'exec' ? 'Runs the selected CLI in the background and writes output to Chat.' : 'Opens external Terminal.app with the selected CLI.'}</small>
          </div>
          <button type="submit">Save settings</button>
        </form>
      )}
    </section>
  )
}
