import { randomUUID } from 'node:crypto'
import type { CustomField, Tag, TaskChecklistItem, TaskComment, TaskTemplatePayload } from '../../shared/types/entities.js'
import { AgentRepository } from '../../db/repositories/agent-repo.js'
import { CustomFieldRepository, TagRepository } from '../../db/repositories/custom-field-repo.js'
import { SkillRepository } from '../../db/repositories/skill-repo.js'

type ImportObject = Record<string, unknown>
type FieldType = CustomField['type']

export type NormalizedTaskJsonImport = {
  title: string
  description: string
  status: string
  agentId: string | null
  tagIds: string[]
  skillIds: string[]
  customFieldValues: Record<string, unknown>
  checklistItems: TaskChecklistItem[]
  comments: TaskComment[]
  subtasks: NormalizedImportedSubtask[]
  warnings: string[]
}

export type NormalizedImportedSubtask = {
  title: string
  description: string
  status: string
  agentId: string | null
  assigneeName: string
  tagIds: string[]
  skillIds: string[]
  customFieldValues: Record<string, unknown>
  checklistItems: TaskChecklistItem[]
  comments: TaskComment[]
  dueAt?: number
}

const UNSUPPORTED_KEYS = ['inputFormatId', 'outputFormatId', 'attachments', 'agent', 'skills']

function asObject(value: unknown): ImportObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ImportObject : {}
}

function createLocalId(): string {
  return randomUUID()
}

function parseJsonObject(value: unknown): ImportObject {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON root must be an object.')
      return parsed as ImportObject
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Enter valid JSON.')
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON root must be an object.')
  return value as ImportObject
}

function stringList(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array.`)
  return value.map((item) => {
    if (typeof item === 'string') return item.trim()
    if (item && typeof item === 'object') {
      const raw = item as ImportObject
      const value = raw.id ?? raw.name ?? raw.title ?? raw.slug
      if (typeof value === 'string') return value.trim()
    }
    return ''
  }).filter(Boolean)
}

function normalizeFieldType(value: unknown): FieldType {
  return value === 'number' || value === 'boolean' || value === 'json' ? value : 'text'
}

function normalizeFieldValue(type: FieldType, value: unknown): unknown {
  if (type === 'number') {
    const numberValue = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numberValue)) throw new Error('Number custom field value is invalid.')
    return numberValue
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
    return Boolean(value)
  }
  if (type === 'json') {
    if (typeof value !== 'string') return value
    if (!value.trim()) return null
    try {
      return JSON.parse(value)
    } catch {
      throw new Error('JSON custom field value is invalid.')
    }
  }
  return value == null ? '' : String(value)
}

function normalizeChecklist(value: unknown): TaskChecklistItem[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('checklist must be an array.')
  const now = Date.now()
  return value.flatMap((raw) => {
    const item = asObject(raw)
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title) return []
    return [{
      id: typeof item.id === 'string' && item.id.trim() ? item.id : createLocalId(),
      title,
      checked: item.checked === true,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now
    }]
  })
}

function normalizeComments(value: unknown): TaskComment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('comments must be an array.')
  const now = Date.now()
  return value.flatMap((raw) => {
    const item = asObject(raw)
    const body = typeof item.body === 'string' ? item.body.trim() : ''
    if (!body) return []
    return [{
      id: typeof item.id === 'string' && item.id.trim() ? item.id : createLocalId(),
      authorName: typeof item.authorName === 'string' && item.authorName.trim() ? item.authorName.trim() : 'Operator',
      body,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined
    }]
  })
}

function collectUnsupportedWarnings(value: ImportObject, scope: string, warnings: string[]) {
  for (const key of UNSUPPORTED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) warnings.push(`${scope}: "${key}" is not imported.`)
  }
}

export class TaskJsonImportNormalizer {
  constructor(
    private readonly orgId: string,
    private readonly agents: AgentRepository,
    private readonly tags: TagRepository,
    private readonly skills: SkillRepository,
    private readonly customFields: CustomFieldRepository
  ) {}

  async normalize(json: unknown): Promise<NormalizedTaskJsonImport> {
    const root = parseJsonObject(json)
    const warnings: string[] = []
    collectUnsupportedWarnings(root, 'Task', warnings)
    const title = typeof root.title === 'string' ? root.title.trim() : ''
    if (!title) throw new Error('title is required.')
    const description = typeof root.description === 'string' ? root.description : ''
    const status = typeof root.status === 'string' ? root.status.trim() : ''
    const tagIds = await this.resolveTags(root.tags)
    const customFieldValues = await this.resolveCustomFields(root.customFields)
    const checklistItems = normalizeChecklist(root.checklist)
    const comments = normalizeComments(root.comments)
    if (root.subtasks !== undefined && !Array.isArray(root.subtasks)) throw new Error('subtasks must be an array.')
    const subtasks: NormalizedImportedSubtask[] = []
    for (const [index, rawSubtask] of ((root.subtasks ?? []) as unknown[]).entries()) {
      const subtask = asObject(rawSubtask)
      collectUnsupportedWarnings(subtask, `Subtask ${index + 1}`, warnings)
      const subtaskTitle = typeof subtask.title === 'string' ? subtask.title.trim() : ''
      if (!subtaskTitle) throw new Error(`subtasks[${index}].title is required.`)
      const dueAt = typeof subtask.dueAt === 'number' && Number.isFinite(subtask.dueAt) ? subtask.dueAt : undefined
      subtasks.push({
        title: subtaskTitle,
        description: typeof subtask.description === 'string' ? subtask.description : '',
        status: typeof subtask.status === 'string' ? subtask.status.trim() : '',
        agentId: null,
        assigneeName: '',
        tagIds: await this.resolveTags(subtask.tags),
        skillIds: [],
        customFieldValues: await this.resolveCustomFields(subtask.customFields),
        checklistItems: normalizeChecklist(subtask.checklist),
        comments: normalizeComments(subtask.comments),
        dueAt
      })
    }
    return {
      title,
      description,
      status,
      agentId: null,
      tagIds,
      skillIds: [],
      customFieldValues,
      checklistItems,
      comments,
      subtasks,
      warnings: Array.from(new Set(warnings))
    }
  }

  toTemplatePayload(normalized: NormalizedTaskJsonImport): TaskTemplatePayload {
    return {
      title: normalized.title,
      description: normalized.description,
      status: normalized.status,
      agentId: normalized.agentId,
      tagIds: normalized.tagIds,
      skillIds: normalized.skillIds,
      customFieldValues: normalized.customFieldValues,
      checklistItems: normalized.checklistItems,
      payload: {},
      inputFormatId: null,
      outputFormatId: null,
      comments: normalized.comments,
      attachments: [],
      subtasks: normalized.subtasks.map((subtask) => ({
        title: subtask.title,
        status: subtask.status,
        agentId: subtask.agentId,
        dueAt: subtask.dueAt,
        inputFormatId: null,
        outputFormatId: null,
        payload: {
          description: subtask.description,
          agentId: subtask.agentId ?? '',
          assigneeId: subtask.agentId ?? '',
          assigneeName: subtask.assigneeName,
          tagIds: subtask.tagIds,
          skillIds: subtask.skillIds,
          customFields: subtask.customFieldValues,
          checklistItems: subtask.checklistItems,
          comments: subtask.comments,
          ...(subtask.dueAt ? { dueAt: subtask.dueAt } : {})
        }
      }))
    }
  }

  private async resolveTags(value: unknown): Promise<string[]> {
    const refs = stringList(value, 'tags')
    if (refs.length === 0) return []
    let tags = await this.tags.list(this.orgId)
    const ids: string[] = []
    for (const ref of refs) {
      const target = ref.trim().toLocaleLowerCase('tr')
      let found = tags.find((tag) => tag.id === ref || tag.name.trim().toLocaleLowerCase('tr') === target)
      if (!found) {
        found = await this.tags.create({ organizationId: this.orgId, name: ref })
        tags = [...tags, found]
      }
      ids.push(found.id)
    }
    return Array.from(new Set(ids))
  }

  private async resolveCustomFields(value: unknown): Promise<Record<string, unknown>> {
    if (value === undefined || value === null) return {}
    if (!Array.isArray(value)) throw new Error('customFields must be an array.')
    let fields = await this.customFields.list(this.orgId)
    const values: Record<string, unknown> = {}
    for (const raw of value) {
      const item = asObject(raw)
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!name) throw new Error('customFields[].name is required.')
      const target = name.trim().toLocaleLowerCase('tr')
      let field = fields.find((entry) => entry.name.trim().toLocaleLowerCase('tr') === target)
      if (!field) {
        const type = normalizeFieldType(item.type)
        field = await this.customFields.create({
          organizationId: this.orgId,
          name,
          type,
          config: { description: '' },
          description: ''
        })
        fields = [...fields, field]
      }
      values[field.id] = normalizeFieldValue(field.type, item.value)
    }
    return values
  }

}
