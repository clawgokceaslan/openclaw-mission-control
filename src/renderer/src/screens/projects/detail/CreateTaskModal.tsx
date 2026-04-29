import { FormEvent, useEffect, useState } from 'react'
import { LuCalendarPlus, LuFlag, LuTag, LuUserPlus, LuX } from 'react-icons/lu'
import type { Agent, Project, Tag, TaskEntity, TaskTemplate } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import type { ProjectStatusColumn } from './status'
import { statusOptionsFromColumns } from './status'
import styles from '../ProjectDetailPage.module.scss'

interface CreateTaskModalProps {
  open: boolean
  project: Project
  tags: Tag[]
  agents: Agent[]
  templates: TaskTemplate[]
  statusColumns: ProjectStatusColumn[]
  defaultStatus: TaskEntity['status']
  busy: boolean
  onClose: () => void
  onCreate: (input: { title: string; description: string; status: TaskEntity['status']; tagIds: string[]; agentId?: string | null; templateId?: string | null }) => void
}

export function CreateTaskModal({ open, project, tags, agents, templates, statusColumns, defaultStatus, busy, onClose, onCreate }: CreateTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskEntity['status']>(defaultStatus)
  const [selectedTags, setSelectedTags] = useState<AppSelectOption[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AppSelectOption | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<AppSelectOption | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setStatus(defaultStatus)
    setSelectedTags([])
    setSelectedAgent(null)
    setSelectedTemplate(null)
  }, [open, defaultStatus])

  if (!open) return null

  const tagOptions = tags.map((tag) => ({ label: tag.name, value: tag.id, color: tag.color }))
  const agentOptions = agents.map((agent) => ({ label: agent.name, value: agent.id }))
  const templateOptions = templates.map((template) => ({ label: template.name, value: template.id }))
  const statusOptions = statusOptionsFromColumns(statusColumns)
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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    onCreate({ title: title.trim(), description: description.trim(), status, tagIds: selectedTags.map((tag) => tag.value), agentId: selectedAgent?.value ?? null, templateId: selectedTemplate?.value ?? null })
  }

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={styles.createTaskModal} role="dialog" aria-modal="true" aria-label="Create task">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Task</span></div>
          <button type="button" onClick={onClose} aria-label="Close create task"><LuX size={17} /></button>
        </header>
        <form className={styles.createTaskBody} onSubmit={submit}>
          <div className={styles.createTaskContext}>
            <span>{project.name}</span>
            <span>Task</span>
          </div>
          <div className={styles.createTaskTags}>
            <AppSelect mode="single" variant="borderless" options={templateOptions} value={selectedTemplate} onChange={applyTemplate} isClearable placeholder="Start from template..." />
          </div>
          <input className={styles.createTaskTitle} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task Name or type '/' for commands" />
          <textarea className={styles.createTaskDescription} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add description, or write with AI" />
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
            <span>Fields</span>
            <button type="submit" disabled={busy || !title.trim()}>Create Task</button>
          </div>
        </form>
      </section>
    </>
  )
}
