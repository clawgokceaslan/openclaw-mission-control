import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuClipboardList, LuRefreshCw, LuSettings2, LuPlay, LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse, type PlannedCodexTaskRow } from '@shared/contracts/ipc'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { useGlobalCodexChat } from '@renderer/providers/codex-global-chat'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { useOutsidePointerDown } from '../useOutsidePointerDown'
import { type TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import styles from './index.module.scss'

const PAGE_SIZE = 8

function missingLabel(row: PlannedCodexTaskRow): string {
  if (row.missing.includes('gateway') && row.missing.includes('runModel')) return 'Gateway and run model required'
  if (row.missing.includes('gateway')) return 'Gateway required'
  if (row.missing.includes('runModel')) return 'Run model required'
  return 'Ready to run'
}

export function PlannedTasksMenu() {
  const { token } = useAuth()
  const { launchPlannedTaskRun, openProjectCodexSettings, busy: globalBusy } = useGlobalCodexChat()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<PlannedCodexTaskRow[]>([])
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

    const response = await invokeBridge<PaginatedResponse<PlannedCodexTaskRow>>(IPC_CHANNELS.tasks.listPlannedCodex, {
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
      const payload = (args[1] ?? args[0]) as { message?: TaskActivityMessage } | undefined
      const source = payload?.message?.source
      if (source === 'codex-plan' || source === 'codex-run' || source === 'codex-chat') {
        scheduleRefresh()
      }
    }

    const onTaskUpdated = () => {
      scheduleRefresh()
    }

    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)

    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
      unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)
    }
  }, [scheduleRefresh, token])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  useOutsidePointerDown(open, containerRef, () => setOpen(false))

  const selectRow = async (row: PlannedCodexTaskRow) => {
    if (!row.runnable) {
      setOpen(false)
      openProjectCodexSettings(row.projectId, row.taskId)
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
        aria-label={total > 0 ? `${total} planned Codex task${total === 1 ? '' : 's'}` : 'No planned Codex tasks'}
        title="Planned Codex tasks"
      >
        <LuClipboardList size={16} />
        {total > 0 ? <span>{total > 99 ? '99+' : total}</span> : null}
      </button>
      {open ? (
        <div className={styles.plannedTasksPanel}>
          <header>
            <div>
              <strong>Planned runs</strong>
              <span>{total > 0 ? `${total} task${total === 1 ? '' : 's'} ready or waiting` : 'No planned tasks'}</span>
            </div>
            <button type="button" onClick={() => loadPage(page)} disabled={loading} aria-label="Refresh planned tasks">
              <LuRefreshCw size={14} />
            </button>
          </header>
          {loading && !hasRows ? (
            <div className={styles.plannedTasksState}>Loading planned tasks...</div>
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
                    aria-label={row.runnable ? `Run ${row.taskTitle}` : `Configure ${row.taskTitle}`}
                    title={row.runnable ? 'Start run' : 'Open Codex settings'}
                  >
                    {row.runnable ? <LuPlay size={14} /> : <LuSettings2 size={14} />}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.plannedTasksEmpty}>
              <LuClipboardList size={18} />
              <strong>No planned tasks</strong>
              <span>Codex tasks with a planned plan state will appear here.</span>
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
