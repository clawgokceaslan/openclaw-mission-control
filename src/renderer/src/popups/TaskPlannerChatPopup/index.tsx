import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuArrowLeft, LuArrowRight, LuCheck, LuGripVertical, LuListChecks, LuPlus, LuRefreshCw, LuSend, LuSparkles, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Project, TaskEntity, TaskJsonImportResult } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import styles from './index.module.scss'

type PlannerStep = 1 | 2 | 3

export type TaskPlannerDraft = {
  id: string
  order: number
  title: string
  description: string
}

interface TaskPlannerChatPopupProps {
  open: boolean
  actorToken: string | null
  project: Project
  sourceTask: TaskEntity
  defaultStatus?: string
  onClose: () => void
  onCreated: (tasks: TaskEntity[]) => void
}

const QUESTIONS = [
  'Bu geniş taskın kullanıcıya veya ürüne sağlayacağı ana sonuç ne?',
  'Bu işi bağımsız ilerleyebilecek hangi 3-6 teslimat parçasına ayırırsın?',
  'Her parçanın kabul sinyali ne olmalı ve hangi parça önce gelmeli?'
]

function createDraftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `draft-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function splitAnswerToDraftTitles(answer: string): string[] {
  const lines = answer
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
  if (lines.length >= 2) return lines.slice(0, 8)
  return answer
    .split(/[.;]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 12)
    .slice(0, 6)
}

function buildDrafts(task: TaskEntity, answers: string[]): TaskPlannerDraft[] {
  const candidateTitles = splitAnswerToDraftTitles(answers[1] || answers.join('\n'))
  const titles = candidateTitles.length > 0
    ? candidateTitles
    : [
      `${task.title} kapsamını netleştir`,
      `${task.title} uygulama adımlarını çıkar`,
      `${task.title} kabul akışını doğrula`
    ]
  const outcome = answers[0]?.trim()
  const acceptance = answers[2]?.trim()
  return titles.map((title, index) => ({
    id: createDraftId(),
    order: index + 1,
    title,
    description: [
      `Kaynak task: ${task.title}`,
      outcome ? `Ana sonuç: ${outcome}` : '',
      `Beklenen çıktı: ${title}`,
      acceptance ? `Kabul sinyali ve sıralama notu: ${acceptance}` : '',
      'Senior product manager yaklaşımıyla kapsamı dar, bağımsız ve doğrulanabilir şekilde ele al.'
    ].filter(Boolean).join('\n\n')
  }))
}

function draftsToPlannerJson(drafts: TaskPlannerDraft[], status?: string) {
  return drafts
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((draft) => ({
      title: draft.title.trim(),
      description: draft.description.trim(),
      ...(status ? { status } : {}),
      comments: [{
        authorName: 'Planner',
        body: `Bu task çoklu planlama akışında ${draft.order}. sırada üretildi.`
      }]
    }))
}

export function TaskPlannerChatPopup({ open, actorToken, project, sourceTask, defaultStatus, onClose, onCreated }: TaskPlannerChatPopupProps) {
  const [step, setStep] = useState<PlannerStep>(1)
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const [drafts, setDrafts] = useState<TaskPlannerDraft[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const currentQuestionIndex = Math.min(answers.findIndex((answer) => !answer.trim()), QUESTIONS.length - 1)
  const answeredCount = answers.filter((answer) => answer.trim()).length
  const canContinueToPreview = answeredCount === QUESTIONS.length
  const sortedDrafts = useMemo(() => drafts.slice().sort((a, b) => a.order - b.order), [drafts])

  if (!open) return null
  const target = typeof document === 'undefined' ? null : document.body

  const updateDraft = (id: string, patch: Partial<TaskPlannerDraft>) => {
    setDrafts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const removeDraft = (id: string) => {
    setDrafts((items) => items.filter((item) => item.id !== id).map((item, index) => ({ ...item, order: index + 1 })))
  }

  const addDraft = () => {
    setDrafts((items) => [...items, {
      id: createDraftId(),
      order: items.length + 1,
      title: '',
      description: `Kaynak task: ${sourceTask.title}\n\nBeklenen çıktı:`
    }])
  }

  const submitAnswer = () => {
    const normalized = message.trim()
    if (!normalized) return
    const targetIndex = answers.findIndex((answer) => !answer.trim())
    if (targetIndex < 0) return
    const nextAnswers = answers.map((answer, index) => index === targetIndex ? normalized : answer)
    setAnswers(nextAnswers)
    setMessage('')
    setError('')
    if (nextAnswers.every((answer) => answer.trim())) {
      setDrafts(buildDrafts(sourceTask, nextAnswers))
      setStep(3)
    } else {
      setStep(2)
    }
  }

  const regenerateDrafts = () => {
    setDrafts(buildDrafts(sourceTask, answers))
    setError('')
  }

  const createTasks = async () => {
    const validDrafts = sortedDrafts.filter((draft) => draft.title.trim() && draft.description.trim())
    if (validDrafts.length === 0) {
      setError('Oluşturulacak en az bir taslak gerekli.')
      return
    }
    setBusy(true)
    setError('')
    const response = await invokeBridge<TaskJsonImportResult>(IPC_CHANNELS.tasks.plannerCreateFromJson, {
      actorToken,
      projectId: project.id,
      taskId: sourceTask.id,
      json: draftsToPlannerJson(validDrafts, defaultStatus)
    })
    setBusy(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Tasklar oluşturulamadı.')
      return
    }
    const created = response.data?.tasks ?? (response.data?.task ? [response.data.task] : [])
    onCreated(created)
    onClose()
  }

  const modal = (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Çoklu task planlama" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.headerIcon}><LuSparkles size={18} /></span>
          <div className={styles.headerText}>
            <span>Çoklu Task Planlama</span>
            <h2>{sourceTask.title}</h2>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Kapat" title="Kapat"><LuX size={16} /></button>
        </header>

        <div className={styles.stepper} aria-label="Planlama adımları">
          {[
            { value: 1, label: 'Bağlam' },
            { value: 2, label: 'Sorular' },
            { value: 3, label: 'Taslaklar' }
          ].map((item) => (
            <button key={item.value} type="button" className={step === item.value ? styles.stepActive : styles.step} onClick={() => setStep(item.value as PlannerStep)}>
              <b>{item.value}</b>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {step === 1 ? (
          <main className={styles.contextStep}>
            <div className={styles.contextSummary}>
              <span>Kaynak task korunacak</span>
              <h3>{sourceTask.title}</h3>
              <p>{sourceTask.description || 'Açıklama yok.'}</p>
            </div>
            <div className={styles.pmPrompt}>
              <LuListChecks size={18} />
              <p>Akış, geniş taskı bağımsız ve doğrulanabilir tasklara bölmek için senior product manager gibi kapsam, teslimat ve kabul sinyali soruları sorar.</p>
            </div>
          </main>
        ) : null}

        {step === 2 ? (
          <main className={styles.chatStep}>
            <div className={styles.messages}>
              {QUESTIONS.map((question, index) => (
                <div key={question} className={styles.messageGroup}>
                  <div className={styles.aiMessage}><LuSparkles size={15} /><p>{question}</p></div>
                  {answers[index] ? <div className={styles.userMessage}><p>{answers[index]}</p></div> : null}
                </div>
              ))}
            </div>
            <footer className={styles.composer}>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={QUESTIONS[currentQuestionIndex]} />
              <button type="button" onClick={submitAnswer} disabled={!message.trim()}><LuSend size={15} /> Yanıtla</button>
            </footer>
          </main>
        ) : null}

        {step === 3 ? (
          <main className={styles.previewStep}>
            <div className={styles.previewToolbar}>
              <div>
                <span>{sortedDrafts.length} task taslağı</span>
                <p>Başlık, açıklama ve sıra alanlarını düzenleyip tek aksiyonla oluştur.</p>
              </div>
              <div className={styles.previewActions}>
                <button type="button" onClick={regenerateDrafts} disabled={!canContinueToPreview}><LuRefreshCw size={15} /> Yeniden üret</button>
                <button type="button" onClick={addDraft}><LuPlus size={15} /> Taslak</button>
              </div>
            </div>
            <div className={styles.draftList}>
              {sortedDrafts.map((draft) => (
                <article key={draft.id} className={styles.draftItem}>
                  <div className={styles.draftOrder}><LuGripVertical size={15} /><input type="number" min={1} value={draft.order} onChange={(event) => updateDraft(draft.id, { order: Number(event.target.value) || 1 })} /></div>
                  <div className={styles.draftFields}>
                    <input value={draft.title} onChange={(event) => updateDraft(draft.id, { title: event.target.value })} placeholder="Task başlığı" />
                    <textarea value={draft.description} onChange={(event) => updateDraft(draft.id, { description: event.target.value })} placeholder="Task açıklaması" />
                  </div>
                  <button type="button" className={styles.removeButton} onClick={() => removeDraft(draft.id)} aria-label="Taslağı sil" title="Sil"><LuX size={15} /></button>
                </article>
              ))}
            </div>
          </main>
        ) : null}

        {error ? <p className={styles.error}>{error}</p> : null}

        <footer className={styles.footer}>
          <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1) as PlannerStep)} disabled={step === 1 || busy}><LuArrowLeft size={15} /> Geri</button>
          {step < 3 ? (
            <button type="button" className={styles.primaryButton} onClick={() => setStep((current) => Math.min(3, current + 1) as PlannerStep)} disabled={step === 2 && !canContinueToPreview}>
              İleri <LuArrowRight size={15} />
            </button>
          ) : (
            <button type="button" className={styles.primaryButton} onClick={() => void createTasks()} disabled={busy || sortedDrafts.length === 0}>
              <LuCheck size={15} /> {busy ? 'Oluşturuluyor' : 'Taskları oluştur'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )

  return target ? createPortal(modal, target) : modal
}
