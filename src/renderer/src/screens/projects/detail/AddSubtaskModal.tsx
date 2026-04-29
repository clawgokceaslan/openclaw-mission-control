import { FormEvent, useEffect, useState } from 'react'
import { LuCalendarPlus, LuListTodo, LuUserPlus, LuX } from 'react-icons/lu'
import type { Agent, TaskSubtask } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import type { ProjectStatusColumn } from './status'
import { statusOptionsFromColumns } from './status'
import styles from '../ProjectDetailPage.module.scss'

type AddSubtaskInput = {
  title: string
  description: string
  status: TaskSubtask['status']
  agentId?: string | null
  dueAt?: number
}

interface AddSubtaskModalProps {
  open: boolean
  projectName: string
  taskTitle: string
  agents: Agent[]
  statusColumns: ProjectStatusColumn[]
  defaultStatus: TaskSubtask['status']
  busy: boolean
  onClose: () => void
  onCreate: (input: AddSubtaskInput) => void
}

export function AddSubtaskModal({ open, projectName, taskTitle, agents, statusColumns, defaultStatus, busy, onClose, onCreate }: AddSubtaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskSubtask['status']>(defaultStatus)
  const [selectedAgent, setSelectedAgent] = useState<AppSelectOption | null>(null)
  const [dueDate, setDueDate] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setStatus(defaultStatus)
    setSelectedAgent(null)
    setDueDate('')
  }, [open, defaultStatus])

  if (!open) return null

  const agentOptions = agents.map((agent) => ({ label: agent.name, value: agent.id }))
  const statusOptions = statusOptionsFromColumns(statusColumns)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    onCreate({
      title: title.trim(),
      description: description.trim(),
      status,
      agentId: selectedAgent?.value ?? null,
      dueAt: dueDate ? new Date(dueDate).getTime() : undefined
    })
  }

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={styles.createTaskModal} role="dialog" aria-modal="true" aria-label="Add subtask">
        <header className={styles.createTaskHeader}>
          <div className={styles.createTaskTabs}><span className={styles.createTaskTabActive}>Subtask</span></div>
          <button type="button" onClick={onClose} aria-label="Close add subtask"><LuX size={17} /></button>
        </header>
        <form className={styles.createTaskBody} onSubmit={submit}>
          <div className={styles.createTaskContext}>
            <span>{projectName}</span>
            <span>{taskTitle}</span>
            <span>Subtask</span>
          </div>
          <input className={styles.createTaskTitle} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Subtask name" />
          <textarea className={styles.createTaskDescription} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add description" />
          <div className={styles.createTaskChips}>
            <div className={styles.createTaskSelectChip}>
              <LuListTodo size={14} />
              <AppSelect
                mode="single"
                variant="borderless"
                options={statusOptions}
                value={statusOptions.find((option) => option.value === status) ?? statusOptions[0] ?? null}
                onChange={(option) => {
                  if (!Array.isArray(option) && option?.value) setStatus(option.value as TaskSubtask['status'])
                }}
              />
            </div>
            <div className={styles.createTaskSelectChip}>
              <LuUserPlus size={14} />
              <AppSelect mode="single" variant="borderless" options={agentOptions} value={selectedAgent} onChange={setSelectedAgent} isClearable placeholder="Agent" />
            </div>
            <label className={styles.createTaskDateChip}>
              <LuCalendarPlus size={14} />
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>
          <div className={styles.createTaskFooter}>
            <span>Custom fields can be managed after creation.</span>
            <button type="submit" disabled={busy || !title.trim()}>Create Subtask</button>
          </div>
        </form>
      </section>
    </>
  )
}
