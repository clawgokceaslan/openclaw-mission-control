import { CSSProperties, FormEvent, MouseEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LuChevronDown, LuPencil, LuPlug, LuPlus, LuRefreshCw, LuStar, LuTrash2, LuUnplug, LuWandSparkles } from 'react-icons/lu'
import styles from './GatewaysPage.module.scss'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Gateway, OpenClawGatewayConfig, OpenClawGatewayTestResult } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'

interface GatewayFormState {
  id?: string
  name: string
  endpoint: string
  workspaceRoot: string
  token: string
  clearToken?: boolean
  allowSelfSignedTls: boolean
  disableDevicePairing: boolean
  autoConnect: boolean
}

interface GatewayTestModalState {
  status: 'sending' | 'success' | 'failed'
  gatewayId: string
  gatewayName: string
  startedAt: number
  prompt: string
  result?: OpenClawGatewayTestResult
  error?: string
}

type ActiveGatewayResponse = {
  gatewayId: string | null
  gateway?: Gateway | null
}

type ActionsMenuState = {
  gatewayId: string
  left: number
  top: number
}

const emptyForm: GatewayFormState = {
  name: '',
  endpoint: '',
  workspaceRoot: '',
  token: '',
  clearToken: false,
  allowSelfSignedTls: false,
  disableDevicePairing: false,
  autoConnect: false
}

function configOf(gateway: Gateway): OpenClawGatewayConfig {
  const deviceIdentity = gateway.template?.deviceIdentity && typeof gateway.template.deviceIdentity === 'object'
    ? gateway.template.deviceIdentity as OpenClawGatewayConfig['deviceIdentity']
    : undefined
  return {
    provider: 'openclaw',
    apiBaseUrl: String(gateway.template?.apiBaseUrl ?? ''),
    authMode: String(gateway.template?.authMode ?? 'device_pairing') as OpenClawGatewayConfig['authMode'],
    workspaceRoot: typeof gateway.template?.workspaceRoot === 'string' ? gateway.template.workspaceRoot : undefined,
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

function formFromGateway(gateway: Gateway): GatewayFormState {
  const config = configOf(gateway)
  return {
    id: gateway.id,
    name: gateway.name,
    endpoint: gateway.endpoint,
    workspaceRoot: config.workspaceRoot ?? '',
    token: '',
    clearToken: false,
    allowSelfSignedTls: Boolean(config.allowSelfSignedTls),
    disableDevicePairing: config.disableDevicePairing === undefined ? false : Boolean(config.disableDevicePairing),
    autoConnect: Boolean(config.autoConnect)
  }
}

function formatTime(value?: number): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function pairingLabel(status?: OpenClawGatewayConfig['pairingStatus']): string {
  if (status === 'paired') return 'Paired'
  if (status === 'requested') return 'Approval required'
  if (status === 'rejected') return 'Rejected'
  if (status === 'failed') return 'Failed'
  return 'Not paired'
}

function pairingClass(status?: OpenClawGatewayConfig['pairingStatus']): string {
  if (status === 'paired') return styles.paired
  if (status === 'requested') return styles.requested
  if (status === 'rejected' || status === 'failed') return styles.failedPairing
  return styles.notPaired
}

export function GatewaysPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<Gateway[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [modal, setModal] = useState<GatewayFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Gateway | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testModal, setTestModal] = useState<GatewayTestModalState | null>(null)
  const [actionsMenu, setActionsMenu] = useState<ActionsMenuState | null>(null)
  const [activeGatewayId, setActiveGatewayId] = useState<string | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false })

  const refresh = async () => {
    const [response, activeResponse] = await Promise.all([
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      invokeBridge<ActiveGatewayResponse>(IPC_CHANNELS.appSettings.getActiveGateway, { actorToken: token })
    ])
    if (!response.ok) {
      setError(response.error?.message ?? 'Gateways could not be loaded.')
      setItems([])
      return
    }
    setError(null)
    setItems((response.data as Gateway[] | undefined) ?? [])
    setActiveGatewayId(activeResponse.ok ? activeResponse.data?.gatewayId ?? null : null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  useEffect(() => {
    if (!actionsMenu) return
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-gateway-actions]')) return
      setActionsMenu(null)
    }
    const closeMenu = () => setActionsMenu(null)
    window.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [actionsMenu])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => `${item.name} ${item.endpoint}`.toLowerCase().includes(needle))
  }, [items, search])

  const invokeAction = async (channel: string, payload: Record<string, unknown>, success: string) => {
    setBusyId(String(payload.gatewayId ?? payload.id ?? 'new'))
    const response = await invokeBridge(channel, { actorToken: token, ...payload })
    setBusyId(null)
    if (!response.ok) {
      setError(response.error?.message ?? 'Gateway action failed.')
      return false
    }
    setNotice(success)
    setError(null)
    await refresh()
    return true
  }

  const setActiveGateway = async (gateway: Gateway) => {
    setActionsMenu(null)
    setBusyId(gateway.id)
    const response = await invokeBridge<ActiveGatewayResponse>(IPC_CHANNELS.appSettings.setActiveGateway, {
      actorToken: token,
      gatewayId: gateway.id
    })
    setBusyId(null)
    if (!response.ok) {
      setError(response.error?.message ?? 'Active gateway could not be updated.')
      return
    }
    setActiveGatewayId(response.data?.gatewayId ?? gateway.id)
    setNotice(`${gateway.name} is now the active gateway.`)
    setError(null)
  }

  const toggleActionsMenu = (gatewayId: string, event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setActionsMenu((current) => {
      if (current?.gatewayId === gatewayId) return null
      const width = 204
      return {
        gatewayId,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 260))
      }
    })
  }

  const submitGateway = async (event: FormEvent) => {
    event.preventDefault()
    if (!modal) return
    const payload = {
      id: modal.id,
      name: modal.name,
      endpoint: modal.endpoint,
      workspaceRoot: modal.workspaceRoot,
      token: modal.token,
      clearToken: Boolean(modal.clearToken),
      allowSelfSignedTls: modal.allowSelfSignedTls,
      disableDevicePairing: modal.disableDevicePairing,
      autoConnect: modal.autoConnect
    }
    const ok = await invokeAction(
      modal.id ? IPC_CHANNELS.gateways.update : IPC_CHANNELS.gateways.create,
      payload,
      modal.id ? 'Gateway updated.' : 'Gateway created.'
    )
    if (ok) setModal(null)
  }

  const testGateway = async (gateway: Gateway) => {
    const prompt = 'How are you?'
    const startedAt = Date.now()
    setTestModal({
      status: 'sending',
      gatewayId: gateway.id,
      gatewayName: gateway.name,
      startedAt,
      prompt
    })
    setBusyId(gateway.id)
    const response = await invokeBridge<OpenClawGatewayTestResult>(IPC_CHANNELS.gateways.testMessage, {
      actorToken: token,
      gatewayId: gateway.id
    })
    setBusyId(null)
    if (!response.ok) {
      setTestModal({
        status: 'failed',
        gatewayId: gateway.id,
        gatewayName: gateway.name,
        startedAt,
        prompt,
        error: response.error?.message ?? 'Gateway test failed.'
      })
      return
    }
    const result = response.data as OpenClawGatewayTestResult
    setTestModal({
      status: result.ok ? 'success' : 'failed',
      gatewayId: gateway.id,
      gatewayName: gateway.name,
      startedAt,
      prompt,
      result,
      error: result.ok ? undefined : result.message
    })
    setNotice(null)
    setError(null)
    await refresh()
  }

  const startTableDrag = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, textarea, select')) return
    const table = tableRef.current
    if (!table) return
    dragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: table.scrollLeft,
      moved: false
    }
    table.setPointerCapture(event.pointerId)
    table.classList.add(styles.dragging)
  }

  const moveTableDrag = (event: PointerEvent<HTMLDivElement>) => {
    const table = tableRef.current
    if (!table || !dragRef.current.active) return
    const delta = event.clientX - dragRef.current.startX
    if (Math.abs(delta) > 3) dragRef.current.moved = true
    table.scrollLeft = dragRef.current.scrollLeft - delta
  }

  const endTableDrag = (event: PointerEvent<HTMLDivElement>) => {
    const table = tableRef.current
    if (!table || !dragRef.current.active) return
    dragRef.current.active = false
    table.releasePointerCapture(event.pointerId)
    table.classList.remove(styles.dragging)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Gateways</h1>
          <p>Manage OpenClaw gateway connections. {items.length} gateway total.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => void refresh()}>
            <LuRefreshCw size={15} />
            Refresh
          </button>
          <button className={styles.primaryButton} type="button" onClick={() => setModal(emptyForm)}>
            <LuPlus size={16} />
            Add gateway
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search gateways..." />
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <div
        ref={tableRef}
        className={styles.tableCard}
        onPointerDown={startTableDrag}
        onPointerMove={moveTableDrag}
        onPointerUp={endTableDrag}
        onPointerCancel={endTableDrag}
        onPointerLeave={endTableDrag}
      >
        <div className={styles.tableHead}>
          <span>Name</span>
          <span>WS URL</span>
          <span>Status</span>
          <span>Pairing</span>
          <span>Token</span>
          <span>Last handshake</span>
          <span>Actions</span>
        </div>
        {filtered.map((gateway) => {
          const config = configOf(gateway)
          const isActive = activeGatewayId === gateway.id
          return (
            <div className={styles.tableRow} key={gateway.id}>
              <span>
                <span className={styles.nameLine}>
                  <Link to={`${APP_ROUTES.GATEWAYS}/${gateway.id}`}>{gateway.name}</Link>
                  {isActive ? <b className={styles.activeBadge}>Active</b> : null}
                </span>
                <small>OpenClaw</small>
              </span>
              <span className={styles.mono}>{gateway.endpoint}</span>
              <span>
                <b className={`${styles.statusPill} ${styles[gateway.status]}`}>{gateway.status}</b>
              </span>
              <span>
                <b className={`${styles.statusPill} ${pairingClass(config.pairingStatus)}`}>{pairingLabel(config.pairingStatus)}</b>
              </span>
              <span className={styles.mono}>{gateway.token || 'No token'}</span>
              <span>{formatTime(config.lastHandshakeAt)}</span>
              <span className={styles.actions}>
                <button disabled={busyId === gateway.id} onClick={() => void invokeAction(IPC_CHANNELS.gateways.connect, { gatewayId: gateway.id }, 'Gateway connected.')}>
                  <LuPlug size={14} />
                  Connect
                </button>
                <button disabled={busyId === gateway.id} onClick={() => void testGateway(gateway)}>
                  <LuWandSparkles size={14} />
                  Test
                </button>
                <button className={styles.moreButton} data-gateway-actions onClick={(event) => toggleActionsMenu(gateway.id, event)}>
                  Actions
                  <LuChevronDown size={14} />
                </button>
                {actionsMenu?.gatewayId === gateway.id ? (
                  <div className={styles.actionsMenu} data-gateway-actions style={{ left: actionsMenu.left, top: actionsMenu.top } as CSSProperties}>
                    <button disabled={busyId === gateway.id || isActive} onClick={() => void setActiveGateway(gateway)}>
                      <LuStar size={14} />
                      {isActive ? 'Active gateway' : 'Set active'}
                    </button>
                    <button disabled={busyId === gateway.id} onClick={() => { setActionsMenu(null); void invokeAction(IPC_CHANNELS.gateways.pairDevice, { gatewayId: gateway.id }, 'Pairing request sent.') }}>
                      <LuPlug size={14} />
                      Pair
                    </button>
                    <button disabled={busyId === gateway.id} onClick={() => { setActionsMenu(null); void invokeAction(IPC_CHANNELS.gateways.disconnect, { gatewayId: gateway.id }, 'Gateway disconnected.') }}>
                      <LuUnplug size={14} />
                      Disconnect
                    </button>
                    <button disabled={busyId === gateway.id} onClick={() => { setActionsMenu(null); void invokeAction(IPC_CHANNELS.gateways.resetPairing, { gatewayId: gateway.id }, 'Pairing identity reset.') }}>
                      <LuRefreshCw size={14} />
                      Reset pair
                    </button>
                    <button onClick={() => { setActionsMenu(null); setModal(formFromGateway(gateway)) }}>
                      <LuPencil size={14} />
                      Edit
                    </button>
                    <button className={styles.dangerText} onClick={() => { setActionsMenu(null); setDeleteTarget(gateway) }}>
                      <LuTrash2 size={14} />
                      Delete
                    </button>
                  </div>
                ) : null}
              </span>
            </div>
          )
        })}
        {filtered.length === 0 && <div className={styles.empty}>No OpenClaw gateways configured.</div>}
      </div>

      {modal && (
        <div className={styles.backdrop} onMouseDown={() => setModal(null)}>
          <form className={styles.modal} onMouseDown={(event) => event.stopPropagation()} onSubmit={submitGateway}>
            <header>
              <h2>{modal.id ? 'Edit gateway' : 'Add gateway'}</h2>
              <button type="button" onClick={() => setModal(null)}>×</button>
            </header>
            <label>
              Name *
              <input value={modal.name} onChange={(event) => setModal({ ...modal, name: event.target.value })} required />
            </label>
            <label>
              Gateway WS URL *
              <input value={modal.endpoint} onChange={(event) => setModal({ ...modal, endpoint: event.target.value })} placeholder="wss://gateway.example/ws" required />
            </label>
            <label>
              OpenClaw workspace root
              <input value={modal.workspaceRoot} onChange={(event) => setModal({ ...modal, workspaceRoot: event.target.value })} placeholder="Leave empty for relative agents/<id>, or use a valid OpenClaw host path" />
            </label>
            <label>
              Gateway Token
              <input
                value={modal.token}
                onChange={(event) => setModal({ ...modal, token: event.target.value })}
                placeholder={modal.id ? '•••••••• (leave empty to keep existing token)' : 'Bearer token'}
              />
            </label>
            {modal.id && (
              <label className={styles.checkRow}>
                <input type="checkbox" checked={Boolean(modal.clearToken)} onChange={(event) => setModal({ ...modal, clearToken: event.target.checked })} />
                Reset stored token
              </label>
            )}
            <label className={styles.checkRow}>
              <input type="checkbox" checked={modal.allowSelfSignedTls} onChange={(event) => setModal({ ...modal, allowSelfSignedTls: event.target.checked })} />
              Allow self-signed TLS certificates
            </label>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={modal.disableDevicePairing} onChange={(event) => setModal({ ...modal, disableDevicePairing: event.target.checked })} />
              Advanced: use Control UI token mode instead of device pairing
            </label>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={modal.autoConnect} onChange={(event) => setModal({ ...modal, autoConnect: event.target.checked })} />
              Auto connect on app start
            </label>
            <footer>
              <button type="button" onClick={() => setModal(null)}>Cancel</button>
              <button className={styles.primaryButton} type="submit">{modal.id ? 'Save changes' : 'Create gateway'}</button>
            </footer>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className={styles.backdrop} onMouseDown={() => setDeleteTarget(null)}>
          <div className={styles.confirm} onMouseDown={(event) => event.stopPropagation()}>
            <h2>Delete gateway</h2>
            <p>Are you sure you want to delete {deleteTarget.name}? Sessions, commands, and cached events will be removed.</p>
            <footer>
              <button onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                className={styles.dangerButton}
                onClick={async () => {
                  const ok = await invokeAction(IPC_CHANNELS.gateways.remove, { id: deleteTarget.id }, 'Gateway deleted.')
                  if (ok) setDeleteTarget(null)
                }}
              >
                Delete
              </button>
            </footer>
          </div>
        </div>
      )}

      {testModal && (
        <div className={styles.backdrop} onMouseDown={() => setTestModal(null)}>
          <div className={styles.resultModal} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <small>OpenClaw TEST message</small>
                <h2>{testModal.gatewayName}</h2>
              </div>
              <button onClick={() => setTestModal(null)}>×</button>
            </header>
            <div className={styles.resultSummary}>
              <span className={`${styles.resultStatus} ${styles[testModal.status]}`}>{testModal.status}</span>
              <span>Duration: {Date.now() - testModal.startedAt}ms</span>
            </div>
            <div className={styles.chatFlow}>
              {testModal.prompt && (
                <div className={styles.userBubble}>
                  <small>You</small>
                  <p>{testModal.prompt}</p>
                </div>
              )}
              <div className={styles.gatewayBubble}>
                <small>OpenClaw Gateway</small>
                {testModal.status === 'sending' && <p>Pairing/connect check, then sending “How are you?”...</p>}
                {testModal.status !== 'sending' && (
                  <p>
                    {testModal.result?.ok
                      ? String(testModal.result.details?.aiResponseText || 'OpenClaw returned an empty assistant response.')
                      : testModal.result?.message ?? testModal.error ?? 'OpenClaw did not respond successfully.'}
                  </p>
                )}
              </div>
            </div>
            {testModal.result && (
              <details className={styles.rawDetails}>
                <summary>Raw response</summary>
                <pre>{JSON.stringify(testModal.result, null, 2)}</pre>
              </details>
            )}
            <footer>
              {testModal.result && (
                <button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(testModal.result, null, 2))}>
                  Copy JSON
                </button>
              )}
              <button onClick={() => setTestModal(null)}>Close</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
