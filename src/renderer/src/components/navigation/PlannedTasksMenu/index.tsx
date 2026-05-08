import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuClipboardList, LuRefreshCw, LuSettings2, LuPlay, LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse, type PlannedGatewayTaskRow } from '@shared/contracts/ipc'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { useGlobalGatewayChat } from '@renderer/providers/gateway-global-chat'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { LoadingState } from '@renderer/components/loading'
import { gatewayHeaderRefreshModeFromTaskActivityArgs, gatewayHeaderRefreshModeFromTaskUpdatedArgs } from '../gatewayHeaderRefresh'
import { useOutsidePointerDown } from '../useOutsidePointerDown'
import styles from './index.module.scss'

const PAGE_SIZE = 8

function missingLabel(row: PlannedGatewayTaskRow): string {
  if (row.missing.includes('gateway') && row.missing.includes('runModel')) return 'Gateway ve çalışma modeli gerekli'
  if (row.missing.includes('gateway')) return 'Gateway gerekli'
  if (row.missing.includes('runModel')) return 'Çalışma modeli gerekli'
  return 'Çalıştırmaya hazır'
}

export function PlannedTasksMenu() {
  const { token } = useAuth()
  const { launchPlannedTaskRun, openProjectGatewaySettings, busy: globalBusy } = useGlobalGatewayChat()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<PlannedGatewayTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null)
  const requestCounterRef = useRef(0)
  const refreshTimerRef = useRef<number | null>(null)
  const pageRef = useRef(1)
  const openRef = useRef(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const hasRows = rows.length > 0

  const loadPage = useCallback(async (nextPage: number, options: { includeRows?: boolean } = {}) => {
    if (!token) return

    const includeRows = options.includeRows ?? true
    const requestedPage = Math.max(1, nextPage)
    const requestId = ++requestCounterRef.current

    if (includeRows) {
      setLoading(true)
    }

    const response = await invokeBridge<PaginatedResponse<PlannedGatewayTaskRow>>(IPC_CHANNELS.tasks.listPlannedGateway, {
      actorToken: token,
      page: requestedPage,
      pageSize: includeRows ? PAGE_SIZE : 1
    })

    if (requestId !== requestCounterRef.current) return

    if (includeRows) {
      setLoading(false)
    }
    setError(null)
    if (!response.ok || !response.data) {
      if (includeRows && openRef.current) {
        setError(response.error?.message ?? 'Unable to load planned tasks')
      }
      return
    }
    const nextTotal = Number(response.data.total ?? 0)
    setTotal(nextTotal)
    if (!includeRows || !openRef.current) return

    const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE))
    if (requestedPage > nextTotalPages) {
      void loadPage(nextTotalPages)
      return
    }
    setRows(Array.isArray(response.data.rows) ? response.data.rows : [])
    setPage(response.data.page || requestedPage)
    pageRef.current = response.data.page || requestedPage
  }, [token])

  const scheduleRefresh = useCallback(() => {
    if (!token) return
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      if (!token) return
      if (openRef.current) {
        void loadPage(pageRef.current)
      } else {
        void loadPage(1, { includeRows: false })
      }
    }, 250)
  }, [loadPage, token])

  const refreshFromSource = useCallback(() => {
    if (!token) return
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    if (openRef.current) {
      void loadPage(pageRef.current)
    } else {
      void loadPage(1, { includeRows: false })
    }
  }, [loadPage, token])

  useEffect(() => {
    if (!open) return
    openRef.current = open
    void loadPage(1)
  }, [loadPage, open])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    pageRef.current = page
  }, [page])

  useEffect(() => {
    if (!token) {
      setRows([])
      setTotal(0)
      return
    }
    void loadPage(1, { includeRows: false })
  }, [loadPage, token])

  useEffect(() => {
    if (!token) return

    const onTaskActivity = (...args: unknown[]) => {
      const refreshMode = gatewayHeaderRefreshModeFromTaskActivityArgs(args)
      if (refreshMode === 'immediate') refreshFromSource()
      if (refreshMode === 'debounced') scheduleRefresh()
    }

    const onTaskUpdated = (...args: unknown[]) => {
      const refreshMode = gatewayHeaderRefreshModeFromTaskUpdatedArgs(args)
      if (refreshMode === 'immediate') refreshFromSource()
      if (refreshMode === 'debounced') scheduleRefresh()
    }

    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)

    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
      unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)
    }
  }, [refreshFromSource, scheduleRefresh, token])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  useOutsidePointerDown(open, containerRef, () => setOpen(false))

  const selectRow = async (row: PlannedGatewayTaskRow) => {
    if (!row.runnable) {
      setOpen(false)
      openProjectGatewaySettings(row.projectId, row.taskId)
      return
    }
    setLaunchingTaskId(row.taskId)
    const launched = await launchPlannedTaskRun({ projectId: row.projectId, taskId: row.taskId })
    setLaunchingTaskId(null)
    if (launched) {
      setOpen(false)
      void loadPage(page)
    }
  }

  return (
    <div ref={containerRef} className={styles.plannedTasksTopArea}>
      <button
        type="button"
        className={`${styles.plannedTasksButton} ${total === 0 ? styles.plannedTasksButtonIdle : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={total > 0 ? `${total} planı hazır task` : 'Planı hazır task yok'}
        title="Planı hazır tasklar"
      >
        <LuClipboardList size={16} />
        {total > 0 ? <span>{total > 99 ? '99+' : total}</span> : null}
      </button>
      {open ? (
        <div className={styles.plannedTasksPanel}>
          <header>
            <div>
              <strong>Çalıştırmaya hazır tasklar</strong>
              <span>{total > 0 ? `${total} task hazır veya ayar bekliyor` : 'Planı hazır task yok'}</span>
            </div>
            <button type="button" onClick={() => loadPage(page)} disabled={loading} aria-label="Planı hazır taskları yenile">
              <LuRefreshCw size={14} />
            </button>
          </header>
          {loading && !hasRows ? (
            <LoadingState variant="skeleton" rows={4} columns={2} messageIndex={3} />
          ) : error ? (
            <div className={`${styles.plannedTasksState} ${styles.plannedTasksError}`}>{error}</div>
          ) : hasRows ? (
            <div className={styles.plannedTasksList}>
              {rows.map((row) => (
                <article key={row.taskId} className={styles.plannedTasksRow}>
                  <div className={styles.plannedTasksRowCopy}>
                    <strong title={row.taskTitle}>{row.taskTitle}</strong>
                    <span title={row.projectName}>{row.projectName}</span>
                    <small className={row.runnable ? styles.plannedTasksReady : styles.plannedTasksMissing}>
                      {missingLabel(row)}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => void selectRow(row)}
                    disabled={globalBusy || launchingTaskId === row.taskId}
                    aria-label={row.runnable ? `${row.taskTitle} taskını çalıştır` : `${row.taskTitle} ayarlarını aç`}
                    title={row.runnable ? 'Çalıştır' : 'Codex ayarlarını aç'}
                  >
                    {row.runnable ? <LuPlay size={14} /> : <LuSettings2 size={14} />}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.plannedTasksEmpty}>
              <LuClipboardList size={18} />
              <strong>Planı hazır task yok</strong>
              <span>Planla aşaması tamamlanan tasklar burada çalıştırmaya hazır görünür.</span>
            </div>
          )}
          <footer>
            <button type="button" onClick={() => loadPage(Math.max(1, page - 1))} disabled={loading || page <= 1} aria-label="Previous planned tasks page">
              <LuChevronLeft size={14} />
            </button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" onClick={() => loadPage(Math.min(totalPages, page + 1))} disabled={loading || page >= totalPages} aria-label="Next planned tasks page">
              <LuChevronRight size={14} />
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  )
}
