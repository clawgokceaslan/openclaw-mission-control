import { CSSProperties, FormEvent, MouseEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LuChevronDown, LuPencil, LuPlus, LuRefreshCw, LuStar, LuTrash2 } from 'react-icons/lu'
import styles from './GatewaysPage.module.scss'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { CodexCliGatewayConfig, CodexCliModel, Gateway } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'

interface GatewayFormState {
  id?: string
  name: string
  cliProvider: 'codex_cli' | 'claude_cli'
  executionMode: 'terminal' | 'exec'
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

type CodexModelsResponse = { gateway: Gateway; models: CodexCliModel[]; cached: boolean; error?: string }

const emptyForm: GatewayFormState = {
  name: '',
  cliProvider: 'codex_cli',
  executionMode: 'terminal'
}

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

function formFromGateway(gateway: Gateway): GatewayFormState {
  return {
    id: gateway.id,
    name: gateway.name,
    cliProvider: 'codex_cli',
    executionMode: configOf(gateway).executionMode ?? 'terminal'
  }
}

interface GatewaysPageProps {
  embedded?: boolean
  onOpenGateway?: (gatewayId: string) => void
}

export function GatewaysPage({ embedded = false, onOpenGateway }: GatewaysPageProps) {
  const { token } = useAuth()
  const [items, setItems] = useState<Gateway[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [modal, setModal] = useState<GatewayFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Gateway | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
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
    return items.filter((item) => `${item.name} ${configOf(item).codexPath ?? item.endpoint}`.toLowerCase().includes(needle))
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

  const refreshModels = async (gateway: Gateway) => {
    setActionsMenu(null)
    setBusyId(gateway.id)
    const response = await invokeBridge<CodexModelsResponse>(IPC_CHANNELS.gateways.codexModels, {
      actorToken: token,
      gatewayId: gateway.id
    })
    setBusyId(null)
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
    if (modal.cliProvider === 'claude_cli') {
      setError('Claude CLI is not available yet.')
      return
    }
    const payload = {
      id: modal.id,
      name: modal.name,
      endpoint: 'codex',
      codexPath: 'codex',
      provider: 'codex_cli',
      codexExecutionMode: modal.executionMode
    }
    const ok = await invokeAction(
      modal.id ? IPC_CHANNELS.gateways.update : IPC_CHANNELS.gateways.create,
      payload,
      modal.id ? 'Gateway updated.' : 'Gateway created.'
    )
    if (ok) setModal(null)
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
    <section className={`${styles.page} ${embedded ? styles.embeddedPage : ''}`}>
      <header className={styles.header}>
        <div>
          <h1>Gateways</h1>
          <p>Manage local CLI gateways. {items.length} gateway total.</p>
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
          <span>CLI</span>
          <span>Status</span>
          <span>Models</span>
          <span>Actions</span>
        </div>
        {filtered.map((gateway) => {
          const isActive = activeGatewayId === gateway.id
          const config = configOf(gateway)
          return (
            <div className={styles.tableRow} key={gateway.id}>
              <span>
                <span className={styles.nameLine}>
                  {onOpenGateway ? (
                    <button type="button" className={styles.nameButton} onClick={() => onOpenGateway(gateway.id)}>{gateway.name}</button>
                  ) : (
                    <Link to={`${APP_ROUTES.GATEWAYS}/${gateway.id}`}>{gateway.name}</Link>
                  )}
                  {isActive ? <b className={styles.activeBadge}>Active</b> : null}
                </span>
                <small>Local CLI</small>
              </span>
              <span>Codex CLI</span>
              <span>
                <b className={`${styles.statusPill} ${styles[gateway.status]}`}>{gateway.status}</b>
              </span>
              <span className={styles.mono}>{config.models?.length ?? 0} cached</span>
              <span className={styles.actions}>
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
                    <button onClick={() => { setActionsMenu(null); setModal(formFromGateway(gateway)) }}>
                      <LuPencil size={14} />
                      Edit
                    </button>
                    <button disabled={busyId === gateway.id} onClick={() => void refreshModels(gateway)}>
                      <LuRefreshCw size={14} />
                      Refresh models
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
        {filtered.length === 0 && <div className={styles.empty}>No Codex CLI gateways configured.</div>}
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
              Provider
              <select value={modal.cliProvider} onChange={(event) => setModal({ ...modal, cliProvider: event.target.value as GatewayFormState['cliProvider'] })}>
                <option value="codex_cli">Codex CLI</option>
                <option value="claude_cli">Claude CLI</option>
              </select>
            </label>
            <div className={styles.modeField}>
              <span>Execution mode</span>
              <div className={styles.segmentedControl}>
                <button
                  type="button"
                  className={modal.executionMode === 'terminal' ? styles.segmentActive : ''}
                  onClick={() => setModal({ ...modal, executionMode: 'terminal' })}
                >
                  Terminal
                </button>
                <button
                  type="button"
                  className={modal.executionMode === 'exec' ? styles.segmentActive : ''}
                  onClick={() => setModal({ ...modal, executionMode: 'exec' })}
                >
                  Exec / Headless
                </button>
              </div>
              <small>{modal.executionMode === 'exec' ? 'Runs codex exec in the background and writes output to Chat.' : 'Opens external Terminal.app with the interactive Codex TUI.'}</small>
            </div>
            {modal.cliProvider === 'claude_cli' ? <p className={styles.error}>Claude CLI is not available yet.</p> : null}
            <footer>
              <button type="button" onClick={() => setModal(null)}>Cancel</button>
              <button className={styles.primaryButton} type="submit" disabled={modal.cliProvider === 'claude_cli'}>{modal.id ? 'Save changes' : 'Create gateway'}</button>
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

    </section>
  )
}
