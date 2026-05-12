import type { PipelineStatusSnapshot } from '@shared/types/entities'

export type PipelineStatusLiveEventTone = 'info' | 'success' | 'warning' | 'danger'

export function snapshotSignature(snapshot: PipelineStatusSnapshot | null): Map<string, string> {
  const values = new Map<string, string>()
  if (!snapshot) return values
  for (const item of snapshot.statusItems ?? []) {
    values.set(`status-item:${item.id}`, `${item.source}:${item.phase}:${item.status}:${item.updatedAt}:${item.progress ?? ''}:${item.progressText ?? ''}:${item.error ?? ''}`)
  }
  for (const task of snapshot.taskSummaries) {
    values.set(`task:${task.id}`, `${task.status}:${task.title}:${task.projectName ?? ''}:${task.updatedAt}:${task.activityStatus ?? ''}:${task.activityPhase ?? ''}:${task.lastActivityAt ?? ''}`)
  }
  for (const task of snapshot.activeTasks ?? []) {
    values.set(`active-task:${task.id}`, `${task.status}:${task.title}:${task.activityStatus ?? ''}:${task.activityPhase ?? ''}:${task.lastActivityAt ?? task.updatedAt}`)
  }
  for (const batch of snapshot.planBatches) {
    values.set(`plan:${batch.id}`, `${batch.status}:${batch.updatedAt}:${batch.linkedRunPipelineId ?? ''}`)
  }
  for (const record of snapshot.planRecords) {
    values.set(`plan-record:${record.id}`, `${record.status}:${record.progress}:${record.updatedAt}:${record.lastError ?? ''}`)
  }
  for (const pipeline of snapshot.pipelines) {
    values.set(`run:${pipeline.batch.id}`, `${pipeline.batch.status}:${pipeline.batch.progress}:${pipeline.batch.updatedAt}:${pipeline.batch.currentItemId ?? ''}`)
    for (const item of pipeline.items) {
      values.set(`run-item:${item.id}`, `${item.status}:${item.progress}:${item.updatedAt}:${item.lastError ?? ''}`)
    }
  }
  return values
}

export function changedKeys(previous: PipelineStatusSnapshot | null, next: PipelineStatusSnapshot): Set<string> {
  const before = snapshotSignature(previous)
  const after = snapshotSignature(next)
  const changed = new Set<string>()
  for (const [key, value] of after.entries()) {
    if (!before.has(key) || before.get(key) !== value) changed.add(key)
  }
  for (const key of before.keys()) {
    if (!after.has(key)) changed.add(key)
  }
  return changed
}

export function strongestChangedTone(snapshot: PipelineStatusSnapshot, keys: Set<string>): PipelineStatusLiveEventTone {
  for (const item of snapshot.statusItems ?? []) {
    if (!keys.has(`status-item:${item.id}`)) continue
    if (item.status === 'failed' || item.status === 'blocked' || item.status === 'cancelled') return 'danger'
    if (item.status === 'completed' || item.status === 'skipped') return 'success'
  }
  for (const pipeline of snapshot.pipelines) {
    if (keys.has(`run:${pipeline.batch.id}`) && ['failed', 'blocked', 'cancelled'].includes(pipeline.batch.status)) return 'danger'
    if (keys.has(`run:${pipeline.batch.id}`) && pipeline.batch.status === 'completed') return 'success'
    for (const item of pipeline.items) {
      if (keys.has(`run-item:${item.id}`) && ['failed', 'blocked'].includes(item.status)) return 'danger'
      if (keys.has(`run-item:${item.id}`) && item.status === 'completed') return 'success'
    }
  }
  for (const record of snapshot.planRecords) {
    if (keys.has(`plan-record:${record.id}`) && ['failed', 'blocked', 'cancelled'].includes(record.status)) return 'danger'
    if (keys.has(`plan-record:${record.id}`) && record.status === 'completed') return 'success'
  }
  for (const task of snapshot.activeTasks ?? []) {
    if (keys.has(`active-task:${task.id}`) && task.activityStatus === 'failed') return 'danger'
    if (keys.has(`active-task:${task.id}`) && task.activityStatus === 'completed') return 'success'
  }
  return 'info'
}

export function pipelineStatusEventText(payload: unknown): { label: string; detail: string } {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  const reason = typeof record.reason === 'string' ? record.reason : ''
  const action = typeof record.action === 'string' ? record.action : ''
  const phase = typeof record.phase === 'string' ? record.phase : ''
  if (reason === 'task_activity') {
    const phaseText = phase === 'post-running' ? 'Post-run' : phase === 'follow-up' ? 'Follow-up' : phase ? `${phase[0]?.toUpperCase()}${phase.slice(1)}` : ''
    const actionText = action ? action.replace(/_/g, ' ') : ''
    return { label: 'Task activity', detail: actionText ? `${phaseText ? `${phaseText} ` : ''}${actionText}` : 'Task activity changed' }
  }
  if (reason === 'task_updated') return { label: 'Task update', detail: action ? `Task ${action.replace(/_/g, ' ')}` : 'Task changed' }
  if (reason === 'plan_pipeline') return { label: 'Plan pipeline', detail: 'Plan status changed' }
  if (reason === 'run_pipeline') return { label: 'Run pipeline', detail: 'Execution status changed' }
  return { label: 'Pipeline status', detail: 'Status changed' }
}
