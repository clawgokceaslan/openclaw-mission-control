import { Component, CSSProperties, DragEvent, PointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Stack } from 'react-bootstrap'
import { LuBot, LuCircleCheck, LuChevronDown, LuClock3, LuCopy, LuDownload, LuExternalLink, LuFileText, LuListChecks, LuMessageSquare, LuEllipsis, LuPaperclip, LuPencil, LuPlay, LuPlus, LuRefreshCw, LuSettings2, LuSlidersHorizontal, LuSparkles, LuSquare, LuTrash2, LuTriangleAlert, LuUpload, LuX } from 'react-icons/lu'
import type { TaskComment } from '@shared/types/entities'
import { GATEWAY_REASONING_EFFORT_OPTIONS, gatewayModelReasoningEfforts, gatewayModelSupportsReasoning, normalizeGatewayReasoningEffort } from '@shared/utils/gateway-language'
import { AppSelect } from '@renderer/components/select/AppSelect'
import { AttachmentTable } from '@renderer/components/attachments/AttachmentTable'
import { MarkdownDescriptionEditor } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { AgentAssignmentPanel, SkillsAssignmentPanel } from '@renderer/components/projects/detail/AssignmentPanels'
import { codexConfigOf, customFieldValueLabel, customFieldValueToDraft, readTaskGatewayOverride, taskActivityMessages, taskGatewaySurfaceStatuses } from '@renderer/screens/projects/detail/projectDetailUtils'
import { lockModalInteractionRegion } from '@renderer/utils/modalInteractionLock'
import styles from './index.module.scss'

const fallbackStatusColumn = (status: string) => ({
  status,
  title: status || 'Unknown',
  accent: 'var(--omc-primary)'
})

function taskPayload(task: any): Record<string, unknown> {
  const payload = task?.payload
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}

function subtaskPayload(subtask: any): Record<string, unknown> {
  const payload = subtask?.payload
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}

function subtaskChecklistItems(subtask: any): any[] {
  const value = subtaskPayload(subtask).checklistItems
  return Array.isArray(value) ? value : []
}

function acceptanceCriteriaOf(task: any): string {
  const agenticInputs = taskPayload(task).agenticInputs
  if (!agenticInputs || typeof agenticInputs !== 'object' || Array.isArray(agenticInputs)) return ''
  const value = (agenticInputs as Record<string, unknown>).acceptanceCriteria
  return typeof value === 'string' ? value : ''
}

function activityTimeLabel(value?: number) {
  if (!value) return 'Henüz kayıt yok'
  return new Date(value).toLocaleString()
}

function latestActivitySummary(task: any) {
  const latest = taskActivityMessages(task)
    .slice()
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0]
  if (!latest) return { title: 'Ajan aktivitesi yok', detail: 'Planlama veya çalışma başladığında son aksiyon burada görünür.', at: undefined }
  const body = latest.body.trim().replace(/\s+/g, ' ')
  return {
    title: latest.role === 'error' || latest.status === 'failed' ? 'Son aksiyon hata verdi' : latest.status === 'running' || latest.status === 'queued' ? 'Ajan çalışıyor' : 'Son ajan aksiyonu kaydedildi',
    detail: body ? body.slice(0, 140) : `${latest.phase ?? 'Akış'} mesajı`,
    at: latest.updatedAt ?? latest.createdAt
  }
}

function pipelineStatusText(task: any, statusKey: string, fallback: string) {
  const latest = latestActivitySummary(task)
  if (statusKey === 'planning') return 'Planlama çalışıyor; gerekirse duraklatıp chat geçmişinden devam edebilirsin.'
  if (statusKey === 'planned') return 'Plan hazır; sıradaki güvenli adım taskı çalıştırmak.'
  if (statusKey === 'working') return 'Çalıştırma aktif; son aksiyon ve çıktı geçmişi aynı task içinde izleniyor.'
  if (statusKey === 'work-completed') return 'Çalışma tamamlandı; doğrulama ve son özet kontrol edilmeli.'
  if (statusKey === 'post-running') return 'Doğrulama özeti hazırlanıyor; riskli karar varsa kullanıcı onayı beklenebilir.'
  if (statusKey === 'post-run-completed') return 'Son çalışma özeti hazır; kabul kriterlerine göre tamamla.'
  if (statusKey === 'needs-input') return 'Kullanıcı onayı veya kısa açıklama bekleniyor; chatten yanıt vererek devam et.'
  if (statusKey === 'paused') return 'Akış duraklatıldı; son güvenli kontrol noktasından devam etmek için ilgili aşamayı tekrar başlat.'
  if (statusKey === 'stale') return 'Akış uzun süredir güncellenmedi; geçmişi kontrol edip devam et veya güvenli kontrol noktasından yeniden dene.'
  if (statusKey === 'blocked') return 'Akış bloke oldu; beklenen kullanıcı yanıtını chatten vererek sıradaki adımı aç.'
  if (statusKey === 'failed') return `${latest.title}: ${latest.detail || 'Yeniden dene veya manuel müdahale ile devam et.'}`
  return fallback
}

function pipelineStateLabel(statusKey?: string, fallback = 'Bekliyor') {
  if (statusKey === 'not-planned') return 'Plan bekliyor'
  if (statusKey === 'planning') return 'Planlanıyor'
  if (statusKey === 'planned') return 'Plan hazır'
  if (statusKey === 'working') return 'Çalışıyor'
  if (statusKey === 'work-completed') return 'Çalışma tamamlandı'
  if (statusKey === 'post-running') return 'Doğrulanıyor'
  if (statusKey === 'post-run-completed') return 'Özet hazır'
  if (statusKey === 'following-up') return 'Devam ediyor'
  if (statusKey === 'followed-up') return 'Devam tamamlandı'
  if (statusKey === 'needs-input') return 'Onay bekliyor'
  if (statusKey === 'paused') return 'Duraklatıldı'
  if (statusKey === 'stale') return 'Kontrol gerekiyor'
  if (statusKey === 'blocked') return 'Bloke'
  if (statusKey === 'failed') return 'Müdahale gerekiyor'
  return fallback
}

function TaskPipelinePanel({
  task,
  completed,
  onPlanWithGateway,
  onRunGateway,
  onStopPlanGateway,
  onStopRunGateway,
  onOpenChat,
  isPlanWithGatewayBusy,
  isPlanWithGatewayDisabled,
  isPlanWithGatewayRunning,
  isRunGatewayBusy,
  isRunGatewayDisabled,
  isRunGatewayRunning,
  isStopGatewayBusy
}: {
  task: any
  completed: Set<string>
  onPlanWithGateway?: () => void
  onRunGateway?: () => void
  onStopPlanGateway?: () => void
  onStopRunGateway?: () => void
  onOpenChat?: () => void
  isPlanWithGatewayBusy?: boolean
  isPlanWithGatewayDisabled?: boolean
  isPlanWithGatewayRunning?: boolean
  isRunGatewayBusy?: boolean
  isRunGatewayDisabled?: boolean
  isRunGatewayRunning?: boolean
  isStopGatewayBusy?: boolean
}) {
  const statuses = taskGatewaySurfaceStatuses(task)
  const statusByPhase = new Map(statuses.map((status) => [status.key.split(':')[0], status]))
  const planStatus = statusByPhase.get('PLAN')
  const runStatus = statusByPhase.get('RUN')
  const verifyStatus = statusByPhase.get('POST-RUNNING')
  const latest = latestActivitySummary(task)
  const runReady = planStatus?.statusKey === 'planned' || Boolean(runStatus)
  const done = completed.has(task.status)
  const failedPlan = planStatus?.statusKey === 'failed'
  const failedRun = runStatus?.statusKey === 'failed' || verifyStatus?.statusKey === 'failed'
  const pipelineSteps = [
    {
      key: 'plan',
      title: 'Planla',
      state: pipelineStateLabel(planStatus?.statusKey, 'Plan bekliyor'),
      tone: planStatus?.statusKey ?? 'not-planned',
      body: pipelineStatusText(task, planStatus?.statusKey ?? 'not-planned', 'Task kapsamı planlanmadı; önce uygulanabilir planı oluştur.'),
      action: isPlanWithGatewayRunning && onStopPlanGateway
        ? { label: 'Duraklat', icon: LuSquare, onClick: onStopPlanGateway, disabled: isStopGatewayBusy }
        : { label: failedPlan ? 'Yeniden dene' : 'Planla', icon: failedPlan ? LuRefreshCw : LuSparkles, onClick: onPlanWithGateway, disabled: isPlanWithGatewayBusy || isPlanWithGatewayDisabled || !onPlanWithGateway }
    },
    {
      key: 'run',
      title: 'Çalıştır',
      state: runStatus ? pipelineStateLabel(runStatus.statusKey) : runReady ? 'Çalıştırılabilir' : 'Plan bekleniyor',
      tone: runStatus?.statusKey ?? (runReady ? 'planned' : 'not-planned'),
      body: pipelineStatusText(task, runStatus?.statusKey ?? 'not-started', runReady ? 'Plan hazır; taskı çalıştırabilir veya önce chatten kapsamı netleştirebilirsin.' : 'Çalıştırma için önce plan aşaması tamamlanmalı.'),
      action: isRunGatewayRunning && onStopRunGateway
        ? { label: 'Duraklat', icon: LuSquare, onClick: onStopRunGateway, disabled: isStopGatewayBusy }
        : { label: failedRun ? 'Yeniden dene' : 'Çalıştır', icon: failedRun ? LuRefreshCw : LuPlay, onClick: onRunGateway, disabled: isRunGatewayBusy || isRunGatewayDisabled || !onRunGateway }
    },
    {
      key: 'verify',
      title: 'Doğrula',
      state: verifyStatus ? pipelineStateLabel(verifyStatus.statusKey) : runStatus?.statusKey === 'work-completed' ? 'Özet bekleniyor' : 'Bekliyor',
      tone: verifyStatus?.statusKey ?? (runStatus?.statusKey === 'work-completed' ? 'working' : 'not-planned'),
      body: pipelineStatusText(task, verifyStatus?.statusKey ?? 'not-started', runStatus?.statusKey === 'work-completed' ? 'Son çalışma özetini ve kabul kriterlerini kontrol et.' : 'Doğrulama çalıştırma tamamlanınca görünür olur.'),
      action: { label: 'Chatte aç', icon: LuMessageSquare, onClick: onOpenChat, disabled: !onOpenChat }
    },
    {
      key: 'complete',
      title: 'Tamamla',
      state: done ? 'Tamamlandı' : verifyStatus?.statusKey === 'post-run-completed' || runStatus?.statusKey === 'work-completed' ? 'Onay bekliyor' : 'Bekliyor',
      tone: done ? 'post-run-completed' : verifyStatus?.statusKey === 'post-run-completed' || runStatus?.statusKey === 'work-completed' ? 'needs-input' : 'not-planned',
      body: done ? 'Task kapalı durumda; akış tamamlandı.' : 'Kabul kriterleri doğrulandıysa statüyü tamamlanan kolona taşı; değilse chatten devam et.',
      action: { label: done ? 'Geçmiş' : 'Devam et', icon: done ? LuCircleCheck : LuMessageSquare, onClick: onOpenChat, disabled: !onOpenChat }
    }
  ]

  return (
    <section className={styles.pipelinePanel}>
      <header className={styles.pipelineHeader}>
        <div>
          <span>Task yaşam döngüsü</span>
          <strong>Planla, çalıştır, doğrula ve tamamla</strong>
        </div>
        <p>{latest.title} · {activityTimeLabel(latest.at)}</p>
      </header>
      <div className={styles.pipelineSteps}>
        {pipelineSteps.map((item) => {
          const Icon = item.tone === 'failed' ? LuTriangleAlert : item.tone === 'not-planned' ? LuClock3 : LuCircleCheck
          const ActionIcon = item.action.icon
          return (
            <article key={item.key} className={`${styles.pipelineStep} ${styles[`pipelineTone_${item.tone}`] ?? ''}`}>
              <div className={styles.pipelineStepIcon}><Icon size={15} /></div>
              <div className={styles.pipelineStepBody}>
                <div><strong>{item.title}</strong><span>{item.state}</span></div>
                <p>{item.body}</p>
              </div>
              <button type="button" onClick={item.action.onClick} disabled={item.action.disabled}>
                <ActionIcon size={14} /> {item.action.label}
              </button>
            </article>
          )
        })}
      </div>
      <footer className={styles.pipelineFooter}>
        <strong>Son çalışma özeti</strong>
        <span>{latest.detail}</span>
      </footer>
    </section>
  )
}

function ChecklistPanel({
  items,
  emptyLabel,
  onAdd,
  onToggle,
  onRemove
}: {
  items: any[]
  emptyLabel: string
  onAdd?: () => void
  onToggle?: (itemId: string) => void
  onRemove?: (itemId: string) => void
}) {
  const checkedCount = items.filter((item) => item.checked).length
  const progress = items.length > 0 ? Math.round((checkedCount / items.length) * 100) : 0
  return (
    <div className={styles.checklistPanel}>
      <div className={styles.checklistProgress}><span style={{ width: `${progress}%` }} /></div>
      <div className={styles.tabCtaCard}>
        <div><strong>Add checklist item</strong><span>Add multiple checklist items in one flow.</span></div>
        <button type="button" className={styles.tabActionButton} onClick={onAdd}><LuPlus size={15} />Add checklist item</button>
      </div>
      {items.length > 0 ? (
        <div className={styles.checklistList}>
          {items.map((item) => (
            <div key={item.id} className={styles.checklistRow}>
              <input type="checkbox" checked={Boolean(item.checked)} onChange={() => void onToggle?.(item.id)} />
              <span className={item.checked ? styles.checklistItemChecked : styles.checklistItemTitle}>{item.title}</span>
              <button type="button" onClick={() => void onRemove?.(item.id)} aria-label={`Remove ${item.title}`}><LuTrash2 size={14} /></button>
            </div>
          ))}
        </div>
      ) : <p className={styles.customFieldEmpty}>{emptyLabel}</p>}
    </div>
  )
}

interface TaskDetailPopupProps {
  taskId: string
  children?: ReactNode
  scope?: Record<string, any>
  onClose: () => void
  onDeleteTask: () => void
  onEditTitle: () => void
  onOpenChat: () => void
  title?: string
  nested?: boolean
  hideTaskActions?: boolean
  onFilesDrop?: (files: File[]) => void
  onDownloadZip?: () => void
  onDownloadTaskMarkdown?: () => void
  onDownloadTaskJson?: () => void
  onExportTaskJson?: () => void
  onDownloadTaskToon?: () => void
  onDownloadAgentMarkdown?: () => void
  onDownloadSkillsMarkdown?: () => void
  onRunGateway?: () => void
  isRunGatewayBusy?: boolean
  isRunGatewayDisabled?: boolean
  onStopRunGateway?: () => void
  isRunGatewayRunning?: boolean
  onPlanWithGateway?: () => void
  isPlanWithGatewayBusy?: boolean
  isPlanWithGatewayDisabled?: boolean
  onStopPlanGateway?: () => void
  isPlanWithGatewayRunning?: boolean
  isStopGatewayBusy?: boolean
  onImportJson?: () => void
}

class TaskDetailPopupBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[TaskDetailPopup] render failed', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.popupFallback}>
          <strong>Task detail failed to render.</strong>
          <span>{this.state.error.message}</span>
          <button type="button" onClick={this.props.onClose}>Close detail</button>
        </div>
      )
    }

    return this.props.children
  }
}

function useTaskDetailCompactLayout() {
  const [isCompact, setIsCompact] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(width <= 900px)').matches : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia('(width <= 900px)')
    const update = () => setIsCompact(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isCompact
}

function CommentsPane({ scope, inline = false }: { scope: Record<string, any>; inline?: boolean }) {
  const sourceComments = scope.comments ?? []
  const comments = useMemo(() => (
    [...sourceComments].sort((a: TaskComment, b: TaskComment) => a.createdAt - b.createdAt)
  ), [sourceComments])
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'OP'
  return (
    <>
      {!inline ? <div className={styles.splitHandle} onMouseDown={scope.onResizeStart} role="separator" aria-orientation="vertical" aria-label="Resize detail and comments panels" /> : null}
      <aside className={`${styles.commentsPane} ${inline ? styles.commentsPaneInline : ''}`}>
        <header className={styles.commentsHeader}><div><h4>Comments</h4><span>{comments.length} notes</span></div></header>
        <div className={styles.commentsFeed}>
          {comments.length > 0 ? (
            comments.map((comment: TaskComment) => (
              <article key={comment.id} className={styles.commentItem}>
                <div className={styles.commentAvatar}>{initials(comment.authorName || 'Operator')}</div>
                <div className={styles.commentContent}>
                  <div className={styles.commentMeta}><strong>{comment.authorName || 'Operator'}</strong><span>{new Date(comment.createdAt).toLocaleString()}</span></div>
                  <p>{comment.body}</p>
                  <div className={styles.commentActions}>
                    <button type="button" className={styles.commentIconBtn} onClick={() => scope.startEditComment?.(comment)} title="Edit comment" aria-label="Edit comment"><LuPencil size={13} /></button>
                    <button type="button" className={styles.commentIconBtn} onClick={() => void scope.removeComment?.(comment)} title="Delete comment" aria-label="Delete comment"><LuTrash2 size={13} /></button>
                  </div>
                </div>
              </article>
            ))
          ) : null}
        </div>
        <section className={styles.commentsComposer}>
          <div className={styles.commentsComposerHeader}>
            <span>{scope.editingCommentId ? 'Editing comment' : 'New comment'}</span>
            {scope.editingCommentId ? <button type="button" onClick={scope.cancelEditComment} aria-label="Cancel comment edit"><LuX size={14} /></button> : null}
          </div>
          <textarea
            rows={3}
            value={scope.commentDraft ?? ''}
            onChange={(event) => scope.setCommentDraft?.(event.target.value)}
            placeholder={scope.editingCommentId ? 'Edit comment...' : 'Write a comment...'}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void scope.submitComment?.()
              }
              if (event.key === 'Escape') {
                scope.cancelEditComment?.()
              }
            }}
          />
          <div className={styles.commentComposerFooter}>
            <span>{scope.editingCommentId ? 'Esc cancels edit' : 'Enter sends, Shift+Enter adds a line'}</span>
            <button type="button" onClick={() => void scope.submitComment?.()} disabled={!String(scope.commentDraft ?? '').trim()}>
              <LuMessageSquare size={14} />
              {scope.editingCommentId ? 'Save' : 'Send'}
            </button>
          </div>
        </section>
      </aside>
    </>
  )
}

function ModelTab({ scope }: { scope: Record<string, any> }) {
  const task = scope.selectedTask
  const override = readTaskGatewayOverride(task)
  const saved = scope.savedGatewaySettings ?? {}
  const selectedGatewayId = override.gatewayId
  const effectiveGatewayId = selectedGatewayId || saved.gatewayId || ''
  const effectiveGateway = (scope.gateways ?? []).find((gateway: any) => gateway.id === effectiveGatewayId) ?? null
  const taskModelOptions = (codexConfigOf(effectiveGateway).models ?? []).map((model) => ({ label: model.label || model.id, value: model.id }))
  const taskModels = codexConfigOf(effectiveGateway).models ?? []
  const effectivePlan = override.planModel || saved.planModel || saved.defaultModel || ''
  const effectiveRun = override.runModel || override.legacyModel || saved.runModel || saved.defaultModel || ''
  const effectivePlanReasoning = override.planReasoningEffort || saved.planReasoningEffort || 'medium'
  const effectiveRunReasoning = override.runReasoningEffort || saved.runReasoningEffort || 'medium'
  const effectivePlanModelRecord = taskModels.find((model) => model.id === effectivePlan) ?? null
  const effectiveRunModelRecord = taskModels.find((model) => model.id === effectiveRun) ?? null
  const planSupportsReasoning = gatewayModelSupportsReasoning(effectivePlanModelRecord)
  const runSupportsReasoning = gatewayModelSupportsReasoning(effectiveRunModelRecord)
  const planReasoningOptions = GATEWAY_REASONING_EFFORT_OPTIONS
    .filter((option) => gatewayModelReasoningEfforts(effectivePlanModelRecord).includes(option.value))
    .map((option) => ({ label: option.label, value: option.value }))
  const runReasoningOptions = GATEWAY_REASONING_EFFORT_OPTIONS
    .filter((option) => gatewayModelReasoningEfforts(effectiveRunModelRecord).includes(option.value))
    .map((option) => ({ label: option.label, value: option.value }))
  const selectedGatewayOption = selectedGatewayId ? (scope.gatewayOptions ?? []).find((option: any) => option.value === selectedGatewayId) ?? null : null
  const selectedPlanOption = taskModelOptions.find((option) => option.value === override.planModel) ?? null
  const selectedRunOption = taskModelOptions.find((option) => option.value === (override.runModel || override.legacyModel)) ?? null
  const selectedPlanReasoningOption = planReasoningOptions.find((option) => option.value === effectivePlanReasoning) ?? planReasoningOptions.find((option) => option.value === 'medium') ?? planReasoningOptions[0] ?? null
  const selectedRunReasoningOption = runReasoningOptions.find((option) => option.value === effectiveRunReasoning) ?? runReasoningOptions.find((option) => option.value === 'medium') ?? runReasoningOptions[0] ?? null

  return (
    <>
      <div className={styles.detailSectionHeader}><div><h4>Model</h4><p>Plan: {effectivePlan || 'Not configured'} · Run: {effectiveRun || 'Not configured'}</p></div></div>
      {!saved.gatewayId || !(saved.planModel || saved.runModel || saved.defaultModel) ? (
        <div className={styles.tabCtaCard}>
          <div><strong>Project Codex settings required</strong><span>Configure a gateway and default model in Project settings first.</span></div>
          <button type="button" className={styles.tabActionButton} onClick={scope.openGatewaySettings}>Open settings</button>
        </div>
      ) : (
        <>
          <div className={styles.codexSummaryCard}>
            <div><span>Gateway</span><strong>{selectedGatewayId ? effectiveGateway?.name ?? selectedGatewayId : `Project default: ${scope.selectedGateway?.name ?? saved.gatewayId}`}</strong></div>
            <div><span>Plan model</span><strong>{override.planModel || `Project default: ${saved.planModel || saved.defaultModel}`}</strong></div>
            <div><span>Run model</span><strong>{override.runModel || override.legacyModel || `Project default: ${saved.runModel || saved.defaultModel}`}</strong></div>
            {planSupportsReasoning ? <div><span>Plan reasoning</span><strong>{override.planReasoningEffort || `Project default: ${saved.planReasoningEffort || 'medium'}`}</strong></div> : null}
            {runSupportsReasoning ? <div><span>Run reasoning</span><strong>{override.runReasoningEffort || `Project default: ${saved.runReasoningEffort || 'medium'}`}</strong></div> : null}
          </div>
          <div className={styles.settingsFormGrid}>
            <label>
              <span>Task gateway</span>
              <AppSelect
                value={selectedGatewayOption}
                options={scope.gatewayOptions ?? []}
                placeholder={`Use project default gateway: ${scope.selectedGateway?.name ?? saved.gatewayId}`}
                isClearable
                onChange={(option) => {
                  if (Array.isArray(option)) return
                  const nextGatewayId = option?.value ?? ''
                  const nextGateway = (scope.gateways ?? []).find((gateway: any) => gateway.id === (nextGatewayId || saved.gatewayId))
                  const models = codexConfigOf(nextGateway).models ?? []
                  const current = readTaskGatewayOverride(task)
                  const currentRun = current.runModel || current.legacyModel
                  void scope.setTaskGatewaySelection?.({
                    gatewayId: nextGatewayId || null,
                    planModel: current.planModel && models.some((model) => model.id === current.planModel) ? current.planModel : null,
                    runModel: currentRun && models.some((model) => model.id === currentRun) ? currentRun : null
                  })
                }}
              />
            </label>
            <label><span>Task plan model</span><AppSelect value={selectedPlanOption} options={taskModelOptions} placeholder={`Use project plan model: ${saved.planModel || saved.defaultModel}`} isClearable isDisabled={taskModelOptions.length === 0} onChange={(option) => { if (!Array.isArray(option)) void scope.setTaskGatewaySelection?.({ planModel: option?.value ?? null }) }} /></label>
            {planSupportsReasoning ? <label><span>Task plan reasoning</span><AppSelect value={selectedPlanReasoningOption} options={planReasoningOptions} placeholder={`Use project plan reasoning: ${saved.planReasoningEffort || 'medium'}`} isClearable onChange={(option) => { if (!Array.isArray(option)) void scope.setTaskGatewaySelection?.({ planReasoningEffort: option?.value ? normalizeGatewayReasoningEffort(option.value) : null }) }} /></label> : null}
            <label><span>Task run model</span><AppSelect value={selectedRunOption} options={taskModelOptions} placeholder={`Use project run model: ${saved.runModel || saved.defaultModel}`} isClearable isDisabled={taskModelOptions.length === 0} onChange={(option) => { if (!Array.isArray(option)) void scope.setTaskGatewaySelection?.({ runModel: option?.value ?? null }) }} /></label>
            {runSupportsReasoning ? <label><span>Task run reasoning</span><AppSelect value={selectedRunReasoningOption} options={runReasoningOptions} placeholder={`Use project run reasoning: ${saved.runReasoningEffort || 'medium'}`} isClearable onChange={(option) => { if (!Array.isArray(option)) void scope.setTaskGatewaySelection?.({ runReasoningEffort: option?.value ? normalizeGatewayReasoningEffort(option.value) : null }) }} /></label> : null}
          </div>
        </>
      )}
    </>
  )
}

function TaskDetailBody({ scope }: { scope: Record<string, any> }) {
  const task = scope.selectedTask
  const isCompactLayout = useTaskDetailCompactLayout()
  const [detailTab, setDetailTab] = useState(scope.detailTab ?? 'subtasks')
  const [acceptanceDraft, setAcceptanceDraft] = useState(() => acceptanceCriteriaOf(task))
  useEffect(() => setDetailTab(scope.detailTab ?? 'subtasks'), [task?.id])
  useEffect(() => setAcceptanceDraft(acceptanceCriteriaOf(task)), [task?.id, task?.payload])
  if (!task) return null
  const completed = new Set(scope.completedStatusIds ?? [])
  const resolveColumn = typeof scope.resolveColumnByStatus === 'function' ? scope.resolveColumnByStatus : fallbackStatusColumn
  const taskStatusColumn = resolveColumn(task.status)
  const selectedTaskAgent = scope.selectedTaskAgent
  const selectedTaskAgentIsDefault = scope.selectedTaskAgentIsDefault === true
  const selectedTaskSkillOptions = scope.selectedTaskSkillOptions ?? []
  const selectTab = (tab: string) => {
    setDetailTab(tab)
    scope.setDetailTab?.(tab)
  }

  return (
    <div className={styles.modalBody} ref={scope.modalBodyRef} style={scope.splitTemplate ? { gridTemplateColumns: scope.splitTemplate } as CSSProperties : undefined}>
      <div className={styles.detailPane}>
        <section className={styles.breadcrumbRow}>
          <button type="button" className={styles.breadcrumbBtn} onClick={() => (scope.closeTaskDetail ?? scope.clearSelection)?.()}>{scope.project?.name ?? 'Project'}</button>
          <span className={styles.breadcrumbSep}>&gt;</span>
          <button type="button" className={styles.breadcrumbBtn} onClick={() => { scope.setDetailViewMode?.('task'); scope.setSelectedSubtaskId?.(null); setDetailTab('subtasks') }}>{task.title}</button>
        </section>
        <section className={styles.detailTop}>
          <div className={styles.taskTypeRow}><span className={styles.taskTypePill}>Task</span><span className={styles.projectContext}>in {scope.project?.name}</span></div>
          {!scope.isTitleEditing ? <h3 className={styles.detailTitle} onClick={() => { scope.setTitleDraft(task.title); scope.setIsTitleEditing(true) }}>{task.title}</h3> : (
            <textarea autoFocus ref={scope.resizeTitleTextarea} className={styles.titleInput} value={scope.titleDraft} rows={1} onInput={(event) => scope.resizeTitleTextarea(event.currentTarget)} onChange={(event) => scope.setTitleDraft(event.target.value)} onBlur={() => void scope.saveTitle()} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void scope.saveTitle() } if (event.key === 'Escape') { scope.setTitleDraft(task.title); scope.setIsTitleEditing(false) } }} />
          )}
          <div className={styles.aiHint}>Add description, write summary or find related tasks</div>
          <div className={styles.topControlGrid}>
            <div className={`${styles.topControlBlock} ${styles.topControlCard} ${styles.statusControlCard}`} style={{ '--status-accent': taskStatusColumn.accent } as CSSProperties}>
              <span className={styles.metaLabel}>Status</span>
              <AppSelect mode="single" variant="borderless" className={styles.statusInlineSelect} value={{ value: task.status, label: taskStatusColumn.title, color: taskStatusColumn.accent }} options={(scope.statusColumns ?? []).map((column: any) => ({ value: column.status, label: column.title, color: column.accent }))} onChange={(option) => { if (!Array.isArray(option) && option?.value) void scope.updateTaskStatus?.(task.id, option.value) }} />
            </div>
            <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
              <span className={styles.metaLabel}>Tags (shared)</span>
              <AppSelect mode="multi" creatable variant="borderless" className={styles.tagInlineSelect} value={scope.selectedTaskTagOptions ?? []} options={scope.availableTagOptions ?? []} onChange={(nextValue) => void scope.setTaskTags?.((Array.isArray(nextValue) ? nextValue : []).map((item: any) => item.value))} onCreateOption={(value) => void scope.createTagAndAttach?.(value)} placeholder="Search or add tags..." />
            </div>
          </div>
          <TaskPipelinePanel
            task={task}
            completed={completed}
            onPlanWithGateway={scope.onPlanWithGateway}
            onRunGateway={scope.onRunGateway}
            onStopPlanGateway={scope.onStopPlanGateway}
            onStopRunGateway={scope.onStopRunGateway}
            onOpenChat={scope.onOpenChat}
            isPlanWithGatewayBusy={scope.isPlanWithGatewayBusy}
            isPlanWithGatewayDisabled={scope.isPlanWithGatewayDisabled}
            isPlanWithGatewayRunning={scope.isPlanWithGatewayRunning}
            isRunGatewayBusy={scope.isRunGatewayBusy}
            isRunGatewayDisabled={scope.isRunGatewayDisabled}
            isRunGatewayRunning={scope.isRunGatewayRunning}
            isStopGatewayBusy={scope.isStopGatewayBusy}
          />
        </section>
        <section className={styles.drawerSection}>
          <h4>Description</h4>
          <MarkdownDescriptionEditor value={scope.descriptionDraft ?? task.description ?? ''} className={`${styles.descriptionField} ${scope.isDescriptionEditing ? styles.editingField : ''}`} minHeight={280} placeholder="Add description, notes, checklists or code..." status={scope.isDescriptionSaving ? 'saving' : scope.isDescriptionEditing ? 'dirty' : 'idle'} enableDataFormatCommands dataFormats={scope.outputFormats ?? []} onCreateDataFormat={scope.createDescriptionDataFormat} onChange={(nextValue) => scope.setDescriptionDraft?.(nextValue)} onCommit={() => { void scope.saveDescription?.({ finalize: true }) }} onCancel={() => scope.resetDescriptionDraft?.()} />
          <div className={styles.fieldStateRow}>{scope.isDescriptionSaving ? <span className={styles.fieldSaving}>Saving...</span> : null}{scope.isDescriptionEditing && !scope.isDescriptionSaving ? <span className={styles.fieldDirty}>Editing</span> : null}</div>
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.detailSectionHeader}>
            <div><h4>Acceptance Criteria</h4><p>Define what must be true before this task is accepted.</p></div>
          </div>
          <textarea
            className={styles.acceptanceCriteriaField}
            value={acceptanceDraft}
            placeholder="Add acceptance criteria..."
            onChange={(event) => setAcceptanceDraft(event.target.value)}
            onBlur={() => {
              if (acceptanceDraft !== acceptanceCriteriaOf(task)) void scope.saveAcceptanceCriteria?.(acceptanceDraft)
            }}
          />
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.tabRow}>
            {[
              ['subtasks', LuListChecks, 'Subtasks'], ['comments', LuMessageSquare, `Comments ${(task.comments ?? []).length}`], ['customFields', LuSlidersHorizontal, 'Custom fields'], ['checklist', LuListChecks, 'Checklist'], ['attachments', LuPaperclip, 'Attachments'], ['agent', LuBot, 'Agent'], ['skills', LuSparkles, 'Skills'], ['model', LuSettings2, 'Model']
            ].map(([tab, Icon, label]: any) => <button key={tab} type="button" className={detailTab === tab ? styles.tabActive : styles.tabBtn} onClick={() => selectTab(tab)}><Icon size={15} />{label}</button>)}
          </div>
          {detailTab === 'subtasks' ? (
            <>
              <div className={styles.detailSectionHeader}><div><h4>Subtasks</h4><p>{(task.subtasks ?? []).filter((item: any) => completed.has(item.status)).length} completed / {(task.subtasks ?? []).length} total</p></div>{(scope.selectedSubtaskIds ?? []).length > 0 ? <button type="button" className={styles.bulkRemoveBtn} onClick={() => void scope.removeSelectedSubtasks()}><LuTrash2 size={15} /></button> : null}</div>
              <div className={styles.tabCtaCard}><div><strong>Add subtask</strong><span>Create a child task and keep this list organized.</span></div><button type="button" className={styles.tabActionButton} onClick={() => scope.setIsAddSubtaskOpen?.(true)}><LuPlus size={15} />Add subtask</button></div>
              <Stack gap={2}>{(task.subtasks ?? []).map((subtask: any) => {
                const subtaskStatusColumn = resolveColumn(subtask.status)
                return <div key={subtask.id} className={`${styles.subtaskRow} ${scope.pendingDeleteSubtaskId === subtask.id ? styles.subtaskDeleteArmed : ''}`}><button type="button" className={`${styles.subtaskStatusToggle} ${completed.has(subtask.status) ? styles.subtaskStatusDone : ''}`} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); scope.setSubtaskStatusMenu?.((current: any) => current?.subtaskId === subtask.id ? null : { subtaskId: subtask.id, left: rect.left, top: rect.bottom + 6 }) }}><span />{subtaskStatusColumn.title}<LuChevronDown size={13} /></button><label><span className={styles.editableSubtaskTitle} onClick={(event) => { event.stopPropagation(); scope.scheduleOpenSubtaskDetail?.(subtask.id) }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); scope.startSubtaskRename?.(subtask) }}>{subtask.title}</span></label><button type="button" className={styles.subtaskRemoveBtn} onClick={() => void scope.removeSubtask?.(subtask.id)}><LuTrash2 size={14} /></button></div>
              })}</Stack>
            </>
          ) : detailTab === 'comments' ? (
            <CommentsPane inline scope={{ ...scope, comments: task.comments ?? [] }} />
          ) : detailTab === 'customFields' ? (
            <><div className={styles.detailSectionHeader}><div><h4>Custom fields</h4><p>{(scope.assignedCustomFieldValues ?? []).length} assigned</p></div></div><div className={styles.tabCtaCard}><div><strong>Add custom field</strong><span>Attach a field value to this task.</span></div><button type="button" className={styles.tabActionButton} onClick={scope.openCustomFieldModal}><LuPlus size={15} />Add custom field</button></div><CustomFieldsList scope={scope} values={scope.assignedCustomFieldValues ?? []} /></>
          ) : detailTab === 'checklist' ? (
            <><div className={styles.detailSectionHeader}><div><h4>Checklist</h4><p>{(task.checklistItems ?? []).filter((item: any) => item.checked).length} checked / {(task.checklistItems ?? []).length} total</p></div></div><ChecklistPanel items={task.checklistItems ?? []} emptyLabel="No checklist items on this task." onAdd={() => scope.openChecklistModal?.()} onToggle={(itemId) => scope.toggleChecklistItem?.(itemId)} onRemove={(itemId) => scope.removeChecklistItem?.(itemId)} /></>
          ) : detailTab === 'attachments' ? (
            <><div className={styles.detailSectionHeader}><div><h4>Attachments</h4><p>{(scope.taskAttachmentRows ?? []).length} files</p></div></div><AttachmentTable rows={scope.taskAttachmentRows ?? []} uploading={scope.isAttachmentUploading} onUpload={(files) => void scope.uploadTaskAttachments(files)} onRemove={(row) => void scope.removeTaskAttachment(row)} onError={scope.setError} /></>
          ) : detailTab === 'agent' ? (
            <><div className={styles.detailSectionHeader}><div><h4>Agent</h4><p>{selectedTaskAgent ? `${selectedTaskAgent.name}${selectedTaskAgentIsDefault ? ` (${scope.selectedTaskAgentDefaultLabel ?? 'Default'})` : ''}` : 'Unassigned'}</p></div></div><AgentAssignmentPanel agent={selectedTaskAgent} agents={scope.agents ?? []} ctaDescription="Choose the agent responsible for this task." onChange={scope.setTaskAgent} inheritedLabel={selectedTaskAgentIsDefault ? scope.selectedTaskAgentDefaultLabel ?? 'Default' : undefined} canClear={!selectedTaskAgentIsDefault} /></>
          ) : detailTab === 'skills' ? (
            <><div className={styles.detailSectionHeader}><div><h4>Skills</h4><p>{(scope.selectedTaskSkills ?? task.skills ?? []).length} selected{scope.selectedTaskSkillsAreDefault ? ' · Project default' : ''}</p></div></div><SkillsAssignmentPanel selectedSkills={scope.selectedTaskSkills ?? task.skills ?? []} skills={scope.skills ?? []} source={scope.selectedTaskSkillsAreDefault ? 'Project default' : 'Task'} ctaDescription="Select one or more skills needed for this task." onChange={scope.setTaskSkills} inheritedLabel={scope.selectedTaskSkillsAreDefault ? 'Project default' : undefined} canClear={!scope.selectedTaskSkillsAreDefault && (task.skills ?? []).length > 0} /></>
          ) : detailTab === 'model' ? <ModelTab scope={scope} /> : null}
        </section>
        <section className={styles.drawerSection}><h4>Dependencies</h4><p>No dependencies.</p></section>
      </div>
      {!isCompactLayout ? <CommentsPane scope={{ ...scope, comments: task.comments ?? [] }} /> : null}
    </div>
  )
}

function CustomFieldsList({ scope, values }: { scope: Record<string, any>; values: Array<{ field: any; value: unknown }> }) {
  return <div className={styles.customFieldPanel}>{scope.customFieldError ? <p className={styles.customFieldError}>{scope.customFieldError}</p> : null}{values.length > 0 ? <div className={styles.customFieldList}>{values.map(({ field, value }) => <div key={field.id} className={styles.customFieldRow}><div className={styles.customFieldInfo}><div><span className={styles.customFieldName}>{field.name}</span>{field.description ? <p>{field.description}</p> : null}</div><span className={`${styles.customFieldType} ${styles[`customFieldType_${field.type}`]}`}>{field.type}</span></div>{scope.editingCustomFieldId === field.id ? <div className={styles.customFieldEditInline}>{field.type === 'boolean' ? <select value={scope.customFieldDraft || 'false'} onChange={(event) => scope.setCustomFieldDraft?.(event.target.value)}><option value="true">True</option><option value="false">False</option></select> : <textarea rows={field.type === 'json' ? 5 : 2} value={scope.customFieldDraft} onChange={(event) => scope.setCustomFieldDraft?.(event.target.value)} />}<button type="button" onClick={() => void scope.saveCustomFieldValue?.(field)}>Save</button><button type="button" onClick={() => { scope.setEditingCustomFieldId?.(null); scope.setCustomFieldDraft?.(''); scope.setCustomFieldError?.(null) }}>Cancel</button></div> : <><pre className={styles.customFieldValue}>{customFieldValueLabel(field, value)}</pre><div className={styles.customFieldActions}><button type="button" onClick={() => { scope.setEditingCustomFieldId?.(field.id); scope.setSelectedCustomFieldOption?.(null); scope.setCustomFieldError?.(null); scope.setCustomFieldDraft?.(customFieldValueToDraft(field, value)) }}><LuPencil size={14} /></button><button type="button" onClick={() => void scope.removeCustomFieldValue?.(field.id)}><LuTrash2 size={14} /></button></div></>}</div>)}</div> : <p className={styles.customFieldEmpty}>No custom fields on this task.</p>}</div>
}

function SubtaskDetailBody({ scope }: { scope: Record<string, any> }) {
  const subtask = scope.selectedSubtask
  const task = scope.selectedTask
  const isCompactLayout = useTaskDetailCompactLayout()
  const [detailTab, setDetailTab] = useState(scope.detailTab === 'subtasks' || scope.detailTab === 'model' ? 'agent' : scope.detailTab ?? 'agent')
  useEffect(() => setDetailTab(scope.detailTab === 'subtasks' || scope.detailTab === 'model' ? 'agent' : scope.detailTab ?? 'agent'), [subtask?.id])
  if (!subtask || !task) return null
  const resolveColumn = typeof scope.resolveColumnByStatus === 'function' ? scope.resolveColumnByStatus : fallbackStatusColumn
  const subtaskStatusColumn = resolveColumn(subtask.status)
  const checklistItems = subtaskChecklistItems(subtask)
  const comments = scope.comments ?? []
  const selectTab = (tab: string) => {
    setDetailTab(tab)
    scope.setDetailTab?.(tab)
  }
  return (
    <div className={styles.modalBody} ref={scope.modalBodyRef} style={scope.splitTemplate ? { gridTemplateColumns: scope.splitTemplate } as CSSProperties : undefined}>
      <div className={styles.detailPane}>
        <section className={styles.breadcrumbRow}>
          <button type="button" className={styles.breadcrumbBtn} onClick={() => { scope.closeSubtaskDetail?.(); if (!scope.closeSubtaskDetail) { scope.setSelectedSubtaskId?.(null); scope.setDetailViewMode?.('task'); scope.setDetailTab?.('subtasks') } }}>{task.title}</button>
          <span className={styles.breadcrumbSep}>&gt;</span>
          <button type="button" className={styles.breadcrumbBtnActive}>{subtask.title}</button>
        </section>
        <section className={styles.detailTop}>
          <div className={styles.taskTypeRow}><span className={styles.taskTypePill}>Subtask</span><span className={styles.projectContext}>in {task.title}</span></div>
          {scope.editingSubtaskId === subtask.id ? (
            <textarea autoFocus ref={scope.resizeTitleTextarea} className={styles.titleInput} value={scope.subtaskDraft ?? subtask.title} rows={1} onInput={(event) => scope.resizeTitleTextarea?.(event.currentTarget)} onChange={(event) => scope.setSubtaskDraft?.(event.target.value)} onBlur={() => void scope.saveSubtaskTitle?.()} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void scope.saveSubtaskTitle?.() } if (event.key === 'Escape') { scope.setEditingSubtaskId?.(null); scope.setSubtaskDraft?.('') } }} />
          ) : (
            <h3 className={styles.detailTitle} onClick={() => { scope.setEditingSubtaskId?.(subtask.id); scope.setSubtaskDraft?.(subtask.title) }}>{subtask.title}</h3>
          )}
          <div className={styles.topControlGrid}>
            <div className={`${styles.topControlBlock} ${styles.topControlCard} ${styles.statusControlCard}`} style={{ '--status-accent': subtaskStatusColumn.accent } as CSSProperties}>
              <span className={styles.metaLabel}>Status</span>
              <AppSelect mode="single" variant="borderless" className={styles.statusInlineSelect} value={{ value: subtask.status, label: subtaskStatusColumn.title, color: subtaskStatusColumn.accent }} options={(scope.statusColumns ?? []).map((column: any) => ({ value: column.status, label: column.title, color: column.accent }))} onChange={(option) => { if (!Array.isArray(option) && option?.value) void scope.updateSubtaskStatus?.(subtask, option.value) }} />
            </div>
            <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
              <span className={styles.metaLabel}>Tags</span>
              <AppSelect mode="multi" creatable variant="borderless" className={styles.tagInlineSelect} value={scope.selectedSubtaskTagOptions ?? []} options={scope.availableTagOptions ?? []} onChange={(nextValue) => void scope.setSubtaskTags?.((Array.isArray(nextValue) ? nextValue : []).map((item: any) => item.value))} onCreateOption={(value) => void scope.createTagAndAttachToSubtask?.(value)} placeholder="Search or add tags..." />
            </div>
          </div>
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.detailSectionHeader}><div><h4>Description</h4><p>{scope.isSubtaskDescriptionSaving ? 'Saving...' : scope.isSubtaskDescriptionDirty ? 'Editing' : 'Ready'}</p></div></div>
          <MarkdownDescriptionEditor value={scope.subtaskDescriptionDraft ?? scope.getSubtaskDescription?.(subtask) ?? ''} className={`${styles.descriptionField} ${scope.isSubtaskDescriptionDirty ? styles.editingField : ''}`} minHeight={280} placeholder="Add subtask description, notes, checklists or code..." status={scope.isSubtaskDescriptionSaving ? 'saving' : scope.isSubtaskDescriptionDirty ? 'dirty' : 'idle'} enableDataFormatCommands dataFormats={scope.outputFormats ?? []} onCreateDataFormat={scope.createDescriptionDataFormat} onChange={(nextValue) => scope.setSubtaskDescriptionDraft?.(nextValue)} onCommit={() => { void scope.saveSubtaskDetail?.({ finalize: true }) }} onCancel={() => scope.resetSubtaskDescriptionDraft?.()} />
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.tabRow}>
            {[[ 'agent', LuBot, 'Agent' ], [ 'skills', LuSparkles, 'Skills' ], [ 'comments', LuMessageSquare, `Comments ${comments.length}` ], [ 'customFields', LuSlidersHorizontal, 'Custom fields' ], [ 'checklist', LuListChecks, 'Checklist' ], [ 'attachments', LuPaperclip, 'Attachments' ]].map(([tab, Icon, label]: any) => <button key={tab} type="button" className={detailTab === tab ? styles.tabActive : styles.tabBtn} onClick={() => selectTab(tab)}><Icon size={15} />{label}</button>)}
          </div>
          {detailTab === 'agent' ? <><div className={styles.detailSectionHeader}><div><h4>Agent</h4><p>{scope.selectedSubtaskAgent?.name ?? 'Unassigned'}</p></div></div><AgentAssignmentPanel agent={scope.selectedSubtaskAgent} agents={scope.agents ?? []} ctaDescription="Choose the agent responsible for this subtask." onChange={scope.setSubtaskAgent} /></> : null}
          {detailTab === 'skills' ? <><div className={styles.detailSectionHeader}><div><h4>Skills</h4><p>{(scope.selectedSubtaskSkillOptions ?? []).length} selected</p></div></div><SkillsAssignmentPanel selectedSkills={scope.selectedSubtaskSkills ?? []} skills={scope.skills ?? []} source="Subtask" ctaDescription="Select one or more skills needed for this subtask." onChange={scope.setSubtaskSkills} /></> : null}
          {detailTab === 'comments' ? <CommentsPane inline scope={{ ...scope, comments }} /> : null}
          {detailTab === 'customFields' ? <><div className={styles.detailSectionHeader}><div><h4>Custom fields</h4><p>{(scope.assignedSubtaskCustomFieldValues ?? []).length} assigned</p></div></div><div className={styles.tabCtaCard}><div><strong>Add custom field</strong><span>Attach a field value to this subtask.</span></div><button type="button" className={styles.tabActionButton} onClick={scope.openCustomFieldModal}><LuPlus size={15} />Add custom field</button></div><CustomFieldsList scope={scope} values={scope.assignedSubtaskCustomFieldValues ?? []} /></> : null}
          {detailTab === 'checklist' ? <><div className={styles.detailSectionHeader}><div><h4>Checklist</h4><p>{checklistItems.filter((item: any) => item.checked).length} checked / {checklistItems.length} total</p></div></div><ChecklistPanel items={checklistItems} emptyLabel="No checklist items on this subtask." onAdd={() => scope.openChecklistModal?.()} onToggle={(itemId) => scope.toggleSubtaskChecklistItem?.(itemId)} onRemove={(itemId) => scope.removeSubtaskChecklistItem?.(itemId)} /></> : null}
          {detailTab === 'attachments' ? <><div className={styles.detailSectionHeader}><div><h4>Attachments</h4><p>{(scope.subtaskAttachmentRows ?? []).length} files</p></div></div><AttachmentTable rows={scope.subtaskAttachmentRows ?? []} uploading={scope.isAttachmentUploading} onUpload={(files) => void scope.uploadSubtaskAttachments(files)} onRemove={(row) => void scope.removeSubtaskAttachment(row)} onError={scope.setError} /></> : null}
        </section>
      </div>
      {!isCompactLayout ? <CommentsPane scope={scope} /> : null}
    </div>
  )
}

function TaskDetailLoadingState({ error }: { error?: string | null }) {
  return (
    <div className={styles.popupFallback}>
      {error ? (
        <>
          <strong>Task detail could not be loaded.</strong>
          <span>{error}</span>
        </>
      ) : (
        <>
          <strong>Task detail yukleniyor.</strong>
          <span>Guncel task verisi API'den aliniyor.</span>
        </>
      )}
    </div>
  )
}

export function TaskDetailPopup({
  taskId,
  children,
  scope,
  onClose,
  onDeleteTask,
  onEditTitle,
  onOpenChat,
  title = 'Task detail',
  nested = false,
  hideTaskActions = false,
  onFilesDrop,
  onDownloadZip,
  onDownloadTaskMarkdown,
  onDownloadTaskJson,
  onExportTaskJson,
  onDownloadTaskToon,
  onDownloadAgentMarkdown,
  onDownloadSkillsMarkdown,
  onRunGateway,
  isRunGatewayBusy = false,
  isRunGatewayDisabled = false,
  onStopRunGateway,
  isRunGatewayRunning = false,
  onPlanWithGateway,
  isPlanWithGatewayBusy = false,
  isPlanWithGatewayDisabled = false,
  onStopPlanGateway,
  isPlanWithGatewayRunning = false,
  isStopGatewayBusy = false,
  onImportJson
}: TaskDetailPopupProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const downloadMenuRef = useRef<HTMLDivElement | null>(null)
  const dragDepthRef = useRef(0)
  const hasDownloadActions = Boolean(onDownloadZip || onDownloadTaskMarkdown || onDownloadTaskJson || onDownloadTaskToon || onDownloadAgentMarkdown || onDownloadSkillsMarkdown)

  useEffect(() => lockModalInteractionRegion(), [])

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

  const copyTaskId = () => { void navigator.clipboard?.writeText(taskId); setIsMenuOpen(false) }
  const copyTaskLink = () => { const url = new URL(window.location.href); url.searchParams.set('task', taskId); void navigator.clipboard?.writeText(url.toString()); setIsMenuOpen(false) }
  const runHeaderAction = (event: PointerEvent<HTMLButtonElement>, action: () => void) => { event.preventDefault(); event.stopPropagation(); action() }
  const bodyScope = scope ? {
    ...scope,
    onOpenChat,
    onRunGateway,
    isRunGatewayBusy,
    isRunGatewayDisabled,
    onStopRunGateway,
    isRunGatewayRunning,
    onPlanWithGateway,
    isPlanWithGatewayBusy,
    isPlanWithGatewayDisabled,
    onStopPlanGateway,
    isPlanWithGatewayRunning,
    isStopGatewayBusy
  } : null
  const taskDetailError = bodyScope?.taskDetailError
  const isTaskDetailPending = Boolean(bodyScope?.isTaskDetailLoading || (bodyScope && !bodyScope.selectedTask))

  const actions = (
    <>
      {!hideTaskActions ? (
        <>
          <div className={styles.secondaryHeaderActions}>
            {onImportJson ? (
              <button type="button" className={`${styles.iconButton} ${styles.labeledActionButton} ${styles.importButton}`} onPointerDown={(event) => runHeaderAction(event, onImportJson)} aria-label="Import JSON">
                <LuUpload size={16} />
                <span className={styles.actionButtonLabel}>Import</span>
              </button>
            ) : null}
            {onExportTaskJson ? (
              <button type="button" className={`${styles.iconButton} ${styles.labeledActionButton} ${styles.exportButton}`} onPointerDown={(event) => runHeaderAction(event, onExportTaskJson)} aria-label="Export JSON">
                <LuDownload size={16} />
                <span className={styles.actionButtonLabel}>Export</span>
              </button>
            ) : null}
            {hasDownloadActions ? (
              <div className={styles.menuWrap} ref={downloadMenuRef}>
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.labeledActionButton} ${styles.downloadButton} ${isDownloadMenuOpen ? styles.iconButtonActive : ''}`}
                  onPointerDown={(event) => runHeaderAction(event, () => {
                    setIsMenuOpen(false)
                    setIsDownloadMenuOpen((value) => !value)
                  })}
                  aria-label="Download task"
                >
                  <LuDownload size={17} />
                  <span className={styles.actionButtonLabel}>Download</span>
                </button>
                {isDownloadMenuOpen ? (
                  <div className={styles.menu} role="menu">
                    {onDownloadZip ? <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadZip() }}><LuDownload size={15} /> Download ZIP</button> : null}
                    {onDownloadTaskMarkdown ? <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadTaskMarkdown() }}><LuFileText size={15} /> Download Task.md</button> : null}
                    {onDownloadTaskJson ? <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadTaskJson() }}><LuFileText size={15} /> Download Task.json</button> : null}
                    {onDownloadTaskToon ? <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadTaskToon() }}><LuFileText size={15} /> Download Task.toon</button> : null}
                    {onDownloadAgentMarkdown ? <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadAgentMarkdown() }}><LuFileText size={15} /> Download Agents.md</button> : null}
                    {onDownloadSkillsMarkdown ? <button type="button" onClick={() => { setIsDownloadMenuOpen(false); onDownloadSkillsMarkdown() }}><LuFileText size={15} /> Download Skills.md</button> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className={styles.primaryActions}>
            {isPlanWithGatewayRunning && onStopPlanGateway ? (
              <button type="button" className={`${styles.iconButton} ${styles.primaryActionButton} ${styles.stopButton}`} onPointerDown={(event) => runHeaderAction(event, () => { if (!isStopGatewayBusy) onStopPlanGateway() })} disabled={isStopGatewayBusy} aria-label="Planlamayı duraklat" title="Çalışan planlamayı duraklat">
                <LuSquare size={15} />
                <span className={styles.primaryActionLabel}>Duraklat</span>
              </button>
            ) : null}
            {onPlanWithGateway ? (
              <button type="button" className={`${styles.iconButton} ${styles.primaryActionButton} ${styles.planButton}`} onPointerDown={(event) => runHeaderAction(event, () => { if (!isPlanWithGatewayBusy && !isPlanWithGatewayDisabled) onPlanWithGateway() })} disabled={isPlanWithGatewayBusy || isPlanWithGatewayDisabled} aria-label="Taskı planla" title={isPlanWithGatewayDisabled ? 'Bu taskı planlamak için önce Codex gateway ve model ayarlarını yapılandır.' : 'Task için uygulanabilir plan oluştur'}>
                <LuSparkles size={16} />
                <span className={styles.primaryActionLabel}>Planla</span>
              </button>
            ) : null}
            {isRunGatewayRunning && onStopRunGateway ? (
              <button type="button" className={`${styles.iconButton} ${styles.primaryActionButton} ${styles.stopButton}`} onPointerDown={(event) => runHeaderAction(event, () => { if (!isStopGatewayBusy) onStopRunGateway() })} disabled={isStopGatewayBusy} aria-label="Çalıştırmayı duraklat" title="Çalışan task akışını duraklat">
                <LuSquare size={15} />
                <span className={styles.primaryActionLabel}>Duraklat</span>
              </button>
            ) : null}
            {onRunGateway ? (
              <button type="button" className={`${styles.iconButton} ${styles.primaryActionButton} ${styles.runButton}`} onPointerDown={(event) => runHeaderAction(event, () => { if (!isRunGatewayBusy && !isRunGatewayDisabled) onRunGateway() })} disabled={isRunGatewayBusy || isRunGatewayDisabled} aria-label="Taskı çalıştır" title={isRunGatewayDisabled ? 'Bu taskı çalıştırmak için önce Codex gateway ve model ayarlarını yapılandır.' : 'Planlanan taskı çalıştır'}>
                <LuPlay size={16} />
                <span className={styles.primaryActionLabel}>Çalıştır</span>
              </button>
            ) : null}
            <button type="button" className={`${styles.iconButton} ${styles.primaryActionButton} ${styles.taskDetailOpenChatButton}`} onPointerDown={(event) => runHeaderAction(event, onOpenChat)} aria-label="Open chat">
              <LuMessageSquare size={16} />
              <span className={styles.primaryActionLabel}>Chat</span>
            </button>
          </div>
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              type="button"
              className={`${styles.iconButton} ${styles.optionsButton} ${isMenuOpen ? styles.iconButtonActive : ''}`}
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
                {onImportJson ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onImportJson() }}><LuUpload size={15} /> Import JSON</button> : null}
                {onExportTaskJson ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onExportTaskJson() }}><LuDownload size={15} /> Export JSON</button> : null}
                {onDownloadZip ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onDownloadZip() }}><LuDownload size={15} /> Download ZIP</button> : null}
                {onDownloadTaskMarkdown ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onDownloadTaskMarkdown() }}><LuFileText size={15} /> Download Task.md</button> : null}
                {onDownloadTaskJson ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onDownloadTaskJson() }}><LuFileText size={15} /> Download Task.json</button> : null}
                {onDownloadTaskToon ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onDownloadTaskToon() }}><LuFileText size={15} /> Download Task.toon</button> : null}
                {onDownloadAgentMarkdown ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onDownloadAgentMarkdown() }}><LuFileText size={15} /> Download Agents.md</button> : null}
                {onDownloadSkillsMarkdown ? <button type="button" className={styles.mobileMenuOnly} onClick={() => { setIsMenuOpen(false); onDownloadSkillsMarkdown() }}><LuFileText size={15} /> Download Skills.md</button> : null}
                <button type="button" onClick={copyTaskLink}><LuExternalLink size={15} /> Copy link</button>
                <button type="button" onClick={copyTaskId}><LuCopy size={15} /> Copy task ID</button>
                <button type="button" onClick={() => { setIsMenuOpen(false); onEditTitle() }}><LuPencil size={15} /> Edit title</button>
                <button type="button" onClick={() => { setIsMenuOpen(false); onOpenChat() }}><LuMessageSquare size={15} /> Open chat</button>
                <button type="button" className={styles.dangerAction} onClick={() => { setIsMenuOpen(false); onDeleteTask() }}><LuTrash2 size={15} /> Delete task</button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      <button type="button" className={styles.iconButton} onPointerDown={(event) => runHeaderAction(event, onClose)} aria-label="Close task modal">
        <LuX size={18} />
      </button>
    </>
  )

  return <><div className={`${styles.backdrop} ${nested ? styles.nestedBackdrop : ''}`} onClick={onClose} /><section className={`${styles.shell} ${nested ? styles.nestedShell : ''}`} role="dialog" aria-modal="true" aria-label={title} onDragEnter={(event: DragEvent<HTMLElement>) => { if (!onFilesDrop || !Array.from(event.dataTransfer.types).includes('Files')) return; event.preventDefault(); dragDepthRef.current += 1; setIsDraggingFiles(true) }} onDragOver={(event) => { if (!onFilesDrop) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDragLeave={(event) => { if (!onFilesDrop) return; event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) setIsDraggingFiles(false) }} onDrop={(event) => { if (!onFilesDrop) return; event.preventDefault(); dragDepthRef.current = 0; setIsDraggingFiles(false); const files = Array.from(event.dataTransfer.files ?? []); if (files.length > 0) onFilesDrop(files) }}>{isDraggingFiles ? <div className={styles.dropOverlay}>Drop files here</div> : null}<header className={styles.header}><div className={styles.headerLeft}><span className={styles.headerTitle}>{title}</span></div><div className={styles.headerActions}>{actions}</div></header><TaskDetailPopupBoundary onClose={onClose}>{bodyScope ? taskDetailError || isTaskDetailPending ? <TaskDetailLoadingState error={taskDetailError} /> : bodyScope.variant === 'subtask' ? <SubtaskDetailBody scope={bodyScope} /> : <TaskDetailBody scope={bodyScope} /> : children}</TaskDetailPopupBoundary></section></>
}
