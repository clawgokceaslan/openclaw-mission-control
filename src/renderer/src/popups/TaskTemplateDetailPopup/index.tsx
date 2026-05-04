import { type CSSProperties, type Dispatch, type DragEvent, type ReactNode, type RefObject, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { LuBot, LuListChecks, LuListTodo, LuPaperclip, LuPencil, LuPlus, LuSettings2, LuSlidersHorizontal, LuSparkles, LuTrash2, LuUpload, LuX } from 'react-icons/lu'
import type { Agent, CodexCliGatewayConfig, CodexCliModel, CustomField, Gateway, OutputFormat, Skill, TaskChecklistItem, TaskComment, TaskTemplate, TaskTemplatePayload } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { MarkdownDescriptionEditor, type DescriptionDataFormat } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import { AttachmentTable } from '@renderer/components/attachments/AttachmentTable'
import type { AttachmentRow } from '@renderer/components/attachments/attachments'
import { PROJECT_STATUS_COLUMNS, resolveProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import styles from './index.module.scss'

export type TaskTemplateSaveState = 'saved' | 'dirty' | 'saving' | 'failed'
export type TaskTemplateBuilderTab = 'subtasks' | 'customFields' | 'checklist' | 'attachments' | 'skills' | 'model'
export type TaskTemplateSubtaskDetailTab = 'agent' | 'skills' | 'customFields' | 'checklist' | 'attachments'
export type TaskTemplateDraftSubtask = NonNullable<TaskTemplatePayload['subtasks']>[number] & { uiId: string }
export type TaskTemplateTextDraftRow = { id: string; title: string }
export type TaskTemplateCustomFieldDraftRow = { id: string; field: AppSelectOption | null; value: string }
export type TaskTemplateDataFormatRole = OutputFormat['formatRole']

type MaybePromise = void | Promise<void>

type PopupShellProps = {
  title: string
  nested?: boolean
  actions?: ReactNode
  onClose: () => void
  onFilesDrop?: (files: File[]) => void
  children: ReactNode
}

type CommentsPaneProps = {
  bodyRef?: RefObject<HTMLDivElement | null>
  splitTemplate?: string
  onResizeStart: () => void
  comments: TaskComment[]
  commentDraft: string
  editingCommentId: string | null
  placeholder: string
  onCommentDraftChange: (value: string) => void
  onSubmitComment: () => void
  onEditComment: (comment: TaskComment) => void
  onRemoveComment: (comment: TaskComment) => void
  onCancelEditComment: () => void
  children: ReactNode
}

export interface TaskTemplateDetailPopupProps {
  template: TaskTemplate
  nameDraft: string
  descriptionDraft: string
  templateDraft: TaskTemplatePayload
  draftSubtasks: TaskTemplateDraftSubtask[]
  selectedSubtask: TaskTemplateDraftSubtask | null
  saveState: TaskTemplateSaveState
  saveError: string | null
  activeTab: TaskTemplateBuilderTab
  setActiveTab: Dispatch<SetStateAction<TaskTemplateBuilderTab>>
  subtaskDetailTab: TaskTemplateSubtaskDetailTab
  setSubtaskDetailTab: Dispatch<SetStateAction<TaskTemplateSubtaskDetailTab>>
  bodyRef: RefObject<HTMLDivElement | null>
  splitTemplate: string
  onResizeStart: () => void
  onClose: () => MaybePromise
  onImportJson: () => void
  onDeleteTemplate: () => void
  onCloseSubtaskDetail: () => void
  onFilesDrop: (files: File[]) => void
  onSubtaskFilesDrop: (files: File[]) => void
  resizeTitleTextarea: (element: HTMLTextAreaElement | null) => void
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onPatchTemplate: (patch: Partial<TaskTemplatePayload>) => void
  onPatchSubtasks: (updater: (current: TaskTemplateDraftSubtask[]) => TaskTemplateDraftSubtask[]) => void
  onUpdateSelectedSubtask: (patch: Partial<TaskTemplateDraftSubtask>) => void
  onUpdateSelectedSubtaskPayload: (patch: Record<string, unknown>) => void
  onPersistNow: () => MaybePromise
  onCreateDescriptionDataFormat: (role: TaskTemplateDataFormatRole) => Promise<DescriptionDataFormat | null>
  tagOptions: AppSelectOption[]
  selectedTags: AppSelectOption[]
  selectedSkillObjects: Skill[]
  selectedSubtaskTags: AppSelectOption[]
  selectedSubtaskAgent: Agent | null
  selectedSubtaskSkillObjects: Skill[]
  selectedSubtaskChecklistItems: TaskChecklistItem[]
  agents: Agent[]
  skills: Skill[]
  customFields: CustomField[]
  outputFormats: OutputFormat[]
  templateAttachmentRows: AttachmentRow[]
  subtaskAttachmentRows: AttachmentRow[]
  isAttachmentUploading: boolean
  onUploadTemplateAttachments: (files: File[]) => MaybePromise
  onUploadSubtaskAttachments: (files: File[]) => MaybePromise
  onRemoveTemplateAttachment: (row: AttachmentRow) => void
  onRemoveSubtaskAttachment: (row: AttachmentRow) => void
  onAttachmentError: (message: string) => void
  commentDraft: string
  setCommentDraft: Dispatch<SetStateAction<string>>
  editingCommentId: string | null
  onSubmitComment: () => void
  onStartEditComment: (comment: TaskComment) => void
  onRemoveComment: (commentId: string) => void
  onCancelEditComment: () => void
  subtaskCommentDraft: string
  setSubtaskCommentDraft: Dispatch<SetStateAction<string>>
  editingSubtaskCommentId: string | null
  onSubmitSubtaskComment: () => void
  onStartEditSubtaskComment: (comment: TaskComment) => void
  onRemoveSubtaskComment: (comment: TaskComment) => void
  onCancelEditSubtaskComment: () => void
  editingTemplateSubtaskId: string | null
  setEditingTemplateSubtaskId: Dispatch<SetStateAction<string | null>>
  templateSubtaskDraft: string
  setTemplateSubtaskDraft: Dispatch<SetStateAction<string>>
  onScheduleOpenSubtaskDetail: (subtaskId: string) => void
  onStartTemplateSubtaskRename: (subtask: TaskTemplateDraftSubtask) => void
  onSaveTemplateSubtaskRename: () => void
  isSubtaskModalOpen: boolean
  setIsSubtaskModalOpen: Dispatch<SetStateAction<boolean>>
  subtaskRows: TaskTemplateTextDraftRow[]
  setSubtaskRows: Dispatch<SetStateAction<TaskTemplateTextDraftRow[]>>
  onAddSubtaskRows: () => void
  isChecklistModalOpen: boolean
  setIsChecklistModalOpen: Dispatch<SetStateAction<boolean>>
  checklistRows: TaskTemplateTextDraftRow[]
  setChecklistRows: Dispatch<SetStateAction<TaskTemplateTextDraftRow[]>>
  onOpenChecklistModal: () => void
  onOpenSubtaskChecklistModal: () => void
  onAddChecklistRows: () => void
  onSetSubtaskAgent: (agentId: string | null) => MaybePromise
  onToggleSubtaskChecklistItem: (itemId: string) => MaybePromise
  onRemoveSubtaskChecklistItem: (itemId: string) => MaybePromise
  customFieldOptions: AppSelectOption[]
  customFieldError: string | null
  selectedCustomField: AppSelectOption | null
  setSelectedCustomField: Dispatch<SetStateAction<AppSelectOption | null>>
  customFieldDraft: string
  setCustomFieldDraft: Dispatch<SetStateAction<string>>
  isCustomFieldModalOpen: boolean
  setIsCustomFieldModalOpen: Dispatch<SetStateAction<boolean>>
  isCreateCustomFieldOpen: boolean
  setIsCreateCustomFieldOpen: Dispatch<SetStateAction<boolean>>
  customFieldRows: TaskTemplateCustomFieldDraftRow[]
  setCustomFieldRows: Dispatch<SetStateAction<TaskTemplateCustomFieldDraftRow[]>>
  quickFieldName: string
  setQuickFieldName: Dispatch<SetStateAction<string>>
  quickFieldType: CustomField['type']
  setQuickFieldType: Dispatch<SetStateAction<CustomField['type']>>
  onOpenCustomFieldModal: () => void
  onAddCustomFieldRows: () => void
  onAddCustomFieldValue: (isSubtask?: boolean) => void
  onCreateCustomFieldFromModal: () => MaybePromise
  onRemoveCustomFieldValue: (fieldId: string, isSubtask?: boolean) => void
  inputFormatOptions: AppSelectOption[]
  outputFormatOptions: AppSelectOption[]
  isOutputFormatModalOpen: boolean
  setIsOutputFormatModalOpen: Dispatch<SetStateAction<boolean>>
  isCreateOutputFormatOpen: boolean
  setIsCreateOutputFormatOpen: Dispatch<SetStateAction<boolean>>
  outputFormatDraftOption: AppSelectOption | null
  setOutputFormatDraftOption: Dispatch<SetStateAction<AppSelectOption | null>>
  dataFormatRoleDraft: TaskTemplateDataFormatRole
  onSaveOutputFormatFromModal: () => void
  quickOutputFormatName: string
  setQuickOutputFormatName: Dispatch<SetStateAction<string>>
  quickOutputFormatDescription: string
  setQuickOutputFormatDescription: Dispatch<SetStateAction<string>>
  onCreateOutputFormatFromModal: () => MaybePromise
  gateways: Gateway[]
  templateCodexGatewayId: string
  templateCodexModel: string
  selectedTemplateGateway: Gateway | null
  templateGatewayOptions: AppSelectOption[]
  selectedTemplateGatewayOption: AppSelectOption | null
  templateModelOptions: AppSelectOption[]
  selectedTemplateModelOption: AppSelectOption | null
  codexModelOptions: CodexCliModel[]
  codexModelLoading: boolean
  codexModelError: string | null
  createLocalId: () => string
}

function codexConfigOf(gateway?: Gateway | null): CodexCliGatewayConfig {
  const template = gateway?.template && typeof gateway.template === 'object' && !Array.isArray(gateway.template)
    ? gateway.template as Partial<CodexCliGatewayConfig>
    : {}
  return {
    provider: 'codex_cli',
    codexPath: typeof template.codexPath === 'string' ? template.codexPath : gateway?.endpoint ?? 'codex',
    executionMode: template.executionMode === 'exec' ? 'exec' : 'terminal',
    models: Array.isArray(template.models) ? template.models : [],
    lastModelRefreshAt: typeof template.lastModelRefreshAt === 'number' ? template.lastModelRefreshAt : undefined,
    lastModelRefreshError: typeof template.lastModelRefreshError === 'string' ? template.lastModelRefreshError : undefined
  }
}

function codexOverride(gatewayId?: string | null, model?: string | null): TaskTemplatePayload['codex'] | undefined {
  const next: NonNullable<TaskTemplatePayload['codex']> = {}
  if (gatewayId) next.gatewayId = gatewayId
  if (model) next.model = model
  return Object.keys(next).length > 0 ? next : undefined
}

function getSubtaskPayload(subtask: TaskTemplateDraftSubtask | null): Record<string, unknown> {
  return subtask?.payload && typeof subtask.payload === 'object' && !Array.isArray(subtask.payload) ? subtask.payload : {}
}

function getSubtaskDescription(subtask: TaskTemplateDraftSubtask | null): string {
  const value = getSubtaskPayload(subtask).description
  return typeof value === 'string' ? value : ''
}

function getSubtaskComments(subtask: TaskTemplateDraftSubtask | null): TaskComment[] {
  const value = getSubtaskPayload(subtask).comments
  if (!Array.isArray(value)) return []
  return value.filter((comment): comment is TaskComment => {
    if (!comment || typeof comment !== 'object') return false
    const candidate = comment as Partial<TaskComment>
    return typeof candidate.id === 'string' && typeof candidate.body === 'string' && typeof candidate.createdAt === 'number'
  })
}

function getSubtaskCustomFields(subtask: TaskTemplateDraftSubtask | null): Record<string, unknown> {
  const value = getSubtaskPayload(subtask).customFields
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function customFieldValueToDraft(field: CustomField, value: unknown): string {
  if (field.type === 'boolean') return value === true ? 'true' : value === false ? 'false' : ''
  if (field.type === 'json') {
    if (value === undefined) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  return value == null ? '' : String(value)
}

function customFieldValueLabel(field: CustomField, value: unknown): string {
  if (value === undefined) return 'Empty'
  if (field.type === 'boolean') return value ? 'True' : 'False'
  if (field.type === 'json') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return 'Invalid JSON'
    }
  }
  return String(value)
}

function PopupShell({ title, nested = false, actions, onClose, onFilesDrop, children }: PopupShellProps) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragDepthRef = useRef(0)

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!onFilesDrop || !Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDraggingFiles(true)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!onFilesDrop) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDraggingFiles(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) onFilesDrop(files)
  }

  return (
    <>
      <div className={`${styles.backdrop} ${nested ? styles.nestedBackdrop : ''}`} onClick={onClose} />
      <section
        className={`${styles.shell} ${nested ? styles.nestedShell : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => {
          if (!onFilesDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (!onFilesDrop) return
          event.preventDefault()
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (dragDepthRef.current === 0) setIsDraggingFiles(false)
        }}
        onDrop={handleDrop}
      >
        {isDraggingFiles ? <div className={styles.dropOverlay}>Drop files here</div> : null}
        <header className={styles.header}>
          <div className={styles.headerLeft}><span className={styles.headerTitle}>{title}</span></div>
          <div className={styles.headerActions}>{actions}</div>
        </header>
        {children}
      </section>
    </>
  )
}

function CommentsLayout({
  bodyRef,
  splitTemplate,
  onResizeStart,
  comments,
  commentDraft,
  editingCommentId,
  placeholder,
  onCommentDraftChange,
  onSubmitComment,
  onEditComment,
  onRemoveComment,
  onCancelEditComment,
  children
}: CommentsPaneProps) {
  const orderedComments = [...comments].sort((a, b) => a.createdAt - b.createdAt)
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'OP'
  return (
    <div className={styles.modalBody} ref={bodyRef} style={splitTemplate ? { gridTemplateColumns: splitTemplate } as CSSProperties : undefined}>
      {children}
      <div className={styles.splitHandle} onMouseDown={onResizeStart} role="separator" aria-orientation="vertical" aria-label="Resize detail and comments panels" />
      <aside className={styles.commentsPane}>
        <header className={styles.commentsHeader}><div><h4>Comments</h4><span>{orderedComments.length} notes</span></div></header>
        <div className={styles.commentsFeed}>
          {orderedComments.map((comment) => (
            <article key={comment.id} className={styles.commentItem}>
              <div className={styles.commentAvatar}>{initials(comment.authorName || 'Operator')}</div>
              <div className={styles.commentContent}>
                <div className={styles.commentMeta}><strong>{comment.authorName || 'Operator'}</strong><span>{new Date(comment.createdAt).toLocaleString()}</span></div>
                <p>{comment.body}</p>
                <div className={styles.commentActions}>
                  <button type="button" className={styles.commentIconBtn} onClick={() => onEditComment(comment)} title="Edit comment" aria-label="Edit comment"><LuPencil size={13} /></button>
                  <button type="button" className={styles.commentIconBtn} onClick={() => onRemoveComment(comment)} title="Delete comment" aria-label="Delete comment"><LuTrash2 size={13} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
        <section className={styles.commentsComposer}>
          <div className={styles.commentsComposerHeader}>
            <span>{editingCommentId ? 'Editing comment' : 'New comment'}</span>
            {editingCommentId ? <button type="button" onClick={onCancelEditComment} aria-label="Cancel comment edit"><LuX size={14} /></button> : null}
          </div>
          <textarea
            rows={3}
            value={commentDraft}
            onChange={(event) => onCommentDraftChange(event.target.value)}
            placeholder={placeholder}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSubmitComment()
              }
              if (event.key === 'Escape') onCancelEditComment()
            }}
          />
          <div className={styles.commentComposerFooter}>
            <span>{editingCommentId ? 'Esc cancels edit' : 'Enter sends, Shift+Enter adds a line'}</span>
            <button type="button" onClick={onSubmitComment} disabled={!commentDraft.trim()}>
              {editingCommentId ? 'Save' : 'Send'}
            </button>
          </div>
        </section>
      </aside>
    </div>
  )
}

function markdownSnippet(markdown?: string): string {
  const normalized = (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\-[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || 'No description.'
}

function AgentPanel({
  agent,
  agents,
  ctaDescription,
  onChange
}: {
  agent: Agent | null
  agents: Agent[]
  ctaDescription: string
  onChange: (agentId: string | null) => MaybePromise
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('tr')
    return [...agents]
      .filter((item) => {
        if (!normalizedQuery) return true
        return [item.name, item.title, item.status, item.description, item.trainingMarkdown]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('tr').includes(normalizedQuery))
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [agents, query])

  const chooseAgent = async (agentId: string | null) => {
    setIsSaving(true)
    try {
      await onChange(agentId)
      setQuery('')
      setIsPickerOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={styles.skillsPanel}>
      <div className={styles.tabCtaCard}>
        <div>
          <strong>{agent ? 'Change agent' : 'Select agent'}</strong>
          <span>{ctaDescription}</span>
        </div>
        <button type="button" className={styles.tabActionButton} onClick={() => { setQuery(''); setIsPickerOpen(true) }}>
          <LuBot size={15} />
          {agent ? 'Change agent' : 'Select agent'}
        </button>
      </div>

      <div className={styles.skillsTableWrap}>
        {agent ? (
          <table className={styles.skillsTable}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Details</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className={styles.skillPrimary}>{agent.name}</span></td>
                <td>{agent.title || 'General'}</td>
                <td><span className={styles.skillBadge}>{agent.status || 'active'}</span></td>
                <td><span className={styles.skillDescription}>{markdownSnippet(agent.description || agent.trainingMarkdown)}</span></td>
                <td>
                  <button type="button" className={styles.skillActionButton} onClick={() => void chooseAgent(null)}>
                    Clear
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className={styles.customFieldEmpty}>No agent assigned to this template subtask.</p>
        )}
      </div>

      {isPickerOpen ? (
        <div className={styles.nestedCreateBackdrop} role="presentation">
          <section className={styles.skillPickerDialog} role="dialog" aria-modal="true" aria-label="Select subtask agent">
            <header>
              <div>
                <h4>Select agent</h4>
                <p>{agent?.name ?? 'Unassigned'}</p>
              </div>
              <button type="button" onClick={() => setIsPickerOpen(false)} aria-label="Close agent picker"><LuX size={15} /></button>
            </header>
            <div className={styles.skillSearch}>
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents..." />
            </div>
            <div className={styles.skillPickerList}>
              {filteredAgents.length > 0 ? filteredAgents.map((item) => {
                const selected = agent?.id === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.skillPickerRow} ${selected ? styles.skillPickerRowSelected : ''}`}
                    disabled={selected || isSaving}
                    onClick={() => void chooseAgent(item.id)}
                  >
                    <span className={styles.skillPickerCheck}>{selected ? 'OK' : ''}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.title || 'General'} - {markdownSnippet(item.description || item.trainingMarkdown)}</small>
                    </span>
                  </button>
                )
              }) : <p className={styles.customFieldEmpty}>No agents found.</p>}
            </div>
            <footer>
              <button type="button" onClick={() => setIsPickerOpen(false)}>Cancel</button>
              <button type="button" onClick={() => void chooseAgent(null)} disabled={!agent || isSaving}>Clear agent</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function SkillsPanel({
  selectedSkills,
  skills,
  source,
  ctaDescription,
  onChange
}: {
  selectedSkills: Skill[]
  skills: Skill[]
  source: string
  ctaDescription: string
  onChange: (skillIds: string[]) => MaybePromise
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map((skill) => skill.id)), [selectedSkills])
  const selectedRows = useMemo(() => [...selectedSkills].sort((a, b) => a.name.localeCompare(b.name, 'tr')), [selectedSkills])
  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('tr')
    return [...skills]
      .filter((skill) => skill.status === 'active' || skill.enabled || selectedSkillIds.has(skill.id))
      .filter((skill) => {
        if (!normalizedQuery) return true
        return [skill.name, skill.status, skill.category, skill.descriptionMarkdown]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('tr').includes(normalizedQuery))
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [query, selectedSkillIds, skills])

  const toggleDraftSkill = (skillId: string) => {
    setDraftSkillIds((current) => current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId])
  }

  const saveDraftSkills = async () => {
    if (draftSkillIds.length === 0) return
    setIsSaving(true)
    try {
      await onChange([...selectedSkillIds, ...draftSkillIds])
      setDraftSkillIds([])
      setQuery('')
      setIsPickerOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  const removeSkill = async (skillId: string) => {
    await onChange(selectedRows.filter((skill) => skill.id !== skillId).map((skill) => skill.id))
  }

  return (
    <div className={styles.skillsPanel}>
      <div className={styles.tabCtaCard}>
        <div>
          <strong>Attach skills</strong>
          <span>{ctaDescription}</span>
        </div>
        <button
          type="button"
          className={styles.tabActionButton}
          onClick={() => {
            setDraftSkillIds([])
            setQuery('')
            setIsPickerOpen(true)
          }}
        >
          <LuSparkles size={15} />
          Add skills
        </button>
      </div>

      <div className={styles.skillsTableWrap}>
        {selectedRows.length > 0 ? (
          <table className={styles.skillsTable}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Status</th>
                <th>Details</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((skill) => (
                <tr key={skill.id}>
                  <td><span className={styles.skillPrimary}>{skill.name}</span></td>
                  <td>{skill.category || 'General'}</td>
                  <td><span className={styles.skillBadge}>{skill.status || (skill.enabled ? 'active' : 'inactive')}</span></td>
                  <td><span className={styles.skillDescription}>{markdownSnippet(skill.descriptionMarkdown)}</span></td>
                  <td>
                    <button type="button" className={styles.skillActionButton} onClick={() => void removeSkill(skill.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.customFieldEmpty}>No skills attached to this {source.toLowerCase()}.</p>
        )}
      </div>

      {isPickerOpen ? (
        <div className={styles.nestedCreateBackdrop} role="presentation">
          <section className={styles.skillPickerDialog} role="dialog" aria-modal="true" aria-label={`Select ${source} skills`}>
            <header>
              <div>
                <h4>Select skills</h4>
                <p>{draftSkillIds.length} selected</p>
              </div>
              <button type="button" onClick={() => setIsPickerOpen(false)} aria-label="Close skills picker"><LuX size={15} /></button>
            </header>
            <div className={styles.skillSearch}>
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills..." />
            </div>
            <div className={styles.skillPickerList}>
              {filteredSkills.length > 0 ? filteredSkills.map((skill) => {
                const selected = selectedSkillIds.has(skill.id)
                const drafted = draftSkillIds.includes(skill.id)
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={`${styles.skillPickerRow} ${selected || drafted ? styles.skillPickerRowSelected : ''}`}
                    disabled={selected}
                    onClick={() => toggleDraftSkill(skill.id)}
                  >
                    <span className={styles.skillPickerCheck}>{selected || drafted ? 'OK' : ''}</span>
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.category || 'General'} - {markdownSnippet(skill.descriptionMarkdown)}</small>
                    </span>
                  </button>
                )
              }) : <p className={styles.customFieldEmpty}>No skills found.</p>}
            </div>
            <footer>
              <button type="button" onClick={() => setIsPickerOpen(false)}>Cancel</button>
              <button type="button" onClick={() => void saveDraftSkills()} disabled={draftSkillIds.length === 0 || isSaving}>
                {isSaving ? 'Saving...' : 'Add selected'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export function TaskTemplateDetailPopup(props: TaskTemplateDetailPopupProps) {
  const {
    nameDraft,
    descriptionDraft,
    templateDraft,
    draftSubtasks,
    selectedSubtask,
    saveState,
    saveError,
    activeTab,
    setActiveTab,
    subtaskDetailTab,
    setSubtaskDetailTab,
    bodyRef,
    splitTemplate,
    onResizeStart,
    onClose,
    onImportJson,
    onDeleteTemplate,
    onCloseSubtaskDetail,
    onFilesDrop,
    onSubtaskFilesDrop,
    resizeTitleTextarea,
    onNameChange,
    onDescriptionChange,
    onPatchTemplate,
    onPatchSubtasks,
    onUpdateSelectedSubtask,
    onUpdateSelectedSubtaskPayload,
    onPersistNow,
    onCreateDescriptionDataFormat,
    tagOptions,
    selectedTags,
    selectedSkillObjects,
    selectedSubtaskTags,
    selectedSubtaskAgent,
    selectedSubtaskSkillObjects,
    selectedSubtaskChecklistItems,
    agents,
    skills,
    customFields,
    outputFormats,
    templateAttachmentRows,
    subtaskAttachmentRows,
    isAttachmentUploading,
    onUploadTemplateAttachments,
    onUploadSubtaskAttachments,
    onRemoveTemplateAttachment,
    onRemoveSubtaskAttachment,
    onAttachmentError,
    commentDraft,
    setCommentDraft,
    editingCommentId,
    onSubmitComment,
    onStartEditComment,
    onRemoveComment,
    onCancelEditComment,
    subtaskCommentDraft,
    setSubtaskCommentDraft,
    editingSubtaskCommentId,
    onSubmitSubtaskComment,
    onStartEditSubtaskComment,
    onRemoveSubtaskComment,
    onCancelEditSubtaskComment,
    editingTemplateSubtaskId,
    setEditingTemplateSubtaskId,
    templateSubtaskDraft,
    setTemplateSubtaskDraft,
    onScheduleOpenSubtaskDetail,
    onStartTemplateSubtaskRename,
    onSaveTemplateSubtaskRename,
    isSubtaskModalOpen,
    setIsSubtaskModalOpen,
    subtaskRows,
    setSubtaskRows,
    onAddSubtaskRows,
    isChecklistModalOpen,
    setIsChecklistModalOpen,
    checklistRows,
    setChecklistRows,
    onOpenChecklistModal,
    onOpenSubtaskChecklistModal,
    onAddChecklistRows,
    onSetSubtaskAgent,
    onToggleSubtaskChecklistItem,
    onRemoveSubtaskChecklistItem,
    customFieldOptions,
    customFieldError,
    selectedCustomField,
    setSelectedCustomField,
    customFieldDraft,
    setCustomFieldDraft,
    isCustomFieldModalOpen,
    setIsCustomFieldModalOpen,
    isCreateCustomFieldOpen,
    setIsCreateCustomFieldOpen,
    customFieldRows,
    setCustomFieldRows,
    quickFieldName,
    setQuickFieldName,
    quickFieldType,
    setQuickFieldType,
    onOpenCustomFieldModal,
    onAddCustomFieldRows,
    onAddCustomFieldValue,
    onCreateCustomFieldFromModal,
    onRemoveCustomFieldValue,
    inputFormatOptions,
    outputFormatOptions,
    isOutputFormatModalOpen,
    setIsOutputFormatModalOpen,
    isCreateOutputFormatOpen,
    setIsCreateOutputFormatOpen,
    outputFormatDraftOption,
    setOutputFormatDraftOption,
    dataFormatRoleDraft,
    onSaveOutputFormatFromModal,
    quickOutputFormatName,
    setQuickOutputFormatName,
    quickOutputFormatDescription,
    setQuickOutputFormatDescription,
    onCreateOutputFormatFromModal,
    gateways,
    templateCodexGatewayId,
    templateCodexModel,
    selectedTemplateGateway,
    templateGatewayOptions,
    selectedTemplateGatewayOption,
    templateModelOptions,
    selectedTemplateModelOption,
    codexModelOptions,
    codexModelLoading,
    codexModelError,
    createLocalId
  } = props

  const nextSubtaskRowFocusRef = useRef<string | null>(null)

  useEffect(() => {
    if (!nextSubtaskRowFocusRef.current) return
    const input = document.querySelector<HTMLInputElement>(`[data-template-subtask-row-id="${nextSubtaskRowFocusRef.current}"]`)
    if (!input) return
    input.focus()
    nextSubtaskRowFocusRef.current = null
  }, [subtaskRows])

  const statusText = saveState === 'saving' ? 'Saving...' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'failed' ? 'Failed' : 'Saved'
  const subtaskStatus = selectedSubtask?.status || PROJECT_STATUS_COLUMNS[0].status
  const selectedSubtaskStatusColumn = resolveProjectStatusColumn(subtaskStatus, PROJECT_STATUS_COLUMNS)
  const templateActions = (
    <>
      <button type="button" className={styles.iconButton} onClick={onImportJson} aria-label="Import template JSON" title="Import JSON"><LuUpload size={16} /></button>
      <button type="button" className={`${styles.iconButton} ${styles.dangerAction}`} onClick={onDeleteTemplate} aria-label="Delete template" title="Delete template"><LuTrash2 size={16} /></button>
      <button type="button" className={styles.iconButton} onClick={() => void onClose()} aria-label="Close template detail" title="Close"><LuX size={17} /></button>
    </>
  )

  const renderCustomFields = (values: Record<string, unknown>, isSubtask = false) => (
    <>
      <div className={styles.detailSectionHeader}><div><h4>Custom fields</h4><p>{Object.keys(values).length} assigned</p></div></div>
      {!isSubtask ? (
        <div className={styles.tabCtaCard}>
          <div><strong>Add custom field</strong><span>Attach a field value to this template.</span></div>
          <button type="button" className={styles.tabActionButton} onClick={onOpenCustomFieldModal}><LuPlus size={15} />Add custom field</button>
        </div>
      ) : null}
      <div className={styles.customFieldPanel}>
        {customFieldError ? <p className={styles.customFieldError}>{customFieldError}</p> : null}
        {isSubtask ? (
          <div className={styles.customFieldAddRow}>
            <AppSelect
              mode="single"
              value={selectedCustomField}
              options={customFieldOptions.filter((option) => !Object.prototype.hasOwnProperty.call(values, option.value))}
              onChange={(option) => {
                if (Array.isArray(option)) return
                setSelectedCustomField(option)
                const field = customFields.find((item) => item.id === option?.value)
                setCustomFieldDraft(field ? customFieldValueToDraft(field, field.defaultValue) : '')
              }}
              placeholder="Add custom field..."
            />
          </div>
        ) : null}
        {isSubtask && selectedCustomField ? (() => {
          const field = customFields.find((item) => item.id === selectedCustomField.value)
          if (!field) return null
          return (
            <div className={styles.customFieldEditor}>
              <div className={styles.customFieldEditorHead}><span>Add field value</span><span className={`${styles.customFieldType} ${styles[`customFieldType_${field.type}`]}`}>{field.type}</span></div>
              {field.type === 'boolean' ? (
                <select value={customFieldDraft || 'false'} onChange={(event) => setCustomFieldDraft(event.target.value)}><option value="true">True</option><option value="false">False</option></select>
              ) : (
                <textarea rows={field.type === 'json' ? 5 : 2} value={customFieldDraft} onChange={(event) => setCustomFieldDraft(event.target.value)} placeholder={field.type === 'json' ? '{ "value": true }' : 'Value'} />
              )}
              <div className={styles.customFieldEditorActions}>
                <button type="button" onClick={() => onAddCustomFieldValue(true)}>Save</button>
                <button type="button" onClick={() => { setSelectedCustomField(null); setCustomFieldDraft('') }}>Cancel</button>
              </div>
            </div>
          )
        })() : null}
        {Object.entries(values).length > 0 ? (
          <div className={styles.customFieldList}>
            {Object.entries(values).map(([fieldId, value]) => {
              const field = customFields.find((item) => item.id === fieldId)
              return (
                <div key={fieldId} className={styles.customFieldRow}>
                  <div className={styles.customFieldInfo}>
                    <div><span className={styles.customFieldName}>{field?.name ?? 'Missing custom field'}</span>{field?.description ? <p>{field.description}</p> : null}</div>
                    <span className={`${styles.customFieldType} ${field ? styles[`customFieldType_${field.type}`] : ''}`}>{field?.type ?? 'missing'}</span>
                  </div>
                  <pre className={styles.customFieldValue}>{field ? customFieldValueLabel(field, value) : String(value)}</pre>
                  <div className={styles.customFieldActions}>
                    <button type="button" aria-label={`Remove ${field?.name ?? 'custom field'}`} onClick={() => onRemoveCustomFieldValue(fieldId, isSubtask)}><LuTrash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className={styles.customFieldEmpty}>No custom fields on this {isSubtask ? 'subtask' : 'template'}.</p>
        )}
      </div>
    </>
  )

  const mainDetailPane = (
    <div className={styles.detailPane}>
      <section className={styles.breadcrumbRow}>
        <button type="button" className={styles.breadcrumbBtn} onClick={() => void onClose()}>Task templates</button>
        <span className={styles.breadcrumbSep}>&gt;</span>
        <button type="button" className={styles.breadcrumbBtnActive}>{nameDraft || 'Untitled template'}</button>
      </section>
      {saveError ? <p className={styles.builderError}>{saveError}</p> : null}
      <section className={styles.detailTop}>
        <div className={styles.taskTypeRow}><span className={styles.taskTypePill}>Template</span><span className={styles.projectContext}>{statusText}</span></div>
        <textarea
          className={styles.titleInput}
          value={nameDraft}
          ref={resizeTitleTextarea}
          rows={1}
          onInput={(event) => resizeTitleTextarea(event.currentTarget)}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Task title from template"
        />
        <div className={styles.aiHint}>Template description and task body are saved automatically</div>
        <div className={styles.topControlGrid}>
          <div className={`${styles.topControlBlock} ${styles.topControlCard} ${styles.statusControlCard}`} style={{ '--status-accent': PROJECT_STATUS_COLUMNS[0].accent } as CSSProperties}>
            <span className={styles.metaLabel}>Status</span>
            <span className={styles.statusPreviewPill}><span />Target project default</span>
          </div>
          <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
            <span className={styles.metaLabel}>Tags (shared)</span>
            <AppSelect mode="multi" variant="borderless" className={styles.tagInlineSelect} value={selectedTags} options={tagOptions} onChange={(value) => onPatchTemplate({ tagIds: Array.isArray(value) ? value.map((item) => item.value) : [] })} placeholder="Search tags..." />
          </div>
        </div>
      </section>
      <section className={styles.drawerSection}>
        <h4>Description</h4>
        <MarkdownDescriptionEditor
          className={styles.descriptionField}
          value={descriptionDraft}
          minHeight={220}
          onChange={onDescriptionChange}
          onCommit={() => void onPersistNow()}
          placeholder="Add template description, instructions, checklists or code..."
          enableDataFormatCommands
          dataFormats={outputFormats}
          onCreateDataFormat={onCreateDescriptionDataFormat}
        />
      </section>
      <section className={styles.drawerSection}>
        <div className={styles.tabRow}>
          <button type="button" className={activeTab === 'subtasks' ? styles.tabActive : styles.tabBtn} onClick={() => setActiveTab('subtasks')}><LuListTodo size={15} />Subtasks</button>
          <button type="button" className={activeTab === 'customFields' ? styles.tabActive : styles.tabBtn} onClick={() => setActiveTab('customFields')}><LuSlidersHorizontal size={15} />Custom fields</button>
          <button type="button" className={activeTab === 'checklist' ? styles.tabActive : styles.tabBtn} onClick={() => setActiveTab('checklist')}><LuListChecks size={15} />Checklist</button>
          <button type="button" className={activeTab === 'attachments' ? styles.tabActive : styles.tabBtn} onClick={() => setActiveTab('attachments')}><LuPaperclip size={15} />Attachments</button>
          <button type="button" className={activeTab === 'skills' ? styles.tabActive : styles.tabBtn} onClick={() => setActiveTab('skills')}><LuSparkles size={15} />Skills</button>
          <button type="button" className={activeTab === 'model' ? styles.tabActive : styles.tabBtn} onClick={() => setActiveTab('model')}><LuSettings2 size={15} />Model</button>
        </div>
        {activeTab === 'subtasks' ? (
          <>
            <div className={styles.detailSectionHeader}><div><h4>Subtasks</h4><p>{draftSubtasks.length} subtasks</p></div></div>
            <div className={styles.tabCtaCard}><div><strong>Add subtask</strong><span>Create a reusable child task for this template.</span></div><button type="button" className={styles.tabActionButton} onClick={() => { setSubtaskRows([{ id: createLocalId(), title: '' }]); setIsSubtaskModalOpen(true) }}><LuPlus size={15} />Add subtask</button></div>
            <div className={styles.subtaskList}>
              {draftSubtasks.map((subtask) => (
                <div key={subtask.uiId} className={styles.subtaskRow}>
                  <button type="button" className={styles.subtaskStatusToggle} aria-label="Template subtask status" title="Template subtask status"><span />Default</button>
                  <label>
                    {editingTemplateSubtaskId === subtask.uiId ? (
                      <input
                        autoFocus
                        className={styles.subtaskInlineInput}
                        value={templateSubtaskDraft}
                        onChange={(event) => setTemplateSubtaskDraft(event.target.value)}
                        onBlur={onSaveTemplateSubtaskRename}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            onSaveTemplateSubtaskRename()
                          }
                          if (event.key === 'Escape') {
                            setEditingTemplateSubtaskId(null)
                            setTemplateSubtaskDraft('')
                          }
                        }}
                      />
                    ) : (
                      <span className={styles.editableSubtaskTitle} onClick={(event) => { event.stopPropagation(); onScheduleOpenSubtaskDetail(subtask.uiId) }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onStartTemplateSubtaskRename(subtask) }}>{subtask.title || 'Untitled subtask'}</span>
                    )}
                  </label>
                  <button type="button" className={styles.subtaskRemoveBtn} onClick={() => onPatchSubtasks((current) => current.filter((item) => item.uiId !== subtask.uiId))} aria-label="Remove subtask" title="Remove subtask"><LuTrash2 size={14} /></button>
                </div>
              ))}
              {draftSubtasks.length === 0 ? <p className={styles.customFieldEmpty}>No subtasks in this template.</p> : null}
            </div>
          </>
        ) : activeTab === 'customFields' ? renderCustomFields(templateDraft.customFieldValues ?? {}) : activeTab === 'checklist' ? (
          <>
            <div className={styles.detailSectionHeader}><div><h4>Checklist</h4><p>{(templateDraft.checklistItems ?? []).filter((item) => item.checked).length} checked / {(templateDraft.checklistItems ?? []).length} total</p></div></div>
            <div className={styles.checklistPanel}>
              <div className={styles.checklistProgress}><span style={{ width: `${(templateDraft.checklistItems ?? []).length > 0 ? Math.round((((templateDraft.checklistItems ?? []).filter((item) => item.checked).length) / (templateDraft.checklistItems ?? []).length) * 100) : 0}%` }} /></div>
              <div className={styles.tabCtaCard}><div><strong>Add checklist item</strong><span>Add multiple checklist items in one flow.</span></div><button type="button" className={styles.tabActionButton} onClick={onOpenChecklistModal}><LuPlus size={15} />Add checklist item</button></div>
              {(templateDraft.checklistItems ?? []).length > 0 ? (
                <div className={styles.checklistList}>
                  {(templateDraft.checklistItems ?? []).map((item) => (
                    <div key={item.id} className={styles.checklistRow}>
                      <input type="checkbox" checked={item.checked} onChange={() => onPatchTemplate({ checklistItems: (templateDraft.checklistItems ?? []).map((entry) => entry.id === item.id ? { ...entry, checked: !entry.checked, updatedAt: Date.now() } : entry) })} />
                      <span className={item.checked ? styles.checklistItemChecked : styles.checklistItemTitle}>{item.title}</span>
                      <button type="button" onClick={() => onPatchTemplate({ checklistItems: (templateDraft.checklistItems ?? []).filter((entry) => entry.id !== item.id) })} aria-label={`Remove ${item.title}`}><LuTrash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              ) : <p className={styles.customFieldEmpty}>No checklist items yet.</p>}
            </div>
          </>
        ) : activeTab === 'attachments' ? (
          <>
            <div className={styles.detailSectionHeader}><div><h4>Attachments</h4><p>{templateAttachmentRows.length} files</p></div></div>
            <AttachmentTable rows={templateAttachmentRows} uploading={isAttachmentUploading} onUpload={(files) => void onUploadTemplateAttachments(files)} onRemove={onRemoveTemplateAttachment} onError={onAttachmentError} />
          </>
        ) : activeTab === 'skills' ? (
          <>
            <div className={styles.detailSectionHeader}><div><h4>Skills</h4><p>{selectedSkillObjects.length} selected</p></div></div>
            <SkillsPanel selectedSkills={selectedSkillObjects} skills={skills} source="Template" ctaDescription="Select one or more default skills for this template." onChange={(skillIds) => onPatchTemplate({ skillIds })} />
          </>
        ) : activeTab === 'model' ? (
          <>
            <div className={styles.detailSectionHeader}><div><h4>Model</h4><p>{templateDraft.codex?.model || 'Project default'}</p></div></div>
            <div className={styles.codexSummaryCard}>
              <div><span>Gateway</span><strong>{templateCodexGatewayId ? selectedTemplateGateway?.name ?? templateCodexGatewayId : 'Project default gateway'}</strong></div>
              <div><span>Model</span><strong>{templateCodexModel || 'Project default model'}</strong></div>
            </div>
            <div className={styles.settingsFormGrid}>
              <label>
                <span>Template gateway</span>
                <AppSelect
                  value={selectedTemplateGatewayOption}
                  options={templateGatewayOptions}
                  placeholder="Use project default gateway"
                  isClearable
                  onChange={(option) => {
                    const nextGatewayId = option?.value ?? ''
                    const nextGateway = nextGatewayId ? gateways.find((gateway) => gateway.id === nextGatewayId) : null
                    const models = nextGateway ? codexConfigOf(nextGateway).models ?? [] : codexModelOptions
                    const nextModel = templateCodexModel && models.some((model) => model.id === templateCodexModel) ? templateCodexModel : ''
                    onPatchTemplate({ codex: codexOverride(nextGatewayId || null, nextModel || null) })
                  }}
                />
              </label>
              <label>
                <span>Template model</span>
                <AppSelect value={selectedTemplateModelOption} options={templateModelOptions} placeholder={codexModelLoading ? 'Loading models...' : 'Use project default model'} isClearable isDisabled={templateModelOptions.length === 0} onChange={(option) => onPatchTemplate({ codex: codexOverride(templateCodexGatewayId || null, option?.value ?? null) })} />
              </label>
            </div>
            {codexModelLoading ? <p className={styles.customFieldEmpty}>Loading models from Codex CLI...</p> : codexModelError ? <p className={styles.customFieldEmpty}>{codexModelError}</p> : templateModelOptions.length === 0 ? <p className={styles.customFieldEmpty}>No cached Codex models yet. Refresh models from Gateways to populate explicit options.</p> : null}
          </>
        ) : null}
      </section>
    </div>
  )

  const nestedSubtaskDetail = selectedSubtask ? (
    <PopupShell
      title="Subtask detail"
      nested
      onClose={onCloseSubtaskDetail}
      onFilesDrop={onSubtaskFilesDrop}
      actions={(
        <>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.dangerAction}`}
            onClick={() => {
              onPatchSubtasks((current) => current.filter((item) => item.uiId !== selectedSubtask.uiId))
              onCloseSubtaskDetail()
            }}
            aria-label="Delete subtask"
            title="Delete subtask"
          >
            <LuTrash2 size={16} />
          </button>
          <button type="button" className={styles.iconButton} onClick={onCloseSubtaskDetail} aria-label="Close subtask detail" title="Close"><LuX size={17} /></button>
        </>
      )}
    >
      <CommentsLayout
        bodyRef={bodyRef}
        splitTemplate={splitTemplate}
        onResizeStart={onResizeStart}
        comments={getSubtaskComments(selectedSubtask)}
        commentDraft={subtaskCommentDraft}
        editingCommentId={editingSubtaskCommentId}
        placeholder={editingSubtaskCommentId ? 'Edit subtask comment...' : 'Write a subtask comment...'}
        onCommentDraftChange={setSubtaskCommentDraft}
        onSubmitComment={onSubmitSubtaskComment}
        onEditComment={onStartEditSubtaskComment}
        onRemoveComment={onRemoveSubtaskComment}
        onCancelEditComment={onCancelEditSubtaskComment}
      >
        <div className={styles.detailPane}>
          <section className={styles.breadcrumbRow}>
            <button type="button" className={styles.breadcrumbBtn} onClick={onCloseSubtaskDetail}>{templateDraft.title || nameDraft}</button>
            <span className={styles.breadcrumbSep}>&gt;</span>
            <button type="button" className={styles.breadcrumbBtnActive}>{selectedSubtask.title || 'Subtask detail'}</button>
          </section>
          <section className={styles.detailTop}>
            <div className={styles.taskTypeRow}><span className={styles.taskTypePill}>Subtask</span><span className={styles.projectContext}>in template</span></div>
            {editingTemplateSubtaskId === selectedSubtask.uiId ? (
              <textarea
                autoFocus
                className={styles.titleInput}
                value={templateSubtaskDraft}
                ref={resizeTitleTextarea}
                rows={1}
                onInput={(event) => resizeTitleTextarea(event.currentTarget)}
                onChange={(event) => setTemplateSubtaskDraft(event.target.value)}
                onBlur={onSaveTemplateSubtaskRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    onSaveTemplateSubtaskRename()
                  }
                  if (event.key === 'Escape') {
                    setEditingTemplateSubtaskId(null)
                    setTemplateSubtaskDraft('')
                  }
                }}
              />
            ) : (
              <h3 className={styles.detailTitle} onClick={() => onStartTemplateSubtaskRename(selectedSubtask)}>{selectedSubtask.title || 'Untitled subtask'}</h3>
            )}
            <div className={styles.topControlGrid}>
              <div className={`${styles.topControlBlock} ${styles.topControlCard} ${styles.statusControlCard}`} style={{ '--status-accent': selectedSubtaskStatusColumn.accent } as CSSProperties}>
                <span className={styles.metaLabel}>Status</span>
                <AppSelect mode="single" variant="borderless" className={styles.statusInlineSelect} value={{ value: selectedSubtaskStatusColumn.status, label: selectedSubtaskStatusColumn.title, color: selectedSubtaskStatusColumn.accent }} options={PROJECT_STATUS_COLUMNS.map((column) => ({ value: column.status, label: column.title, color: column.accent }))} onChange={(option) => { if (!Array.isArray(option) && option?.value) onUpdateSelectedSubtask({ status: option.value }) }} />
              </div>
              <div className={`${styles.topControlBlock} ${styles.topControlCard}`}>
                <span className={styles.metaLabel}>Tags</span>
                <AppSelect mode="multi" variant="borderless" className={styles.tagInlineSelect} value={selectedSubtaskTags} options={tagOptions} onChange={(value) => onUpdateSelectedSubtaskPayload({ tagIds: Array.isArray(value) ? value.map((item) => item.value) : [] })} placeholder="Search tags..." />
              </div>
            </div>
          </section>
          <section className={styles.drawerSection}>
            <div className={styles.detailSectionHeader}><div><h4>Description</h4><p>{saveState === 'saving' ? 'Saving...' : saveState === 'dirty' ? 'Editing' : 'Ready'}</p></div></div>
            <MarkdownDescriptionEditor value={getSubtaskDescription(selectedSubtask)} className={styles.descriptionField} minHeight={220} placeholder="Add subtask description, notes, checklists or code..." enableDataFormatCommands dataFormats={outputFormats} onCreateDataFormat={onCreateDescriptionDataFormat} onChange={(nextValue) => onUpdateSelectedSubtaskPayload({ description: nextValue, inputFormatId: '', outputFormatId: '' })} onCommit={() => void onPersistNow()} />
          </section>
          <section className={styles.drawerSection}>
            <div className={styles.tabRow}>
              <button type="button" className={subtaskDetailTab === 'agent' ? styles.tabActive : styles.tabBtn} onClick={() => setSubtaskDetailTab('agent')}><LuBot size={15} />Agent</button>
              <button type="button" className={subtaskDetailTab === 'skills' ? styles.tabActive : styles.tabBtn} onClick={() => setSubtaskDetailTab('skills')}><LuSparkles size={15} />Skills</button>
              <button type="button" className={subtaskDetailTab === 'customFields' ? styles.tabActive : styles.tabBtn} onClick={() => setSubtaskDetailTab('customFields')}><LuSlidersHorizontal size={15} />Custom fields</button>
              <button type="button" className={subtaskDetailTab === 'checklist' ? styles.tabActive : styles.tabBtn} onClick={() => setSubtaskDetailTab('checklist')}><LuListChecks size={15} />Checklist</button>
              <button type="button" className={subtaskDetailTab === 'attachments' ? styles.tabActive : styles.tabBtn} onClick={() => setSubtaskDetailTab('attachments')}><LuPaperclip size={15} />Attachments</button>
            </div>
            {subtaskDetailTab === 'agent' ? (
              <>
                <div className={styles.detailSectionHeader}><div><h4>Agent</h4><p>{selectedSubtaskAgent?.name ?? 'Unassigned'}</p></div></div>
                <AgentPanel agent={selectedSubtaskAgent} agents={agents} ctaDescription="Choose the default agent for this template subtask." onChange={onSetSubtaskAgent} />
              </>
            ) : subtaskDetailTab === 'skills' ? (
              <>
                <div className={styles.detailSectionHeader}><div><h4>Skills</h4><p>{selectedSubtaskSkillObjects.length} selected</p></div></div>
                <SkillsPanel selectedSkills={selectedSubtaskSkillObjects} skills={skills} source="Subtask" ctaDescription="Select one or more default skills for this template subtask." onChange={(skillIds) => onUpdateSelectedSubtaskPayload({ skillIds })} />
              </>
            ) : subtaskDetailTab === 'customFields' ? renderCustomFields(getSubtaskCustomFields(selectedSubtask), true) : subtaskDetailTab === 'checklist' ? (
              <>
                <div className={styles.detailSectionHeader}><div><h4>Checklist</h4><p>{selectedSubtaskChecklistItems.filter((item) => item.checked).length} checked / {selectedSubtaskChecklistItems.length} total</p></div></div>
                <div className={styles.checklistPanel}>
                  <div className={styles.checklistProgress}><span style={{ width: `${selectedSubtaskChecklistItems.length > 0 ? Math.round((selectedSubtaskChecklistItems.filter((item) => item.checked).length / selectedSubtaskChecklistItems.length) * 100) : 0}%` }} /></div>
                  <div className={styles.tabCtaCard}><div><strong>Add checklist item</strong><span>Add multiple checklist items in one flow.</span></div><button type="button" className={styles.tabActionButton} onClick={onOpenSubtaskChecklistModal}><LuPlus size={15} />Add checklist item</button></div>
                  {selectedSubtaskChecklistItems.length > 0 ? (
                    <div className={styles.checklistList}>
                      {selectedSubtaskChecklistItems.map((item) => (
                        <div key={item.id} className={styles.checklistRow}>
                          <input type="checkbox" checked={item.checked} onChange={() => void onToggleSubtaskChecklistItem(item.id)} />
                          <span className={item.checked ? styles.checklistItemChecked : styles.checklistItemTitle}>{item.title}</span>
                          <button type="button" onClick={() => void onRemoveSubtaskChecklistItem(item.id)} aria-label={`Remove ${item.title}`}><LuTrash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  ) : <p className={styles.customFieldEmpty}>No checklist items on this template subtask.</p>}
                </div>
              </>
            ) : subtaskDetailTab === 'attachments' ? (
              <>
                <div className={styles.detailSectionHeader}><div><h4>Attachments</h4><p>{subtaskAttachmentRows.length} files</p></div></div>
                <AttachmentTable rows={subtaskAttachmentRows} uploading={isAttachmentUploading} onUpload={(files) => void onUploadSubtaskAttachments(files)} onRemove={onRemoveSubtaskAttachment} onError={onAttachmentError} />
              </>
            ) : null}
          </section>
        </div>
      </CommentsLayout>
    </PopupShell>
  ) : null

  return (
    <>
      <PopupShell title="Task template detail" onClose={() => void onClose()} onFilesDrop={onFilesDrop} actions={templateActions}>
        <CommentsLayout
          bodyRef={bodyRef}
          splitTemplate={splitTemplate}
          onResizeStart={onResizeStart}
          comments={templateDraft.comments ?? []}
          commentDraft={commentDraft}
          editingCommentId={editingCommentId}
          placeholder={editingCommentId ? 'Edit template comment...' : 'Write a template comment...'}
          onCommentDraftChange={setCommentDraft}
          onSubmitComment={onSubmitComment}
          onEditComment={onStartEditComment}
          onRemoveComment={(comment) => onRemoveComment(comment.id)}
          onCancelEditComment={onCancelEditComment}
        >
          {mainDetailPane}
        </CommentsLayout>
      </PopupShell>
      {nestedSubtaskDetail}
      {isSubtaskModalOpen ? (
        <>
          <div className={styles.createTaskBackdrop} onClick={() => setIsSubtaskModalOpen(false)} />
          <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add subtask">
            <header className={styles.createTaskHeader}><div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Subtask</span></div><button type="button" onClick={() => setIsSubtaskModalOpen(false)} aria-label="Close add subtask modal"><LuX size={17} /></button></header>
            <form className={styles.createTaskBody} onSubmit={(event) => { event.preventDefault(); onAddSubtaskRows() }}>
              <div className={styles.multiAddList}>
                {subtaskRows.map((row, index) => (
                  <div key={row.id} className={styles.multiAddRow}>
                    <span>{index + 1}</span>
                    <input autoFocus={index === 0} data-template-subtask-row-id={row.id} value={row.title} onChange={(event) => setSubtaskRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, title: event.target.value } : entry))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const nextRow = { id: createLocalId(), title: '' }; nextSubtaskRowFocusRef.current = nextRow.id; setSubtaskRows((current) => [...current, nextRow]) } if (event.key === 'Escape') { event.preventDefault(); setIsSubtaskModalOpen(false) } }} placeholder="Subtask name" />
                    <button type="button" onClick={() => setSubtaskRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), title: '' }])} aria-label="Remove subtask row"><LuTrash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <button type="button" className={styles.modalAddRowButton} onClick={() => { const nextRow = { id: createLocalId(), title: '' }; nextSubtaskRowFocusRef.current = nextRow.id; setSubtaskRows((current) => [...current, nextRow]) }}><LuPlus size={15} />Add row</button>
              <footer className={styles.createTaskFooter}><span>Enter adds another row.</span><button type="submit" disabled={!subtaskRows.some((row) => row.title.trim())}>Save all</button></footer>
            </form>
          </section>
        </>
      ) : null}
      {isChecklistModalOpen ? (
        <>
          <div className={styles.createTaskBackdrop} onClick={() => setIsChecklistModalOpen(false)} />
          <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add checklist items">
            <header className={styles.createTaskHeader}><div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Checklist</span></div><button type="button" onClick={() => setIsChecklistModalOpen(false)} aria-label="Close checklist modal"><LuX size={17} /></button></header>
            <form className={styles.createTaskBody} onSubmit={(event) => { event.preventDefault(); onAddChecklistRows() }}>
              <div className={styles.multiAddList}>
                {checklistRows.map((row, index) => (
                  <div key={row.id} className={styles.multiAddRow}>
                    <span>{index + 1}</span>
                    <input autoFocus={index === 0} value={row.title} onChange={(event) => setChecklistRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, title: event.target.value } : entry))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setChecklistRows((current) => [...current, { id: createLocalId(), title: '' }]) } if (event.key === 'Escape') { event.preventDefault(); setIsChecklistModalOpen(false) } }} placeholder="Checklist item title" />
                    <button type="button" onClick={() => setChecklistRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), title: '' }])} aria-label="Remove checklist row"><LuTrash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <button type="button" className={styles.modalAddRowButton} onClick={() => setChecklistRows((current) => [...current, { id: createLocalId(), title: '' }])}><LuPlus size={15} />Add row</button>
              <footer className={styles.createTaskFooter}><span>Enter adds another row.</span><button type="submit" disabled={!checklistRows.some((row) => row.title.trim())}>Save all</button></footer>
            </form>
          </section>
        </>
      ) : null}
      {isCustomFieldModalOpen ? (
        <>
          <div className={styles.createTaskBackdrop} onClick={() => setIsCustomFieldModalOpen(false)} />
          <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Add custom field">
            <header className={styles.createTaskHeader}><div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Custom field</span></div><button type="button" onClick={() => setIsCustomFieldModalOpen(false)} aria-label="Close custom field modal"><LuX size={17} /></button></header>
            <div className={styles.createTaskBody}>
              {customFieldError ? <p className={styles.customFieldError}>{customFieldError}</p> : null}
              <div className={styles.multiAddList}>
                {customFieldRows.map((row, index) => {
                  const field = customFields.find((item) => item.id === row.field?.value)
                  const assignedIds = new Set(Object.keys(templateDraft.customFieldValues ?? {}))
                  const selectedOtherIds = new Set(customFieldRows.filter((entry) => entry.id !== row.id && entry.field).map((entry) => entry.field?.value ?? ''))
                  const rowOptions = customFields.filter((item) => !assignedIds.has(item.id) && !selectedOtherIds.has(item.id)).map((item) => ({ value: item.id, label: item.name }))
                  return (
                    <div key={row.id} className={styles.multiCustomFieldRow}>
                      <span>{index + 1}</span>
                      <div className={styles.multiCustomFieldMain}>
                        <label className={styles.multiCustomFieldControl}><span>Field</span><AppSelect mode="single" value={row.field} options={rowOptions} onChange={(option) => { if (Array.isArray(option)) return; const nextField = customFields.find((item) => item.id === option?.value); setCustomFieldRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, field: option, value: nextField ? customFieldValueToDraft(nextField, nextField.defaultValue) : '' } : entry)) }} placeholder="Choose field..." /></label>
                        <label className={styles.multiCustomFieldControl}><span>Value{field ? <em>{field.type}</em> : null}</span>{field?.type === 'boolean' ? <select value={row.value || 'false'} onChange={(event) => setCustomFieldRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))}><option value="true">True</option><option value="false">False</option></select> : <textarea rows={field?.type === 'json' ? 4 : 1} value={row.value} onChange={(event) => setCustomFieldRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value: event.target.value } : entry))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && field?.type !== 'json') { event.preventDefault(); setCustomFieldRows((current) => [...current, { id: createLocalId(), field: null, value: '' }]) } }} placeholder={field?.type === 'json' ? '{ "value": true }' : 'Value'} />}</label>
                      </div>
                      <button type="button" onClick={() => setCustomFieldRows((current) => current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [{ id: createLocalId(), field: null, value: '' }])} aria-label="Remove custom field row"><LuTrash2 size={14} /></button>
                    </div>
                  )
                })}
              </div>
              <div className={styles.modalInlineActions}>
                <button type="button" className={styles.modalAddRowButton} onClick={() => setCustomFieldRows((current) => [...current, { id: createLocalId(), field: null, value: '' }])}><LuPlus size={15} />Add row</button>
                <button type="button" className={styles.modalAddRowButton} onClick={() => { setQuickFieldName(''); setQuickFieldType('text'); setIsCreateCustomFieldOpen(true) }}><LuPlus size={15} />Add new custom field</button>
              </div>
              <footer className={styles.modalFooterActions}><button type="button" onClick={() => setIsCustomFieldModalOpen(false)}>Cancel</button><button type="button" className={styles.primaryModalAction} onClick={onAddCustomFieldRows}>Save all</button></footer>
              {isCreateCustomFieldOpen ? (
                <>
                  <div className={styles.nestedCreateBackdrop} onClick={() => setIsCreateCustomFieldOpen(false)} />
                  <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new custom field">
                    <header><h4>Add new custom field</h4><button type="button" onClick={() => setIsCreateCustomFieldOpen(false)} aria-label="Close custom field create popup"><LuX size={15} /></button></header>
                    <div className={styles.nestedCreateBody}><input autoFocus value={quickFieldName} onChange={(event) => setQuickFieldName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void onCreateCustomFieldFromModal() } }} placeholder="Field name" /><select value={quickFieldType} onChange={(event) => setQuickFieldType(event.target.value as CustomField['type'])}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="json">JSON</option></select></div>
                    <footer><button type="button" onClick={() => setIsCreateCustomFieldOpen(false)}>Cancel</button><button type="button" onClick={() => void onCreateCustomFieldFromModal()} disabled={!quickFieldName.trim()}>Create</button></footer>
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
      {isOutputFormatModalOpen ? (
        <>
          <div className={styles.createTaskBackdrop} onClick={() => setIsOutputFormatModalOpen(false)} />
          <section className={`${styles.createTaskModal} ${styles.fieldFlowModal}`} role="dialog" aria-modal="true" aria-label="Set data format">
            <header className={styles.createTaskHeader}><div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>{dataFormatRoleDraft === 'input' ? 'Input data format' : 'Output data format'}</span></div><button type="button" onClick={() => setIsOutputFormatModalOpen(false)} aria-label="Close data format modal"><LuX size={17} /></button></header>
            <div className={styles.createTaskBody}>
              <div className={styles.modalField}><span>Select data format</span><AppSelect mode="single" value={outputFormatDraftOption} options={dataFormatRoleDraft === 'input' ? inputFormatOptions : outputFormatOptions} onChange={(option) => { if (!Array.isArray(option)) setOutputFormatDraftOption(option) }} placeholder="No data format" isClearable /></div>
              <div className={styles.modalInlineActions}><button type="button" className={styles.modalAddRowButton} onClick={() => { setQuickOutputFormatName(''); setQuickOutputFormatDescription(''); setIsCreateOutputFormatOpen(true) }}><LuPlus size={15} />Add new data format</button></div>
              <footer className={styles.modalFooterActions}><button type="button" onClick={() => setIsOutputFormatModalOpen(false)}>Cancel</button><button type="button" className={styles.primaryModalAction} onClick={onSaveOutputFormatFromModal}>Save</button></footer>
              {isCreateOutputFormatOpen ? (
                <>
                  <div className={styles.nestedCreateBackdrop} onClick={() => setIsCreateOutputFormatOpen(false)} />
                  <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Add new data format">
                    <header><h4>Add new data format</h4><button type="button" onClick={() => setIsCreateOutputFormatOpen(false)} aria-label="Close data format create popup"><LuX size={15} /></button></header>
                    <div className={styles.nestedCreateBody}><input autoFocus value={quickOutputFormatName} onChange={(event) => setQuickOutputFormatName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void onCreateOutputFormatFromModal() } }} placeholder="Format name" /><input value={quickOutputFormatDescription} onChange={(event) => setQuickOutputFormatDescription(event.target.value)} placeholder="Description (optional)" /></div>
                    <footer><button type="button" onClick={() => setIsCreateOutputFormatOpen(false)}>Cancel</button><button type="button" onClick={() => void onCreateOutputFormatFromModal()} disabled={!quickOutputFormatName.trim()}>Create</button></footer>
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}
