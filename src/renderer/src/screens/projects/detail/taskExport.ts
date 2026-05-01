import { strToU8, zipSync } from 'fflate'
import type { Agent, CustomField, Project, ProjectGroup, ProjectStatus, Skill, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskEntity, TaskSubtask } from '@shared/types/entities'

type ExportContext = {
  task: TaskEntity
  project?: Project | null
  projectGroup?: ProjectGroup | null
  agents: Agent[]
  skills: Skill[]
  tags: Tag[]
  customFields: CustomField[]
  projectStatuses?: ProjectStatus[]
}

type ZipInput = Record<string, Uint8Array>
type AttachmentExportStatus = {
  path: string
  name: string
  status: 'included' | 'linked' | 'unavailable'
  url: string
  ownerId?: string
  source?: string
}

type SubtaskExportStatusMap = Record<string, AttachmentExportStatus[]>
export type ProjectWorkspaceExportTaskPayload = {
  taskId: string
  taskMarkdown: string
  agentMarkdown: string
  skillsMarkdown: string
  attachments: Array<TaskAttachment & { ownerId: string; exportName: string }>
}

const SECTION_SEPARATOR = '\n\n-----\n\n'

function safeName(value: string, fallback = 'item'): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
  return normalized || fallback
}

function shortHash(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8)
}

function getPayload(value: { payload?: Record<string, unknown> } | null | undefined): Record<string, unknown> {
  return value?.payload && typeof value.payload === 'object' && !Array.isArray(value.payload) ? value.payload : {}
}

function getPayloadList<T>(payload: Record<string, unknown>, key: string): T[] {
  const value = payload[key]
  return Array.isArray(value) ? value as T[] : []
}

function getSubtaskDescription(subtask: TaskSubtask): string {
  const payload = getPayload(subtask)
  return typeof payload.description === 'string' ? payload.description : subtask.description ?? ''
}

function getSubtaskAttachments(subtask: TaskSubtask): TaskAttachment[] {
  return getPayloadList<TaskAttachment>(getPayload(subtask), 'attachments')
}

function getSubtaskChecklist(subtask: TaskSubtask): TaskChecklistItem[] {
  return getPayloadList<TaskChecklistItem>(getPayload(subtask), 'checklistItems')
}

function getSubtaskComments(subtask: TaskSubtask): TaskComment[] {
  return getPayloadList<TaskComment>(getPayload(subtask), 'comments')
}

function getSubtaskTagIds(subtask: TaskSubtask): string[] {
  return getPayloadList<string>(getPayload(subtask), 'tagIds')
}

function getSubtaskSkillIds(subtask: TaskSubtask): string[] {
  return getPayloadList<string>(getPayload(subtask), 'skillIds')
}

function getSubtaskAgentId(subtask: TaskSubtask): string {
  const payload = getPayload(subtask)
  if (typeof payload.agentId === 'string' && payload.agentId.trim()) return payload.agentId
  if (typeof payload.assigneeId === 'string' && payload.assigneeId.trim()) return payload.assigneeId
  return subtask.assigneeId ?? ''
}

function getTaskAttachments(task: TaskEntity): TaskAttachment[] {
  return getPayloadList<TaskAttachment>(getPayload(task), 'attachments')
}

function formatInlineValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function hasExportValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function formatDate(value?: number): string {
  return value ? new Date(value).toLocaleString() : '-'
}

function anchorFor(prefix: string, value: string) {
  return `${prefix}-${safeName(value, 'item').toLowerCase()}`
}

function subtaskLabel(subtask: TaskSubtask, index: number): string {
  return `Subtask ${index + 1}: ${subtask.title}`
}

function subtaskAnchor(subtask: TaskSubtask, index: number): string {
  return `subtask-${index + 1}-${safeName(subtask.title, 'subtask').toLowerCase()}`
}

function markdownCell(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function humanizeStatus(value: string | undefined, statuses?: ProjectStatus[]): string {
  if (!value) return '-'
  const status = statuses?.find((item) => item.id === value)
  if (status) return status.name
  const likelyId = /^[0-9a-f-]{16,}$/i.test(value) || value.length > 24
  if (likelyId) return 'Missing status metadata'
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function subtaskStatusAction(subtask: TaskSubtask, statuses?: ProjectStatus[]): { label: string; shouldBypass: boolean; action: string } {
  const label = humanizeStatus(subtask.status, statuses)
  const status = statuses?.find((item) => item.id === subtask.status)
  const normalized = `${status?.category ?? ''} ${label} ${subtask.status ?? ''}`.toLowerCase()
  const shouldBypass = status?.category === 'done'
    || status?.category === 'closed'
    || /\b(done|closed|complete|completed)\b|tamamland|kapat[ıi]ld/.test(normalized)
  return {
    label,
    shouldBypass,
    action: shouldBypass ? `Bypass - status is ${label}` : 'Process'
  }
}

function agentDescription(agent: Agent): string {
  const candidate = (agent as { description?: unknown }).description ?? agent.config?.description
  return typeof candidate === 'string' ? candidate : ''
}

function agentPrompt(agent: Agent): string {
  return agent.trainingMarkdown?.trim() ?? ''
}

function stepPrompt(step: { prompt?: unknown }): string {
  return typeof step.prompt === 'string' ? step.prompt.trim() : ''
}

function agentExtraConfig(agent: Agent): Record<string, unknown> {
  const config = agent.config && typeof agent.config === 'object' ? { ...agent.config } : {}
  delete config.title
  delete config.description
  delete config.trainingMarkdown
  delete config.steps
  delete config.reasoningLevel
  return config
}

function commentsMarkdown(comments: TaskComment[]): string {
  return comments
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((comment, index) => {
      const metadata = [
        `- Author: ${comment.authorName || 'Operator'}`,
        `- Created: ${formatDate(comment.createdAt)}`,
        comment.updatedAt ? `- Updated: ${formatDate(comment.updatedAt)}` : ''
      ].filter(Boolean).join('\n')
      return `### Comment ${index + 1}\n${metadata}\n\n${comment.body.trim()}`
    })
    .join('\n\n')
}

function checklistMarkdown(items: TaskChecklistItem[] | undefined): string {
  if (!items?.length) return ''
  return items.map((item) => `- [${item.checked ? 'x' : ' '}] ${item.title}`).join('\n')
}

function tagsMarkdown(tagIds: string[], tags: Tag[]): string {
  const names = tagIds.map((id) => tags.find((tag) => tag.id === id)?.name ?? id).filter(Boolean)
  return names.map((name) => `\`${name}\``).join(', ')
}

function tagDetailsMarkdown(tagIds: string[], tags: Tag[]): string {
  const rows = tagIds.map((id) => {
    const tag = tags.find((item) => item.id === id)
    if (!tag) return `| ${markdownCell(id)} | missing metadata | Missing tag metadata |`
    return `| ${markdownCell(tag.name)} | ${markdownCell(tag.color)} | ${markdownCell(tag.description || '-')} |`
  })
  return ['| Name | Color | Description |', '| --- | --- | --- |', ...rows].join('\n')
}

function customFieldsMarkdown(values: Record<string, unknown> | undefined, fields: CustomField[]): string {
  const normalizedValues = values && typeof values === 'object' && !Array.isArray(values) ? values : {}
  const rows = fields
    .filter((field) => hasExportValue(normalizedValues[field.id]))
    .map((field) => `| ${markdownCell(field.name)} | ${markdownCell(field.type)} | ${markdownCell(formatInlineValue(normalizedValues[field.id]))} | ${markdownCell(formatInlineValue(field.defaultValue))} | ${markdownCell(field.description || '-')} |`)
  const knownIds = new Set(fields.map((field) => field.id))
  for (const [fieldId, value] of Object.entries(normalizedValues)) {
    if (knownIds.has(fieldId)) continue
    if (!hasExportValue(value)) continue
    rows.push(`| ${markdownCell(fieldId)} | missing metadata | ${markdownCell(formatInlineValue(value))} | - | Missing custom field metadata |`)
  }
  if (!rows.length) return ''
  return ['| Field | Type | Value | Default | Description |', '| --- | --- | --- | --- | --- |', ...rows].join('\n')
}

function attachmentsMarkdown(attachments: TaskAttachment[], source: string, statuses: AttachmentExportStatus[] = []): string {
  if (!attachments.length) return ''
  const rows = attachments.map((attachment) => {
    const status = statuses.find((item) => item.url === attachment.url)
    const path = status ? `${status.path}/${status.name}` : attachment.url
    return `| ${markdownCell(source)} | ${markdownCell(attachment.name)} | ${markdownCell(attachment.type || 'file')} | ${markdownCell(attachment.size || 0)} | ${markdownCell(status?.status ?? 'linked')} | ${markdownCell(path)} |`
  })
  return ['| Source | Name | Type | Size bytes | Export status | Path |', '| --- | --- | --- | ---: | --- | --- |', ...rows].join('\n')
}

function attachmentFolderMarkdown(statuses: AttachmentExportStatus[]): string {
  if (!statuses.length) return ''
  const rows = statuses.map((item) => `| ${markdownCell(item.source ?? item.ownerId ?? 'Attachment')} | ${markdownCell(item.name)} | ${markdownCell(item.status)} | ${markdownCell(`${item.path}/${item.name}`)} |`)
  return ['Attachment folder: `attachments/`', '', '| Source | File | Status | Markdown path |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

function agentReferencesMarkdown(task: TaskEntity, agents: Agent[]): string {
  const rows: string[] = []
  if (task.agentId) {
    const agent = agents.find((item) => item.id === task.agentId)
    const target = agent ? `Agents.md#${anchorFor('agent', agent.id)}` : 'missing metadata'
    rows.push(`| Task | ${markdownCell(agent?.name ?? task.agentId)} | ${markdownCell(agent?.title ?? '-')} | ${markdownCell(agent ? agentDescription(agent) || '-' : 'missing metadata')} | ${markdownCell(agent && agentPrompt(agent) ? `See ${target}` : '-')} | ${markdownCell(task.title)} | ${markdownCell(target)} |`)
  }
  for (const [index, subtask] of (task.subtasks ?? []).entries()) {
    const agentId = getSubtaskAgentId(subtask)
    if (!agentId) continue
    const agent = agents.find((item) => item.id === agentId)
    const target = agent ? `Agents.md#${anchorFor('agent', agent.id)}` : 'missing metadata'
    rows.push(`| ${markdownCell(subtaskLabel(subtask, index))} | ${markdownCell(agent?.name ?? agentId)} | ${markdownCell(agent?.title ?? '-')} | ${markdownCell(agent ? agentDescription(agent) || '-' : 'missing metadata')} | ${markdownCell(agent && agentPrompt(agent) ? `See ${target}` : '-')} | ${markdownCell(subtaskLabel(subtask, index))} | ${markdownCell(target)} |`)
  }
  if (!rows.length) return ''
  return ['| Source | Agent | Title | Description | Prompt | Used in | Details |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n')
}

function skillReferencesMarkdown(task: TaskEntity, skills: Skill[]): string {
  const rows: string[] = []
  for (const skill of task.skills ?? []) {
    rows.push(`| Task | ${markdownCell(skill.name)} | ${markdownCell(task.title)} | ${markdownCell(`Skills.md#${anchorFor('skill', skill.id)}`)} |`)
  }
  for (const [index, subtask] of (task.subtasks ?? []).entries()) {
    for (const skillId of getSubtaskSkillIds(subtask)) {
      const skill = skills.find((item) => item.id === skillId)
      rows.push(`| ${markdownCell(subtaskLabel(subtask, index))} | ${markdownCell(skill?.name ?? skillId)} | ${markdownCell(subtaskLabel(subtask, index))} | ${markdownCell(skill ? `Skills.md#${anchorFor('skill', skill.id)}` : 'missing metadata')} |`)
    }
  }
  if (!rows.length) return ''
  return ['| Source | Skill | Used in | Details |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

function pushSection(sections: string[], title: string, body: string | undefined | null, level = 2) {
  const normalized = body?.trim()
  if (!normalized) return
  sections.push(`${'#'.repeat(level)} ${title}\n${normalized}`)
}

function flowBox(lines: string[]): string[] {
  const width = Math.max(14, ...lines.map((line) => line.length)) + 2
  return [
    `┌${'─'.repeat(width)}┐`,
    ...lines.map((line) => `│ ${line.padEnd(width - 1)}│`),
    `└${'─'.repeat(width)}┘`
  ]
}

function flowConnector(): string[] {
  return ['       │', '       v']
}

function taskHasMetadata(task: TaskEntity): boolean {
  return Boolean(
    (task.tags ?? []).length
    || Object.keys(task.customFieldValues ?? {}).length
    || (task.checklistItems ?? []).length
    || (task.comments ?? []).length
  )
}

function subtaskFlowLabels(subtask: TaskSubtask): string[] {
  const payload = getPayload(subtask)
  const labels: string[] = []
  if (getSubtaskDescription(subtask).trim()) labels.push('prompt')
  if (getSubtaskComments(subtask).length) labels.push('comments')
  if (payload.customFields && typeof payload.customFields === 'object' && Object.keys(payload.customFields as Record<string, unknown>).length) labels.push('custom fields')
  if (getSubtaskChecklist(subtask).length) labels.push('checklist')
  if (getSubtaskAttachments(subtask).length) labels.push('attachments')
  if (getSubtaskAgentId(subtask)) labels.push('agent')
  if (getSubtaskSkillIds(subtask).length) labels.push('skills')
  return labels
}

function buildAiExecutionFlow(context: ExportContext): string {
  const { task } = context
  const subtasks = task.subtasks ?? []
  const actionableSubtasks = subtasks.filter((subtask) => !subtaskStatusAction(subtask, context.projectStatuses).shouldBypass)
  const bypassedSubtasks = subtasks.length - actionableSubtasks.length
  const taskAttachments = getTaskAttachments(task)
  const subtaskAttachments = subtasks.flatMap(getSubtaskAttachments)
  const hasProjectRules = Boolean(
    context.project?.generalContext?.trim()
    || context.project?.generalPrompt?.trim()
    || context.project?.defaultOutput?.trim()
    || context.project?.description?.trim()
    || context.projectGroup?.description?.trim()
  )
  const hasAgentReferences = Boolean(task.agentId || subtasks.some((subtask) => getSubtaskAgentId(subtask)))
  const hasSkillReferences = Boolean((task.skills ?? []).length || subtasks.some((subtask) => getSubtaskSkillIds(subtask).length))
  const hasAttachments = taskAttachments.length + subtaskAttachments.length > 0
  const nodes: string[][] = [
    ['START'],
    ['Read Project Inputs']
  ]

  if (hasProjectRules) nodes.push(['Apply Project Rules', 'context + prompt + output'])
  nodes.push(['Read Task Details', 'title + description/prompt'])
  if (taskHasMetadata(task)) nodes.push(['Read Task Metadata', 'tags + fields + comments'])
  if (hasAttachments) nodes.push(['Use Attachment Folder', 'attachments/ + manifest'])
  if (hasAgentReferences) nodes.push(['Load Agents.md', 'agent prompts + steps'])
  if (hasSkillReferences) nodes.push(['Load Skills.md', 'skill instructions'])
  if (subtasks.length) {
    const subtaskLabels = Array.from(new Set(actionableSubtasks.flatMap(subtaskFlowLabels)))
    nodes.push([
      actionableSubtasks.length
        ? `Process ${actionableSubtasks.length} Subtask${actionableSubtasks.length === 1 ? '' : 's'}`
        : 'Process 0 Subtasks',
      bypassedSubtasks ? `bypass ${bypassedSubtasks} done/closed` : 'in numeric order',
      subtaskLabels.length ? subtaskLabels.join(' + ') : 'title + status'
    ])
  }
  nodes.push(['Execute Task'])
  nodes.push(['Finalize Output'])

  const diagram = nodes.flatMap((node, index) => [
    ...flowBox(node),
    ...(index < nodes.length - 1 ? flowConnector() : [])
  ]).join('\n')

  return [
    '```text',
    diagram,
    '```',
    '',
    'Execution rule: Follow this flow top-to-bottom. Process subtasks strictly in numeric order from the Subtasks Index. Bypass subtasks marked Done or Closed. Skip nodes that are absent from this file/package.'
  ].join('\n')
}

function buildDetailsMarkdown(rows: Array<[string, unknown]>, description?: string, promptLevel = 3, promptTitle = 'Description / Prompt'): string {
  const table = [
    '| Field | Value |',
    '| --- | --- |',
    ...rows
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value]) => `| ${markdownCell(label)} | ${markdownCell(formatInlineValue(value))} |`)
  ].join('\n')
  const prompt = description?.trim() ? `\n\n${'#'.repeat(promptLevel)} ${promptTitle}\n${description.trim()}` : ''
  return `${table}${prompt}`
}

function buildSubtaskSection(subtask: TaskSubtask, index: number, context: ExportContext, exportStatuses: AttachmentExportStatus[] = []): string {
  const payload = getPayload(subtask)
  const tagIds = getSubtaskTagIds(subtask)
  const attachments = getSubtaskAttachments(subtask)
  const label = subtaskLabel(subtask, index)
  const statusAction = subtaskStatusAction(subtask, context.projectStatuses)
  const details = buildDetailsMarkdown([
    ['Subtask number', index + 1],
    ['Subtask title', subtask.title],
    ['Parent task', context.task.title],
    ['Status', statusAction.label],
    ['AI action', statusAction.action],
    ['Tags', tagIds.length ? tagsMarkdown(tagIds, context.tags) : 'None'],
    ['Created', formatDate(subtask.createdAt)],
    ['Updated', formatDate(subtask.updatedAt)]
  ], getSubtaskDescription(subtask), 4, 'Subtask Description / Prompt')
  const sections = [`## ${label} - Status: ${statusAction.label}\n<a id="${subtaskAnchor(subtask, index)}"></a>\n\n### Subtask Details\n${details}`]
  if (tagIds.length) pushSection(sections, 'Tags', tagDetailsMarkdown(tagIds, context.tags), 3)
  pushSection(sections, 'Comments', commentsMarkdown(getSubtaskComments(subtask)), 3)
  pushSection(sections, 'Custom Fields', customFieldsMarkdown(payload.customFields as Record<string, unknown> | undefined, context.customFields), 3)
  pushSection(sections, 'Checklist', checklistMarkdown(getSubtaskChecklist(subtask)), 3)
  pushSection(sections, 'Attachments Manifest', attachmentsMarkdown(attachments, label, exportStatuses), 3)
  const subtaskAgentId = getSubtaskAgentId(subtask)
  if (subtaskAgentId) {
    const agent = context.agents.find((item) => item.id === subtaskAgentId)
    const target = agent ? `Agents.md#${anchorFor('agent', agent.id)}` : 'missing metadata'
    pushSection(sections, 'Agent References', `| Source | Agent | Title | Description | Prompt | Used in | Details |\n| --- | --- | --- | --- | --- | --- | --- |\n| ${markdownCell(label)} | ${markdownCell(agent?.name ?? subtaskAgentId)} | ${markdownCell(agent?.title ?? '-')} | ${markdownCell(agent ? agentDescription(agent) || '-' : 'missing metadata')} | ${markdownCell(agent && agentPrompt(agent) ? `See ${target}` : '-')} | ${markdownCell(label)} | ${markdownCell(target)} |`, 3)
  }
  const subtaskSkillIds = getSubtaskSkillIds(subtask)
  if (subtaskSkillIds.length) {
    pushSection(sections, 'Skill References', [
      '| Source | Skill | Used in | Details |',
      '| --- | --- | --- | --- |',
      ...subtaskSkillIds.map((skillId) => {
        const skill = context.skills.find((item) => item.id === skillId)
        return `| ${markdownCell(label)} | ${markdownCell(skill?.name ?? skillId)} | ${markdownCell(label)} | ${markdownCell(skill ? `Skills.md#${anchorFor('skill', skill.id)}` : 'missing metadata')} |`
      })
    ].join('\n'), 3)
  }
  return sections.join(SECTION_SEPARATOR)
}

export function buildTaskMarkdown(context: ExportContext, exportStatuses: AttachmentExportStatus[] = [], subtaskExportStatuses: SubtaskExportStatusMap = {}): string {
  const { task, tags, customFields } = context
  const taskTagIds = (task.tags ?? []).map((tag) => tag.id)
  const subtasks = task.subtasks ?? []
  const taskAttachments = getTaskAttachments(task)
  const subtaskAttachments = subtasks.flatMap(getSubtaskAttachments)
  const sections = [`# ${task.title}`]
  const projectInputs = [
    `- Project: ${context.project?.name ?? task.projectId}`,
    `- Project ID: ${task.projectId}`,
    context.projectGroup?.name ? `- Project group: ${context.projectGroup.name}` : '',
    context.projectGroup?.description?.trim() ? `### Project Group Description\n${context.projectGroup.description.trim()}` : '',
    context.project?.description?.trim() ? `### Project Description\n${context.project.description.trim()}` : '',
    context.project?.generalContext?.trim() ? `### General Context\n${context.project.generalContext.trim()}` : '',
    context.project?.generalPrompt?.trim() ? `### General Prompt\n${context.project.generalPrompt.trim()}` : '',
    context.project?.defaultOutput?.trim() ? `### Default Output\n${context.project.defaultOutput.trim()}` : ''
  ].filter(Boolean).join('\n\n')
  pushSection(sections, 'AI Execution Flow', buildAiExecutionFlow(context))
  pushSection(sections, 'Project Inputs', projectInputs)
  pushSection(sections, 'Task Details', buildDetailsMarkdown([
    ['Title', task.title],
    ['Status', humanizeStatus(task.status, context.projectStatuses)],
    ['Project', context.project?.name ?? task.projectId],
    ['Project group', context.projectGroup?.name ?? 'None'],
    ['Tags', taskTagIds.length ? tagsMarkdown(taskTagIds, tags) : 'None'],
    ['Subtasks', subtasks.length],
    ['Subtask details', subtasks.length ? 'See Subtasks Index and numbered Subtask sections below. Process them in numeric order.' : 'None'],
    ['Attachments', taskAttachments.length + subtaskAttachments.length],
    ['Created', formatDate(task.createdAt)],
    ['Updated', formatDate(task.updatedAt)]
  ], task.description))
  if (taskTagIds.length) pushSection(sections, 'Tags', tagDetailsMarkdown(taskTagIds, tags))
  pushSection(sections, 'Comments', commentsMarkdown(task.comments ?? []))
  pushSection(sections, 'Custom Fields', customFieldsMarkdown(task.customFieldValues, customFields))
  pushSection(sections, 'Checklist', checklistMarkdown(task.checklistItems))
  pushSection(sections, 'Attachments Manifest', attachmentsMarkdown(taskAttachments, 'Task', exportStatuses.filter((item) => item.ownerId === task.id)))
  pushSection(sections, 'Attachment Folder', attachmentFolderMarkdown(exportStatuses))
  pushSection(sections, 'Agent References', agentReferencesMarkdown(task, context.agents))
  pushSection(sections, 'Skill References', skillReferencesMarkdown(task, context.skills))
  if (subtasks.length) {
    pushSection(sections, 'Subtasks Index', subtasks.map((subtask, index) => {
      const statusAction = subtaskStatusAction(subtask, context.projectStatuses)
      return `${index + 1}. [${subtaskLabel(subtask, index)}](#${subtaskAnchor(subtask, index)}) - Status: ${statusAction.label} - AI action: ${statusAction.action}`
    }).join('\n'))
  }
  for (const [index, subtask] of subtasks.entries()) sections.push(buildSubtaskSection(subtask, index, context, subtaskExportStatuses[subtask.id] ?? []))
  return `${sections.join(SECTION_SEPARATOR)}\n`
}

export function buildAgentMarkdown(context: ExportContext): string {
  const refs = new Map<string, { agent: Agent; sources: string[] }>()
  const add = (agentId: string | undefined | null, source: string) => {
    if (!agentId) return
    const agent = context.agents.find((item) => item.id === agentId)
    if (!agent) return
    const current = refs.get(agent.id) ?? { agent, sources: [] }
    current.sources.push(source)
    refs.set(agent.id, current)
  }
  add(context.task.agentId, `Task: ${context.task.title}`)
  for (const [index, subtask] of (context.task.subtasks ?? []).entries()) add(getSubtaskAgentId(subtask), subtaskLabel(subtask, index))
  if (!refs.size) return ''
  const sections = ['# Agents']
  for (const { agent, sources } of Array.from(refs.values()).sort((a, b) => a.agent.name.localeCompare(b.agent.name, 'tr'))) {
    const description = agentDescription(agent)
    const prompt = agentPrompt(agent)
    const agentSections = [
      `## ${agent.name}\n<a id="${anchorFor('agent', agent.id)}"></a>`,
      [
        '### Agent Details',
        '| Field | Value |',
        '| --- | --- |',
        `| Name | ${markdownCell(agent.name)} |`,
        `| Title | ${markdownCell(agent.title ?? '-')} |`,
        `| Description | ${markdownCell(description || '-')} |`,
        `| Status | ${markdownCell(agent.status)} |`,
        `| Reasoning level | ${markdownCell(agent.reasoningLevel ?? '-')} |`,
        `| Last heartbeat | ${markdownCell(formatDate(agent.heartbeatAt))} |`,
        `| Created | ${markdownCell(formatDate(agent.createdAt))} |`,
        `| Updated | ${markdownCell(formatDate(agent.updatedAt))} |`
      ].join('\n'),
      `### References\n${sources.map((source) => `- ${source}`).join('\n')}`
    ]
    if (prompt) agentSections.push(`### Agent Prompt\n${prompt}`)
    const steps = (agent.steps ?? [])
      .filter((step) => step.title?.trim() || step.description?.trim() || stepPrompt(step))
      .sort((a, b) => a.sortOrder - b.sortOrder)
    if (steps.length) {
      agentSections.push([
        '### Execution Steps',
        ...steps.map((step, index) => {
          const prompt = stepPrompt(step)
          return [
            `#### Step ${index + 1}: ${step.title || 'Untitled step'}`,
            '| Field | Value |',
            '| --- | --- |',
            `| Title | ${markdownCell(step.title || 'Untitled step')} |`,
            `| Description | ${markdownCell(step.description?.trim() || '-')} |`,
            `| Sort order | ${markdownCell(step.sortOrder)} |`,
            prompt ? `\n##### Step Prompt\n${prompt}` : ''
          ].filter(Boolean).join('\n')
        })
      ].join('\n\n'))
    }
    const extraConfig = agentExtraConfig(agent)
    if (Object.keys(extraConfig).length > 0) {
      agentSections.push(`### Extra Config\n\`\`\`json\n${JSON.stringify(extraConfig, null, 2)}\n\`\`\``)
    }
    sections.push(agentSections.join('\n\n'))
  }
  return `${sections.join(SECTION_SEPARATOR)}\n`
}

export function buildSkillsMarkdown(context: ExportContext): string {
  const refs = new Map<string, { skill: Skill; sources: string[] }>()
  const add = (skill: Skill | undefined, source: string) => {
    if (!skill) return
    const current = refs.get(skill.id) ?? { skill, sources: [] }
    current.sources.push(source)
    refs.set(skill.id, current)
  }
  for (const skill of context.task.skills ?? []) add(skill, `Task: ${context.task.title}`)
  for (const [index, subtask] of (context.task.subtasks ?? []).entries()) {
    for (const skillId of getSubtaskSkillIds(subtask)) add(context.skills.find((skill) => skill.id === skillId), subtaskLabel(subtask, index))
  }
  if (!refs.size) return ''
  const sections = ['# Skills']
  for (const { skill, sources } of Array.from(refs.values()).sort((a, b) => a.skill.name.localeCompare(b.skill.name, 'tr'))) {
    const skillSections = [
      `## ${skill.name}\n<a id="${anchorFor('skill', skill.id)}"></a>`,
      `### Skill Metadata
- ID: ${skill.id}
- Name: ${skill.name}
- Slug: ${skill.slug}
- Category: ${skill.category}
- Version: ${skill.version}
- Status: ${skill.status}
- Enabled: ${skill.enabled ? 'yes' : 'no'}
- Updated: ${formatDate(skill.updatedAt)}`,
      `### References\n${sources.map((source) => `- ${source}`).join('\n')}`
    ]
    if (skill.descriptionMarkdown?.trim()) skillSections.push(`### Instructions\n${skill.descriptionMarkdown.trim()}`)
    sections.push(skillSections.join('\n\n'))
  }
  return `${sections.join(SECTION_SEPARATOR)}\n`
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadMarkdownFile(name: string, content: string): void {
  downloadBlob(name, new Blob([content], { type: 'text/markdown;charset=utf-8' }))
}

async function readFileUrl(url: string): Promise<Uint8Array | null> {
  if (!url.startsWith('file://')) return null
  const req = (globalThis as { require?: (name: string) => unknown }).require
  if (typeof req !== 'function') return null
  try {
    const { fileURLToPath } = req('node:url') as { fileURLToPath: (value: string) => string }
    const { readFile } = req('node:fs/promises') as { readFile: (path: string) => Promise<Uint8Array> }
    return await readFile(fileURLToPath(url))
  } catch {
    return null
  }
}

function uniqueAttachmentName(usedNames: Set<string>, name: string, ownerId?: string): string {
  const base = safeName(name, 'attachment')
  if (!usedNames.has(base)) {
    usedNames.add(base)
    return base
  }
  const dot = base.lastIndexOf('.')
  let counter = 1
  while (counter < 1000) {
    const suffix = ownerId ? `${shortHash(ownerId)}-${counter}` : String(usedNames.size + 1)
    const nextName = dot > 0 ? `${base.slice(0, dot)}-${suffix}${base.slice(dot)}` : `${base}-${suffix}`
    if (!usedNames.has(nextName)) {
      usedNames.add(nextName)
      return nextName
    }
    counter += 1
  }
  const fallback = `${base}-${usedNames.size + 1}`
  usedNames.add(fallback)
  return fallback
}

async function addAttachmentFiles(zip: ZipInput, basePath: string, attachments: TaskAttachment[], usedNames: Set<string>, ownerId?: string, source?: string): Promise<AttachmentExportStatus[]> {
  const statuses: AttachmentExportStatus[] = []
  for (const attachment of attachments) {
    const fileName = uniqueAttachmentName(usedNames, attachment.name, ownerId)
    if (!attachment.url.startsWith('file://')) {
      statuses.push({ path: basePath, name: fileName, status: 'linked', url: attachment.url, ownerId, source })
      continue
    }
    const bytes = await readFileUrl(attachment.url)
    if (!bytes) {
      statuses.push({ path: basePath, name: fileName, status: 'unavailable', url: attachment.url, ownerId, source })
      continue
    }
    zip[`${basePath}/${fileName}`] = bytes
    statuses.push({ path: basePath, name: fileName, status: 'included', url: attachment.url, ownerId, source })
  }
  return statuses
}

export function buildWorkspaceSnapshotPayload(context: ExportContext) {
  const taskMarkdown = buildTaskMarkdown(context)
  const agentMarkdown = buildAgentMarkdown(context)
  const skillsMarkdown = buildSkillsMarkdown(context)
  const attachments = [
    ...getTaskAttachments(context.task).map((attachment) => ({ ...attachment, ownerId: context.task.id })),
    ...(context.task.subtasks ?? []).flatMap((subtask) => getSubtaskAttachments(subtask).map((attachment) => ({ ...attachment, ownerId: subtask.id })))
  ]
  return { taskMarkdown, agentMarkdown, skillsMarkdown, attachments }
}

export function buildProjectWorkspaceExportTaskPayload(context: ExportContext): ProjectWorkspaceExportTaskPayload {
  const usedAttachmentNames = new Set<string>()
  const taskExportStatuses = getTaskAttachments(context.task).map((attachment) => {
    const name = uniqueAttachmentName(usedAttachmentNames, attachment.name, context.task.id)
    return {
      path: 'attachments',
      name,
      status: attachment.url.startsWith('file://') ? 'included' as const : 'linked' as const,
      url: attachment.url,
      ownerId: context.task.id,
      source: 'Task'
    }
  })
  const subtaskExportStatuses: SubtaskExportStatusMap = {}
  for (const [index, subtask] of (context.task.subtasks ?? []).entries()) {
    subtaskExportStatuses[subtask.id] = getSubtaskAttachments(subtask).map((attachment) => {
      const name = uniqueAttachmentName(usedAttachmentNames, attachment.name, subtask.id)
      return {
        path: 'attachments',
        name,
        status: attachment.url.startsWith('file://') ? 'included' as const : 'linked' as const,
        url: attachment.url,
        ownerId: subtask.id,
        source: subtaskLabel(subtask, index)
      }
    })
  }
  const taskMarkdown = buildTaskMarkdown(context, [
    ...taskExportStatuses,
    ...Object.values(subtaskExportStatuses).flat()
  ], subtaskExportStatuses)
  const agentMarkdown = buildAgentMarkdown(context)
  const skillsMarkdown = buildSkillsMarkdown(context)
  const attachments = [
    ...taskExportStatuses.map((status) => {
      const attachment = getTaskAttachments(context.task).find((item) => item.url === status.url)
      return attachment ? { ...attachment, ownerId: context.task.id, exportName: status.name } : null
    }),
    ...(context.task.subtasks ?? []).flatMap((subtask) => (subtaskExportStatuses[subtask.id] ?? []).map((status) => {
      const attachment = getSubtaskAttachments(subtask).find((item) => item.url === status.url)
      return attachment ? { ...attachment, ownerId: subtask.id, exportName: status.name } : null
    }))
  ]
  return { taskId: context.task.id, taskMarkdown, agentMarkdown, skillsMarkdown, attachments: attachments.filter((attachment): attachment is TaskAttachment & { ownerId: string; exportName: string } => Boolean(attachment)) }
}

export async function downloadTaskZip(context: ExportContext): Promise<void> {
  const zip: ZipInput = {}
  const exportStatuses: AttachmentExportStatus[] = []
  const subtaskExportStatuses: SubtaskExportStatusMap = {}
  const usedAttachmentNames = new Set<string>()
  exportStatuses.push(...await addAttachmentFiles(zip, 'attachments', getTaskAttachments(context.task), usedAttachmentNames, context.task.id, 'Task'))
  for (const [index, subtask] of (context.task.subtasks ?? []).entries()) {
    const subtaskStatuses = await addAttachmentFiles(zip, 'attachments', getSubtaskAttachments(subtask), usedAttachmentNames, subtask.id, subtaskLabel(subtask, index))
    subtaskExportStatuses[subtask.id] = subtaskStatuses
    exportStatuses.push(...subtaskStatuses)
  }
  const agentMarkdown = buildAgentMarkdown(context)
  const skillsMarkdown = buildSkillsMarkdown(context)
  const taskMarkdown = buildTaskMarkdown(context, exportStatuses, subtaskExportStatuses)
  if (agentMarkdown.trim()) zip['Agents.md'] = strToU8(agentMarkdown)
  if (skillsMarkdown.trim()) zip['Skills.md'] = strToU8(skillsMarkdown)
  if (taskMarkdown.trim()) zip['Task.md'] = strToU8(taskMarkdown)
  const archive = zipSync(zip)
  downloadBlob(`${safeName(context.task.title, 'task')}.zip`, new Blob([archive], { type: 'application/zip' }))
}
