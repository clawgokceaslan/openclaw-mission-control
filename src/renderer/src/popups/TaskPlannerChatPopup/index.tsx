import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  LuArrowLeft,
  LuArrowRight,
  LuBrainCircuit,
  LuCheck,
  LuClipboardCheck,
  LuGauge,
  LuGripVertical,
  LuLayers,
  LuListChecks,
  LuMessageSquare,
  LuPlus,
  LuRefreshCw,
  LuSend,
  LuSparkles,
  LuTarget,
  LuWandSparkles,
  LuX
} from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Project, TaskEntity, TaskJsonImportResult } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import styles from './index.module.scss'

type PlannerStep = 1 | 2 | 3 | 4 | 5 | 6 | 7
type PlannerIntent = 'project' | 'product' | 'research' | 'delivery'
type PlannerDepth = 'fast' | 'balanced' | 'deep'

export type TaskPlannerDraft = {
  id: string
  order: number
  phase: string
  title: string
  description: string
  confidence: number
  rationale: string
  risk: string
}

type PlannerForm = {
  intent: PlannerIntent
  depth: PlannerDepth
  outcome: string
  problem: string
  audience: string
  successSignals: string
  constraints: string
  exclusions: string
  pmNotes: string
}

type IntelligenceReport = {
  score: number
  missing: string[]
  strengths: string[]
  risks: string[]
  nextBestAction: string
  suggestedTaskCount: number
}

interface TaskPlannerChatPopupProps {
  open: boolean
  actorToken: string | null
  project: Project
  sourceTask?: TaskEntity | null
  defaultStatus?: string
  onClose: () => void
  onCreated: (tasks: TaskEntity[]) => void
}

const STEPS: Array<{ value: PlannerStep; label: string; hint: string }> = [
  { value: 1, label: 'Niyet', hint: 'Akışı seç' },
  { value: 2, label: 'Ürün', hint: 'Problemi yaz' },
  { value: 3, label: 'Başarı', hint: 'Kabul sinyali' },
  { value: 4, label: 'Sınırlar', hint: 'Kapsamı daralt' },
  { value: 5, label: 'PM Tur', hint: 'Soruları yanıtla' },
  { value: 6, label: 'Sentez', hint: 'AI tamamlar' },
  { value: 7, label: 'Taslak', hint: 'Düzenle ve aç' }
]

const INTENT_OPTIONS: Array<{ value: PlannerIntent; title: string; description: string }> = [
  { value: 'product', title: 'Product manager akışı', description: 'Problem, kullanıcı, başarı ve bağımsız delivery taskları çıkar.' },
  { value: 'project', title: 'Project breakdown', description: 'Geniş işi milestone ve paralel iş paketlerine ayır.' },
  { value: 'delivery', title: 'Engineering delivery', description: 'Uygulama, entegrasyon, test ve release sırasını netleştir.' },
  { value: 'research', title: 'Discovery / araştırma', description: 'Bilinmeyenleri soru, karar ve doğrulama tasklarına böl.' }
]

const DEPTH_OPTIONS: Array<{ value: PlannerDepth; title: string; count: string }> = [
  { value: 'fast', title: 'Hızlı', count: '3-4 task' },
  { value: 'balanced', title: 'Dengeli', count: '5-6 task' },
  { value: 'deep', title: 'Derin', count: '6-8 task' }
]

const FIELD_LABELS: Record<keyof Pick<PlannerForm, 'outcome' | 'problem' | 'audience' | 'successSignals' | 'constraints' | 'exclusions' | 'pmNotes'>, string> = {
  outcome: 'İstenen sonuç',
  problem: 'Problem / fırsat',
  audience: 'Kullanıcı / paydaş',
  successSignals: 'Başarı sinyalleri',
  constraints: 'Kısıtlar',
  exclusions: 'Kapsam dışı',
  pmNotes: 'PM notları'
}

function createDraftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `draft-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function compactText(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function initialPlannerForm(project: Project, sourceTask?: TaskEntity | null): PlannerForm {
  return {
    intent: 'product',
    depth: 'balanced',
    outcome: sourceTask?.title ?? '',
    problem: sourceTask?.description ?? project.description ?? '',
    audience: '',
    successSignals: '',
    constraints: '',
    exclusions: '',
    pmNotes: ''
  }
}

function splitInput(value: string): string[] {
  return value
    .split(/\r?\n|[;•]/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
}

function sentences(value: string): string[] {
  const byLine = splitInput(value)
  if (byLine.length > 1) return byLine
  return value
    .split(/[.!?]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 10)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function uniqueItems(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function taskCountForDepth(depth: PlannerDepth, signalCount: number) {
  const base = depth === 'fast' ? 4 : depth === 'deep' ? 7 : 6
  return clamp(Math.max(base, signalCount + 2), depth === 'fast' ? 3 : 5, depth === 'deep' ? 8 : 6)
}

function defaultAudience(project: Project, form: PlannerForm) {
  const text = `${project.name} ${form.outcome} ${form.problem}`.toLowerCase()
  if (text.includes('cli') || text.includes('developer') || text.includes('api')) return 'Geliştiriciler, operasyon kullanıcıları ve ürünü yöneten ekip'
  if (text.includes('popup') || text.includes('modal') || text.includes('task')) return 'Task planlayan ürün ekipleri, project managerlar ve execution agent kullanan ekip üyeleri'
  return 'Ürünü kullanan ana kullanıcı grubu ve karar veren proje paydaşları'
}

function smartDefaults(project: Project, form: PlannerForm, sourceTask?: TaskEntity | null): Partial<PlannerForm> {
  const subject = compactText(sourceTask?.title || form.outcome || project.name)
  return {
    outcome: form.outcome.trim() || `${subject} için uygulanabilir, önceliklendirilmiş ve doğrulanabilir task seti oluşturmak`,
    problem: form.problem.trim() || compactText(sourceTask?.description || project.description) || `${subject} kapsamı fazla geniş; bağımsız iş parçaları, karar noktaları ve kabul sinyalleri net değil.`,
    audience: form.audience.trim() || defaultAudience(project, form),
    successSignals: form.successSignals.trim() || [
      'Kullanıcı tek akışta ne istediğini tarif edebiliyor',
      'AI eksik bağlamı önerilerle tamamlıyor',
      'Taslak tasklar düzenlenip tek aksiyonla oluşturuluyor'
    ].join('\n'),
    constraints: form.constraints.trim() || [
      'Süreç 6-7 basamakta kalmalı',
      'Popup geniş kalmalı ama boş alanlar anlamlı panellerle dolmalı',
      'Tasklar aynı projede bağımsız kayıtlar olarak açılmalı'
    ].join('\n'),
    exclusions: form.exclusions.trim() || 'Kaynak taskı otomatik kapatma, kullanıcı onayı olmadan direkt task oluşturma, task detail modalına bağımlı chat state taşıma',
    pmNotes: form.pmNotes.trim() || 'Senior product manager gibi önce niyeti daralt, sonra delivery tasklarını bağımsız, sıralı ve kabul sinyali olan parçalara böl.'
  }
}

function analyzePlan(form: PlannerForm, answers: string[], draftCount: number): IntelligenceReport {
  const missing: string[] = []
  const strengths: string[] = []
  const risks: string[] = []
  const filled = {
    outcome: form.outcome.trim().length > 16,
    problem: form.problem.trim().length > 24,
    audience: form.audience.trim().length > 8,
    successSignals: splitInput(form.successSignals).length > 0 || form.successSignals.trim().length > 18,
    constraints: form.constraints.trim().length > 8,
    exclusions: form.exclusions.trim().length > 8,
    pmNotes: form.pmNotes.trim().length > 12
  }

  Object.entries(filled).forEach(([key, ready]) => {
    if (!ready) missing.push(FIELD_LABELS[key as keyof typeof FIELD_LABELS])
  })
  if (filled.outcome && filled.problem) strengths.push('Problem ve hedef aynı akışta okunuyor.')
  if (filled.successSignals) strengths.push('Kabul sinyali task açıklamalarına taşınabilir.')
  if (filled.constraints && filled.exclusions) strengths.push('Kapsam sınırı gereksiz task üretimini azaltır.')
  if (answers.filter((answer) => answer.trim()).length >= 2) strengths.push('PM soru turu taslak sırasını besliyor.')
  if (!filled.audience) risks.push('Kullanıcı grubu belirsizse tasklar teknik yapılacak işe kayabilir.')
  if (!filled.successSignals) risks.push('Başarı sinyali yoksa oluşturulan tasklar doğrulanabilir olmaz.')
  if (draftCount > 0 && draftCount < 3) risks.push('Taslak sayısı geniş bir kapsam için düşük kalabilir.')

  const score = clamp(
    Object.values(filled).filter(Boolean).length * 12 +
      answers.filter((answer) => answer.trim()).length * 5 +
      Math.min(draftCount, 6) * 3,
    8,
    100
  )

  return {
    score,
    missing,
    strengths,
    risks,
    nextBestAction: missing.length > 0 ? `${missing[0]} alanını doldur veya AI ile tamamlat.` : draftCount === 0 ? 'Sentez adımında taslakları üret.' : 'Taslakları sırala ve oluştur.',
    suggestedTaskCount: taskCountForDepth(form.depth, splitInput(form.successSignals).length)
  }
}

function buildDynamicQuestions(form: PlannerForm, report: IntelligenceReport) {
  const questions = [
    'Bu işin sonunda kullanıcı veya ekip hangi somut davranışı yapabilir hale gelmeli?',
    'Bu akışta hangi bağımsız tasklar paralel ilerleyebilir, hangileri sıraya bağlı?',
    'Riskli varsayım hangisi ve bunu doğrulayan kabul sinyali ne olmalı?'
  ]
  if (!form.audience.trim()) questions.unshift('Bu işten en çok etkilenen kullanıcı, rol veya paydaş kim?')
  if (!form.exclusions.trim()) questions.push('Bu planın dışında özellikle bırakmam gereken şeyler var mı?')
  if (report.score > 72) questions.push('Taslakları üretirken daha agresif mi parçalayayım, yoksa daha az ve büyük task mı bırakalım?')
  return uniqueItems(questions).slice(0, 5)
}

function titleFromText(value: string, fallback: string) {
  const cleaned = value.replace(/[:#]/g, '').trim()
  if (!cleaned) return fallback
  return cleaned.length > 82 ? `${cleaned.slice(0, 79).trim()}...` : cleaned
}

function phaseTemplates(intent: PlannerIntent) {
  if (intent === 'research') return ['Discovery', 'Varsayım', 'Karar', 'Doğrulama', 'Raporlama', 'Handoff']
  if (intent === 'delivery') return ['Analiz', 'Mimari', 'Uygulama', 'Entegrasyon', 'Kalite', 'Release']
  if (intent === 'project') return ['Kapsam', 'Milestone', 'Bağımlılık', 'Uygulama', 'Koordinasyon', 'Kabul']
  return ['Discovery', 'Kapsam', 'Deneyim', 'Uygulama', 'Ölçüm', 'Kabul']
}

function candidateTaskTitles(form: PlannerForm, answers: string[], project: Project) {
  const explicit = uniqueItems([
    ...sentences(form.pmNotes),
    ...answers.flatMap((answer) => sentences(answer))
  ]).filter((item) => item.length > 12 && item.length < 120)

  if (explicit.length >= 3) return explicit.slice(0, 8)

  const subject = titleFromText(form.outcome || form.problem || project.name, project.name)
  if (form.intent === 'research') {
    return [
      `${subject} için bilinmeyenleri sınıflandır`,
      `${subject} kullanıcı varsayımlarını doğrula`,
      `${subject} karar matrisini hazırla`,
      `${subject} için uygulanabilir task setini netleştir`
    ]
  }
  if (form.intent === 'delivery') {
    return [
      `${subject} teknik sınırlarını çıkar`,
      `${subject} ana uygulama akışını kur`,
      `${subject} entegrasyon ve hata durumlarını bağla`,
      `${subject} kabul senaryolarını doğrula`
    ]
  }
  return [
    `${subject} problemini ve hedef kullanıcısını netleştir`,
    `${subject} kapsamını bağımsız iş paketlerine böl`,
    `${subject} deneyim akışını standartlaştır`,
    `${subject} state ve veri sözleşmesini sağlamlaştır`,
    `${subject} kabul sinyallerini ve edge case listesini doğrula`
  ]
}

function buildDraftDescription(project: Project, form: PlannerForm, title: string, phase: string, order: number, report: IntelligenceReport, sourceTask?: TaskEntity | null) {
  const successSignals = splitInput(form.successSignals)
  const constraints = splitInput(form.constraints)
  const exclusions = splitInput(form.exclusions)
  const risk = report.risks[0] ?? 'Kapsam genişlerse task bağımsızlığı zayıflayabilir.'
  return [
    '## Amaç',
    `${title}. Bu task ${project.name} projesi içinde ${phase.toLowerCase()} basamağını bağımsız ve doğrulanabilir hale getirmeli.`,
    '',
    '## Bağlam',
    form.problem.trim() || form.outcome.trim(),
    sourceTask ? `Kaynak bağlam: ${sourceTask.title}` : '',
    '',
    '## Kullanıcı / Paydaş',
    form.audience.trim(),
    '',
    '## Beklenen İş',
    `1. ${phase} kapsamını daralt.`,
    `2. ${order}. sıradaki teslimatı net bir kullanıcı veya sistem davranışına bağla.`,
    '3. Çıktıyı bir sonraki taskı bloke etmeyecek şekilde teslim et.',
    '',
    '## Kabul Sinyali',
    successSignals.length > 0 ? successSignals.map((signal) => `- ${signal}`).join('\n') : '- Beklenen davranış manuel veya otomatik olarak doğrulanabiliyor.',
    '',
    '## Kısıtlar',
    constraints.length > 0 ? constraints.map((constraint) => `- ${constraint}`).join('\n') : '- Mevcut proje kuralları ve tasarım standardı korunur.',
    exclusions.length > 0 ? `\n## Kapsam Dışı\n${exclusions.map((item) => `- ${item}`).join('\n')}` : '',
    '',
    '## PM Notu',
    form.pmNotes.trim() || 'Senior product manager yaklaşımıyla küçük, bağımsız ve kabul edilebilir çıktı üret.',
    '',
    '## Risk',
    risk
  ].filter(Boolean).join('\n')
}

function buildSmartDrafts(project: Project, form: PlannerForm, answers: string[], sourceTask?: TaskEntity | null): TaskPlannerDraft[] {
  const hydratedForm = { ...form, ...smartDefaults(project, form, sourceTask) }
  const report = analyzePlan(hydratedForm, answers, 0)
  const targetCount = report.suggestedTaskCount
  const phases = phaseTemplates(hydratedForm.intent)
  const titles = candidateTaskTitles(hydratedForm, answers, project)
  const filledTitles = Array.from({ length: targetCount }, (_, index) => titleFromText(titles[index] ?? `${phases[index % phases.length]} teslimatını tamamla`, `${phases[index % phases.length]} teslimatını tamamla`))

  return filledTitles.map((title, index) => {
    const phase = phases[index % phases.length]
    const confidence = clamp(report.score - Math.max(0, index - 2) * 4 + (title.length > 22 ? 4 : 0), 42, 96)
    return {
      id: createDraftId(),
      order: index + 1,
      phase,
      title,
      description: buildDraftDescription(project, hydratedForm, title, phase, index + 1, report, sourceTask),
      confidence,
      rationale: `${phase} basamağı ${index === 0 ? 'önce belirsizliği azaltır' : 'önceki çıktının üstüne kurulur'} ve bağımsız task olarak izlenebilir.`,
      risk: report.risks[index % Math.max(report.risks.length, 1)] ?? 'Bağımlılıklar açık yazılmazsa task gereğinden genişleyebilir.'
    }
  })
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
        body: [
          `Bu task çoklu planlama merkezinde ${draft.order}. sırada üretildi.`,
          `Faz: ${draft.phase}.`,
          `Güven: %${draft.confidence}.`,
          `Gerekçe: ${draft.rationale}`
        ].join('\n')
      }]
    }))
}

export function TaskPlannerChatPopup({ open, actorToken, project, sourceTask, defaultStatus, onClose, onCreated }: TaskPlannerChatPopupProps) {
  const [step, setStep] = useState<PlannerStep>(1)
  const [form, setForm] = useState<PlannerForm>(() => initialPlannerForm(project, sourceTask))
  const [answers, setAnswers] = useState<string[]>([])
  const [drafts, setDrafts] = useState<TaskPlannerDraft[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setStep(1)
    setForm(initialPlannerForm(project, sourceTask))
    setAnswers([])
    setDrafts([])
    setMessage('')
    setError('')
  }, [open, project.id, sourceTask?.id])

  const sortedDrafts = useMemo(() => drafts.slice().sort((a, b) => a.order - b.order), [drafts])
  const report = useMemo(() => analyzePlan(form, answers, sortedDrafts.length), [answers, form, sortedDrafts.length])
  const questions = useMemo(() => buildDynamicQuestions(form, report), [form, report])
  const currentQuestionIndex = Math.min(answers.length, questions.length - 1)
  const canCreate = sortedDrafts.some((draft) => draft.title.trim() && draft.description.trim())

  if (!open) return null
  const target = typeof document === 'undefined' ? null : document.body

  const updateForm = <K extends keyof PlannerForm>(key: K, value: PlannerForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const applySmartDefaults = () => {
    setForm((current) => ({ ...current, ...smartDefaults(project, current, sourceTask) }))
    setError('')
  }

  const synthesizeDrafts = (nextStep: PlannerStep = 6, formOverride = form, answersOverride = answers) => {
    const hydratedForm = { ...formOverride, ...smartDefaults(project, formOverride, sourceTask) }
    const hydratedAnswers = answersOverride.length > 0 ? answersOverride : [
      hydratedForm.outcome,
      hydratedForm.successSignals,
      hydratedForm.constraints
    ]
    setForm(hydratedForm)
    setAnswers(hydratedAnswers.filter(Boolean))
    setDrafts(buildSmartDrafts(project, hydratedForm, hydratedAnswers, sourceTask))
    setStep(nextStep)
    setError('')
  }

  const submitAnswer = () => {
    const normalized = message.trim()
    if (!normalized) return
    const nextAnswers = [...answers.slice(0, questions.length - 1), normalized].slice(0, questions.length)
    setAnswers(nextAnswers)
    setMessage('')
    setError('')
    if (nextAnswers.length >= Math.min(3, questions.length)) {
      synthesizeDrafts(6, form, nextAnswers)
    }
  }

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
      phase: 'Ek',
      title: '',
      description: `## Amaç\n\n## Bağlam\n${project.name}\n\n## Kabul Sinyali\n- `,
      confidence: 58,
      rationale: 'Kullanıcı tarafından manuel eklenen taslak.',
      risk: 'Manuel taslakta kabul sinyali eksik kalabilir.'
    }])
    setStep(7)
  }

  const goNext = () => {
    if (step === 5 && sortedDrafts.length === 0) {
      synthesizeDrafts(6)
      return
    }
    if (step === 6 && sortedDrafts.length === 0) {
      synthesizeDrafts(7)
      return
    }
    setStep((current) => Math.min(7, current + 1) as PlannerStep)
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
      ...(sourceTask?.id ? { taskId: sourceTask.id } : {}),
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

  const renderTextArea = (key: keyof Pick<PlannerForm, 'outcome' | 'problem' | 'audience' | 'successSignals' | 'constraints' | 'exclusions' | 'pmNotes'>, label: string, placeholder: string, rows = 4) => (
    <label className={styles.field}>
      <span>{label}</span>
      <textarea rows={rows} value={form[key]} onChange={(event) => updateForm(key, event.target.value)} placeholder={placeholder} />
    </label>
  )

  const modal = (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Task oluşturma merkezi" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.headerIcon}><LuBrainCircuit size={20} /></span>
          <div className={styles.headerText}>
            <span>{sourceTask ? 'Çoklu Task Planlama' : 'Task Oluşturma Merkezi'}</span>
            <h2>{sourceTask?.title || project.name}</h2>
          </div>
          <div className={styles.headerMetrics}>
            <span><LuGauge size={14} /> %{report.score}</span>
            <span><LuLayers size={14} /> {report.suggestedTaskCount} öneri</span>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Kapat" title="Kapat"><LuX size={16} /></button>
        </header>

        <nav className={styles.stepper} aria-label="Planlama adımları">
          {STEPS.map((item) => (
            <button key={item.value} type="button" className={step === item.value ? styles.stepActive : styles.step} onClick={() => setStep(item.value)}>
              <b>{item.value}</b>
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>

        <main className={styles.workspace}>
          <section className={styles.stage}>
            {step === 1 ? (
              <div className={styles.intentStep}>
                <div className={styles.stageHero}>
                  <span><LuSparkles size={15} /> Standart akış</span>
                  <h3>Bu popup artık task yazma ekranı değil, yönlendiren bir planlama merkezi.</h3>
                  <p>Az bilgiyle başlayabilir, eksikleri AI katmanına doldurtabilir ve son adımda tüm taslakları düzenleyebilirsin.</p>
                </div>
                <div className={styles.intentGrid}>
                  {INTENT_OPTIONS.map((option) => (
                    <button key={option.value} type="button" className={form.intent === option.value ? styles.optionActive : styles.option} onClick={() => updateForm('intent', option.value)}>
                      <strong>{option.title}</strong>
                      <span>{option.description}</span>
                    </button>
                  ))}
                </div>
                <div className={styles.depthRow}>
                  {DEPTH_OPTIONS.map((option) => (
                    <button key={option.value} type="button" className={form.depth === option.value ? styles.depthActive : styles.depth} onClick={() => updateForm('depth', option.value)}>
                      <strong>{option.title}</strong>
                      <span>{option.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className={styles.formStep}>
                {renderTextArea('outcome', 'İstenen sonuç', 'Örn: Project ve product manager isteklerini yönlendiren çoklu task oluşturma merkezi', 3)}
                {renderTextArea('problem', 'Problem / fırsat', 'Kullanıcı neyi başarmaya çalışıyor, bugün neden zor, hangi kararlar belirsiz?', 6)}
              </div>
            ) : null}

            {step === 3 ? (
              <div className={styles.formStep}>
                {renderTextArea('audience', 'Kullanıcı / paydaş', 'Örn: project manager, product manager, execution agent kullanan ekip üyeleri', 3)}
                {renderTextArea('successSignals', 'Başarı sinyalleri', 'Her satıra bir kabul sinyali yaz. AI bunları task açıklamalarına dağıtacak.', 6)}
              </div>
            ) : null}

            {step === 4 ? (
              <div className={styles.formStep}>
                {renderTextArea('constraints', 'Kısıtlar', 'Tasarım, state, süre, teknik veya ürün kısıtlarını yaz.', 5)}
                {renderTextArea('exclusions', 'Kapsam dışı', 'Bu planın özellikle yapmaması gereken şeyleri yaz.', 4)}
                {renderTextArea('pmNotes', 'PM notları', 'Tasklar nasıl bölünsün, hangi sıra/öncelik mantığı kullanılsın?', 4)}
              </div>
            ) : null}

            {step === 5 ? (
              <div className={styles.chatStep}>
                <div className={styles.messages}>
                  {questions.map((question, index) => (
                    <div key={question} className={styles.messageGroup}>
                      <div className={styles.aiMessage}><LuMessageSquare size={15} /><p>{question}</p></div>
                      {answers[index] ? <div className={styles.userMessage}><p>{answers[index]}</p></div> : null}
                    </div>
                  ))}
                </div>
                <footer className={styles.composer}>
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={questions[currentQuestionIndex] ?? 'Ek PM notu yaz'} />
                  <button type="button" onClick={submitAnswer} disabled={!message.trim()}><LuSend size={15} /> Yanıtla</button>
                </footer>
              </div>
            ) : null}

            {step === 6 ? (
              <div className={styles.synthesisStep}>
                <div className={styles.synthesisHero}>
                  <span><LuWandSparkles size={16} /> AI sentez katmanı</span>
                  <h3>Eksikler tamamlandı, taslak mimarisi üretildi.</h3>
                  <p>Bu adım kullanıcıyı bekletmeden kararları görünür yapar: kaç task, hangi faz, hangi risk ve hangi kabul sinyaliyle ilerleyeceğini burada netleştirir.</p>
                </div>
                <div className={styles.synthesisGrid}>
                  <div>
                    <strong>Önerilen sıra</strong>
                    <span>{sortedDrafts.length || report.suggestedTaskCount} task, {form.depth} derinlik</span>
                  </div>
                  <div>
                    <strong>Kalite skoru</strong>
                    <span>%{report.score} hazır</span>
                  </div>
                  <div>
                    <strong>Sonraki aksiyon</strong>
                    <span>{report.nextBestAction}</span>
                  </div>
                </div>
                <button type="button" className={styles.fullButton} onClick={() => synthesizeDrafts(7)}><LuRefreshCw size={15} /> Taslakları yeniden sentezle ve önizle</button>
              </div>
            ) : null}

            {step === 7 ? (
              <div className={styles.previewStep}>
                <div className={styles.previewToolbar}>
                  <div>
                    <span>{sortedDrafts.length} task taslağı</span>
                    <p>Başlık, açıklama, sıra, faz ve risk alanlarını düzenleyip tek aksiyonla oluştur.</p>
                  </div>
                  <div className={styles.previewActions}>
                    <button type="button" onClick={() => synthesizeDrafts(7)}><LuRefreshCw size={15} /> Yeniden üret</button>
                    <button type="button" onClick={addDraft}><LuPlus size={15} /> Taslak</button>
                  </div>
                </div>
                <div className={styles.draftList}>
                  {sortedDrafts.map((draft) => (
                    <article key={draft.id} className={styles.draftItem}>
                      <div className={styles.draftOrder}>
                        <LuGripVertical size={15} />
                        <input type="number" min={1} value={draft.order} onChange={(event) => updateDraft(draft.id, { order: Number(event.target.value) || 1 })} aria-label="Sıra" />
                        <span>%{draft.confidence}</span>
                      </div>
                      <div className={styles.draftFields}>
                        <div className={styles.inlineFields}>
                          <input value={draft.phase} onChange={(event) => updateDraft(draft.id, { phase: event.target.value })} placeholder="Faz" />
                          <input value={draft.title} onChange={(event) => updateDraft(draft.id, { title: event.target.value })} placeholder="Task başlığı" />
                        </div>
                        <textarea value={draft.description} onChange={(event) => updateDraft(draft.id, { description: event.target.value })} placeholder="Task açıklaması" />
                        <div className={styles.draftMeta}>
                          <input value={draft.rationale} onChange={(event) => updateDraft(draft.id, { rationale: event.target.value })} placeholder="Gerekçe" />
                          <input value={draft.risk} onChange={(event) => updateDraft(draft.id, { risk: event.target.value })} placeholder="Risk" />
                        </div>
                      </div>
                      <button type="button" className={styles.removeButton} onClick={() => removeDraft(draft.id)} aria-label="Taslağı sil" title="Sil"><LuX size={15} /></button>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <aside className={styles.sidePanel}>
            <div className={styles.scorePanel}>
              <span>Plan skoru</span>
              <strong>%{report.score}</strong>
              <div className={styles.scoreTrack}><i style={{ width: `${report.score}%` }} /></div>
            </div>
            <div className={styles.assistPanel}>
              <h4><LuBrainCircuit size={15} /> Akıl katmanı</h4>
              <p>{report.nextBestAction}</p>
              <button type="button" onClick={applySmartDefaults}><LuWandSparkles size={15} /> Boşlukları doldur</button>
              <button type="button" onClick={() => synthesizeDrafts(7)}><LuClipboardCheck size={15} /> Direkt taslak üret</button>
            </div>
            <div className={styles.signalPanel}>
              <h4><LuTarget size={15} /> Güçlü sinyaller</h4>
              {(report.strengths.length > 0 ? report.strengths : ['Henüz sinyal yok; birkaç alan doldurunca burada kalite gerekçeleri görünür.']).map((item) => <p key={item}>{item}</p>)}
            </div>
            <div className={styles.signalPanel}>
              <h4><LuListChecks size={15} /> Eksikler / riskler</h4>
              {([ ...report.missing.map((item) => `${item} eksik`), ...report.risks ].slice(0, 5).length > 0
                ? [ ...report.missing.map((item) => `${item} eksik`), ...report.risks ].slice(0, 5)
                : ['Kritik risk görünmüyor; taslak önizlemede son kontrol yeterli.']).map((item) => <p key={item}>{item}</p>)}
            </div>
          </aside>
        </main>

        {error ? <p className={styles.error}>{error}</p> : null}

        <footer className={styles.footer}>
          <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1) as PlannerStep)} disabled={step === 1 || busy}><LuArrowLeft size={15} /> Geri</button>
          <div className={styles.footerCenter}>
            <span>{sourceTask ? 'Kaynak task korunur; yeni tasklar ayrı oluşturulur.' : 'Yeni tasklar proje merkezinde ayrı kayıtlar olarak açılır.'}</span>
          </div>
          {step < 7 ? (
            <button type="button" className={styles.primaryButton} onClick={goNext} disabled={busy}>
              İleri <LuArrowRight size={15} />
            </button>
          ) : (
            <button type="button" className={styles.primaryButton} onClick={() => void createTasks()} disabled={busy || !canCreate}>
              <LuCheck size={15} /> {busy ? 'Oluşturuluyor' : 'Taskları oluştur'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )

  return target ? createPortal(modal, target) : modal
}
