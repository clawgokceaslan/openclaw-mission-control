import { Link, useNavigate } from 'react-router-dom'
import { Navbar, Container } from 'react-bootstrap'
import { useEffect, useRef, useState } from 'react'
import { LuArrowRight, LuMenu, LuMessageCircleQuestion, LuPlus, LuSearch, LuX } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import type { User } from '@shared/types/entities'
import { UserAvatar } from '@renderer/components/avatar/UserAvatar'
import { resolveUserAvatarUrl } from '@renderer/components/avatar/avatarUrl'
import { RunningGatewayMenu } from './RunningCodexMenu'
import { usePlannerQuestions } from '@renderer/components/planner/PlannerQuestionHost'
import { useOutsidePointerDown } from './useOutsidePointerDown'
import styles from '@renderer/App.module.scss'
import { GlobalCreateTaskModal } from './GlobalCreateTaskModal'
import { PlannedTasksMenu } from './PlannedTasksMenu'
import { UniversalCommand, type GlobalTaskCreateInitial } from './UniversalCommand'

const appIconSrc = new URL('../../../../../app-icon.png', import.meta.url).href

function hasMacWindowControlsInset(): boolean {
  const isElectron = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)
  if (!isElectron) return false

  const runtimeProcess = (globalThis as { process?: { platform?: string } }).process
  return runtimeProcess?.platform === 'darwin'
}

type TopHeaderProps = {
  user: User | null
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function TopHeader({ user, sidebarOpen, onToggleSidebar }: TopHeaderProps) {
  const navigate = useNavigate()
  const userName = user?.name?.trim() || 'Mission Operator'
  const [open, setOpen] = useState(false)
  const [taskCreateInitial, setTaskCreateInitial] = useState<GlobalTaskCreateInitial | null>(null)
  const [questionPanelOpen, setQuestionPanelOpen] = useState(false)
  const questionPanelRef = useRef<HTMLDivElement | null>(null)
  const { queue: plannerQuestions, hasConfigurationWarning, openQuestion } = usePlannerQuestions()
  const avatarUrl = resolveUserAvatarUrl(user?.avatarUrl)
  const brandAreaClassName = `${styles.brandArea} ${hasMacWindowControlsInset() ? styles.brandAreaMacInset : ''}`

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (plannerQuestions.length === 0) setQuestionPanelOpen(false)
  }, [plannerQuestions.length])

  useOutsidePointerDown(questionPanelOpen, questionPanelRef, () => setQuestionPanelOpen(false))

  const openRelatedChat = (projectId: string, taskId: string, conversationId: string) => {
    setQuestionPanelOpen(false)
    navigate(`${APP_ROUTES.PROJECTS}/${projectId}`, {
      state: {
        openTaskId: taskId,
        openTaskConversationId: conversationId,
        openTaskChat: true
      }
    })
  }

  const onQuestionButtonClick = () => {
    setQuestionPanelOpen((current) => !current)
  }

  return (
    <Navbar className={styles.topbar}>
      <Container fluid className={styles.topbarInner}>
        <div className={brandAreaClassName}>
          <button
            type="button"
            className={styles.sidebarToggle}
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={sidebarOpen}
            aria-controls="primary-navigation"
            title={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          >
            {sidebarOpen ? <LuX size={18} /> : <LuMenu size={18} />}
          </button>
          <div className={styles.brandMark}>
            <img src={appIconSrc} alt="Open Mission Control logo" />
          </div>
          <div className={styles.brandText}>
            <p className={styles.brandTitle}>Open Mission Control</p>
          </div>
        </div>

        <button
          type="button"
          className={styles.universalSearchButton}
          onClick={() => setOpen(true)}
          aria-label="Open universal search"
          title="Search or create"
        >
          <LuSearch size={15} />
          <span>Search or create...</span>
          <kbd>⌘K</kbd>
        </button>

        <div className={styles.userCluster}>
          <button
            type="button"
            className={styles.headerAddTaskButton}
            onClick={() => setTaskCreateInitial({ title: '', projectId: '', templateId: null })}
            aria-label="Add task"
            title="Add task"
          >
            <LuPlus size={16} />
          </button>
          <PlannedTasksMenu />
          <RunningGatewayMenu />
          <div className={styles.plannerQuestionTopArea} ref={questionPanelRef}>
            <button
              type="button"
              className={`${styles.plannerQuestionButton} ${plannerQuestions.length === 0 ? styles.plannerQuestionButtonIdle : ''} ${hasConfigurationWarning ? styles.plannerQuestionButtonWarning : ''}`}
              onClick={onQuestionButtonClick}
              aria-label={plannerQuestions.length > 0 ? `${plannerQuestions.length} planner question${plannerQuestions.length === 1 ? '' : 's'} waiting` : 'No planner questions waiting'}
              title={plannerQuestions.length > 0 ? 'Planner questions' : 'No planner questions waiting'}
            >
              <LuMessageCircleQuestion size={16} />
              {plannerQuestions.length > 0 ? <span>{plannerQuestions.length}</span> : null}
            </button>
          {questionPanelOpen ? (
            <div className={styles.plannerQuestionPanel}>
              <header>
                <strong>Planner questions</strong>
                <span>{plannerQuestions.length > 0 ? `${plannerQuestions.length} waiting` : 'Clear'}</span>
              </header>
              {plannerQuestions.length > 0 ? (
                <div className={styles.plannerQuestionList}>
                  {plannerQuestions.map((item) => (
                    <article key={item.id} className={styles.plannerQuestionRow}>
                      <div>
                        <strong>{item.taskTitle}</strong>
                        <span>{item.projectId} · {item.prompt.questions.length} question{item.prompt.questions.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className={styles.plannerQuestionActions}>
                        <button
                          type="button"
                          onClick={() => {
                            openQuestion(item.id)
                            setQuestionPanelOpen(false)
                          }}
                        >
                          Answer
                        </button>
                        <button type="button" onClick={() => openRelatedChat(item.projectId, item.taskId, item.conversationId)} aria-label={`Open chat for ${item.taskTitle}`}>
                          <LuArrowRight size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.plannerQuestionEmpty}>
                  <LuMessageCircleQuestion size={18} />
                  <strong>No planner questions</strong>
                  <span>Questions that Codex asks before planning will stay here until answered.</span>
                </div>
              )}
            </div>
          ) : null}
          </div>
          <Link className={styles.userArea} to={APP_ROUTES.PROFILE} aria-label="Open profile">
            <UserAvatar name={userName} imageUrl={avatarUrl} alt="Open Mission Control avatar" className={styles.userAvatar} />
          </Link>
        </div>
      </Container>

      {open ? (
        <>
          <div className={styles.commandBackdrop} onClick={() => setOpen(false)} />
          <UniversalCommand
            onClose={() => setOpen(false)}
            onOpenTaskCreate={(initial) => {
              setOpen(false)
              setTaskCreateInitial(initial)
            }}
          />
        </>
      ) : null}
      <GlobalCreateTaskModal
        open={Boolean(taskCreateInitial)}
        initial={taskCreateInitial}
        onClose={() => setTaskCreateInitial(null)}
      />
    </Navbar>
  )
}
