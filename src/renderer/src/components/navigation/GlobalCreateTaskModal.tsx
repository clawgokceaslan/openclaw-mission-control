import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, OutputFormat, Project, ProjectStatus, Tag, TaskTemplate } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { CreateTaskModal } from '@renderer/screens/projects/detail/CreateTaskModal'
import { createTaskWithTemplate, type CreateTaskInput } from '@renderer/screens/projects/detail/createTaskWithTemplate'
import { PROJECT_STATUS_COLUMNS, columnsFromProjectStatuses } from '@renderer/screens/projects/detail/status'
import type { GlobalTaskCreateInitial } from './UniversalCommand'

interface GlobalCreateTaskModalProps {
  open: boolean
  initial: GlobalTaskCreateInitial | null
  onClose: () => void
}

export function GlobalCreateTaskModal({ open, initial, onClose }: GlobalCreateTaskModalProps) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [statusColumns, setStatusColumns] = useState(PROJECT_STATUS_COLUMNS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedProjectId(initial?.projectId ?? '')
    setError(null)
    let cancelled = false
    Promise.all([
      loadList<Project[]>(IPC_CHANNELS.projects.list, token),
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token),
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token)
    ]).then(([projectResponse, templateResponse, agentResponse, tagResponse, outputFormatResponse]) => {
      if (cancelled) return
      if (projectResponse.ok) setProjects(Array.isArray(projectResponse.data) ? projectResponse.data : [])
      if (templateResponse.ok) setTemplates(Array.isArray(templateResponse.data) ? templateResponse.data : [])
      if (agentResponse.ok) setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
      if (tagResponse.ok) setTags(Array.isArray(tagResponse.data) ? tagResponse.data : [])
      if (outputFormatResponse.ok) setOutputFormats(Array.isArray(outputFormatResponse.data) ? outputFormatResponse.data : [])
    }).catch(() => {
      if (!cancelled) setError('Task create options could not be loaded.')
    })
    return () => {
      cancelled = true
    }
  }, [initial?.projectId, open, token])

  useEffect(() => {
    if (!open || !selectedProjectId) {
      setStatusColumns(PROJECT_STATUS_COLUMNS)
      return
    }
    let cancelled = false
    invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId: selectedProjectId })
      .then((response) => {
        if (cancelled) return
        setStatusColumns(response.ok && Array.isArray(response.data) ? columnsFromProjectStatuses(response.data) : PROJECT_STATUS_COLUMNS)
      })
      .catch(() => {
        if (!cancelled) setStatusColumns(PROJECT_STATUS_COLUMNS)
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedProjectId, token])

  const handleCreate = async (input: CreateTaskInput) => {
    if (!input.projectId || !input.title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await createTaskWithTemplate({
        actorToken: token,
        input,
        templates,
        statusColumns,
        defaultStatus: statusColumns[0]?.status ?? 'pending',
        outputFormats
      })
      if (result.warnings[0]) setError(result.warnings[0])
      onClose()
      navigate(`${APP_ROUTES.PROJECTS}/${input.projectId}`, { state: { openTaskId: result.task.id } })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Task create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <CreateTaskModal
      open={open}
      project={projects.find((project) => project.id === selectedProjectId) ?? null}
      projects={projects}
      selectedProjectId={selectedProjectId}
      tags={tags}
      agents={agents}
      templates={templates}
      statusColumns={statusColumns}
      defaultStatus={statusColumns[0]?.status ?? 'pending'}
      initialTitle={initial?.title ?? ''}
      initialTemplateId={initial?.templateId ?? null}
      busy={busy}
      error={error}
      onClose={onClose}
      onProjectChange={setSelectedProjectId}
      onCreate={(input) => void handleCreate(input)}
    />
  )
}
