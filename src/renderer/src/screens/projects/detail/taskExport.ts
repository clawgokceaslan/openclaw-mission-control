import { strToU8, zipSync } from 'fflate'
import type { Agent, CustomField, Project, ProjectGroup, Skill, Tag, TaskAttachment, TaskChecklistItem, TaskComment, TaskEntity, TaskSubtask } from '@shared/types/entities'

type ExportContext = {
  task: TaskEntity
  project?: Project | null
  projectGroup?: ProjectGroup | null
  agents: Agent[]
  skills: Skill[]
  tags: Tag[]
  customFields: CustomField[]
}

type ZipInput = Record<string, Uint8Array>
type AttachmentExportStatus = {
  path: string
  name: string
  status: 'included' | 'linked' | 'unavailable'
  url: string
}

type SubtaskExportStatusMap = Record<string, AttachmentExportStatus[]>

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

function entityFolder(title: string, id: string, fallback: string): string {
  return `${safeName(title, fallback)}__${shortHash(id)}`
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

function getTaskAttachments(task: TaskEntity): TaskAttachment[] {
  return getPayloadList<TaskAttachment>(getPayload(task), 'attachments')
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  if (typeof value === 'object') return `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
  return String(value)
}

function markdownCell(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function commentsMarkdown(comments: TaskComment[]): string {
  if (!comments.length) return '-'
  return comments
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((comment) => `- **${comment.authorName || 'Operator'}** (${new Date(comment.createdAt).toLocaleString()}): ${comment.body.replace(/\n/g, ' ')}`)
    .join('\n')
}

function checklistMarkdown(items: TaskChecklistItem[] | undefined): string {
  if (!items?.length) return '-'
  return items.map((item) => `- [${item.checked ? 'x' : ' '}] ${item.title}`).join('\n')
}

function tagsMarkdown(tagIds: string[], tags: Tag[]): string {
  const names = tagIds.map((id) => tags.find((tag) => tag.id === id)?.name ?? id).filter(Boolean)
  return names.length ? names.map((name) => `\`${name}\``).join(', ') : '-'
}

function tagDetailsMarkdown(tagIds: string[], tags: Tag[]): string {
  if (!tagIds.length) return '-'
  const rows = tagIds.map((id) => {
    const tag = tags.find((item) => item.id === id)
    if (!tag) return `| ${markdownCell(id)} | - | Missing tag metadata |`
    return `| ${markdownCell(tag.name)} | ${markdownCell(tag.color)} | ${markdownCell(tag.description || '-')} |`
  })
  return ['| Name | Color | Description |', '| --- | --- | --- |', ...rows].join('\n')
}

function customFieldsMarkdown(values: Record<string, unknown> | undefined, fields: CustomField[]): string {
  if (!values || Object.keys(values).length === 0) return '-'
  return Object.entries(values).map(([fieldId, value]) => {
    const field = fields.find((item) => item.id === fieldId)
    return `- **${field?.name ?? fieldId}**: ${formatValue(value)}`
  }).join('\n')
}

function attachmentsMarkdown(attachments: TaskAttachment[]): string {
  if (!attachments.length) return '-'
  return attachments.map((attachment) => `- ${attachment.name} (${attachment.type || 'file'}, ${attachment.size || 0} bytes): ${attachment.url}`).join('\n')
}

function attachmentStatusMarkdown(statuses: AttachmentExportStatus[]): string {
  if (!statuses.length) return '-'
  return statuses.map((item) => `- ${item.status.toUpperCase()} ${item.path}/${item.name}: ${item.url}`).join('\n')
}

function agentMarkdownForTask(task: TaskEntity, agents: Agent[]): string {
  const agent = task.agentId ? agents.find((item) => item.id === task.agentId) : null
  if (!agent) return '## Task Agent\n\nUnassigned\n'
  return `## Task Agent\n\n# ${agent.name}\n\n- Status: ${agent.status}\n- Title: ${agent.title ?? '-'}\n- Reasoning: ${agent.reasoningLevel ?? '-'}\n- Last heartbeat: ${agent.heartbeatAt ? new Date(agent.heartbeatAt).toLocaleString() : '-'}\n\n${agent.trainingMarkdown ?? ''}\n`
}

function payloadSummaryMarkdown(payload: Record<string, unknown>): string {
  const ignoredKeys = new Set(['attachments', 'comments', 'customFields', 'description', 'tagIds', 'skillIds', 'checklistItems'])
  const entries = Object.entries(payload).filter(([key, value]) => !ignoredKeys.has(key) && value !== undefined && value !== null && value !== '')
  if (!entries.length) return '-'
  return entries.map(([key, value]) => `- **${key}**: ${formatValue(value)}`).join('\n')
}

function buildSubtaskSection(subtask: TaskSubtask, context: ExportContext, exportStatuses: AttachmentExportStatus[] = []): string {
  const payload = getPayload(subtask)
  const sections = [
    `## [SUBTASK] ${subtask.title}`,
    `### Summary
- ID: ${subtask.id}
- Status: ${subtask.status}
- Tags: ${tagsMarkdown(getSubtaskTagIds(subtask), context.tags)}
- Created: ${new Date(subtask.createdAt).toLocaleString()}
- Updated: ${new Date(subtask.updatedAt).toLocaleString()}`,
    `### Description
${getSubtaskDescription(subtask).trim() || '-'}`,
    `### Tags
${tagDetailsMarkdown(getSubtaskTagIds(subtask), context.tags)}`,
    `### Comments
${commentsMarkdown(getSubtaskComments(subtask))}`,
    `### Custom Fields
${customFieldsMarkdown(payload.customFields as Record<string, unknown> | undefined, context.customFields)}`,
    `### Checklist
${checklistMarkdown(getSubtaskChecklist(subtask))}`,
    `### Attachments Manifest
${attachmentsMarkdown(getSubtaskAttachments(subtask))}`,
    `### Payload Summary
${payloadSummaryMarkdown(payload)}`,
    `### Export File Status
${attachmentStatusMarkdown(exportStatuses)}`
  ]
  return sections.join(SECTION_SEPARATOR)
}

export function buildTaskMarkdown(context: ExportContext, exportStatuses: AttachmentExportStatus[] = [], subtaskExportStatuses: SubtaskExportStatusMap = {}): string {
  const { task, tags, customFields } = context
  const taskTagIds = (task.tags ?? []).map((tag) => tag.id)
  const subtasks = task.subtasks ?? []
  const sections = [
    `# ${task.title}`,
    `## Project Inputs
- Project: ${context.project?.name ?? task.projectId}
- Project group: ${context.projectGroup?.name ?? '-'}

### General context
${context.project?.generalContext?.trim() || '-'}

### General prompt
${context.project?.generalPrompt?.trim() || '-'}

### Default output
${context.project?.defaultOutput?.trim() || '-'}`,
    `## Task Summary
- ID: ${task.id}
- Status: ${task.status}
- Tags: ${tagsMarkdown(taskTagIds, tags)}
- Created: ${new Date(task.createdAt).toLocaleString()}
- Updated: ${new Date(task.updatedAt).toLocaleString()}`,
    `## Tags
${tagDetailsMarkdown(taskTagIds, tags)}`,
    `## Description
${task.description?.trim() || '-'}`,
    `## Comments
${commentsMarkdown(task.comments ?? [])}`,
    `## Custom Fields
${customFieldsMarkdown(task.customFieldValues, customFields)}`,
    `## Checklist
${checklistMarkdown(task.checklistItems)}`,
    `## Attachments Manifest
${attachmentsMarkdown(getTaskAttachments(task))}`,
    `## Subtasks Index
${subtasks.length ? subtasks.map((subtask) => `- [SUBTASK] ${subtask.title} (${subtask.status})`).join('\n') : '-'}`,
    `## Export File Status
${attachmentStatusMarkdown(exportStatuses)}`,
    ...subtasks.map((subtask) => buildSubtaskSection(subtask, context, subtaskExportStatuses[subtask.id] ?? []))
  ]
  return `${sections.join(SECTION_SEPARATOR)}\n`
}

export function buildSubtaskMarkdown(subtask: TaskSubtask, context: ExportContext): string {
  return `# ${subtask.title}

## Summary
- ID: ${subtask.id}
- Status: ${subtask.status}
- Tags: ${tagsMarkdown(getSubtaskTagIds(subtask), context.tags)}
- Created: ${new Date(subtask.createdAt).toLocaleString()}
- Updated: ${new Date(subtask.updatedAt).toLocaleString()}

## Description
${getSubtaskDescription(subtask).trim() || '-'}

## Tags
${tagDetailsMarkdown(getSubtaskTagIds(subtask), context.tags)}

## Custom Fields
${customFieldsMarkdown(getPayload(subtask).customFields as Record<string, unknown> | undefined, context.customFields)}

## Comments
${commentsMarkdown(getSubtaskComments(subtask))}

## Attachments
${attachmentsMarkdown(getSubtaskAttachments(subtask))}
`
}

export function buildAgentMarkdown(context: ExportContext): string {
  const subtaskSections = (context.task.subtasks ?? []).map((subtask) => {
    const agentId = typeof getPayload(subtask).agentId === 'string' ? String(getPayload(subtask).agentId) : subtask.assigneeId
    const agent = agentId ? context.agents.find((item) => item.id === agentId) : null
    return `## ${subtask.title}\n\n${agent ? `- Agent: ${agent.name}\n- Status: ${agent.status}\n- Title: ${agent.title ?? '-'}` : 'Unassigned'}`
  })
  return `${agentMarkdownForTask(context.task, context.agents)}\n${subtaskSections.join('\n\n')}\n`
}

export function buildSkillsMarkdown(context: ExportContext): string {
  const taskSkills = context.task.skills ?? []
  const subtaskSections = (context.task.subtasks ?? []).map((subtask) => {
    const ids = new Set(getSubtaskSkillIds(subtask))
    const rows = context.skills.filter((skill) => ids.has(skill.id))
    return `## ${subtask.title}\n\n${rows.length ? rows.map((skill) => `- ${skill.name} (${skill.status})${skill.descriptionMarkdown ? `: ${skill.descriptionMarkdown.replace(/\n/g, ' ')}` : ''}`).join('\n') : '-'}`
  })
  return `# Skills

## Task
${taskSkills.length ? taskSkills.map((skill) => `- ${skill.name} (${skill.status})${skill.descriptionMarkdown ? `: ${skill.descriptionMarkdown.replace(/\n/g, ' ')}` : ''}`).join('\n') : '-'}

${subtaskSections.join('\n\n')}
`
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

async function addAttachmentFiles(zip: ZipInput, basePath: string, attachments: TaskAttachment[]): Promise<AttachmentExportStatus[]> {
  const statuses: AttachmentExportStatus[] = []
  for (const attachment of attachments) {
    if (!attachment.url.startsWith('file://')) {
      statuses.push({ path: basePath, name: attachment.name, status: 'linked', url: attachment.url })
      continue
    }
    const bytes = await readFileUrl(attachment.url)
    if (!bytes) {
      statuses.push({ path: basePath, name: attachment.name, status: 'unavailable', url: attachment.url })
      continue
    }
    const fileName = safeName(attachment.name, 'attachment')
    zip[`${basePath}/${fileName}`] = bytes
    statuses.push({ path: basePath, name: fileName, status: 'included', url: attachment.url })
  }
  return statuses
}

export async function downloadTaskZip(context: ExportContext): Promise<void> {
  const zip: ZipInput = {
    'AGENT.md': strToU8(buildAgentMarkdown(context)),
    'Skills.md': strToU8(buildSkillsMarkdown(context))
  }
  const exportStatuses: AttachmentExportStatus[] = []
  const subtaskExportStatuses: SubtaskExportStatusMap = {}
  exportStatuses.push(...await addAttachmentFiles(zip, 'attachments', getTaskAttachments(context.task)))
  for (const subtask of context.task.subtasks ?? []) {
    const folder = `Subtasks/${entityFolder(subtask.title, subtask.id, 'subtask')}`
    const subtaskStatuses = await addAttachmentFiles(zip, `${folder}/attachments`, getSubtaskAttachments(subtask))
    subtaskExportStatuses[subtask.id] = subtaskStatuses
    exportStatuses.push(...subtaskStatuses)
  }
  zip['Task.md'] = strToU8(buildTaskMarkdown(context, exportStatuses, subtaskExportStatuses))
  const archive = zipSync(zip)
  downloadBlob(`${safeName(context.task.title, 'task')}.zip`, new Blob([archive], { type: 'application/zip' }))
}
