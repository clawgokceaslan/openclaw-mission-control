import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowRight, LuChevronLeft, LuChevronRight, LuMessageSquare, LuRefreshCw } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse, type RunningCodexTaskRow } from '@shared/contracts/ipc'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { useGlobalCodexChat } from '@renderer/providers/codex-global-chat'
import { invokeBridge } from '@renderer/utils/api'
import { formatRunningCodexActivitySummary, runningCodexConversationTypeLabel, runningCodexLiveStatusLabel } from '../runningCodexMenuUtils'
import { useOutsidePointerDown } from '../useOutsidePointerDown'
import styles from './index.module.scss'

const PAGE_SIZE = 8
const RUNNING_SECTION_KEYS = ['planning', 'postRunning', 'running'] as const
type RunningSectionKey = typeof RUNNING_SECTION_KEYS[number]

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
    { key: 'postRunning', title: 'Post Running', rows: sectionMap.get('postRunning')! },
    { key: 'running', title: 'Running', rows: sectionMap.get('running')! }
  ]
  return sections.filter((section) => section.rows.length > 0)
}

export function RunningCodexMenu() {
  const { token } = useAuth()
  const { openTaskConversation, busy: globalBusy } = useGlobalCodexChat()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<RunningCodexTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const hasRows = rows.length > 0

  const loadPage = useCallback(async (nextPage: number) => {
    if (!token) return
    const requestedPage = Math.max(1, nextPage)
    setLoading(true)
    setError(null)
    const response = await invokeBridge<PaginatedResponse<RunningCodexTaskRow>>(IPC_CHANNELS.tasks.listRunningCodex, {
      actorToken: token,
      page: requestedPage,
      pageSize: PAGE_SIZE
    })
    setLoading(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to load running Codex conversations')
      return
    }
    const nextTotal = Number(response.data.total ?? 0)
    const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE))
    if (requestedPage > nextTotalPages) {
      void loadPage(nextTotalPages)
      return
    }
    setRows(Array.isArray(response.data.rows) ? response.data.rows : [])
    setTotal(nextTotal)
    setPage(response.data.page || requestedPage)
  }, [token])

  useEffect(() => {
    if (!open) return
    void loadPage(1)
  }, [loadPage, open])
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
        className={`${styles.runningCodexButton} ${total === 0 ? styles.runningCodexButtonIdle : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={total > 0 ? `${total} running Codex conversation${total === 1 ? '' : 's'}` : 'No running Codex conversations'}
        title="Running Codex chats"
      >
        <LuMessageSquare size={16} />
        {total > 0 ? <span>{total > 99 ? '99+' : total}</span> : null}
      </button>
      {open ? (
        <div className={styles.runningCodexPanel}>
          <header>
            <div>
              <strong>Running</strong>
              <span>{total > 0 ? `${total} live Codex conversation${total === 1 ? '' : 's'}` : 'No running conversations'}</span>
            </div>
            <button type="button" onClick={() => loadPage(page)} disabled={loading} aria-label="Refresh running conversations">
              <LuRefreshCw size={14} />
            </button>
          </header>
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
