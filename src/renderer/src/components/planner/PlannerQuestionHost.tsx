import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { LuArrowRight, LuMinus, LuSend, LuSparkles } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Project, TaskEntity } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { formatPlannerClarificationAnswer } from '@renderer/screens/projects/detail/chat/chatUtils'
import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import {
  enqueuePlannerQuestion,
  plannerQuestionItemFromActivity,
  removeAnsweredPlannerQuestions,
  resolvePlannerQuestionConfig,
  unansweredPlannerQuestionsFromTasks,
  type PlannerQuestionActivityEvent,
  type PlannerQuestionQueueItem
} from './plannerQuestionQueue'
import styles from './PlannerQuestionHost.module.scss'

type ResolvedQuestionContext = {
  config: ReturnType<typeof resolvePlannerQuestionConfig>
  task: TaskEntity | null
  project: Project | null
}

function nextSelectedOptionIds(current: Record<string, string>, questionId: string, optionId: string): Record<string, string> {
  if (current[questionId] === optionId) {
    const { [questionId]: _removed, ...rest } = current
    return rest
  }
  return { ...current, [questionId]: optionId }
}

type PlannerQuestionContextValue = {
  queue: PlannerQuestionQueueItem[]
  active: PlannerQuestionQueueItem | null
  isModalOpen: boolean
  hasConfigurationWarning: boolean
  openFirstQuestion: () => void
  openQuestion: (questionId: string) => void
  closeQuestionModal: () => void
  removeQuestion: (questionId: string) => void
}

const PlannerQuestionContext = createContext<PlannerQuestionContextValue | null>(null)
const EMPTY_PLANNER_QUESTION_CONTEXT: PlannerQuestionContextValue = {
  queue: [],
  active: null,
  isModalOpen: false,
  hasConfigurationWarning: false,
  openFirstQuestion: () => {},
  openQuestion: () => {},
  closeQuestionModal: () => {},
  removeQuestion: () => {}
}

export function usePlannerQuestions(): PlannerQuestionContextValue {
  const value = useContext(PlannerQuestionContext)
  return value ?? EMPTY_PLANNER_QUESTION_CONTEXT
}

export function PlannerQuestionProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [queue, setQueue] = useState<PlannerQuestionQueueItem[]>([])
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const openQuestion = useCallback((questionId: string) => {
    setActiveQuestionId(questionId)
    setIsModalOpen(true)
  }, [])

  const openFirstQuestion = useCallback(() => {
    setQueue((current) => {
      if (current[0]) {
        setActiveQuestionId(current[0].id)
        setIsModalOpen(true)
      }
      return current
    })
  }, [])

  const closeQuestionModal = useCallback(() => {
    setIsModalOpen(false)
  }, [])

  const removeQuestion = useCallback((questionId: string) => {
    setQueue((current) => current.filter((item) => item.id !== questionId))
    setActiveQuestionId((current) => current === questionId ? null : current)
  }, [])

  const enqueueAndOpen = useCallback((item: PlannerQuestionQueueItem) => {
    setQueue((current) => {
      const existed = current.some((queued) => queued.id === item.id)
      const next = enqueuePlannerQuestion(current, item)
      if (!existed) {
        const first = next[0] ?? item
        setActiveQuestionId((currentActive) => currentActive && next.some((queued) => queued.id === currentActive) ? currentActive : first.id)
        setIsModalOpen(true)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!token) {
      setQueue([])
      setActiveQuestionId(null)
      setIsModalOpen(false)
      return
    }
    let cancelled = false

    const bootstrapQuestions = async () => {
      const response = await invokeBridge<TaskEntity[]>(IPC_CHANNELS.tasks.list, { actorToken: token })
      if (cancelled || !response.ok || !Array.isArray(response.data)) return
      const questions = unansweredPlannerQuestionsFromTasks(response.data)
      setQueue((current) => {
        const next = questions.reduce((items, item) => enqueuePlannerQuestion(items, item), current)
        if (next.length > 0) {
          setActiveQuestionId((currentActive) => currentActive && next.some((item) => item.id === currentActive) ? currentActive : next[0].id)
          setIsModalOpen((currentOpen) => currentOpen || current.length === 0)
        }
        return next
      })
    }

    void bootstrapQuestions()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    const onTaskActivity = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as PlannerQuestionActivityEvent | undefined
      const message = payload?.message as TaskActivityMessage | undefined
      if (!payload || !message) return
      const item = plannerQuestionItemFromActivity({ ...payload, message })
      if (item) {
        enqueueAndOpen(item)
        return
      }
      setQueue((current) => removeAnsweredPlannerQuestions(current, message))
    }

    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
  }, [enqueueAndOpen])

  useEffect(() => {
    if (!activeQuestionId || queue.some((item) => item.id === activeQuestionId)) return
    setActiveQuestionId(queue[0]?.id ?? null)
  }, [activeQuestionId, queue])

  const active = queue.find((item) => item.id === activeQuestionId) ?? queue[0] ?? null
  const value = useMemo<PlannerQuestionContextValue>(() => ({
    queue,
    active,
    isModalOpen,
    hasConfigurationWarning: queue.some((item) => !item.gatewayId || !item.model),
    openFirstQuestion,
    openQuestion,
    closeQuestionModal,
    removeQuestion
  }), [active, closeQuestionModal, isModalOpen, openFirstQuestion, openQuestion, queue, removeQuestion])

  return (
    <PlannerQuestionContext.Provider value={value}>
      {children}
    </PlannerQuestionContext.Provider>
  )
}

export function PlannerQuestionHost() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const { active, isModalOpen, queue, closeQuestionModal, removeQuestion } = usePlannerQuestions()
  const [selectedOptionIds, setSelectedOptionIds] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [resolved, setResolved] = useState<ResolvedQuestionContext | null>(null)

  useEffect(() => {
    setSelectedOptionIds({})
    setNotes({})
    setSubmitting(false)
    setResolveError(null)
    setResolved(null)
  }, [active?.id])

  useEffect(() => {
    if (!active) return
    let cancelled = false

    const resolveContext = async () => {
      let task: TaskEntity | null = null
      let project: Project | null = null
      if (token && active.taskId) {
        const taskResponse = await invokeBridge<TaskEntity>(IPC_CHANNELS.tasks.get, { actorToken: token, id: active.taskId })
        if (taskResponse.ok && taskResponse.data) task = taskResponse.data
      }
      const projectId = active.projectId || task?.projectId
      if (token && projectId) {
        const projectResponse = await invokeBridge<Project>(IPC_CHANNELS.projects.get, { actorToken: token, id: projectId })
        if (projectResponse.ok && projectResponse.data) project = projectResponse.data
      }
      const config = resolvePlannerQuestionConfig({ item: active, task, project })
      if (cancelled) return
      setResolved({ config, task, project })
      if (!token) {
        setResolveError('Sign in is required before answering this planner question.')
      } else if (!config.gatewayId || !config.model) {
        setResolveError('This plan question is missing Codex gateway or plan model settings. Open the related chat and configure the project model settings before answering.')
      } else {
        setResolveError(null)
      }
    }

    void resolveContext()
    return () => {
      cancelled = true
    }
  }, [active, token])

  const canSubmit = useMemo(() => Boolean(active && !submitting && !resolveError), [active, resolveError, submitting])

  const openRelatedChat = () => {
    if (!active) return
    navigate(`${APP_ROUTES.PROJECTS}/${active.projectId}`, {
      state: {
        openTaskId: active.taskId,
        openTaskConversationId: active.conversationId,
        openTaskChat: true
      }
    })
  }

  const submitAnswer = async () => {
    if (!active || !resolved?.config || !canSubmit || resolveError) return
    setSubmitting(true)
    const answer = formatPlannerClarificationAnswer({
      prompt: active.prompt,
      selectedOptionIds,
      notes
    })
    const response = await invokeBridge(IPC_CHANNELS.tasks.planWithCodex, {
      actorToken: token,
      taskId: resolved.config.taskId,
      projectId: resolved.config.projectId,
      gatewayId: resolved.config.gatewayId,
      model: resolved.config.model,
      language: resolved.config.language,
      reasoningEffort: resolved.config.reasoningEffort,
      conversationId: active.conversationId,
      clarificationMessage: answer
    })
    setSubmitting(false)
    if (!response.ok) {
      setResolveError(response.error?.message ?? 'Unable to send planner clarification.')
      return
    }
    removeQuestion(active.id)
  }

  if (!active || !isModalOpen) return null

  const displayTaskTitle = resolved?.task?.title || active.taskTitle
  const displayProjectName = resolved?.project?.name || active.projectId
  const queueLabel = queue.length > 1 ? `Question ${1} of ${queue.length}` : 'Planner question'

  const modal = (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Planner clarification questions">
      <section className={styles.dialog}>
        <header className={styles.header}>
          <span className={styles.icon}><LuSparkles size={20} /></span>
          <div>
            <small>{queueLabel}</small>
            <h2>Codex needs input before planning</h2>
            <p>{displayProjectName} / {displayTaskTitle}</p>
          </div>
          <button type="button" className={styles.minimizeButton} onClick={closeQuestionModal} aria-label="Minimize planner questions">
            <LuMinus size={18} />
          </button>
        </header>

        <div className={styles.summary}>
          <strong>{active.prompt.summary}</strong>
          <button type="button" onClick={openRelatedChat}>
            Open related chat <LuArrowRight size={14} />
          </button>
        </div>

        {resolveError ? <div className={styles.error}>{resolveError}</div> : null}

        <div className={styles.questions}>
          {active.prompt.questions.map((question, questionIndex) => (
            <article key={question.id} className={styles.questionCard}>
              <div className={styles.questionTitle}>
                <span>{questionIndex + 1}</span>
                <div>
                  <h3>{question.question}</h3>
                  {question.why ? <p>{question.why}</p> : null}
                </div>
              </div>
              {question.options.length > 0 ? (
                <div className={styles.options}>
                  {question.options.map((option) => (
                    <label key={option.id} className={selectedOptionIds[question.id] === option.id ? styles.optionSelected : ''}>
                      <input
                        type="checkbox"
                        name={`global-planner-question-${active.id}-${question.id}`}
                        checked={selectedOptionIds[question.id] === option.id}
                        onChange={() => setSelectedOptionIds((current) => nextSelectedOptionIds(current, question.id, option.id))}
                      />
                      <span>
                        <b>{option.label}</b>
                        {option.description ? <small>{option.description}</small> : null}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              <textarea
                value={notes[question.id] ?? ''}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setNotes((current) => ({ ...current, [question.id]: value }))
                }}
                placeholder={question.options.length > 0 ? 'Optional note...' : 'Answer...'}
              />
            </article>
          ))}
        </div>

        <footer className={styles.footer}>
          <span>{queue.length > 1 ? `${queue.length - 1} more planner question batch${queue.length - 1 === 1 ? '' : 'es'} waiting.` : 'You can leave choices blank and Codex will decide.'}</span>
          <button type="button" onClick={() => void submitAnswer()} disabled={!canSubmit || submitting || Boolean(resolveError)}>
            {submitting ? 'Sending...' : <><LuSend size={15} /> Send answer</>}
          </button>
        </footer>
      </section>
    </div>
  )

  const target = typeof document === 'undefined' ? null : document.body
  return target ? createPortal(modal, target) : modal
}
