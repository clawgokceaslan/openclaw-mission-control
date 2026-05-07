import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  LuArrowLeft,
  LuArrowRight,
  LuBrainCircuit,
  LuBookOpen,
  LuCheck,
  LuClipboardCheck,
  LuCompass,
  LuFlag,
  LuFlaskConical,
  LuGitBranch,
  LuGauge,
  LuGripVertical,
  LuLayers,
  LuLightbulb,
  LuListChecks,
  LuMap,
  LuMessageSquare,
  LuPlus,
  LuRefreshCw,
  LuRocket,
  LuRoute,
  LuSave,
  LuScale,
  LuSend,
  LuShieldAlert,
  LuSparkles,
  LuTarget,
  LuUsers,
  LuWandSparkles,
  LuX
} from 'react-icons/lu'
import { IPC_CHANNELS, type TaskPlannerAiFillResult } from '@shared/contracts/ipc'
import { GATEWAY_REASONING_EFFORT_OPTIONS, gatewayModelReasoningEfforts, normalizeGatewayReasoningEffort } from '@shared/utils/gateway-language'
import type { CodexCliModel, Gateway, Project, TaskEntity, TaskJsonImportResult } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import styles from './index.module.scss'

type PlannerStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
type PlannerIntent = 'project' | 'product' | 'research' | 'delivery'
type PlannerDepth = 'fast' | 'balanced' | 'deep'
type PlannerTextKey = Exclude<keyof PlannerForm, 'intent' | 'depth'>
type PlannerAiMode = 'step' | 'all' | 'drafts'

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
  northStar: string
  problem: string
  audience: string
  jobToBeDone: string
  evidence: string
  opportunity: string
  hypotheses: string
  successSignals: string
  moscow: string
  prioritization: string
  storyMap: string
  deliveryPlan: string
  metrics: string
  risks: string
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
  gateways?: Gateway[]
  sourceTask?: TaskEntity | null
  defaultStatus?: string
  onClose: () => void
  onCreated: (tasks: TaskEntity[]) => void
}

const STEPS: Array<{ value: PlannerStep; label: string; hint: string; method: string }> = [
  { value: 1, label: 'Strateji', hint: 'Akış modu', method: 'Outcome over output' },
  { value: 2, label: 'North Star', hint: 'Sonuç metriği', method: 'North Star Metric' },
  { value: 3, label: 'Kullanıcı', hint: 'JTBD', method: 'Jobs To Be Done' },
  { value: 4, label: 'Fırsat', hint: 'Discovery', method: 'Opportunity Solution Tree' },
  { value: 5, label: 'Varsayım', hint: 'Hipotez', method: 'Lean Startup' },
  { value: 6, label: 'Kapsam', hint: 'MoSCoW', method: 'MoSCoW' },
  { value: 7, label: 'Öncelik', hint: 'RICE/Kano', method: 'RICE + Kano' },
  { value: 8, label: 'Deneyim', hint: 'Story map', method: 'User Story Mapping' },
  { value: 9, label: 'Delivery', hint: 'Sıralama', method: 'Dual-track delivery' },
  { value: 10, label: 'Metrik', hint: 'HEART', method: 'HEART + Guardrail' },
  { value: 11, label: 'Risk', hint: 'PM kritik', method: 'Pre-mortem' },
  { value: 12, label: 'Task Studio', hint: 'Kaydet', method: 'PRD to tasks' }
]

const STEP_PHASES: Array<{ title: string; description: string; steps: PlannerStep[] }> = [
  { title: 'Tanımla', description: 'Outcome, metrik, kullanıcı', steps: [1, 2, 3] },
  { title: 'Keşfet', description: 'Kanıt, fırsat, varsayım', steps: [4, 5] },
  { title: 'Şekillendir', description: 'Kapsam, öncelik, deneyim', steps: [6, 7, 8] },
  { title: 'Teslim Et', description: 'Delivery, ölçüm, risk, task', steps: [9, 10, 11, 12] }
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

const FIELD_LABELS: Record<PlannerTextKey, string> = {
  outcome: 'İstenen sonuç',
  northStar: 'North Star',
  problem: 'Problem / fırsat',
  audience: 'Kullanıcı / paydaş',
  jobToBeDone: 'JTBD',
  evidence: 'Kanıt',
  opportunity: 'Fırsat ağacı',
  hypotheses: 'Hipotezler',
  successSignals: 'Başarı sinyalleri',
  moscow: 'MoSCoW',
  prioritization: 'Öncelik',
  storyMap: 'Story map',
  deliveryPlan: 'Delivery plan',
  metrics: 'Metrikler',
  risks: 'Riskler',
  constraints: 'Kısıtlar',
  exclusions: 'Kapsam dışı',
  pmNotes: 'PM notları'
}

const ALL_TEXT_FIELDS = Object.keys(FIELD_LABELS) as PlannerTextKey[]

const STEP_FIELDS: Record<PlannerStep, PlannerTextKey[]> = {
  1: ['outcome', 'pmNotes'],
  2: ['outcome', 'northStar', 'successSignals'],
  3: ['audience', 'jobToBeDone', 'problem'],
  4: ['evidence', 'opportunity', 'problem'],
  5: ['hypotheses', 'risks'],
  6: ['moscow', 'constraints', 'exclusions'],
  7: ['prioritization', 'successSignals'],
  8: ['storyMap', 'audience'],
  9: ['deliveryPlan', 'constraints'],
  10: ['metrics', 'successSignals'],
  11: ['risks', 'pmNotes'],
  12: ['pmNotes']
}

const FRAMEWORK_CATALOG = [
  'Marty Cagan: empowered teams, outcome over output',
  'Teresa Torres: Opportunity Solution Tree ve continuous discovery',
  'Jobs To Be Done: kullanıcı işini ve progress motivasyonunu netleştirme',
  'RICE: reach, impact, confidence, effort ile öncelik',
  'Kano: basic, performance, delight ayrımı',
  'MoSCoW: must, should, could, won’t kapsam disiplini',
  'User Story Mapping: backbone, slices, release cut',
  'Lean Startup: riski hipoteze çevirip doğrulama',
  'HEART: happiness, engagement, adoption, retention, task success',
  'Pre-mortem: başarısızlığı önceden tasarlayıp risk kapatma',
  'DHM: delight, hard-to-copy advantage, margin',
  'PRD: problem, solution, scope, acceptance, rollout'
]

const STEP_COACH: Record<PlannerStep, { title: string; principle: string; output: string }> = {
  1: { title: 'Strateji koçu', principle: 'Önce outcome, sonra output. Ekip ne üreteceğini değil hangi davranışı değiştireceğini netleştirir.', output: 'Intent, derinlik ve PM çalışma prensibi' },
  2: { title: 'North Star koçu', principle: 'Tek kuzey metriği ve 2-3 proxy sinyal belirle; tasklar bu sinyale bağlanmalı.', output: 'Outcome, North Star ve kabul sinyali' },
  3: { title: 'Kullanıcı koçu', principle: 'JTBD ile rol değil ilerleme ihtiyacını yaz; task açıklaması kullanıcının işinden kopmasın.', output: 'Kullanıcı, paydaş ve JTBD cümlesi' },
  4: { title: 'Discovery koçu', principle: 'Fırsat ağacı problemden çözüme atlamayı engeller; kanıtı ve fırsatı ayır.', output: 'Kanıt listesi ve fırsat alanları' },
  5: { title: 'Hipotez koçu', principle: 'Büyük kararları test edilebilir varsayımlara böl; belirsizlik taska dönüşür.', output: 'Hipotez ve deney riski' },
  6: { title: 'Scope koçu', principle: 'MoSCoW ve kapsam dışı yoksa plan büyür; won’t-have alanı en az must-have kadar değerlidir.', output: 'Must/Should/Could/Won’t ve kısıtlar' },
  7: { title: 'Öncelik koçu', principle: 'RICE, Kano ve value/effort aynı kararı farklı açılardan doğrular; sıra savunulabilir olmalı.', output: 'Öncelik mantığı ve task sayısı' },
  8: { title: 'Deneyim koçu', principle: 'Story mapping kullanıcı akışını delivery diline çevirir; backbone ve release slice yaz.', output: 'Backbone, slice ve kritik edge case' },
  9: { title: 'Delivery koçu', principle: 'Dual-track yaklaşımda discovery ve delivery beraber akar; bağımlılıkları task sınırına yaz.', output: 'Sıralama, bağımlılık ve handoff planı' },
  10: { title: 'Metrik koçu', principle: 'HEART ve guardrail metrikleri kaliteyi sonuçla dengeler; sadece çıktı sayma.', output: 'Başarı, davranış ve guardrail metrikleri' },
  11: { title: 'Risk koçu', principle: 'Pre-mortem en ucuz kalite kapısıdır; başarısızlık nedenini taska çevir.', output: 'Risk, mitigasyon ve PM kritik soruları' },
  12: { title: 'Task studio', principle: 'PRD’den taska geçerken her task bağımsız, ölçülebilir ve kaynak bağlamına iz bırakır.', output: 'Kaydedilebilir task taslakları' }
}

const STEP_ICONS: Record<PlannerStep, typeof LuSparkles> = {
  1: LuCompass,
  2: LuFlag,
  3: LuUsers,
  4: LuGitBranch,
  5: LuFlaskConical,
  6: LuScale,
  7: LuGauge,
  8: LuMap,
  9: LuRoute,
  10: LuTarget,
  11: LuShieldAlert,
  12: LuRocket
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
    northStar: '',
    problem: sourceTask?.description ?? project.description ?? '',
    audience: '',
    jobToBeDone: '',
    evidence: '',
    opportunity: '',
    hypotheses: '',
    successSignals: '',
    moscow: '',
    prioritization: '',
    storyMap: '',
    deliveryPlan: '',
    metrics: '',
    risks: '',
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

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function projectGatewayValue(project: Project, key: string): string {
  const gateway = recordOf(project.metrics?.gateway)
  const value = gateway[key]
  return typeof value === 'string' ? value : ''
}

function codexModelsOf(gateway?: Gateway | null): CodexCliModel[] {
  const template = recordOf(gateway?.template)
  return Array.isArray(template.models) ? template.models.filter((item): item is CodexCliModel => Boolean(item && typeof item === 'object' && 'id' in item)) : []
}

function highestReasoningEffort(model?: CodexCliModel | null) {
  const available = gatewayModelReasoningEfforts(model)
  const options = available.length > 0 ? available : GATEWAY_REASONING_EFFORT_OPTIONS.map((option) => option.value)
  return (['xhigh', 'high', 'medium', 'low', 'minimal'] as const).find((value) => options.includes(value)) ?? normalizeGatewayReasoningEffort(options[0])
}

function reasoningOptionsForModel(model?: CodexCliModel | null) {
  const available = gatewayModelReasoningEfforts(model)
  const allowed = available.length > 0 ? available : GATEWAY_REASONING_EFFORT_OPTIONS.map((option) => option.value)
  return GATEWAY_REASONING_EFFORT_OPTIONS
    .filter((option) => allowed.includes(option.value))
    .map((option) => ({ value: option.value, label: option.label }))
}

function defaultAudience(project: Project, form: PlannerForm) {
  const text = `${project.name} ${form.outcome} ${form.problem}`.toLowerCase()
  if (text.includes('cli') || text.includes('developer') || text.includes('api')) return 'Geliştiriciler, operasyon kullanıcıları ve ürünü yöneten ekip'
  if (text.includes('popup') || text.includes('modal') || text.includes('task')) return 'Task planlayan ürün ekipleri, project managerlar ve execution agent kullanan ekip üyeleri'
  return 'Ürünü kullanan ana kullanıcı grubu ve karar veren proje paydaşları'
}

function smartDefaults(project: Project, form: PlannerForm, sourceTask?: TaskEntity | null): Partial<PlannerForm> {
  const subject = compactText(sourceTask?.title || form.outcome || project.name)
  const audience = form.audience.trim() || defaultAudience(project, form)
  const sourceContext = compactText(sourceTask?.description || project.description)
  return {
    outcome: form.outcome.trim() || `${subject} için uygulanabilir, önceliklendirilmiş ve doğrulanabilir task seti oluşturmak`,
    northStar: form.northStar.trim() || `${subject} akışında kullanıcı başına doğrulanabilir task oluşturma başarısını artırmak; proxy metrik: ilk oturumda düzenlenip kaydedilen task taslağı sayısı.`,
    problem: form.problem.trim() || compactText(sourceTask?.description || project.description) || `${subject} kapsamı fazla geniş; bağımsız iş parçaları, karar noktaları ve kabul sinyalleri net değil.`,
    audience,
    jobToBeDone: form.jobToBeDone.trim() || `When ${audience.toLowerCase()} geniş ve belirsiz bir işi planlamak zorunda kaldığında, bağımsız ve kabul sinyali olan tasklara güvenle bölmek ister, so execution tarafı beklemeden başlayabilir.`,
    evidence: form.evidence.trim() || [
      sourceContext ? `Kaynak bağlam: ${sourceContext}` : `Proje bağlamı: ${project.name}`,
      'Kullanıcı beklentisi: süreç premium, yönlendirici, geri/ileri yapılabilir ve suggestion destekli olmalı.',
      'Kabul sinyali: tasklar son adımda düzenlenip proje içinde kaydedilebilir olmalı.'
    ].join('\n'),
    opportunity: form.opportunity.trim() || [
      'Ana fırsat: geniş işi ürün probleminden delivery tasklarına çevirmek',
      'Alt fırsat: eksik bağlamı AI önerileriyle tamamlamak',
      'Alt fırsat: kullanıcı onayından önce düzenlenebilir task studio sunmak'
    ].join('\n'),
    hypotheses: form.hypotheses.trim() || [
      'Eğer kullanıcıya adım bazlı PM soruları ve öneriler verilirse daha kaliteli task taslakları üretir.',
      'Eğer RICE, MoSCoW, JTBD ve metrikler aynı akışta görünürse scope creep azalır.',
      'Eğer taslaklar kaydedilmeden önce düzenlenirse kullanıcı kontrol hissini kaybetmez.'
    ].join('\n'),
    successSignals: form.successSignals.trim() || [
      'Kullanıcı tek akışta ne istediğini tarif edebiliyor',
      'AI eksik bağlamı önerilerle tamamlıyor',
      'Taslak tasklar düzenlenip tek aksiyonla oluşturuluyor'
    ].join('\n'),
    moscow: form.moscow.trim() || [
      'Must: 12 adım, geri/ileri navigasyon, AI önerileri, düzenlenebilir task taslakları',
      'Should: risk, metrik, öncelik ve kapsam disiplinini yan panelde görünür tutmak',
      'Could: farklı intent modlarına göre task fazlarını değiştirmek',
      'Won’t: kullanıcı onayı olmadan task oluşturmak veya kaynak taskı otomatik kapatmak'
    ].join('\n'),
    prioritization: form.prioritization.trim() || [
      'RICE: reach yüksek, impact yüksek, confidence orta/yüksek, effort orta',
      'Kano: temel beklenti task kaydı; performans beklentisi hızlı öneri; delight beklentisi premium PM koçluğu',
      'Value/Effort: önce netleştirme ve task studio, sonra gelişmiş otomasyon'
    ].join('\n'),
    storyMap: form.storyMap.trim() || [
      'Backbone: strateji belirle -> kullanıcıyı netleştir -> fırsatı çıkar -> kapsamı sınırla -> taskları kaydet',
      'Release slice 1: bilgi toplama, suggestion, taslak üretme',
      'Release slice 2: düzenleme, sıralama, kaydetme, kaynak task izi'
    ].join('\n'),
    deliveryPlan: form.deliveryPlan.trim() || [
      'Discovery: belirsiz alanları adım bazlı sorularla azalt',
      'Design: ana çalışma alanını sade, yan paneli akıl katmanı olarak kullan',
      'Engineering: form state, autosave, batch JSON ve task create akışını koru',
      'Verification: build, test ve create kabul senaryolarını çalıştır'
    ].join('\n'),
    metrics: form.metrics.trim() || [
      'HEART Happiness: kullanıcı akışı boğucu bulmadan tamamlıyor',
      'Engagement: planlanan task taslağı sayısı',
      'Adoption: planlama merkezinden oluşturulan task oranı',
      'Retention: aynı kaynak task için taslağa geri dönme başarısı',
      'Task Success: geçerli task JSON ile kayıt başarı oranı',
      'Guardrail: fazla adım yüzünden terk oranı artmıyor'
    ].join('\n'),
    risks: form.risks.trim() || [
      'Pre-mortem: 12 adım fazla metinle boğarsa kullanıcı erken çıkar.',
      'Risk: metodoloji listesi task üretimini yavaşlatabilir.',
      'Mitigasyon: her adım tek ana karar, sağ panel suggestion ve otomatik doldurma sunar.'
    ].join('\n'),
    constraints: form.constraints.trim() || [
      'Süreç 12 basamaklı ama her basamak tek karar odağında kalmalı',
      'Popup geniş kalmalı ama boş alanlar anlamlı panellerle dolmalı',
      'Tasklar aynı projede bağımsız kayıtlar olarak açılmalı'
    ].join('\n'),
    exclusions: form.exclusions.trim() || 'Kaynak taskı otomatik kapatma, kullanıcı onayı olmadan direkt task oluşturma, task detail modalına bağımlı chat state taşıma',
    pmNotes: form.pmNotes.trim() || 'Senior product manager gibi outcome’dan başla, kullanıcı işini netleştir, fırsatları kanıtla, MoSCoW ve RICE ile scope’u daralt, story map ve metrikleri task açıklamalarına taşı.'
  }
}

function analyzePlan(form: PlannerForm, answers: string[], draftCount: number): IntelligenceReport {
  const missing: string[] = []
  const strengths: string[] = []
  const risks: string[] = []
  const filled: Record<PlannerTextKey, boolean> = {
    outcome: form.outcome.trim().length > 16,
    northStar: form.northStar.trim().length > 18,
    problem: form.problem.trim().length > 24,
    audience: form.audience.trim().length > 8,
    jobToBeDone: form.jobToBeDone.trim().length > 20,
    evidence: form.evidence.trim().length > 18,
    opportunity: form.opportunity.trim().length > 18,
    hypotheses: splitInput(form.hypotheses).length > 0 || form.hypotheses.trim().length > 18,
    successSignals: splitInput(form.successSignals).length > 0 || form.successSignals.trim().length > 18,
    moscow: form.moscow.trim().length > 18,
    prioritization: form.prioritization.trim().length > 18,
    storyMap: form.storyMap.trim().length > 18,
    deliveryPlan: form.deliveryPlan.trim().length > 18,
    metrics: form.metrics.trim().length > 18,
    risks: form.risks.trim().length > 18,
    constraints: form.constraints.trim().length > 8,
    exclusions: form.exclusions.trim().length > 8,
    pmNotes: form.pmNotes.trim().length > 12
  }

  Object.entries(filled).forEach(([key, ready]) => {
    if (!ready) missing.push(FIELD_LABELS[key as keyof typeof FIELD_LABELS])
  })
  if (filled.outcome && filled.northStar) strengths.push('Outcome ve North Star aynı yöne bakıyor.')
  if (filled.audience && filled.jobToBeDone) strengths.push('Kullanıcı işi task diline taşınabilir.')
  if (filled.evidence && filled.opportunity) strengths.push('Discovery kanıtı ve fırsat ağacı aynı bağlamda.')
  if (filled.successSignals && filled.metrics) strengths.push('Kabul sinyali ve ürün metriği birlikte doğrulanabilir.')
  if (filled.moscow && filled.prioritization) strengths.push('Kapsam ve öncelik metodolojisi gereksiz işi filtreler.')
  if (filled.storyMap && filled.deliveryPlan) strengths.push('Deneyim akışı delivery sırasına çevrilebilir.')
  if (answers.filter((answer) => answer.trim()).length >= 2) strengths.push('PM soru turu taslak sırasını besliyor.')
  if (!filled.audience) risks.push('Kullanıcı grubu belirsizse tasklar teknik yapılacak işe kayabilir.')
  if (!filled.successSignals) risks.push('Başarı sinyali yoksa oluşturulan tasklar doğrulanabilir olmaz.')
  if (!filled.prioritization) risks.push('RICE veya value/effort yoksa task sırası politik olur, ürün değeriyle savunulamaz.')
  if (!filled.metrics) risks.push('Metrik yoksa çıktı üretilebilir ama outcome öğrenmesi eksik kalır.')
  if (form.risks.trim()) risks.push(...splitInput(form.risks).slice(0, 2))
  if (draftCount > 0 && draftCount < 3) risks.push('Taslak sayısı geniş bir kapsam için düşük kalabilir.')

  const readyCount = Object.values(filled).filter(Boolean).length
  const totalCount = Object.keys(filled).length
  const score = clamp(
    Math.round((readyCount / totalCount) * 74) +
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
    nextBestAction: missing.length > 0 ? `${missing[0]} alanını doldur veya AI önerisiyle tamamlat.` : draftCount === 0 ? 'Task Studio adımında taslakları üret.' : 'Taslakları sırala, riskleri kontrol et ve kaydet.',
    suggestedTaskCount: taskCountForDepth(form.depth, splitInput(form.successSignals).length)
  }
}

function buildDynamicQuestions(form: PlannerForm, report: IntelligenceReport) {
  const questions = [
    'Marty Cagan yaklaşımıyla soruyorum: Bu plan hangi outcome’u büyütüyor, sadece hangi çıktıyı üretmiyor?',
    'Teresa Torres Opportunity Solution Tree mantığıyla en güçlü fırsat ve alt fırsatlar hangileri?',
    'RICE’e göre ilk üç taskın reach, impact, confidence ve effort sırası nasıl olmalı?',
    'Pre-mortem yaparsak bu plan neden başarısız olur ve hangi task bu riski kapatır?'
  ]
  if (!form.audience.trim()) questions.unshift('Bu işten en çok etkilenen kullanıcı, rol veya paydaş kim?')
  if (!form.exclusions.trim()) questions.push('Bu planın dışında özellikle bırakmam gereken şeyler var mı?')
  if (!form.metrics.trim()) questions.push('HEART veya North Star için hangi metrik kazanımı başarı sayılır?')
  if (report.score > 72) questions.push('Taslakları üretirken daha agresif mi parçalayayım, yoksa daha az ve büyük task mı bırakalım?')
  return uniqueItems(questions).slice(0, 6)
}

function titleFromText(value: string, fallback: string) {
  const cleaned = value.replace(/[:#]/g, '').trim()
  if (!cleaned) return fallback
  return cleaned.length > 82 ? `${cleaned.slice(0, 79).trim()}...` : cleaned
}

function phaseTemplates(intent: PlannerIntent) {
  if (intent === 'research') return ['Strateji', 'JTBD', 'Discovery', 'Fırsat', 'Varsayım', 'Deney', 'Karar', 'Metrik', 'Risk', 'Handoff']
  if (intent === 'delivery') return ['Strateji', 'Kapsam', 'Mimari', 'State', 'Uygulama', 'Entegrasyon', 'Kalite', 'Metrik', 'Release', 'Handoff']
  if (intent === 'project') return ['Strateji', 'Kapsam', 'Milestone', 'Bağımlılık', 'Uygulama', 'Koordinasyon', 'Risk', 'Kabul', 'Handoff']
  return ['Strateji', 'Kullanıcı', 'Fırsat', 'Hipotez', 'Kapsam', 'Öncelik', 'Deneyim', 'Delivery', 'Metrik', 'Risk', 'Kabul']
}

function candidateTaskTitles(form: PlannerForm, answers: string[], project: Project) {
  const explicit = uniqueItems([
    ...sentences(form.pmNotes),
    ...sentences(form.opportunity),
    ...sentences(form.hypotheses),
    ...sentences(form.prioritization),
    ...sentences(form.storyMap),
    ...sentences(form.deliveryPlan),
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
  const priority = splitInput(form.prioritization)[order - 1] ?? splitInput(form.prioritization)[0] ?? 'RICE ve value/effort dengesiyle önceliklendir.'
  const metric = splitInput(form.metrics)[order - 1] ?? splitInput(form.metrics)[0] ?? 'Task success ve guardrail metrikleriyle doğrula.'
  return [
    '## Amaç',
    `${title}. Bu task ${project.name} projesi içinde ${phase.toLowerCase()} basamağını bağımsız ve doğrulanabilir hale getirmeli.`,
    '',
    '## Product Methodology',
    `- Faz: ${phase}`,
    `- North Star: ${form.northStar.trim() || 'Outcome odaklı ürün kazanımı netleştirilecek.'}`,
    `- Öncelik Mantığı: ${priority}`,
    `- Ölçüm: ${metric}`,
    '',
    '## Bağlam',
    form.problem.trim() || form.outcome.trim(),
    sourceTask ? `Kaynak bağlam: ${sourceTask.title}` : '',
    '',
    '## Kullanıcı / Paydaş',
    form.audience.trim(),
    form.jobToBeDone.trim() ? `\nJTBD: ${form.jobToBeDone.trim()}` : '',
    '',
    '## Fırsat ve Varsayım',
    form.opportunity.trim() || 'Fırsat bu task içinde daraltılacak.',
    form.hypotheses.trim() ? `\nHipotez:\n${form.hypotheses.trim()}` : '',
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
    form.moscow.trim() ? `\n## MoSCoW\n${form.moscow.trim()}` : '',
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

function suggestionForStep(step: PlannerStep, project: Project, form: PlannerForm, sourceTask?: TaskEntity | null): Partial<PlannerForm> {
  const defaults = smartDefaults(project, form, sourceTask)
  const patch: Partial<PlannerForm> = {}
  STEP_FIELDS[step].forEach((key) => {
    patch[key] = defaults[key]
  })
  return patch
}

function safePlannerStep(value: unknown): PlannerStep {
  return clamp(typeof value === 'number' ? value : Number(value), 1, 12) as PlannerStep
}

export function TaskPlannerChatPopup({ open, actorToken, project, gateways = [], sourceTask, defaultStatus, onClose, onCreated }: TaskPlannerChatPopupProps) {
  const [step, setStep] = useState<PlannerStep>(1)
  const [form, setForm] = useState<PlannerForm>(() => initialPlannerForm(project, sourceTask))
  const [answers, setAnswers] = useState<string[]>([])
  const [aiQuestions, setAiQuestions] = useState<string[]>([])
  const [drafts, setDrafts] = useState<TaskPlannerDraft[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [aiIntro, setAiIntro] = useState('')
  const [aiGatewayId, setAiGatewayId] = useState(() => projectGatewayValue(project, 'gatewayId'))
  const [aiModel, setAiModel] = useState(() => projectGatewayValue(project, 'planModel') || projectGatewayValue(project, 'defaultModel') || projectGatewayValue(project, 'runModel'))
  const [aiReasoningEffort, setAiReasoningEffort] = useState('xhigh')
  const draftStorageKey = useMemo(() => `omc-task-planner:${project.id}:${sourceTask?.id ?? 'new'}`, [project.id, sourceTask?.id])
  const selectedAiGateway = useMemo(() => gateways.find((gateway) => gateway.id === aiGatewayId) ?? gateways[0] ?? null, [aiGatewayId, gateways])
  const aiModelOptions = useMemo(() => codexModelsOf(selectedAiGateway), [selectedAiGateway])
  const selectedAiModelRecord = useMemo(() => aiModelOptions.find((model) => model.id === aiModel) ?? null, [aiModel, aiModelOptions])
  const aiReasoningOptions = useMemo(() => reasoningOptionsForModel(selectedAiModelRecord), [selectedAiModelRecord])
  const aiReady = Boolean(actorToken && project.id && selectedAiGateway?.id && aiModel.trim())

  useEffect(() => {
    if (!open) return
    const initialForm = initialPlannerForm(project, sourceTask)
    try {
      const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(draftStorageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as {
          step?: PlannerStep
          form?: Partial<PlannerForm>
          answers?: string[]
          aiQuestions?: string[]
          drafts?: TaskPlannerDraft[]
          aiIntro?: string
          aiGatewayId?: string
          aiModel?: string
          aiReasoningEffort?: string
        }
        setStep(safePlannerStep(parsed.step ?? 1))
        setForm({ ...initialForm, ...(parsed.form ?? {}) })
        setAnswers(Array.isArray(parsed.answers) ? parsed.answers.filter((item) => typeof item === 'string') : [])
        setAiQuestions(Array.isArray(parsed.aiQuestions) ? parsed.aiQuestions.filter((item) => typeof item === 'string') : [])
        setDrafts(Array.isArray(parsed.drafts) ? parsed.drafts : [])
        setAiIntro(typeof parsed.aiIntro === 'string' ? parsed.aiIntro : '')
        setAiGatewayId(typeof parsed.aiGatewayId === 'string' ? parsed.aiGatewayId : projectGatewayValue(project, 'gatewayId'))
        setAiModel(typeof parsed.aiModel === 'string' ? parsed.aiModel : projectGatewayValue(project, 'planModel') || projectGatewayValue(project, 'defaultModel') || projectGatewayValue(project, 'runModel'))
        setAiReasoningEffort(normalizeGatewayReasoningEffort(parsed.aiReasoningEffort || 'xhigh'))
      } else {
        setStep(1)
        setForm(initialForm)
        setAnswers([])
        setAiQuestions([])
        setDrafts([])
        setAiIntro('')
        setAiGatewayId(projectGatewayValue(project, 'gatewayId'))
        setAiModel(projectGatewayValue(project, 'planModel') || projectGatewayValue(project, 'defaultModel') || projectGatewayValue(project, 'runModel'))
        setAiReasoningEffort('xhigh')
      }
    } catch {
      setStep(1)
      setForm(initialForm)
      setAnswers([])
      setAiQuestions([])
      setDrafts([])
      setAiIntro('')
      setAiGatewayId(projectGatewayValue(project, 'gatewayId'))
      setAiModel(projectGatewayValue(project, 'planModel') || projectGatewayValue(project, 'defaultModel') || projectGatewayValue(project, 'runModel'))
      setAiReasoningEffort('xhigh')
    }
    setMessage('')
    setError('')
  }, [draftStorageKey, open, project.id, project.description, sourceTask?.description, sourceTask?.id, sourceTask?.title])

  useEffect(() => {
    if (!open || typeof localStorage === 'undefined') return
    localStorage.setItem(draftStorageKey, JSON.stringify({ step, form, answers, aiQuestions, drafts, aiIntro, aiGatewayId, aiModel, aiReasoningEffort }))
  }, [aiGatewayId, aiIntro, aiModel, aiQuestions, aiReasoningEffort, answers, draftStorageKey, drafts, form, open, step])

  useEffect(() => {
    if (!open || gateways.length === 0) return
    const projectGatewayId = projectGatewayValue(project, 'gatewayId')
    setAiGatewayId((current) => current || projectGatewayId || gateways[0]?.id || '')
  }, [gateways, open, project])

  useEffect(() => {
    if (!open || !selectedAiGateway) return
    const models = codexModelsOf(selectedAiGateway)
    const projectModel = projectGatewayValue(project, 'planModel') || projectGatewayValue(project, 'defaultModel') || projectGatewayValue(project, 'runModel')
    setAiModel((current) => {
      if (current && models.some((model) => model.id === current)) return current
      if (projectModel && models.some((model) => model.id === projectModel)) return projectModel
      return models[0]?.id ?? current
    })
  }, [open, project, selectedAiGateway])

  useEffect(() => {
    if (!open) return
    const next = highestReasoningEffort(selectedAiModelRecord)
    setAiReasoningEffort((current) => aiReasoningOptions.some((option) => option.value === current) ? current : next)
  }, [aiReasoningOptions, open, selectedAiModelRecord])

  const sortedDrafts = useMemo(() => drafts.slice().sort((a, b) => a.order - b.order), [drafts])
  const report = useMemo(() => analyzePlan(form, answers, sortedDrafts.length), [answers, form, sortedDrafts.length])
  const generatedQuestions = useMemo(() => buildDynamicQuestions(form, report), [form, report])
  const questions = aiQuestions.length > 0 ? aiQuestions : generatedQuestions
  const currentGuide = STEPS.find((item) => item.value === step) ?? STEPS[0]
  const currentCoach = STEP_COACH[step]
  const StepIcon = STEP_ICONS[step]
  const currentStepMissing = STEP_FIELDS[step].filter((key) => !form[key].trim())
  const currentStepReady = STEP_FIELDS[step].length - currentStepMissing.length
  const activePhase = STEP_PHASES.find((phase) => phase.steps.includes(step)) ?? STEP_PHASES[0]
  const currentQuestionIndex = Math.min(answers.length, questions.length - 1)
  const canCreate = sortedDrafts.some((draft) => draft.title.trim() && draft.description.trim())

  if (!open) return null
  const target = typeof document === 'undefined' ? null : document.body

  const updateForm = <K extends keyof PlannerForm>(key: K, value: PlannerForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const applyAiResult = (result?: TaskPlannerAiFillResult, nextStep?: PlannerStep) => {
    if (!result) return
    if (result.form && Object.keys(result.form).length > 0) {
      setForm((current) => ({ ...current, ...result.form }))
    }
    if (Array.isArray(result.questions) && result.questions.length > 0) {
      setAiQuestions(result.questions)
    }
    if (Array.isArray(result.drafts) && result.drafts.length > 0) {
      setDrafts(result.drafts.map((draft, index) => ({
        id: createDraftId(),
        order: draft.order ?? index + 1,
        phase: draft.phase?.trim() || phaseTemplates(form.intent)[index % phaseTemplates(form.intent).length] || 'Plan',
        title: draft.title?.trim() || `Task ${index + 1}`,
        description: draft.description?.trim() || '## Amaç\n\n## Kabul Sinyali\n- ',
        confidence: typeof draft.confidence === 'number' ? clamp(draft.confidence, 1, 100) : 86,
        rationale: draft.rationale?.trim() || 'AI tarafından kaynak bağlam ve PM intro üzerinden üretildi.',
        risk: draft.risk?.trim() || 'Bağımlılık ve kabul sinyali önizlemede kontrol edilmeli.'
      })))
    }
    if (nextStep) setStep(nextStep)
  }

  const fillWithAi = async (mode: PlannerAiMode, targetFields: PlannerTextKey[] = STEP_FIELDS[step], nextStep?: PlannerStep) => {
    if (!aiReady || !selectedAiGateway?.id || !aiModel.trim()) {
      setError('AI doldurma için gateway ve model seçilmeli.')
      return
    }
    const busyKey = mode === 'step' && targetFields.length === 1 ? `field:${targetFields[0]}` : mode
    setAiBusy(busyKey)
    setError('')
    try {
      const response = await invokeBridge<TaskPlannerAiFillResult>(IPC_CHANNELS.tasks.plannerAiFill, {
        actorToken,
        projectId: project.id,
        ...(sourceTask?.id ? { taskId: sourceTask.id } : {}),
        gatewayId: selectedAiGateway.id,
        model: aiModel,
        reasoningEffort: aiReasoningEffort,
        language: projectGatewayValue(project, 'language') || projectGatewayValue(project, 'outputLanguage') || projectGatewayValue(project, 'inputLanguage'),
        mode,
        step,
        intro: aiIntro,
        targetFields,
        form,
        answers,
        suggestedTaskCount: report.suggestedTaskCount
      })
      if (!response.ok) {
        setError(response.error?.message ?? 'AI doldurma tamamlanamadı.')
        return
      }
      applyAiResult(response.data, nextStep)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'AI doldurma tamamlanamadı.')
    } finally {
      setAiBusy(null)
    }
  }

  const applySmartDefaults = () => {
    setForm((current) => ({ ...current, ...smartDefaults(project, current, sourceTask) }))
    setError('')
  }

  const applyStepSuggestion = () => {
    setForm((current) => ({ ...current, ...suggestionForStep(step, project, current, sourceTask) }))
    setError('')
  }

  const advanceWithSuggestion = () => {
    const hydratedForm = { ...form, ...suggestionForStep(step, project, form, sourceTask) }
    setForm(hydratedForm)
    if (step === 11) {
      synthesizeDrafts(12, hydratedForm)
      return
    }
    setStep((current) => Math.min(12, current + 1) as PlannerStep)
    setError('')
  }

  const advanceWithAi = () => {
    const nextStep = (step === 11 ? 12 : Math.min(12, step + 1)) as PlannerStep
    void fillWithAi(step === 11 ? 'drafts' : 'step', step === 11 ? ALL_TEXT_FIELDS : STEP_FIELDS[step], nextStep)
  }

  const synthesizeDrafts = (nextStep: PlannerStep = 12, formOverride = form, answersOverride = answers) => {
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
      synthesizeDrafts(12, form, nextAnswers)
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
    setStep(12)
  }

  const goNext = () => {
    if (step === 11 && sortedDrafts.length === 0) {
      if (aiReady) void fillWithAi('drafts', ALL_TEXT_FIELDS, 12)
      else synthesizeDrafts(12)
      return
    }
    setStep((current) => Math.min(12, current + 1) as PlannerStep)
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
    if (typeof localStorage !== 'undefined') localStorage.removeItem(draftStorageKey)
    onCreated(created)
    onClose()
  }

  const renderTextArea = (key: PlannerTextKey, label: string, placeholder: string, rows = 4) => (
    <div className={styles.field}>
      <div className={styles.fieldHeader}>
        <span>{label}</span>
        <button type="button" onClick={() => void fillWithAi('step', [key])} disabled={!aiReady || Boolean(aiBusy)} title={`${label} alanını AI ile doldur`}>
          <LuWandSparkles size={14} /> {aiBusy === `field:${key}` ? 'Dolduruluyor' : 'AI'}
        </button>
      </div>
      <textarea rows={rows} value={form[key]} onChange={(event) => updateForm(key, event.target.value)} placeholder={placeholder} />
    </div>
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
            <span><LuRoute size={14} /> {activePhase.title}</span>
            <span><LuGauge size={14} /> %{report.score}</span>
            <span><LuLayers size={14} /> {sortedDrafts.length || report.suggestedTaskCount} task</span>
            <span><LuWandSparkles size={14} /> {aiModel || 'AI model'}/{aiReasoningEffort}</span>
            <span><LuSave size={14} /> Otomatik kayıt</span>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Kapat" title="Kapat"><LuX size={16} /></button>
        </header>

        <nav className={styles.stepper} aria-label="Planlama adımları">
          {STEP_PHASES.map((phase) => (
            <section key={phase.title} className={phase.steps.includes(step) ? styles.stepGroupActive : styles.stepGroup}>
              <header>
                <strong>{phase.title}</strong>
                <span>{phase.description}</span>
              </header>
              <div className={styles.stepGroupRail}>
                {phase.steps.map((stepValue) => {
                  const item = STEPS.find((entry) => entry.value === stepValue) ?? STEPS[0]
                  return (
                    <button key={item.value} type="button" className={step === item.value ? styles.stepActive : styles.step} onClick={() => setStep(item.value)} title={`${item.label}: ${item.method}`}>
                      <b>{item.value}</b>
                      <span>{item.label}</span>
                      <small>{item.hint}</small>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </nav>

        <main className={styles.workspace}>
          <section className={styles.stage}>
            <div className={styles.stageIntro}>
              <div className={styles.stageIntroHeader}>
                <span><StepIcon size={15} /> {currentGuide.method}</span>
                <strong>Adım {step}/12</strong>
              </div>
              <h3>{currentCoach.title}</h3>
              <p>{currentCoach.principle}</p>
              <div className={styles.stageIntroMeta}>
                <small>Çıktı: {currentCoach.output}</small>
                <small>{currentStepReady}/{STEP_FIELDS[step].length} alan dolu</small>
                <small>{activePhase.title} fazı</small>
              </div>
            </div>

            {step === 1 ? (
              <div className={styles.intentStep}>
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
                <div className={styles.aiSetup}>
                  <div className={styles.aiIntroBox}>
                    <div className={styles.aiIntroHeader}>
                      <strong><LuBrainCircuit size={15} /> AI çalışma introsu</strong>
                      <button type="button" onClick={() => void fillWithAi('all', ALL_TEXT_FIELDS)} disabled={!aiReady || Boolean(aiBusy)}>
                        <LuWandSparkles size={15} /> {aiBusy === 'all' ? 'Çalışıyor' : 'Tüm planı AI ile doldur'}
                      </button>
                    </div>
                    <textarea
                      value={aiIntro}
                      onChange={(event) => setAiIntro(event.target.value)}
                      placeholder="İlk yönlendirmeyi buraya yaz: hedef, kısıt, öncelik, istemediğin kapsam, taskların nasıl bölünmesini istediğin..."
                    />
                  </div>
                  <div className={styles.aiSettingsGrid}>
                    <label>
                      <span>Gateway</span>
                      <select value={selectedAiGateway?.id ?? aiGatewayId} onChange={(event) => setAiGatewayId(event.target.value)} disabled={gateways.length === 0 || Boolean(aiBusy)}>
                        {gateways.length === 0 ? <option value="">Gateway yok</option> : null}
                        {gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Model</span>
                      <select value={aiModel} onChange={(event) => setAiModel(event.target.value)} disabled={aiModelOptions.length === 0 || Boolean(aiBusy)}>
                        {aiModelOptions.length === 0 && aiModel ? <option value={aiModel}>{aiModel}</option> : null}
                        {aiModelOptions.length === 0 && !aiModel ? <option value="">Model yok</option> : null}
                        {aiModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Reasoning</span>
                      <select value={aiReasoningEffort} onChange={(event) => setAiReasoningEffort(normalizeGatewayReasoningEffort(event.target.value))} disabled={aiReasoningOptions.length === 0 || Boolean(aiBusy)}>
                        {aiReasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className={styles.formStep}>
                {renderTextArea('outcome', 'İstenen outcome', 'Örn: Project ve product manager isteklerini yönlendiren çoklu task oluşturma merkezi', 3)}
                {renderTextArea('northStar', 'North Star / proxy metrik', 'Bu akış hangi davranışı veya ürün metriğini büyütecek?', 4)}
                {renderTextArea('successSignals', 'Başarı sinyalleri', 'Her satıra bir kabul sinyali yaz. AI bunları task açıklamalarına dağıtacak.', 4)}
              </div>
            ) : null}

            {step === 3 ? (
              <div className={styles.formStep}>
                {renderTextArea('audience', 'Kullanıcı / paydaş', 'Örn: project manager, product manager, execution agent kullanan ekip üyeleri', 3)}
                {renderTextArea('jobToBeDone', 'Jobs To Be Done', 'When ..., I want to ..., so I can ... biçiminde kullanıcının ilerleme ihtiyacını yaz.', 4)}
                {renderTextArea('problem', 'Problem / fırsat', 'Kullanıcı neyi başarmaya çalışıyor, bugün neden zor, hangi kararlar belirsiz?', 4)}
              </div>
            ) : null}

            {step === 4 ? (
              <div className={styles.formStep}>
                {renderTextArea('evidence', 'Kanıt / veri / kullanıcı sesi', 'Kullanıcı yorumu, task açıklaması, geçmiş karar, gözlem veya varsayım kaynağı.', 5)}
                {renderTextArea('opportunity', 'Opportunity Solution Tree', 'Ana fırsat ve alt fırsatları satır satır yaz.', 5)}
              </div>
            ) : null}

            {step === 5 ? (
              <div className={styles.formStep}>
                {renderTextArea('hypotheses', 'Lean hipotezleri', 'Eğer ... olursa ... metriği/çıktısı iyileşir çünkü ...', 5)}
                {renderTextArea('risks', 'Varsayım riskleri', 'En riskli varsayım, bilinmeyen, karar ve doğrulama ihtiyacı.', 5)}
              </div>
            ) : null}

            {step === 6 ? (
              <div className={styles.formStep}>
                {renderTextArea('moscow', 'MoSCoW kapsamı', 'Must, Should, Could, Won’t olacak şekilde kapsamı keskinleştir.', 5)}
                {renderTextArea('constraints', 'Kısıtlar', 'Tasarım, state, süre, teknik veya ürün kısıtlarını yaz.', 4)}
                {renderTextArea('exclusions', 'Kapsam dışı', 'Bu planın özellikle yapmaması gereken şeyleri yaz.', 4)}
              </div>
            ) : null}

            {step === 7 ? (
              <div className={styles.formStep}>
                {renderTextArea('prioritization', 'RICE / Kano / Value-Effort', 'Reach, Impact, Confidence, Effort; basic/performance/delight; quick win/big bet notlarını yaz.', 6)}
                {renderTextArea('successSignals', 'Önceliğe bağlanan kabul sinyalleri', 'İlk taskların hangi sinyali taşıyacağını netleştir.', 4)}
              </div>
            ) : null}

            {step === 8 ? (
              <div className={styles.formStep}>
                {renderTextArea('storyMap', 'User Story Mapping', 'Backbone, release slice, happy path, edge case ve handoff noktalarını yaz.', 6)}
                {renderTextArea('audience', 'Akıştaki roller', 'Ana kullanıcı, ikinci paydaş, operasyon veya execution agent rolünü netleştir.', 4)}
              </div>
            ) : null}

            {step === 9 ? (
              <div className={styles.formStep}>
                {renderTextArea('deliveryPlan', 'Dual-track delivery planı', 'Discovery, design, engineering, verification, rollout ve bağımlılık sırasını yaz.', 6)}
                {renderTextArea('constraints', 'Engineering kısıtları', 'State, IPC, servis, test, responsive, performans veya release kısıtları.', 4)}
              </div>
            ) : null}

            {step === 10 ? (
              <div className={styles.formStep}>
                {renderTextArea('metrics', 'HEART / North Star / guardrail', 'Happiness, engagement, adoption, retention, task success ve guardrail metrikleri.', 6)}
                {renderTextArea('successSignals', 'Kabul ve ölçüm sinyalleri', 'Task acceptance ile ürün metriği arasındaki bağlantıyı yaz.', 4)}
              </div>
            ) : null}

            {step === 11 ? (
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

            {step === 12 ? (
              <div className={styles.previewStep}>
                <div className={styles.previewToolbar}>
                  <div>
                    <span>{sortedDrafts.length} task taslağı</span>
                    <p>Başlık, açıklama, sıra, faz ve risk alanlarını düzenleyip tek aksiyonla oluştur.</p>
                  </div>
                  <div className={styles.previewActions}>
                    <button type="button" onClick={() => void fillWithAi('drafts', ALL_TEXT_FIELDS, 12)} disabled={!aiReady || Boolean(aiBusy)}><LuWandSparkles size={15} /> {aiBusy === 'drafts' ? 'AI çalışıyor' : 'AI ile yenile'}</button>
                    <button type="button" onClick={() => synthesizeDrafts(12)}><LuRefreshCw size={15} /> Şablonla yenile</button>
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
            <div className={styles.sideHeader}>
              <span>Karar konsolu</span>
              <strong>{activePhase.title}</strong>
              <small>{currentGuide.label} adımı, {currentGuide.method} disipliniyle ilerliyor.</small>
            </div>
            <div className={styles.scorePanel}>
              <span>Plan skoru</span>
              <strong>%{report.score}</strong>
              <div className={styles.scoreTrack}><i style={{ width: `${report.score}%` }} /></div>
            </div>
            <div className={styles.stepCoachPanel}>
              <h4><StepIcon size={15} /> {currentCoach.title}</h4>
              <p>{currentCoach.principle}</p>
              <small>{currentCoach.output}</small>
              <button type="button" onClick={() => void fillWithAi('step', STEP_FIELDS[step])} disabled={!aiReady || Boolean(aiBusy)}><LuWandSparkles size={15} /> {aiBusy === 'step' ? 'AI çalışıyor' : 'Bu adımı AI ile doldur'}</button>
              <button type="button" onClick={advanceWithAi} disabled={!aiReady || Boolean(aiBusy)}><LuArrowRight size={15} /> AI ile ilerle</button>
              <button type="button" onClick={applyStepSuggestion}><LuLightbulb size={15} /> Hızlı şablon</button>
              <button type="button" onClick={advanceWithSuggestion}><LuArrowRight size={15} /> Şablonla ilerle</button>
            </div>
            <div className={styles.assistPanel}>
              <h4><LuBrainCircuit size={15} /> Akıl katmanı</h4>
              <p>{report.nextBestAction}</p>
              <button type="button" onClick={() => void fillWithAi('all', ALL_TEXT_FIELDS)} disabled={!aiReady || Boolean(aiBusy)}><LuWandSparkles size={15} /> {aiBusy === 'all' ? 'AI dolduruyor' : 'Tüm boşlukları AI ile doldur'}</button>
              <button type="button" onClick={() => void fillWithAi('drafts', ALL_TEXT_FIELDS, 12)} disabled={!aiReady || Boolean(aiBusy)}><LuClipboardCheck size={15} /> {aiBusy === 'drafts' ? 'Taslak üretiyor' : 'AI ile task taslakları üret'}</button>
              <button type="button" onClick={applySmartDefaults}><LuLightbulb size={15} /> Şablon boşlukları doldur</button>
              <button type="button" onClick={() => synthesizeDrafts(12)}><LuClipboardCheck size={15} /> Şablon taslak üret</button>
            </div>
            <div className={styles.signalPanel}>
              <h4><LuBookOpen size={15} /> Bu adımda eksik</h4>
              {(currentStepMissing.length > 0 ? currentStepMissing.map((item) => FIELD_LABELS[item]) : ['Bu adım task üretimi için yeterli.']).map((item) => <p key={item}>{item}</p>)}
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
            <div className={styles.methodPanel}>
              <h4><LuSparkles size={15} /> Metodoloji seti</h4>
              {FRAMEWORK_CATALOG.map((item) => <span key={item}>{item}</span>)}
            </div>
          </aside>
        </main>

        {error ? <p className={styles.error}>{error}</p> : null}

        <footer className={styles.footer}>
          <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1) as PlannerStep)} disabled={step === 1 || busy || Boolean(aiBusy)}><LuArrowLeft size={15} /> Geri</button>
          <div className={styles.footerCenter}>
            <span>{sourceTask ? 'Kaynak task korunur; yeni tasklar ayrı oluşturulur.' : 'Yeni tasklar proje merkezinde ayrı kayıtlar olarak açılır.'}</span>
          </div>
          {step < 12 ? (
            <button type="button" className={styles.primaryButton} onClick={goNext} disabled={busy || Boolean(aiBusy)}>
              {aiBusy ? 'AI çalışıyor' : 'İleri'} <LuArrowRight size={15} />
            </button>
          ) : (
            <button type="button" className={styles.primaryButton} onClick={() => void createTasks()} disabled={busy || Boolean(aiBusy) || !canCreate}>
              <LuCheck size={15} /> {busy ? 'Oluşturuluyor' : 'Taskları oluştur'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )

  return target ? createPortal(modal, target) : modal
}
