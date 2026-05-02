import { FormEvent, useEffect, useMemo, useState } from 'react'
import styles from './GatewayDetailPage.module.scss'
import { useNavigate, useParams } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import {
  CodexCliGatewayConfig,
  CodexCliModel,
  Gateway,
  GatewayHistoryItem
} from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'

type TabKey = 'overview' | 'events' | 'settings'

interface SettingsState {
  name: string
  executionMode: 'terminal' | 'exec'
}

type CodexModelsResponse = { gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }

function configOf(gateway: Gateway): CodexCliGatewayConfig {
  const template = gateway.template && typeof gateway.template === 'object' && !Array.isArray(gateway.template)
    ? gateway.template as Partial<CodexCliGatewayConfig>
    : {}
  return {
    provider: 'codex_cli',
    codexPath: typeof template.codexPath === 'string' && template.codexPath.trim() ? template.codexPath : gateway.endpoint || 'codex',
    executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal',
    models: Array.isArray(template.models) ? template.models : [],
    lastModelRefreshAt: typeof template.lastModelRefreshAt === 'number' ? template.lastModelRefreshAt : undefined,
    lastModelRefreshError: typeof template.lastModelRefreshError === 'string' ? template.lastModelRefreshError : undefined
  }
}

function settingsFromGateway(gateway: Gateway): SettingsState {
  return {
    name: gateway.name,
    executionMode: configOf(gateway).executionMode ?? 'terminal'
  }
}

function formatTime(value?: number): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value ?? {}, null, 2)}</pre>
}

export function GatewayDetailPage() {
  const params = useParams<{ gatewayId?: string }>()
  const gatewayId = params.gatewayId
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
      endpoint: 'codex',
      codexPath: 'codex',
      provider: 'codex_cli',
      codexExecutionMode: settings.executionMode
    }, 'Gateway settings saved.')
  }

  const refreshModels = async () => {
    if (!gatewayId) return
    const response = await invokeBridge<CodexModelsResponse>(IPC_CHANNELS.gateways.codexModels, { actorToken: token, gatewayId })
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
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <button className={styles.backButton} onClick={() => navigate(APP_ROUTES.GATEWAYS)}>← Gateways</button>
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
          <div><small>CLI</small><b>Codex CLI</b></div>
          <div><small>Command</small><b>{config.codexPath || 'codex'}</b></div>
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
          <h2>Codex CLI documentation</h2>
          <p className={styles.empty}>This gateway uses the already configured local Codex terminal. Open Mission Control only inspects model metadata in this phase.</p>
          <div className={styles.identityGrid}>
            <span><b>Interactive mode</b><small><code>codex</code> opens the terminal UI for repo-aware chat, edits, and command review.</small></span>
            <span><b>Model inspect</b><small><code>codex debug models</code> reads the model catalog used by Gateway settings.</small></span>
            <span><b>Resume</b><small><code>codex resume</code> reopens saved local transcripts.</small></span>
            <span><b>Image input</b><small><code>codex -i screenshot.png</code> attaches screenshots or design specs.</small></span>
            <span><b>Permissions</b><small><code>/permissions</code> controls approval and sandbox behavior inside the CLI.</small></span>
            <span><b>Slash commands</b><small><code>/review</code>, <code>/model</code>, <code>/status</code>, and related commands remain CLI-owned.</small></span>
            <span><b>Remote app-server</b><small>Documented by Codex, but not used by Open Mission Control in this phase.</small></span>
            <span><b>Exec / Headless</b><small><code>codex exec</code> runs without opening Terminal when this gateway mode is enabled.</small></span>
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
          <label>CLI<input value="Codex CLI" disabled /></label>
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
            <small>{settings.executionMode === 'exec' ? 'Runs codex exec in the background and writes output to Activity.' : 'Opens external Terminal.app with the interactive Codex TUI.'}</small>
          </div>
          <button type="submit">Save settings</button>
        </form>
      )}
    </section>
  )
}
