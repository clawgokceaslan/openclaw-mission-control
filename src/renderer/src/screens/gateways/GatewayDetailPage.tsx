import { FormEvent, useEffect, useMemo, useState } from 'react'
import styles from './GatewayDetailPage.module.scss'
import { useNavigate, useParams } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import {
  Gateway,
  GatewayCommand,
  GatewayHistoryItem,
  GatewaySession,
  OpenClawGatewayConfig,
  OpenClawGatewayTestResult,
  OpenClawRpcCallResult,
  OpenClawRpcMethodDefinition
} from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'

type TabKey = 'overview' | 'pairing' | 'sessions' | 'chat' | 'rpc' | 'events' | 'config' | 'settings'

interface SettingsState {
  name: string
  endpoint: string
  token: string
  clearToken?: boolean
  allowSelfSignedTls: boolean
  disableDevicePairing: boolean
  autoConnect: boolean
}

interface TestCommandModalState {
  status: 'sending' | 'success' | 'failed'
  requestId: string
  startedAt: number
  title?: string
  result?: OpenClawGatewayTestResult
  rpcResult?: OpenClawRpcCallResult
  error?: string
}

function configOf(gateway: Gateway): OpenClawGatewayConfig {
  const deviceIdentity = gateway.template?.deviceIdentity && typeof gateway.template.deviceIdentity === 'object'
    ? gateway.template.deviceIdentity as OpenClawGatewayConfig['deviceIdentity']
    : undefined
  return {
    provider: 'openclaw',
    apiBaseUrl: String(gateway.template?.apiBaseUrl ?? ''),
    authMode: String(gateway.template?.authMode ?? 'device_pairing') as OpenClawGatewayConfig['authMode'],
    allowSelfSignedTls: Boolean(gateway.template?.allowSelfSignedTls),
    disableDevicePairing: gateway.template?.disableDevicePairing === undefined ? false : Boolean(gateway.template.disableDevicePairing),
    autoConnect: Boolean(gateway.template?.autoConnect),
    lastHandshakeAt: typeof gateway.template?.lastHandshakeAt === 'number' ? gateway.template.lastHandshakeAt : undefined,
    protocolVersion: typeof gateway.template?.protocolVersion === 'string' ? gateway.template.protocolVersion : undefined,
    capabilities: Array.isArray(gateway.template?.capabilities) ? gateway.template.capabilities.map(String) : undefined,
    deviceIdentity,
    pairingStatus: typeof gateway.template?.pairingStatus === 'string' ? gateway.template.pairingStatus as OpenClawGatewayConfig['pairingStatus'] : 'not_paired',
    lastPairingError: typeof gateway.template?.lastPairingError === 'string' ? gateway.template.lastPairingError : undefined
  }
}

function settingsFromGateway(gateway: Gateway): SettingsState {
  const config = configOf(gateway)
  return {
    name: gateway.name,
    endpoint: gateway.endpoint,
    token: '',
    clearToken: false,
    allowSelfSignedTls: Boolean(config.allowSelfSignedTls),
    disableDevicePairing: Boolean(config.disableDevicePairing),
    autoConnect: Boolean(config.autoConnect)
  }
}

function formatTime(value?: number): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value ?? {}, null, 2)}</pre>
}

function nextRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `rpc-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function fingerprint(value?: string): string {
  if (!value) return 'Not generated'
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  return `local-${Math.abs(hash).toString(16).padStart(8, '0')}`
}

function testResultText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const details = (value as { details?: Record<string, unknown> }).details
  return typeof details?.aiResponseText === 'string' && details.aiResponseText.trim() ? details.aiResponseText : ''
}

function parsePayload(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {}
  const parsed = JSON.parse(text)
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { value: parsed }
}

export function GatewayDetailPage() {
  const params = useParams<{ gatewayId?: string }>()
  const gatewayId = params.gatewayId
  const { token } = useAuth()
  const navigate = useNavigate()
  const [gateway, setGateway] = useState<Gateway | null>(null)
  const [sessions, setSessions] = useState<GatewaySession[]>([])
  const [commands, setCommands] = useState<GatewayCommand[]>([])
  const [history, setHistory] = useState<GatewayHistoryItem[]>([])
  const [methods, setMethods] = useState<OpenClawRpcMethodDefinition[]>([])
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [selectedMethod, setSelectedMethod] = useState('status')
  const [payloadText, setPayloadText] = useState('')
  const [sessionKey, setSessionKey] = useState('')
  const [chatMessage, setChatMessage] = useState('How are you?')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [testModal, setTestModal] = useState<TestCommandModalState | null>(null)

  const config = useMemo(() => (gateway ? configOf(gateway) : null), [gateway])
  const groupedMethods = useMemo(() => {
    const groups = new Map<string, OpenClawRpcMethodDefinition[]>()
    methods.forEach((method) => groups.set(method.group, [...(groups.get(method.group) ?? []), method]))
    return [...groups.entries()]
  }, [methods])
  const defaultSessionKey = gatewayId ? `openmissioncontrol:${gatewayId}:test` : ''

  const refresh = async () => {
    if (!gatewayId) return
    const [gatewayResponse, sessionsResponse, commandsResponse, historyResponse, methodsResponse] = await Promise.all([
      invokeBridge<Gateway>(IPC_CHANNELS.gateways.get, { actorToken: token, id: gatewayId }),
      invokeBridge<GatewaySession[]>(IPC_CHANNELS.gateways.sessions, { actorToken: token, gatewayId }),
      invokeBridge<GatewayCommand[]>(IPC_CHANNELS.gateways.commands, { actorToken: token, gatewayId }),
      invokeBridge<GatewayHistoryItem[]>(IPC_CHANNELS.gateways.commandsHistory, { actorToken: token, gatewayId }),
      invokeBridge<OpenClawRpcMethodDefinition[]>(IPC_CHANNELS.gateways.rpcMethods, { actorToken: token })
    ])
    if (!gatewayResponse.ok) {
      setError(gatewayResponse.error?.message ?? 'Gateway not found.')
      return
    }
    const nextGateway = gatewayResponse.data as Gateway
    setGateway(nextGateway)
    setSettings(settingsFromGateway(nextGateway))
    setSessions(Array.isArray(sessionsResponse.data) ? sessionsResponse.data : [])
    setCommands(Array.isArray(commandsResponse.data) ? commandsResponse.data : [])
    setHistory(Array.isArray(historyResponse.data) ? historyResponse.data : [])
    setMethods(Array.isArray(methodsResponse.data) ? methodsResponse.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [gatewayId, token])

  useEffect(() => {
    if (!sessionKey && defaultSessionKey) setSessionKey(defaultSessionKey)
  }, [defaultSessionKey, sessionKey])

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
    await action(IPC_CHANNELS.gateways.update, { id: gatewayId, ...settings }, 'Gateway settings saved.')
  }

  const runConnectionTest = async () => {
    if (!gatewayId) return
    const requestId = nextRequestId()
    const startedAt = Date.now()
    setTestModal({ status: 'sending', requestId, startedAt, title: 'OpenClaw chat test' })
    const response = await invokeBridge<OpenClawGatewayTestResult>(IPC_CHANNELS.gateways.testMessage, { actorToken: token, gatewayId })
    if (!response.ok) {
      setTestModal({ status: 'failed', requestId, startedAt, title: 'OpenClaw chat test', error: response.error?.message ?? 'Gateway test failed.' })
      await refresh()
      return
    }
    const result = response.data as OpenClawGatewayTestResult
    setTestModal({ status: result.ok ? 'success' : 'failed', requestId, startedAt, title: 'OpenClaw chat test', result, error: result.ok ? undefined : result.message })
    await refresh()
  }

  const runRpc = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!gatewayId || !selectedMethod.trim()) return
    let params: Record<string, unknown>
    try {
      params = parsePayload(payloadText) ?? {}
    } catch {
      setError('Payload JSON is invalid.')
      return
    }
    const requestId = nextRequestId()
    const startedAt = Date.now()
    setTestModal({ status: 'sending', requestId, startedAt, title: selectedMethod })
    const response = await invokeBridge<OpenClawRpcCallResult>(IPC_CHANNELS.gateways.rpcCall, { actorToken: token, gatewayId, method: selectedMethod, params })
    if (!response.ok) {
      setTestModal({ status: 'failed', requestId, startedAt, title: selectedMethod, error: response.error?.message ?? 'RPC failed.' })
      await refresh()
      return
    }
    const result = response.data as OpenClawRpcCallResult
    setTestModal({ status: result.ok ? 'success' : 'failed', requestId: result.requestId ?? requestId, startedAt, title: selectedMethod, rpcResult: result, error: result.error })
    await refresh()
  }

  const runChatSend = async () => {
    if (!gatewayId || !sessionKey.trim() || !chatMessage.trim()) return
    setSelectedMethod('chat.send')
    setPayloadText(JSON.stringify({ sessionKey, message: chatMessage, deliver: true }, null, 2))
    const response = await invokeBridge<OpenClawRpcCallResult>(IPC_CHANNELS.gateways.chatSend, { actorToken: token, gatewayId, sessionKey, message: chatMessage })
    setTestModal({ status: response.ok && (response.data as OpenClawRpcCallResult)?.ok ? 'success' : 'failed', requestId: nextRequestId(), startedAt: Date.now(), title: 'chat.send', rpcResult: response.data as OpenClawRpcCallResult, error: response.error?.message })
    await refresh()
  }

  if (!gatewayId) return <section className={styles.page}><h1>Gateway</h1><p>Gateway id is missing.</p></section>

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <button className={styles.backButton} onClick={() => navigate(APP_ROUTES.GATEWAYS)}>← Gateways</button>
          <h1>{gateway?.name ?? 'Gateway'}</h1>
          <p>OpenClaw gateway core control surface</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={() => void action(IPC_CHANNELS.gateways.pairDevice, { gatewayId }, 'Pairing request sent.')}>Pair</button>
          <button onClick={() => void action(IPC_CHANNELS.gateways.connect, { gatewayId }, 'Gateway connected.')}>Connect</button>
          <button onClick={() => void runConnectionTest()}>Test</button>
          <button onClick={() => void action(IPC_CHANNELS.gateways.disconnect, { gatewayId }, 'Gateway disconnected.')}>Disconnect</button>
          <button onClick={() => void action(IPC_CHANNELS.gateways.resetPairing, { gatewayId }, 'Pairing identity reset.')}>Reset pairing</button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {gateway && config && (
        <div className={styles.overview}>
          <div><small>Status</small><b className={`${styles.statusPill} ${styles[gateway.status]}`}>{gateway.status}</b></div>
          <div><small>WS URL</small><b>{gateway.endpoint}</b></div>
          <div><small>Auth mode</small><b>{config.authMode ?? 'device_pairing'}</b></div>
          <div><small>Pairing</small><b>{config.pairingStatus ?? 'not_paired'}</b></div>
          <div><small>Last handshake</small><b>{formatTime(config.lastHandshakeAt)}</b></div>
        </div>
      )}

      <nav className={styles.tabs}>
        {(['overview', 'pairing', 'sessions', 'chat', 'rpc', 'events', 'config', 'settings'] as TabKey[]).map((key) => (
          <button key={key} className={tab === key ? styles.activeTab : ''} onClick={() => setTab(key)}>{key[0].toUpperCase() + key.slice(1)}</button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className={styles.card}>
          <h2>Gateway core</h2>
          <p className={styles.empty}>Remote-safe WS RPC. No Python, no sidecar, no local OpenClaw config reads.</p>
          <div className={styles.methodGrid}>{methods.slice(0, 18).map((method) => <span key={method.method}>{method.method}</span>)}</div>
        </div>
      )}

      {tab === 'pairing' && config && (
        <div className={styles.card}>
          <h2>Pairing and device identity</h2>
          <div className={styles.identityGrid}>
            <span><b>Device id</b><small>{config.deviceIdentity?.deviceId ?? 'Not generated'}</small></span>
            <span><b>Public key fingerprint</b><small>{fingerprint(config.deviceIdentity?.publicKeyPem)}</small></span>
            <span><b>Pairing state</b><small>{config.pairingStatus ?? 'not_paired'}</small></span>
            <span><b>Last pairing error</b><small>{config.lastPairingError ?? 'None'}</small></span>
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        <div className={styles.card}>
          <h2>Sessions</h2>
          <form className={styles.commandForm} onSubmit={(event) => { event.preventDefault(); void action(IPC_CHANNELS.gateways.sessionsPatch, { gatewayId, key: sessionKey, label: sessionKey }, 'Session patched.') }}>
            <input value={sessionKey} onChange={(event) => setSessionKey(event.target.value)} placeholder={defaultSessionKey} />
            <button type="submit">Patch session</button>
          </form>
          {sessions.map((session) => <div className={styles.row} key={session.id}><span>{session.status}</span><span>{formatTime(session.lastSeenAt)}</span><span>{session.backoffMs ? `${session.backoffMs}ms` : 'No backoff'}</span></div>)}
          {sessions.length === 0 && <p className={styles.empty}>No sessions found.</p>}
        </div>
      )}

      {tab === 'chat' && (
        <div className={styles.card}>
          <h2>Chat</h2>
          <div className={styles.commandForm}>
            <input value={sessionKey} onChange={(event) => setSessionKey(event.target.value)} placeholder={defaultSessionKey} />
            <textarea value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} rows={3} />
            <button type="button" onClick={() => void runChatSend()}>Send chat</button>
            <button type="button" onClick={() => void action(IPC_CHANNELS.gateways.chatHistory, { gatewayId, sessionKey, limit: 50 }, 'Chat history requested.')}>Load history</button>
          </div>
        </div>
      )}

      {tab === 'rpc' && (
        <div className={styles.card}>
          <h2>RPC method catalog</h2>
          <div className={styles.dataGrid}>{groupedMethods.map(([group, list]) => <div className={styles.methodPanel} key={group}><h3>{group}</h3>{list.map((method) => <button key={method.method} onClick={() => { setSelectedMethod(method.method); setPayloadText(JSON.stringify(method.sampleParams ?? {}, null, 2)) }}>{method.method}<small>{method.access}</small></button>)}</div>)}</div>
          <form className={styles.commandForm} onSubmit={runRpc}>
            <input value={selectedMethod} onChange={(event) => setSelectedMethod(event.target.value)} placeholder="OpenClaw method" />
            <textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} placeholder="Payload JSON" rows={5} />
            <button type="submit">Run RPC</button>
          </form>
        </div>
      )}

      {tab === 'events' && <div className={styles.card}><h2>Events</h2>{history.map((event) => <details className={styles.eventRow} key={event.id}><summary><b>{event.eventType}</b><span>{formatTime(event.createdAt)}</span></summary><JsonBlock value={event.payload} /></details>)}{history.length === 0 && <p className={styles.empty}>No OpenClaw events cached yet.</p>}</div>}

      {tab === 'config' && (
        <div className={styles.card}>
          <h2>OpenClaw config</h2>
          <div className={styles.methodGrid}>{['config.get', 'config.schema', 'config.set', 'config.patch', 'config.apply'].map((method) => <button key={method} onClick={() => { setSelectedMethod(method); setPayloadText(method === 'config.get' || method === 'config.schema' || method === 'config.apply' ? '{}' : '{\n  "key": "path.to.key",\n  "value": true\n}') ; setTab('rpc') }}>{method}</button>)}</div>
        </div>
      )}

      {tab === 'settings' && settings && (
        <form className={styles.settingsForm} onSubmit={saveSettings}>
          <label>Name<input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} /></label>
          <label>Gateway WS URL<input value={settings.endpoint} onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })} /></label>
          <label>Replace token<input value={settings.token} onChange={(event) => setSettings({ ...settings, token: event.target.value })} placeholder="•••••••• (leave empty to keep existing token)" /></label>
          <label className={styles.checkRow}><input type="checkbox" checked={Boolean(settings.clearToken)} onChange={(event) => setSettings({ ...settings, clearToken: event.target.checked })} /> Reset stored token</label>
          <label className={styles.checkRow}><input type="checkbox" checked={settings.allowSelfSignedTls} onChange={(event) => setSettings({ ...settings, allowSelfSignedTls: event.target.checked })} /> Allow self-signed TLS certificates</label>
          <label className={styles.checkRow}><input type="checkbox" checked={settings.disableDevicePairing} onChange={(event) => setSettings({ ...settings, disableDevicePairing: event.target.checked })} /> Advanced: use Control UI token mode instead of device pairing</label>
          <label className={styles.checkRow}><input type="checkbox" checked={settings.autoConnect} onChange={(event) => setSettings({ ...settings, autoConnect: event.target.checked })} /> Auto connect on app start</label>
          <button type="submit">Save settings</button>
        </form>
      )}

      {testModal && (
        <div className={styles.modalBackdrop} onMouseDown={() => setTestModal(null)}>
          <div className={styles.resultModal} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><small>OpenClaw gateway</small><h2>{testModal.title ?? 'Response'}</h2></div><button onClick={() => setTestModal(null)}>×</button></header>
            <div className={styles.resultSummary}><span className={`${styles.resultStatus} ${styles[testModal.status]}`}>{testModal.status}</span><span>Request: {testModal.requestId}</span><span>Duration: {Date.now() - testModal.startedAt}ms</span></div>
            {testModal.status === 'sending' && <p className={styles.empty}>Sending request to OpenClaw...</p>}
            {testModal.error && <p className={styles.error}>{testModal.error}</p>}
            {testModal.result && <div className={styles.chatResult}><small>Assistant</small><p>{testResultText(testModal.result) || 'OpenClaw returned an empty assistant response.'}</p></div>}
            {testModal.rpcResult && <JsonBlock value={testModal.rpcResult.result ?? testModal.rpcResult.error ?? testModal.rpcResult} />}
            {(testModal.result || testModal.rpcResult) && <details className={styles.rawDetails}><summary>Raw response</summary><JsonBlock value={testModal.result ?? testModal.rpcResult} /></details>}
            <footer><button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(testModal.result ?? testModal.rpcResult ?? {}, null, 2))}>Copy JSON</button><button onClick={() => setTestModal(null)}>Close</button></footer>
          </div>
        </div>
      )}
    </section>
  )
}
