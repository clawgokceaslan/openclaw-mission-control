import { FormEvent, useEffect, useState } from 'react'
import { LuCalendarPlus, LuFlag, LuFolder, LuTag, LuUpload, LuUserPlus, LuX } from 'react-icons/lu'
import type { Agent, Project, Tag, TaskEntity, TaskTemplate } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { MarkdownDescriptionEditor } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import type { ProjectStatusColumn } from './status'
import { statusOptionsFromColumns } from './status'
import { TaskJsonImportModal } from './TaskJsonImportModal'
import { parseTaskJsonImportPreview } from './taskJsonImport'
import styles from '../ProjectDetailPage.module.scss'

interface CreateTaskModalProps {
  open: boolean
  project: Project | null
  projects?: Project[]
  selectedProjectId?: string
  tags: Tag[]
  agents: Agent[]
  templates: TaskTemplate[]
  statusColumns: ProjectStatusColumn[]
  defaultStatus: TaskEntity['status']
  initialTitle?: string
  initialTemplateId?: string | null
  busy: boolean
  error?: string | null
  onClose: () => void
  onProjectChange?: (projectId: string) => void
  onCreate: (input: { projectId: string; title: string; description: string; status: TaskEntity['status']; tagIds: string[]; agentId?: string | null; templateId?: string | null; importJson?: string | null }) => void
}

export function CreateTaskModal({ open, project, projects = [], selectedProjectId, tags, agents, templates, statusColumns, defaultStatus, initialTitle = '', initialTemplateId = null, busy, error, onClose, onProjectChange, onCreate }: CreateTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskEntity['status']>(defaultStatus)
  const [selectedTags, setSelectedTags] = useState<AppSelectOption[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AppSelectOption | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<AppSelectOption | null>(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importJson, setImportJson] = useState<string | null>(null)
  const tagOptions = tags.map((tag) => ({ label: tag.name, value: tag.id, color: tag.color }))
  const agentOptions = agents.map((agent) => ({ label: agent.name, value: agent.id }))
  const templateOptions = templates.map((template) => ({ label: template.name, value: template.id }))
  const projectOptions = projects.map((item) => ({ label: item.name, value: item.id }))
  const statusOptions = statusOptionsFromColumns(statusColumns)
  const currentProjectId = selectedProjectId ?? project?.id ?? ''
  const currentProject = project ?? projects.find((item) => item.id === currentProjectId) ?? null
  const requiresProject = Boolean(onProjectChange)
  const applyTemplate = (option: AppSelectOption | null) => {
    setSelectedTemplate(option)
    const template = templates.find((item) => item.id === option?.value)
    if (!template) return
    const payload = template.template
    setTitle(payload.title ?? '')
    setDescription(payload.description ?? '')
    if (payload.status && statusOptions.some((item) => item.value === payload.status)) setStatus(payload.status)
    const agent = agentOptions.find((item) => item.value === payload.agentId)
    setSelectedAgent(agent ?? null)
    const nextTagIds = new Set(payload.tagIds ?? [])
    setSelectedTags(tagOptions.filter((tag) => nextTagIds.has(tag.value)))
  }

  useEffect(() => {
    if (!open) return
    setTitle(initialTitle)
    setDescription('')
    setStatus(defaultStatus)
    setSelectedTags([])
    setSelectedAgent(null)
    setImportJson(null)
    setIsImportOpen(false)
    const templateOption = initialTemplateId ? templates.map((template) => ({ label: template.name, value: template.id })).find((option) => option.value === initialTemplateId) ?? null : null
    setSelectedTemplate(templateOption)
    if (templateOption) applyTemplate(templateOption)
  }, [open, initialTitle, initialTemplateId])

  useEffect(() => {
    if (!open) return
    setStatus(defaultStatus)
  }, [defaultStatus, currentProjectId, open])

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !currentProjectId) return
    onCreate({ projectId: currentProjectId, title: title.trim(), description: description.trim(), status, tagIds: selectedTags.map((tag) => tag.value), agentId: selectedAgent?.value ?? null, templateId: selectedTemplate?.value ?? null, importJson })
  }

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={styles.createTaskModal} role="dialog" aria-modal="true" aria-label="Create task">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Task</span></div>
          <div className={styles.createTaskHeaderActions}>
            <button type="button" onClick={() => setIsImportOpen(true)} aria-label="Import task JSON"><LuUpload size={16} /> Import JSON</button>
            <button type="button" onClick={onClose} aria-label="Close create task"><LuX size={17} /></button>
          </div>
        </header>
        <form className={styles.createTaskBody} onSubmit={submit}>
          <div className={styles.createTaskContext}>
            <span>{currentProject?.name ?? 'Select project'}</span>
            <span>Task</span>
          </div>
          {error ? <p className={styles.error}>{error}</p> : null}
          {requiresProject ? (
            <div className={styles.createTaskProjectPicker}>
              <LuFolder size={15} />
              <AppSelect
                mode="single"
                variant="borderless"
                options={projectOptions}
                value={projectOptions.find((option) => option.value === currentProjectId) ?? null}
                onChange={(option) => {
                  if (!Array.isArray(option)) onProjectChange?.(option?.value ?? '')
                }}
                placeholder="Choose project..."
              />
            </div>
          ) : null}
          <div className={styles.createTaskTags}>
            <AppSelect mode="single" variant="borderless" options={templateOptions} value={selectedTemplate} onChange={applyTemplate} isClearable placeholder="Start from template..." />
          </div>
          <input className={styles.createTaskTitle} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task Name or type '/' for commands" />
          <MarkdownDescriptionEditor
            className={styles.createTaskDescription}
            value={description}
            onChange={setDescription}
            placeholder="Add description, notes, checklists or code..."
            minHeight={116}
          />
          <div className={styles.createTaskChips}>
            <div className={styles.createTaskSelectChip}>
              <AppSelect
                mode="single"
                variant="borderless"
                options={statusOptions}
                value={statusOptions.find((option) => option.value === status) ?? statusOptions[0] ?? null}
                onChange={(option) => {
                  if (!Array.isArray(option) && option?.value) setStatus(option.value as TaskEntity['status'])
                }}
              />
            </div>
            <div className={styles.createTaskSelectChip}>
              <LuUserPlus size={14} />
              <AppSelect
                mode="single"
                variant="borderless"
                options={agentOptions}
                value={selectedAgent}
                onChange={setSelectedAgent}
                isClearable
                placeholder="Assignee"
              />
            </div>
            <span><LuCalendarPlus size={14} /> Due date</span>
            <span><LuFlag size={14} /> Priority</span>
            <span><LuTag size={14} /> Tags</span>
          </div>
          <div className={styles.createTaskTags}>
            <AppSelect mode="multi" variant="borderless" options={tagOptions} value={selectedTags} onChange={(value) => setSelectedTags(Array.isArray(value) ? value : [])} placeholder="Search or add tags..." />
          </div>
          <div className={styles.createTaskFooter}>
            <span>{currentProject ? `Creates in ${currentProject.name}` : 'Choose a project to continue'}</span>
            <button type="submit" disabled={busy || !title.trim() || !currentProjectId}>{busy ? 'Creating...' : 'Create Task'}</button>
          </div>
        </form>
      </section>
      <TaskJsonImportModal
        open={isImportOpen}
        title="Import task JSON"
        busy={busy}
        onClose={() => setIsImportOpen(false)}
        onImport={(jsonText) => {
          const preview = parseTaskJsonImportPreview(jsonText)
          setTitle(preview.title)
          setDescription(preview.description)
          setSelectedTemplate(null)
          setSelectedTags([])
          setSelectedAgent(null)
          setImportJson(jsonText)
          setIsImportOpen(false)
        }}
      />
    </>
  )
}
