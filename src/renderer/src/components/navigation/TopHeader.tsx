import { Link, useNavigate } from 'react-router-dom'
import { Navbar, Container } from 'react-bootstrap'
import { useEffect, useState } from 'react'
import { LuArrowRight, LuMessageCircleQuestion, LuSearch } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import type { User } from '@shared/types/entities'
import { useLocalAvatar } from '@renderer/components/avatar/localAvatar'
import { UserAvatar } from '@renderer/components/avatar/UserAvatar'
import { usePlannerQuestions } from '@renderer/components/planner/PlannerQuestionHost'
import styles from '@renderer/App.module.scss'
import { GlobalCreateTaskModal } from './GlobalCreateTaskModal'
import { PlannedTasksMenu } from './PlannedTasksMenu'
import { UniversalCommand, type GlobalTaskCreateInitial } from './UniversalCommand'

export function TopHeader({ user }: { user: User | null }) {
  const navigate = useNavigate()
  const userName = user?.name?.trim() || 'Mission Operator'
  const { avatarUrl } = useLocalAvatar(user?.id)
  const [open, setOpen] = useState(false)
  const [taskCreateInitial, setTaskCreateInitial] = useState<GlobalTaskCreateInitial | null>(null)
  const [questionPanelOpen, setQuestionPanelOpen] = useState(false)
  const { queue: plannerQuestions, hasConfigurationWarning, openQuestion } = usePlannerQuestions()

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
        <div className={styles.brandArea}>
          <div className={styles.brandMark}>OM</div>
          <div className={styles.brandText}>
            <p className={styles.brandTitle}>Open Mission Control</p>
          </div>
        </div>

        <button type="button" className={styles.universalSearchButton} onClick={() => setOpen(true)}>
          <LuSearch size={15} />
          <span>Search or create...</span>
          <kbd>⌘K</kbd>
        </button>

        <div className={styles.userCluster}>
          <PlannedTasksMenu />
          <div className={styles.plannerQuestionTopArea}>
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
            <UserAvatar name={userName} imageUrl={avatarUrl} alt={`${userName} avatar`} className={styles.userAvatar} />
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
