import { FormEvent, useEffect, useState } from 'react'
import { LuFolder, LuListChecks, LuRoute, LuTag, LuUpload, LuUserPlus, LuX } from 'react-icons/lu'
import type { Agent, Project, Tag, TaskEntity, TaskGroup, TaskTemplate } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { MarkdownDescriptionEditor } from '@renderer/components/markdown/MarkdownDescriptionEditor'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { statusOptionsFromColumns } from '@renderer/screens/projects/detail/status'
import { TaskJsonImportPopup } from '@renderer/popups/TaskJsonImport'
import { parseTaskJsonImportPreview } from '@renderer/screens/projects/detail/taskJsonImport'
import styles from './index.module.scss'

interface CreateTaskPopupProps {
  open: boolean
  project: Project | null
  projects?: Project[]
  selectedProjectId?: string
  tags: Tag[]
  agents: Agent[]
  templates: TaskTemplate[]
  taskGroups?: TaskGroup[]
  statusColumns: ProjectStatusColumn[]
  defaultStatus: TaskEntity['status']
  initialTitle?: string
  initialTemplateId?: string | null
  busy: boolean
  error?: string | null
  onClose: () => void
  onProjectChange?: (projectId: string) => void
  onCreate: (input: {
    projectId: string
    title: string
    description: string
    status: TaskEntity['status']
    tagIds: string[]
    agentId?: string | null
    templateId?: string | null
    targetGroupId?: string | null
    targetGroupOrderedTaskIds?: string[]
    importJson?: string | null
    agenticInputs?: {
      acceptanceCriteria?: string
    }
  }) => void
}

export function CreateTaskPopup({ open, project, projects = [], selectedProjectId, tags, agents, templates, taskGroups = [], statusColumns, defaultStatus, initialTitle = '', initialTemplateId = null, busy, error, onClose, onProjectChange, onCreate }: CreateTaskPopupProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskEntity['status']>(defaultStatus)
  const [selectedTags, setSelectedTags] = useState<AppSelectOption[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AppSelectOption | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<AppSelectOption | null>(null)
  const [selectedTaskGroup, setSelectedTaskGroup] = useState<AppSelectOption | null>(null)
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importJson, setImportJson] = useState<string | null>(null)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const tagOptions = tags.map((tag) => ({ label: tag.name, value: tag.id, color: tag.color }))
  const agentOptions = agents.map((agent) => ({ label: agent.name, value: agent.id }))
  const templateOptions = templates.map((template) => ({ label: template.name, value: template.id }))
  const taskGroupOptions = taskGroups.map((group) => ({ label: group.title, value: group.groupId }))
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
    setAcceptanceCriteria('')
    setImportJson(null)
    setIsImportOpen(false)
    setHasSubmitted(false)
    const templateOption = initialTemplateId ? templates.map((template) => ({ label: template.name, value: template.id })).find((option) => option.value === initialTemplateId) ?? null : null
    setSelectedTemplate(templateOption)
    setSelectedTaskGroup(null)
    if (templateOption) applyTemplate(templateOption)
  }, [open, initialTitle, initialTemplateId])

  useEffect(() => {
    if (!open) return
    setStatus(defaultStatus)
  }, [defaultStatus, currentProjectId, open])

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setHasSubmitted(true)
    if (!title.trim() || !currentProjectId) return
    onCreate({
      projectId: currentProjectId,
      title: title.trim(),
      description: description.trim(),
      status,
      tagIds: selectedTags.map((tag) => tag.value),
      agentId: selectedAgent?.value ?? null,
      templateId: selectedTemplate?.value ?? null,
      targetGroupId: selectedTaskGroup?.value ?? null,
      targetGroupOrderedTaskIds: taskGroups.find((group) => group.groupId === selectedTaskGroup?.value)?.orderedTaskIds ?? [],
      importJson,
      agenticInputs: {
        acceptanceCriteria: acceptanceCriteria.trim()
      }
    })
  }

  const titleInvalid = hasSubmitted && !title.trim()
  const projectInvalid = requiresProject && !currentProjectId
  const titleDescriptionId = titleInvalid ? 'create-task-title-error' : undefined
  const projectDescriptionId = projectInvalid ? 'create-task-project-error' : undefined

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={styles.createTaskModal} role="dialog" aria-modal="true" aria-labelledby="create-task-heading">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><h2 id="create-task-heading" className={styles.createTaskTabActive}>Task</h2></div>
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
              {projectInvalid ? <p id={projectDescriptionId} className={styles.fieldError}>Choose a project before creating the task.</p> : null}
            </div>
          ) : null}
          <div className={styles.createTaskTemplatePicker}>
            <div className={styles.createTaskFieldLabel}>
              <LuListChecks size={15} />
              <span>Template</span>
            </div>
            <AppSelect
              mode="single"
              options={templateOptions}
              value={selectedTemplate}
              onChange={applyTemplate}
              isClearable
              placeholder={templateOptions.length ? 'Start from template...' : 'No templates yet'}
              isDisabled={!templateOptions.length}
            />
          </div>
          {taskGroupOptions.length > 0 ? (
            <div className={styles.createTaskGroupPicker}>
              <div className={styles.createTaskFieldLabel}>
                <LuRoute size={15} />
                <span>Task group</span>
              </div>
              <AppSelect
                mode="single"
                options={taskGroupOptions}
                value={selectedTaskGroup}
                onChange={(option) => {
                  if (!Array.isArray(option)) setSelectedTaskGroup(option)
                }}
                isClearable
                placeholder="Add to existing group..."
              />
            </div>
          ) : null}
          <div className={styles.createTaskTitleField}>
            <input
              id="create-task-title"
              className={styles.createTaskTitle}
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => setHasSubmitted(true)}
              placeholder="Task name"
              required
              aria-invalid={titleInvalid}
              aria-describedby={titleDescriptionId}
            />
            {titleInvalid ? <p id={titleDescriptionId} className={styles.fieldError}>Task name is required.</p> : null}
          </div>
          <MarkdownDescriptionEditor
            className={styles.createTaskDescription}
            value={description}
            onChange={setDescription}
            placeholder="Add description, notes, checklists or code..."
            minHeight={180}
          />
          <div className={styles.createTaskMetaGrid}>
            <div className={styles.createTaskSelectField}>
              <div className={styles.createTaskFieldLabel}>
                <span>Status</span>
              </div>
              <AppSelect
                mode="single"
                className={styles.createTaskStatusSelect}
                options={statusOptions}
                value={statusOptions.find((option) => option.value === status) ?? statusOptions[0] ?? null}
                onChange={(option) => {
                  if (!Array.isArray(option) && option?.value) setStatus(option.value as TaskEntity['status'])
                }}
              />
            </div>
            <div className={styles.createTaskSelectField}>
              <div className={styles.createTaskFieldLabel}>
                <LuUserPlus size={15} />
                <span>Assignee</span>
              </div>
              <AppSelect
                mode="single"
                options={agentOptions}
                value={selectedAgent}
                onChange={setSelectedAgent}
                isClearable
                placeholder="Assignee"
              />
            </div>
          </div>
          <div className={styles.createTaskAgenticGrid}>
            <label>
              <span>Acceptance criteria</span>
              <textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} placeholder="What must be true for this task to be accepted?" />
            </label>
          </div>
          <div className={styles.createTaskTags}>
            <div className={styles.createTaskFieldLabel}>
              <LuTag size={15} />
              <span>Tags</span>
            </div>
            <AppSelect mode="multi" variant="borderless" options={tagOptions} value={selectedTags} onChange={(value) => setSelectedTags(Array.isArray(value) ? value : [])} placeholder="Search or add tags..." />
          </div>
          <div className={styles.createTaskFooter}>
            <span>{currentProject ? `Creates in ${currentProject.name}` : 'Choose a project to continue'}</span>
            <button type="submit" disabled={busy || !title.trim() || !currentProjectId} aria-busy={busy}>{busy ? 'Creating...' : 'Create Task'}</button>
          </div>
        </form>
      </section>
      {isImportOpen ? (
        <TaskJsonImportPopup
          open
          title="Import task JSON"
          busy={busy}
          onClose={() => setIsImportOpen(false)}
          onImport={(jsonText) => {
            const preview = parseTaskJsonImportPreview(jsonText)
            setTitle(preview.title)
            setDescription(preview.description)
            setAcceptanceCriteria('')
            setSelectedTemplate(null)
            setSelectedTags([])
            setSelectedAgent(null)
            setImportJson(jsonText)
            setIsImportOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
