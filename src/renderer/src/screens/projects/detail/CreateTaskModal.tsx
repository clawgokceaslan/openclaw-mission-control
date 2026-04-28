import { FormEvent, useEffect, useState } from 'react'
import { LuCalendarPlus, LuFlag, LuTag, LuUserPlus, LuX } from 'react-icons/lu'
import type { Agent, Project, Tag, TaskEntity } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { PROJECT_STATUS_OPTIONS } from './status'
import styles from '../ProjectDetailPage.module.scss'

interface CreateTaskModalProps {
  open: boolean
  project: Project
  tags: Tag[]
  agents: Agent[]
  defaultStatus: TaskEntity['status']
  busy: boolean
  onClose: () => void
  onCreate: (input: { title: string; description: string; status: TaskEntity['status']; tagIds: string[]; agentId?: string | null }) => void
}

export function CreateTaskModal({ open, project, tags, agents, defaultStatus, busy, onClose, onCreate }: CreateTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskEntity['status']>(defaultStatus)
  const [selectedTags, setSelectedTags] = useState<AppSelectOption[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AppSelectOption | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setStatus(defaultStatus)
    setSelectedTags([])
    setSelectedAgent(null)
  }, [open, defaultStatus])

  if (!open) return null

  const tagOptions = tags.map((tag) => ({ label: tag.name, value: tag.id, color: tag.color }))
  const agentOptions = agents.map((agent) => ({ label: agent.name, value: agent.id }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    onCreate({ title: title.trim(), description: description.trim(), status, tagIds: selectedTags.map((tag) => tag.value), agentId: selectedAgent?.value ?? null })
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
          <input className={styles.createTaskTitle} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task Name or type '/' for commands" />
          <textarea className={styles.createTaskDescription} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add description, or write with AI" />
          <div className={styles.createTaskChips}>
            <div className={styles.createTaskSelectChip}>
              <AppSelect
                mode="single"
                variant="borderless"
                options={PROJECT_STATUS_OPTIONS}
                value={PROJECT_STATUS_OPTIONS.find((option) => option.value === status) ?? null}
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
