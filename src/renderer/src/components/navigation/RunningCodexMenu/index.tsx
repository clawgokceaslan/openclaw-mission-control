import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowRight, LuChevronLeft, LuChevronRight, LuMessageSquare, LuRefreshCw } from 'react-icons/lu'
import { IPC_CHANNELS, type RunningCodexGroupCounts, type RunningCodexGroupKey, type RunningCodexTaskRow, type RunningCodexTasksResponse } from '@shared/contracts/ipc'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { useGlobalCodexChat } from '@renderer/providers/codex-global-chat'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { formatRunningCodexActivitySummary, runningCodexConversationTypeLabel, runningCodexGroupLabel, runningCodexLiveStatusLabel } from '../runningCodexMenuUtils'
import { codexHeaderRefreshModeFromTaskActivityArgs, codexHeaderRefreshModeFromTaskUpdatedArgs } from '../codexHeaderRefresh'
import { useOutsidePointerDown } from '../useOutsidePointerDown'
import styles from './index.module.scss'

const PAGE_SIZE = 8
const RUNNING_GROUP_KEYS: RunningCodexGroupKey[] = ['all', 'planning', 'running', 'postRunning']
const EMPTY_COUNTS: RunningCodexGroupCounts = {
  all: 0,
  planning: 0,
  running: 0,
  postRunning: 0
}
type RunningSectionKey = Exclude<RunningCodexGroupKey, 'all'>

type RunningSection = {
  key: RunningSectionKey
  title: string
  rows: RunningCodexTaskRow[]
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString()
}

function buildRunningSections(rows: RunningCodexTaskRow[]): RunningSection[] {
  const sectionMap = new Map<RunningSectionKey, RunningCodexTaskRow[]>([
    ['planning', []],
    ['postRunning', []],
    ['running', []]
  ])

  for (const row of rows) {
    if (row.conversationType === 'plan') {
      sectionMap.get('planning')!.push(row)
    } else if (row.conversationType === 'post-run') {
      sectionMap.get('postRunning')!.push(row)
    } else {
      sectionMap.get('running')!.push(row)
    }
  }

  const sections: RunningSection[] = [
    { key: 'planning', title: 'Planning', rows: sectionMap.get('planning')! },
    { key: 'running', title: 'Running', rows: sectionMap.get('running')! },
    { key: 'postRunning', title: 'Post Running', rows: sectionMap.get('postRunning')! }
  ]
  return sections.filter((section) => section.rows.length > 0)
}

export function RunningCodexMenu() {
  const { token } = useAuth()
  const { openTaskConversation, busy: globalBusy } = useGlobalCodexChat()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [activeGroup, setActiveGroup] = useState<RunningCodexGroupKey>('all')
  const [counts, setCounts] = useState<RunningCodexGroupCounts>(EMPTY_COUNTS)
  const [rows, setRows] = useState<RunningCodexTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null)
  const requestCounterRef = useRef(0)
  const refreshTimerRef = useRef<number | null>(null)
  const pageRef = useRef(1)
  const openRef = useRef(false)
  const activeGroupRef = useRef<RunningCodexGroupKey>('all')

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const hasRows = rows.length > 0
  const runningTotal = counts.all

  const loadPage = useCallback(async (nextPage: number, options: { includeRows?: boolean } = {}) => {
    if (!token) return
    const includeRows = options.includeRows ?? true
    const requestedPage = Math.max(1, nextPage)
    const requestId = ++requestCounterRef.current

    if (includeRows) {
      setLoading(true)
    }
    const response = await invokeBridge<RunningCodexTasksResponse>(IPC_CHANNELS.tasks.listRunningCodex, {
      actorToken: token,
      page: requestedPage,
      pageSize: includeRows ? PAGE_SIZE : 1,
      group: activeGroupRef.current
    })

    if (requestId !== requestCounterRef.current) return

    if (includeRows) {
      setLoading(false)
    }
    setError(null)
    if (!response.ok || !response.data) {
      if (includeRows && openRef.current) {
        setError(response.error?.message ?? 'Unable to load running Codex conversations')
      }
      return
    }
    setCounts(response.data.counts ?? EMPTY_COUNTS)
    const nextTotal = Number(response.data.total ?? 0)
    setTotal(nextTotal)
    if (!includeRows || !openRef.current) return
    const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE))
    if (requestedPage > nextTotalPages) {
      void loadPage(nextTotalPages)
      return
    }
    setRows(Array.isArray(response.data.rows) ? response.data.rows : [])
    setTotal(nextTotal)
    setPage(response.data.page || requestedPage)
    pageRef.current = response.data.page || requestedPage
  }, [token])

  const scheduleSummaryRefresh = useCallback(() => {
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
    setRows([])
    setError(null)
    void loadPage(1)
  }, [activeGroup, loadPage, open])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    pageRef.current = page
  }, [page])

  useEffect(() => {
    activeGroupRef.current = activeGroup
  }, [activeGroup])

  useEffect(() => {
    if (!token) {
      setCounts(EMPTY_COUNTS)
      setRows([])
      setTotal(0)
      return
    }
    void loadPage(1, { includeRows: false })
  }, [loadPage, token])

  useEffect(() => {
    if (!token) return

    const onTaskActivity = (...args: unknown[]) => {
      const refreshMode = codexHeaderRefreshModeFromTaskActivityArgs(args)
      if (refreshMode === 'immediate') refreshFromSource()
      if (refreshMode === 'debounced') scheduleSummaryRefresh()
    }

    const onTaskUpdated = (...args: unknown[]) => {
      const refreshMode = codexHeaderRefreshModeFromTaskUpdatedArgs(args)
      if (refreshMode === 'immediate') refreshFromSource()
      if (refreshMode === 'debounced') scheduleSummaryRefresh()
    }

    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)

    return () => {
      unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
      unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)
    }
  }, [refreshFromSource, scheduleSummaryRefresh, token])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])
  const sections = useMemo(() => buildRunningSections(rows), [rows])

  useOutsidePointerDown(open, containerRef, () => setOpen(false))

  const selectRow = async (row: RunningCodexTaskRow) => {
    setOpeningConversationId(row.codexConversationId)
    setError(null)
    setOpen(false)
    const opened = await openTaskConversation({
      projectId: row.projectId,
      taskId: row.taskId,
      conversationId: row.codexConversationId,
      conversationType: row.conversationType
    })
    setOpeningConversationId(null)
    if (!opened) {
      setError('Unable to open the selected running conversation.')
    }
  }

  return (
    <div ref={containerRef} className={styles.runningCodexTopArea}>
      <button
        type="button"
        className={`${styles.runningCodexButton} ${runningTotal === 0 ? styles.runningCodexButtonIdle : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={runningTotal > 0 ? `${runningTotal} running Codex conversation${runningTotal === 1 ? '' : 's'}` : 'No running Codex conversations'}
        title="Running Codex chats"
      >
        <LuMessageSquare size={16} />
        {runningTotal > 0 ? <span>{runningTotal > 99 ? '99+' : runningTotal}</span> : null}
      </button>
      {open ? (
        <div className={styles.runningCodexPanel}>
          <header>
            <div>
              <strong>Running</strong>
              <span>{runningTotal > 0 ? `${runningTotal} live Codex conversation${runningTotal === 1 ? '' : 's'}` : 'No running conversations'}</span>
            </div>
            <button type="button" onClick={() => loadPage(page)} disabled={loading} aria-label="Refresh running conversations">
              <LuRefreshCw size={14} />
            </button>
          </header>
          <div className={styles.runningCodexTabs} role="tablist" aria-label="Running Codex groups">
            {RUNNING_GROUP_KEYS.map((group) => (
              <button
                key={group}
                type="button"
                role="tab"
                aria-selected={activeGroup === group}
                className={activeGroup === group ? styles.runningCodexTabActive : undefined}
                onClick={() => {
                  if (activeGroup === group) return
                  activeGroupRef.current = group
                  setActiveGroup(group)
                  setPage(1)
                  setRows([])
                  setTotal(counts[group])
                  pageRef.current = 1
                }}
              >
                <span>{runningCodexGroupLabel(group)}</span>
                <b>{counts[group]}</b>
              </button>
            ))}
          </div>
          {loading && !hasRows ? (
            <div className={styles.runningCodexState}>Loading running conversations...</div>
          ) : error ? (
            <div className={`${styles.runningCodexState} ${styles.runningCodexError}`}>{error}</div>
          ) : hasRows ? (
            <div className={styles.runningCodexList}>
              {sections.map((section) => (
                <section key={section.key} className={styles.runningCodexSection}>
                  <h3>{section.title}</h3>
                  {section.rows.map((row) => (
                    <button
                      key={`${row.taskId}:${row.codexConversationId}:${section.key}`}
                      type="button"
                      className={styles.runningCodexRow}
                      onClick={() => void selectRow(row)}
                      disabled={globalBusy || openingConversationId === row.codexConversationId}
                      aria-label={`Open ${row.taskTitle} ${runningCodexConversationTypeLabel(row.conversationType)} conversation`}
                      title={`Open ${row.taskTitle}`}
                    >
                      <div className={styles.runningCodexRowCopy}>
                        <strong title={row.taskTitle}>{row.taskTitle}</strong>
                        <span title={row.projectName}>
                          {row.projectName} · {runningCodexConversationTypeLabel(row.conversationType)} · {row.taskStatus}
                        </span>
                        <small>
                          <em className={row.liveStatus === 'running' ? styles.runningCodexLiveRunning : styles.runningCodexLiveQueued}>
                            {runningCodexLiveStatusLabel(row.liveStatus)}
                          </em>
                          <span title={row.latestActivitySummary}>{formatRunningCodexActivitySummary(row.latestActivitySummary) || 'Active conversation'}</span>
                          <b>{formatTimestamp(row.latestAt)}</b>
                        </small>
                      </div>
                      <LuArrowRight size={14} />
                    </button>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className={styles.runningCodexEmpty}>
              <LuMessageSquare size={18} />
              <strong>No running conversations</strong>
              <span>Queued and running Codex plan, run, chat, steer, and post-run conversations will appear here.</span>
            </div>
          )}
          <footer>
            <button type="button" onClick={() => loadPage(Math.max(1, page - 1))} disabled={loading || page <= 1} aria-label="Previous running conversations page">
              <LuChevronLeft size={14} />
            </button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" onClick={() => loadPage(Math.min(totalPages, page + 1))} disabled={loading || page >= totalPages} aria-label="Next running conversations page">
              <LuChevronRight size={14} />
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  )
}
