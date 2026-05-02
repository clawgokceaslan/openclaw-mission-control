import { DragEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { LuCopy, LuDownload, LuExternalLink, LuFileText, LuHistory, LuEllipsis, LuPencil, LuPlay, LuSparkles, LuTrash2, LuUpload, LuX } from 'react-icons/lu'
import styles from './TaskDetailModal.module.scss'

interface TaskDetailModalProps {
  taskId: string
  children: ReactNode
  onClose: () => void
  onDeleteTask: () => void
  onEditTitle: () => void
  onOpenActivity: () => void
  title?: string
  nested?: boolean
  hideTaskActions?: boolean
  onFilesDrop?: (files: File[]) => void
  onDownloadZip?: () => void
  onDownloadTaskMarkdown?: () => void
  onDownloadAgentMarkdown?: () => void
  onDownloadSkillsMarkdown?: () => void
  onRunCodex?: () => void
  isRunCodexBusy?: boolean
  isRunCodexDisabled?: boolean
  onPlanWithCodex?: () => void
  isPlanWithCodexBusy?: boolean
  isPlanWithCodexDisabled?: boolean
  onImportJson?: () => void
}

export function TaskDetailModal({
  taskId,
  children,
  onClose,
  onDeleteTask,
  onEditTitle,
  onOpenActivity,
  title = 'Task detail',
  nested = false,
  hideTaskActions = false,
  onFilesDrop,
  onDownloadZip,
  onDownloadTaskMarkdown,
  onDownloadAgentMarkdown,
  onDownloadSkillsMarkdown,
  onRunCodex,
  isRunCodexBusy = false,
  isRunCodexDisabled = false,
  onPlanWithCodex,
  isPlanWithCodexBusy = false,
  isPlanWithCodexDisabled = false,
  onImportJson
}: TaskDetailModalProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const downloadMenuRef = useRef<HTMLDivElement | null>(null)
  const dragDepthRef = useRef(0)
  const hasDownloadActions = Boolean(onDownloadZip || onDownloadTaskMarkdown || onDownloadAgentMarkdown || onDownloadSkillsMarkdown)

  useEffect(() => {
    if (!isMenuOpen && !isDownloadMenuOpen) return
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      if (downloadMenuRef.current?.contains(event.target as Node)) return
      setIsMenuOpen(false)
      setIsDownloadMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [isMenuOpen, isDownloadMenuOpen])

  const copyTaskId = () => {
    void navigator.clipboard?.writeText(taskId)
    setIsMenuOpen(false)
  }

  const copyTaskLink = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('task', taskId)
    void navigator.clipboard?.writeText(url.toString())
    setIsMenuOpen(false)
  }

  const runHeaderAction = (event: PointerEvent<HTMLButtonElement>, action: () => void) => {
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  const actions = (
    <>
      {!hideTaskActions ? (
        <>
          {onImportJson ? (
            <button
              type="button"
              className={styles.iconButton}
              onPointerDown={(event) => runHeaderAction(event, onImportJson)}
              aria-label="Import JSON"
            >
              <LuUpload size={16} />
            </button>
          ) : null}
          {hasDownloadActions ? (
            <div className={styles.menuWrap} ref={downloadMenuRef}>
              <button
                type="button"
                className={`${styles.iconButton} ${isDownloadMenuOpen ? styles.iconButtonActive : ''}`}
                onPointerDown={(event) => runHeaderAction(event, () => {
                  setIsMenuOpen(false)
                  setIsDownloadMenuOpen((value) => !value)
                })}
                aria-label="Download task"
              >
                <LuDownload size={17} />
              </button>
              {isDownloadMenuOpen ? (
                <div className={styles.menu} role="menu">
                  {onDownloadZip ? (
                    <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadZip() }}><LuDownload size={15} /> Download ZIP</button>
                  ) : null}
                  {onDownloadTaskMarkdown ? (
                    <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadTaskMarkdown() }}><LuFileText size={15} /> Download Task.md</button>
                  ) : null}
                  {onDownloadAgentMarkdown ? (
                    <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadAgentMarkdown() }}><LuFileText size={15} /> Download Agents.md</button>
                  ) : null}
                  {onDownloadSkillsMarkdown ? (
                    <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadSkillsMarkdown() }}><LuFileText size={15} /> Download Skills.md</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              type="button"
              className={`${styles.iconButton} ${isMenuOpen ? styles.iconButtonActive : ''}`}
              onPointerDown={(event) => runHeaderAction(event, () => {
                setIsDownloadMenuOpen(false)
                setIsMenuOpen((value) => !value)
              })}
              aria-label="Task actions"
            >
              <LuEllipsis size={18} />
            </button>
            {isMenuOpen ? (
              <div className={styles.menu} role="menu">
                <button type="button" onClick={copyTaskLink}><LuExternalLink size={15} /> Copy link</button>
                <button type="button" onClick={copyTaskId}><LuCopy size={15} /> Copy task ID</button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false)
                    onEditTitle()
                  }}
                >
                  <LuPencil size={15} /> Edit title
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false)
                    onOpenActivity()
                  }}
                >
                  <LuHistory size={15} /> Open activity chat
                </button>
                <button
                  type="button"
                  className={styles.dangerAction}
                  onClick={() => {
                    setIsMenuOpen(false)
                    onDeleteTask()
                  }}
                >
                  <LuTrash2 size={15} /> Delete task
                </button>
              </div>
            ) : null}
          </div>
          <div className={styles.primaryActions}>
            {onPlanWithCodex ? (
              <button
                type="button"
                className={`${styles.iconButton} ${styles.planButton}`}
                onPointerDown={(event) => runHeaderAction(event, () => {
                  if (!isPlanWithCodexBusy) onPlanWithCodex()
                })}
                disabled={isPlanWithCodexBusy}
                aria-label="Plan task with Codex"
                title={isPlanWithCodexDisabled ? 'Configure Codex gateway and model before planning this task.' : 'Plan task with Codex'}
              >
                <LuSparkles size={16} />
              </button>
            ) : null}
            {onRunCodex ? (
              <button
                type="button"
                className={`${styles.iconButton} ${styles.runButton}`}
                onPointerDown={(event) => runHeaderAction(event, () => {
                  if (!isRunCodexBusy) onRunCodex()
                })}
                disabled={isRunCodexBusy}
                aria-label="Run task with Codex"
                title={isRunCodexDisabled ? 'Configure Codex gateway and model before running this task.' : 'Run task with Codex'}
              >
                <LuPlay size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className={styles.iconButton}
              onPointerDown={(event) => runHeaderAction(event, onOpenActivity)}
              aria-label="Open activity chat"
            >
              <LuHistory size={16} />
            </button>
          </div>
        </>
      ) : null}
      <button
        type="button"
        className={styles.iconButton}
        onPointerDown={(event) => runHeaderAction(event, onClose)}
        aria-label="Close task modal"
      >
        <LuX size={18} />
      </button>
    </>
  )

  return (
    <>
      <div className={`${styles.backdrop} ${nested ? styles.nestedBackdrop : ''}`} onClick={onClose} />
      <section
        className={`${styles.shell} ${nested ? styles.nestedShell : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onDragEnter={(event: DragEvent<HTMLElement>) => {
          if (!onFilesDrop || !Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          dragDepthRef.current += 1
          setIsDraggingFiles(true)
        }}
        onDragOver={(event) => {
          if (!onFilesDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (!onFilesDrop) return
          event.preventDefault()
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (dragDepthRef.current === 0) setIsDraggingFiles(false)
        }}
        onDrop={(event) => {
          if (!onFilesDrop) return
          event.preventDefault()
          dragDepthRef.current = 0
          setIsDraggingFiles(false)
          const files = Array.from(event.dataTransfer.files ?? [])
          if (files.length > 0) onFilesDrop(files)
        }}
      >
        {isDraggingFiles ? <div className={styles.dropOverlay}>Drop files here</div> : null}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerTitle}>{title}</span>
          </div>
          <div className={styles.headerActions}>
            {actions}
          </div>
        </header>
        {children}
      </section>
    </>
  )
}
