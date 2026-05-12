import { strToU8, zipSync } from 'fflate'
import type { Agent, AiTool, CustomField, Project, ProjectGroup, ProjectStatus, Skill, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskEntity, TaskSubtask } from '@shared/types/entities'
import { normalizeGatewayPromptShape, type GatewayPromptShape } from '@shared/utils/gateway-prompt-shape'
import { parseToonRecord, serializeToonRecord, stringifyCompactJson } from '@shared/utils/toon'

type ExportContext = {
  task: TaskEntity
  project?: Project | null
  projectGroup?: ProjectGroup | null
  agents: Agent[]
  skills: Skill[]
  tags: Tag[]
  customFields: CustomField[]
  projectStatuses?: ProjectStatus[]
  gatewayLanguage?: string
  gatewayPlanReasoningEffort?: string
  gatewayRunReasoningEffort?: string
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
  taskJson: string
  taskToon: string
  taskFileName: 'Task.md' | 'Task.json' | 'Task.toon'
  taskFileContent: string
  agentMarkdown: string
  skillsMarkdown: string
  toolsMarkdown: string
  attachments: Array<TaskAttachment & { ownerId: string; exportName: string }>
}

const SECTION_SEPARATOR = '\n\n-----\n\n'
const TASK_FORMAT_VERSION = 1

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

function getProjectRules(project?: Project | null): string {
  const metrics = project?.metrics && typeof project.metrics === 'object' && !Array.isArray(project.metrics) ? project.metrics : {}
  const rules = (metrics as Record<string, unknown>).projectRules
  return typeof rules === 'string' ? rules.trim() : ''
}

function getProjectPlanGuide(project?: Project | null): string {
  const metrics = project?.metrics && typeof project.metrics === 'object' && !Array.isArray(project.metrics) ? project.metrics : {}
  const guide = (metrics as Record<string, unknown>).projectPlanGuide
  return typeof guide === 'string' ? guide.trim() : ''
}

function getProjectPostRunPrompt(project?: Project | null): string {
  const metrics = project?.metrics && typeof project.metrics === 'object' && !Array.isArray(project.metrics) ? project.metrics : {}
  const value = (metrics as Record<string, unknown>).projectPostRunPrompt
  return typeof value === 'string' ? value.trim() : ''
}

function projectDefaultAgentIdValue(project?: Project | null): string {
  return typeof project?.metrics?.defaultAgentId === 'string' ? project.metrics.defaultAgentId : ''
}

function projectDefaultSkillIdsValue(project?: Project | null): string[] {
  const value = project?.metrics?.defaultSkillIds
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function effectiveTaskAgentId(context: ExportContext): string {
  return context.task.agentId || projectDefaultAgentIdValue(context.project)
}

function effectiveTaskSkillIds(context: ExportContext): string[] {
  const explicit = (context.task.skills ?? []).map((skill) => skill.id).filter(Boolean)
  return explicit.length > 0 ? explicit : projectDefaultSkillIdsValue(context.project)
}

function effectiveSourceLabel(context: ExportContext, kind: 'agent' | 'skills'): string {
  if (kind === 'agent') return context.task.agentId ? `Task: ${context.task.title}` : `Project default: ${context.project?.name ?? context.task.projectId}`
  return (context.task.skills?.length ?? 0) > 0 ? `Task: ${context.task.title}` : `Project default: ${context.project?.name ?? context.task.projectId}`
}

function contextPromptShape(context: ExportContext): GatewayPromptShape {
  const gateway = context.project?.metrics?.gateway
  const value = gateway && typeof gateway === 'object' && !Array.isArray(gateway)
    ? (gateway as Record<string, unknown>).promptShape
    : undefined
  return normalizeGatewayPromptShape(value)
}

function agentReferencePayload(agentId: string | undefined | null, agents: Agent[], source: string) {
  if (!agentId) return null
  const agent = agents.find((item) => item.id === agentId)
  const details = agent ? `Agents.md#${anchorFor('agent', agent.id)}` : 'missing metadata'
  return {
    source,
    id: agent?.id ?? agentId,
    name: agent?.name ?? agentId,
    title: agent?.title ?? '',
    description: agent ? agentDescription(agent) : 'missing metadata',
    promptRef: agent && agentPrompt(agent) ? details : '',
    details
  }
}

function skillReferencePayload(skillId: string, skills: Skill[], source: string) {
  const skill = skills.find((item) => item.id === skillId)
  return {
    source,
    id: skill?.id ?? skillId,
    name: skill?.name ?? skillId,
    details: skill ? `Skills.md#${anchorFor('skill', skill.id)}` : 'missing metadata'
  }
}

function buildTaskFormatContract(context: ExportContext, exportStatuses: AttachmentExportStatus[] = [], subtaskExportStatuses: SubtaskExportStatusMap = {}) {
  const { task } = context
  const subtasks = task.subtasks ?? []
  const taskAttachments = getTaskAttachments(task)
  const subtaskAttachments = subtasks.flatMap(getSubtaskAttachments)
  const defaultSkillIds = projectDefaultSkillIdsValue(context.project)
  const taskTagIds = (task.tags ?? []).map((tag) => tag.id)
  const agentReferences = [
    agentReferencePayload(effectiveTaskAgentId(context), context.agents, effectiveSourceLabel(context, 'agent')),
    ...subtasks.map((subtask, index) => agentReferencePayload(getSubtaskAgentId(subtask), context.agents, subtaskLabel(subtask, index)))
  ].filter((item): item is NonNullable<typeof item> => Boolean(item))
  const skillReferences = [
    ...effectiveTaskSkillIds(context).map((skillId) => skillReferencePayload(skillId, context.skills, effectiveSourceLabel(context, 'skills'))),
    ...subtasks.flatMap((subtask, index) => getSubtaskSkillIds(subtask).map((skillId) => skillReferencePayload(skillId, context.skills, subtaskLabel(subtask, index))))
  ]

  return {
    format: 'open_mission_control_task',
    version: TASK_FORMAT_VERSION,
    shape: contextPromptShape(context),
    metadata: {
      files: {
        markdown: 'Task.md',
        json: 'Task.json',
        toon: 'Task.toon',
        agents: 'Agents.md',
        skills: 'Skills.md',
        tools: 'Tools.md',
        attachments: 'attachments/'
      },
      generatedFor: 'Codex and Claude CLI task context',
      dataTypePolicy: 'The selected project prompt data type controls the primary task file: Markdown uses Task.md, JSON uses Task.json, and TOON uses Task.toon.',
      agentSkillPolicy: 'Task files include short summaries and refs only. Full prompts/instructions are lazy-loaded from Agents.md, Skills.md, and Tools.md. Tools.md is catalog context only in v1.'
    },
    project: {
      id: task.projectId,
      name: context.project?.name ?? task.projectId,
      group: context.projectGroup ? { id: context.projectGroup.id, name: context.projectGroup.name, description: context.projectGroup.description ?? '' } : null,
      description: context.project?.description ?? '',
      language: context.gatewayLanguage ?? '',
      defaultAgentId: projectDefaultAgentIdValue(context.project),
      defaultSkillIds,
      gateway: context.project?.metrics?.gateway ?? {},
      instructions: {
        generalContext: context.project?.generalContext ?? '',
        generalPrompt: context.project?.generalPrompt ?? '',
        planGuide: getProjectPlanGuide(context.project),
        defaultOutput: context.project?.defaultOutput ?? '',
        rules: getProjectRules(context.project),
        postRunPrompt: getProjectPostRunPrompt(context.project)
      }
    },
    task: {
      id: task.id,
      title: task.title,
      status: humanizeStatus(task.status, context.projectStatuses),
      description: task.description ?? '',
      tags: taskTagIds.map((id) => context.tags.find((tag) => tag.id === id)?.name ?? id),
      customFields: task.customFieldValues ?? {},
      checklist: task.checklistItems ?? [],
      comments: task.comments ?? [],
      attachments: taskAttachments.map((attachment) => {
        const status = exportStatuses.find((item) => item.ownerId === task.id && item.url === attachment.url)
        return { ...attachment, exportStatus: status?.status ?? 'linked', exportPath: status ? `${status.path}/${status.name}` : attachment.url }
      }),
      counts: {
        subtasks: subtasks.length,
        attachments: taskAttachments.length + subtaskAttachments.length
      }
    },
    references: {
      agents: agentReferences,
      skills: skillReferences
    },
    subtasks: subtasks.map((subtask, index) => {
      const statusAction = subtaskStatusAction(subtask, context.projectStatuses)
      return {
        number: index + 1,
        id: subtask.id,
        title: subtask.title,
        status: statusAction.label,
        aiAction: statusAction.action,
        description: getSubtaskDescription(subtask),
        tags: getSubtaskTagIds(subtask).map((id) => context.tags.find((tag) => tag.id === id)?.name ?? id),
        customFields: getPayload(subtask).customFields ?? {},
        checklist: getSubtaskChecklist(subtask),
        comments: getSubtaskComments(subtask),
        agentRef: agentReferencePayload(getSubtaskAgentId(subtask), context.agents, subtaskLabel(subtask, index)),
        skillRefs: getSubtaskSkillIds(subtask).map((skillId) => skillReferencePayload(skillId, context.skills, subtaskLabel(subtask, index))),
        attachments: getSubtaskAttachments(subtask).map((attachment) => {
          const status = (subtaskExportStatuses[subtask.id] ?? []).find((item) => item.url === attachment.url)
          return { ...attachment, exportStatus: status?.status ?? 'linked', exportPath: status ? `${status.path}/${status.name}` : attachment.url }
        }),
        createdAt: subtask.createdAt,
        updatedAt: subtask.updatedAt
      }
    })
  }
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

function agentExtraConfig(agent: Agent): Record<string, unknown> {
  const config = agent.config && typeof agent.config === 'object' ? { ...agent.config } : {}
  delete config.title
  delete config.description
  delete config.trainingMarkdown
  delete config.steps
  delete config.reasoningLevel
  delete config.status
  return config
}

function agentTags(agent: Agent): string {
  return (agent.tags ?? []).map((tag) => tag.name).filter(Boolean).join(', ')
}

function agentTools(agent: Agent): AiTool[] {
  return (agent.tools ?? []).filter((tool) => tool.status === 'active')
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

function taskHasMetadata(task: TaskEntity): boolean {
  return Boolean(
    (task.tags ?? []).length
    || Object.keys(task.customFieldValues ?? {}).length
    || (task.checklistItems ?? []).length
    || (task.comments ?? []).length
  )
}

function buildAiExecutionFlow(context: ExportContext): string {
  const { task } = context
  const subtasks = task.subtasks ?? []
  const actionableSubtasks = subtasks.filter((subtask) => !subtaskStatusAction(subtask, context.projectStatuses).shouldBypass)
  const bypassedSubtasks = subtasks.length - actionableSubtasks.length
  const metadataHint = taskHasMetadata(task) ? ' Review task metadata and comments before editing.' : ''
  const subtaskHint = subtasks.length
    ? `Execute ${actionableSubtasks.length} actionable subtask${actionableSubtasks.length === 1 ? '' : 's'} in Subtasks Index order.${bypassedSubtasks ? ` Bypass ${bypassedSubtasks} done/closed subtask${bypassedSubtasks === 1 ? '' : 's'}.` : ''}`
    : 'No subtasks are defined; execute from the parent task details.'
  return [
    '1. Read Task Details, Subtasks, Comments, Checklist, and attachments first.',
    `2. ${subtaskHint} Use each subtask description as the main AI guidance; checklist items are optional supporting detail.`,
    `3. Apply Project Instructions, then Agents.md, Skills.md, and Tools.md as supporting context.${metadataHint}`,
    '4. Implement, verify, and finalize output.'
  ].join('\n')
}

function subtaskExecutionPlanMarkdown(context: ExportContext): string {
  const subtasks = context.task.subtasks ?? []
  if (!subtasks.length) return ''
  const actionable = subtasks.filter((subtask) => !subtaskStatusAction(subtask, context.projectStatuses).shouldBypass).length
  const checklistCount = subtasks.reduce((sum, subtask) => sum + getSubtaskChecklist(subtask).length, 0)
  return [
    'Subtasks are the authoritative execution plan for this task. Use the parent task details as context, then execute the numbered subtask titles and descriptions below in order.',
    '',
    `- Total subtasks: ${subtasks.length}`,
    `- Actionable subtasks: ${actionable}`,
    `- Optional subtask checklist items: ${checklistCount}`,
    '- Treat each subtask description as the primary execution guidance before considering optional checklist details.',
    '- If a subtask is marked Done or Closed, follow its AI action in the index instead of redoing work.'
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
  pushSection(sections, 'Checklist', checklistMarkdown(getSubtaskChecklist(subtask)), 3)
  pushSection(sections, 'Comments', commentsMarkdown(getSubtaskComments(subtask)), 3)
  pushSection(sections, 'Custom Fields', customFieldsMarkdown(payload.customFields as Record<string, unknown> | undefined, context.customFields), 3)
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
  const gatewaySettings = context.project?.metrics?.gateway && typeof context.project.metrics.gateway === 'object' && !Array.isArray(context.project.metrics.gateway)
    ? context.project.metrics.gateway as Record<string, unknown>
    : {}
  const defaultSkillIds = projectDefaultSkillIdsValue(context.project)
  const defaultAgentId = projectDefaultAgentIdValue(context.project)
  const defaultAgentName = defaultAgentId ? context.agents.find((agent) => agent.id === defaultAgentId)?.name ?? defaultAgentId : ''
  const defaultSkillNames = defaultSkillIds.map((skillId) => context.skills.find((skill) => skill.id === skillId)?.name ?? skillId)
  const projectInputs = [
    context.gatewayLanguage ? `- Selected Codex language: ${context.gatewayLanguage}` : '',
    defaultAgentName ? `- Project default agent: ${defaultAgentName}` : '',
    defaultSkillNames.length > 0 ? `- Project default skills: ${defaultSkillNames.join(', ')}` : '',
    gatewaySettings.gatewayId ? `- Project Codex gateway: ${String(gatewaySettings.gatewayId)}` : '',
    gatewaySettings.runtimeWorkspaceId ? `- Runtime workspace: ${String(gatewaySettings.runtimeWorkspaceId)}` : '',
    gatewaySettings.planModel ? `- Plan model: ${String(gatewaySettings.planModel)} (${context.gatewayPlanReasoningEffort ?? gatewaySettings.planReasoningEffort ?? 'medium'} reasoning)` : '',
    gatewaySettings.runModel || gatewaySettings.defaultModel ? `- Run model: ${String(gatewaySettings.runModel ?? gatewaySettings.defaultModel)} (${context.gatewayRunReasoningEffort ?? gatewaySettings.runReasoningEffort ?? 'medium'} reasoning)` : '',
    `- Project: ${context.project?.name ?? task.projectId}`,
    `- Project ID: ${task.projectId}`,
    context.projectGroup?.name ? `- Project group: ${context.projectGroup.name}` : '',
    context.projectGroup?.description?.trim() ? `### Project Group Description\n${context.projectGroup.description.trim()}` : '',
    context.project?.description?.trim() ? `### Project Description\n${context.project.description.trim()}` : '',
    context.project?.generalContext?.trim() ? `### General Context\n${context.project.generalContext.trim()}` : '',
    context.project?.generalPrompt?.trim() ? `### General Prompt\n${context.project.generalPrompt.trim()}` : '',
    getProjectPlanGuide(context.project) ? `### Plan Guide\n${getProjectPlanGuide(context.project)}` : '',
    context.project?.defaultOutput?.trim() ? `### Default Output\n${context.project.defaultOutput.trim()}` : '',
    getProjectRules(context.project) ? `### Project Rules\n${getProjectRules(context.project)}` : '',
    getProjectPostRunPrompt(context.project) ? `### Post-run Prompt\n${getProjectPostRunPrompt(context.project)}` : ''
  ].filter(Boolean).join('\n\n')
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
  pushSection(sections, 'AI Execution Flow', buildAiExecutionFlow(context))
  pushSection(sections, 'Subtasks as Primary Execution Plan', subtaskExecutionPlanMarkdown(context))
  if (subtasks.length) {
    pushSection(sections, 'Subtasks Index', subtasks.map((subtask, index) => {
      const statusAction = subtaskStatusAction(subtask, context.projectStatuses)
      const checklistCount = getSubtaskChecklist(subtask).length
      const descriptionSignal = getSubtaskDescription(subtask).trim() ? 'description: present' : 'description: missing'
      return `${index + 1}. [${subtaskLabel(subtask, index)}](#${subtaskAnchor(subtask, index)}) - Status: ${statusAction.label} - AI action: ${statusAction.action} - ${descriptionSignal} - Optional checklist: ${checklistCount}`
    }).join('\n'))
  }
  for (const [index, subtask] of subtasks.entries()) sections.push(buildSubtaskSection(subtask, index, context, subtaskExportStatuses[subtask.id] ?? []))
  pushSection(sections, 'Project Instructions', projectInputs)
  pushSection(sections, 'Agent References', agentReferencesMarkdown(task, context.agents))
  pushSection(sections, 'Skill References', skillReferencesMarkdown(task, context.skills))
  return `${sections.join(SECTION_SEPARATOR)}\n`
}

export function buildTaskJsonData(context: ExportContext, exportStatuses: AttachmentExportStatus[] = [], subtaskExportStatuses: SubtaskExportStatusMap = {}) {
  return buildTaskFormatContract(context, exportStatuses, subtaskExportStatuses)
}

export function buildTaskJson(context: ExportContext, exportStatuses: AttachmentExportStatus[] = [], subtaskExportStatuses: SubtaskExportStatusMap = {}): string {
  return `${JSON.stringify(buildTaskJsonData(context, exportStatuses, subtaskExportStatuses), null, 2)}\n`
}

function customFieldImportValues(values: Record<string, unknown> | undefined, fields: CustomField[]) {
  const normalizedValues = values && typeof values === 'object' && !Array.isArray(values) ? values : {}
  return Object.entries(normalizedValues)
    .filter(([, value]) => hasExportValue(value))
    .map(([fieldId, value]) => {
      const field = fields.find((item) => item.id === fieldId)
      return {
        name: field?.name ?? fieldId,
        type: field?.type ?? 'text',
        value
      }
    })
}

export function buildTaskImportJsonData(context: ExportContext) {
  const { task } = context
  return {
    title: task.title,
    description: task.description ?? '',
    tags: (task.tags ?? []).map((tag) => tag.name || tag.id).filter(Boolean),
    customFields: customFieldImportValues(task.customFieldValues, context.customFields),
    checklist: task.checklistItems ?? [],
    comments: task.comments ?? [],
    subtasks: (task.subtasks ?? []).map((subtask) => ({
      title: subtask.title,
      description: getSubtaskDescription(subtask),
      tags: getSubtaskTagIds(subtask).map((id) => context.tags.find((tag) => tag.id === id)?.name ?? id),
      customFields: customFieldImportValues(getPayload(subtask).customFields as Record<string, unknown> | undefined, context.customFields),
      checklist: getSubtaskChecklist(subtask),
      comments: getSubtaskComments(subtask),
      ...(typeof getPayload(subtask).dueAt === 'number' ? { dueAt: getPayload(subtask).dueAt } : {})
    }))
  }
}

export function buildTaskImportJson(context: ExportContext): string {
  return `${JSON.stringify(buildTaskImportJsonData(context), null, 2)}\n`
}

export function buildTaskToon(context: ExportContext, exportStatuses: AttachmentExportStatus[] = [], subtaskExportStatuses: SubtaskExportStatusMap = {}): string {
  const data = buildTaskJsonData(context, exportStatuses, subtaskExportStatuses)
  return `${serializeToonRecord({
    format: 'open_mission_control_task',
    shape: 'toon',
    version: TASK_FORMAT_VERSION,
    data: stringifyCompactJson(data)
  })}\n`
}

export function parseTaskToon(value: string) {
  const parsed = parseToonRecord(value)
  if (parsed.format !== 'open_mission_control_task') throw new Error('Invalid Task.toon format.')
  if (parsed.shape !== 'toon') throw new Error('Invalid Task.toon shape.')
  const data = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Task.toon data.')
  return data
}

function taskFileForShape(shape: GatewayPromptShape, taskMarkdown: string, taskJson: string, taskToon: string): { taskFileName: ProjectWorkspaceExportTaskPayload['taskFileName']; taskFileContent: string; contentType: string } {
  if (shape === 'json') return { taskFileName: 'Task.json', taskFileContent: taskJson, contentType: 'application/json;charset=utf-8' }
  if (shape === 'toon') return { taskFileName: 'Task.toon', taskFileContent: taskToon, contentType: 'text/plain;charset=utf-8' }
  return { taskFileName: 'Task.md', taskFileContent: taskMarkdown, contentType: 'text/markdown;charset=utf-8' }
}

export function buildSelectedTaskFile(context: ExportContext, exportStatuses: AttachmentExportStatus[] = [], subtaskExportStatuses: SubtaskExportStatusMap = {}): { taskFileName: ProjectWorkspaceExportTaskPayload['taskFileName']; taskFileContent: string; contentType: string } {
  const taskMarkdown = buildTaskMarkdown(context, exportStatuses, subtaskExportStatuses)
  const taskJson = buildTaskJson(context, exportStatuses, subtaskExportStatuses)
  const taskToon = buildTaskToon(context, exportStatuses, subtaskExportStatuses)
  return taskFileForShape(contextPromptShape(context), taskMarkdown, taskJson, taskToon)
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
  add(effectiveTaskAgentId(context), effectiveSourceLabel(context, 'agent'))
  for (const [index, subtask] of (context.task.subtasks ?? []).entries()) add(getSubtaskAgentId(subtask), subtaskLabel(subtask, index))
  if (!refs.size) return ''
  const sections = [
    '# Agents',
    'Effective Agent instructions are execution guidance. Skills provide procedural/domain guidance, and linked Tools describe the Agent capability catalog for this task flow.'
  ]
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
        `| Tags | ${markdownCell(agentTags(agent) || '-')} |`,
        `| Tools | ${markdownCell(agentTools(agent).map((tool) => tool.name).join(', ') || '-')} |`,
        `| Last heartbeat | ${markdownCell(formatDate(agent.heartbeatAt))} |`,
        `| Created | ${markdownCell(formatDate(agent.createdAt))} |`,
        `| Updated | ${markdownCell(formatDate(agent.updatedAt))} |`
      ].join('\n'),
      `### References\n${sources.map((source) => `- ${source}`).join('\n')}`
    ]
    agentSections.push(`### Capability Relationship\n- Agent role: primary executor for referenced task/subtask sources.\n- Skills: apply effective task/project skills as procedural guidance.\n- Tools: linked active tools are capability catalog context only; do not execute command templates unless a future runtime explicitly enables tool invocation and approval.`)
    if (prompt) agentSections.push(`### Agent Prompt\n${prompt}`)
    const extraConfig = agentExtraConfig(agent)
    if (Object.keys(extraConfig).length > 0) {
      agentSections.push(`### Extra Config\n\`\`\`json\n${JSON.stringify(extraConfig, null, 2)}\n\`\`\``)
    }
    sections.push(agentSections.join('\n\n'))
  }
  return `${sections.join(SECTION_SEPARATOR)}\n`
}

export function buildToolsMarkdown(context: ExportContext): string {
  const refs = new Map<string, { tool: AiTool; sources: string[] }>()
  const addAgentTools = (agentId: string | undefined | null, source: string) => {
    if (!agentId) return
    const agent = context.agents.find((item) => item.id === agentId)
    if (!agent) return
    for (const tool of agentTools(agent)) {
      const current = refs.get(tool.id) ?? { tool, sources: [] }
      current.sources.push(`${source} via agent ${agent.name}`)
      refs.set(tool.id, current)
    }
  }
  addAgentTools(effectiveTaskAgentId(context), effectiveSourceLabel(context, 'agent'))
  for (const [index, subtask] of (context.task.subtasks ?? []).entries()) addAgentTools(getSubtaskAgentId(subtask), subtaskLabel(subtask, index))
  if (!refs.size) return ''
  const sections = [
    '# Tools',
    'These AI tools are catalog definitions only. Open Mission Control exports them as context for the effective Agent; do not execute listed commands, function bodies, or code bodies unless a future runtime explicitly enables tool invocation and approval.'
  ]
  for (const { tool, sources } of Array.from(refs.values()).sort((a, b) => a.tool.name.localeCompare(b.tool.name, 'tr'))) {
    const rows = [
      `## ${tool.name}\n<a id="${anchorFor('tool', tool.id)}"></a>`,
      [
        '### Tool Details',
        '| Field | Value |',
        '| --- | --- |',
        `| ID | ${markdownCell(tool.id)} |`,
        `| Slug | ${markdownCell(tool.slug)} |`,
        `| Type | ${markdownCell(tool.toolType)} |`,
        `| Status | ${markdownCell(tool.status)} |`,
        `| Approval required | ${tool.approvalRequired ? 'yes' : 'no'} |`,
        `| Timeout seconds | ${markdownCell(tool.timeoutSeconds ?? '-')} |`
      ].join('\n'),
      `### References\n${sources.map((source) => `- ${source}`).join('\n')}`
    ]
    if (tool.descriptionMarkdown?.trim()) rows.push(`### AI Usage Notes\n${tool.descriptionMarkdown.trim()}`)
    if (tool.functionName?.trim()) rows.push(`### Function\n\`${tool.functionName.trim()}\``)
    if (tool.inputSchemaJson) rows.push(`### Input Schema\n\`\`\`json\n${JSON.stringify(tool.inputSchemaJson, null, 2)}\n\`\`\``)
    if (tool.outputSchemaJson) rows.push(`### Output Schema\n\`\`\`json\n${JSON.stringify(tool.outputSchemaJson, null, 2)}\n\`\`\``)
    if (tool.prepareCommand?.trim()) rows.push(`### Prepare Command\n\`\`\`bash\n${tool.prepareCommand.trim()}\n\`\`\``)
    if (tool.commandTemplate?.trim()) rows.push(`### Command Template\n\`\`\`bash\n${tool.commandTemplate.trim()}\n\`\`\``)
    if (tool.codeBody?.trim()) rows.push(`### Code\n\`\`\`${tool.codeLanguage || 'text'}\n${tool.codeBody.trim()}\n\`\`\``)
    if (tool.executionFlowMarkdown?.trim()) rows.push(`### Execution Flow\n${tool.executionFlowMarkdown.trim()}`)
    sections.push(rows.join('\n\n'))
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
  for (const skillId of effectiveTaskSkillIds(context)) add(context.skills.find((skill) => skill.id === skillId) ?? (context.task.skills ?? []).find((skill) => skill.id === skillId), effectiveSourceLabel(context, 'skills'))
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

export function downloadTextFile(name: string, content: string, type = 'text/plain;charset=utf-8'): void {
  downloadBlob(name, new Blob([content], { type }))
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
  const taskJson = buildTaskJson(context)
  const taskToon = buildTaskToon(context)
  const agentMarkdown = buildAgentMarkdown(context)
  const skillsMarkdown = buildSkillsMarkdown(context)
  const toolsMarkdown = buildToolsMarkdown(context)
  const attachments = [
    ...getTaskAttachments(context.task).map((attachment) => ({ ...attachment, ownerId: context.task.id })),
    ...(context.task.subtasks ?? []).flatMap((subtask) => getSubtaskAttachments(subtask).map((attachment) => ({ ...attachment, ownerId: subtask.id })))
  ]
  return { taskMarkdown, taskJson, taskToon, agentMarkdown, skillsMarkdown, toolsMarkdown, attachments }
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
  const taskJson = buildTaskJson(context, [
    ...taskExportStatuses,
    ...Object.values(subtaskExportStatuses).flat()
  ], subtaskExportStatuses)
  const taskToon = buildTaskToon(context, [
    ...taskExportStatuses,
    ...Object.values(subtaskExportStatuses).flat()
  ], subtaskExportStatuses)
  const taskFile = taskFileForShape(contextPromptShape(context), taskMarkdown, taskJson, taskToon)
  const agentMarkdown = buildAgentMarkdown(context)
  const skillsMarkdown = buildSkillsMarkdown(context)
  const toolsMarkdown = buildToolsMarkdown(context)
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
  return { taskId: context.task.id, taskMarkdown, taskJson, taskToon, ...taskFile, agentMarkdown, skillsMarkdown, toolsMarkdown, attachments: attachments.filter((attachment): attachment is TaskAttachment & { ownerId: string; exportName: string } => Boolean(attachment)) }
}

export async function buildTaskZipArchive(context: ExportContext): Promise<{ fileName: string; archive: Uint8Array }> {
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
  const taskFile = buildSelectedTaskFile(context, exportStatuses, subtaskExportStatuses)
  if (taskFile.taskFileContent.trim()) zip[taskFile.taskFileName] = strToU8(taskFile.taskFileContent)
  const archive = zipSync(zip)
  return { fileName: `${safeName(context.task.title, 'task')}.zip`, archive }
}

export async function downloadTaskZip(context: ExportContext): Promise<void> {
  const { fileName, archive } = await buildTaskZipArchive(context)
  downloadBlob(fileName, new Blob([archive], { type: 'application/zip' }))
}
