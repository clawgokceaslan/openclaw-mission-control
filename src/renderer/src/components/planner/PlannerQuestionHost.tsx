import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuArrowRight, LuSend, LuSparkles } from 'react-icons/lu'
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
  type PlannerQuestionActivityEvent,
  type PlannerQuestionQueueItem
} from './plannerQuestionQueue'
import styles from './PlannerQuestionHost.module.scss'

type ResolvedQuestionContext = {
  config: ReturnType<typeof resolvePlannerQuestionConfig>
  task: TaskEntity | null
  project: Project | null
}

export function PlannerQuestionHost() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [queue, setQueue] = useState<PlannerQuestionQueueItem[]>([])
  const [selectedOptionIds, setSelectedOptionIds] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [resolved, setResolved] = useState<ResolvedQuestionContext | null>(null)

  const active = queue[0] ?? null

  useEffect(() => {
    const onTaskActivity = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as PlannerQuestionActivityEvent | undefined
      const message = payload?.message as TaskActivityMessage | undefined
      if (!payload || !message) return
      const item = plannerQuestionItemFromActivity({ ...payload, message })
      if (item) {
        setQueue((current) => enqueuePlannerQuestion(current, item))
        return
      }
      setQueue((current) => removeAnsweredPlannerQuestions(current, message))
    }

    subscribeToChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.taskActivity, onTaskActivity)
  }, [])

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

  const canSubmit = useMemo(() => Boolean(active && active.prompt.questions.every((question) => (
    question.options.length > 0
      ? Boolean(selectedOptionIds[question.id])
      : Boolean(notes[question.id]?.trim())
  ))), [active, notes, selectedOptionIds])

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
    setQueue((current) => current.filter((item) => item.id !== active.id))
  }

  if (!active) return null

  const displayTaskTitle = resolved?.task?.title || active.taskTitle
  const displayProjectName = resolved?.project?.name || active.projectId
  const queueLabel = queue.length > 1 ? `Question ${1} of ${queue.length}` : 'Planner question'

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Planner clarification questions">
      <section className={styles.dialog}>
        <header className={styles.header}>
          <span className={styles.icon}><LuSparkles size={20} /></span>
          <div>
            <small>{queueLabel}</small>
            <h2>Codex needs input before planning</h2>
            <p>{displayProjectName} / {displayTaskTitle}</p>
          </div>
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
                        type="radio"
                        name={`global-planner-question-${active.id}-${question.id}`}
                        checked={selectedOptionIds[question.id] === option.id}
                        onChange={() => setSelectedOptionIds((current) => ({ ...current, [question.id]: option.id }))}
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
                onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.currentTarget.value }))}
                placeholder={question.options.length > 0 ? 'Optional note...' : 'Answer...'}
              />
            </article>
          ))}
        </div>

        <footer className={styles.footer}>
          <span>{queue.length > 1 ? `${queue.length - 1} more planner question batch${queue.length - 1 === 1 ? '' : 'es'} waiting.` : 'Answer to continue the planner run.'}</span>
          <button type="button" onClick={() => void submitAnswer()} disabled={!canSubmit || submitting || Boolean(resolveError)}>
            {submitting ? 'Sending...' : <><LuSend size={15} /> Send answer</>}
          </button>
        </footer>
      </section>
    </div>
  )
}
