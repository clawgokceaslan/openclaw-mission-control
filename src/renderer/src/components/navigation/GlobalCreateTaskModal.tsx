import { Suspense, lazy, useEffect, useState } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, OutputFormat, Project, ProjectStatus, Tag, TaskTemplate } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { CreateTaskPopup } from '@renderer/popups/CreateTask'
import { createTaskWithTemplate, type CreateTaskInput } from '@renderer/screens/projects/detail/createTaskWithTemplate'
import { PROJECT_STATUS_COLUMNS, columnsFromProjectStatuses } from '@renderer/screens/projects/detail/status'
import type { GlobalTaskCreateInitial } from './UniversalCommand'

const GlobalTaskDetailModal = lazy(() => import('./GlobalTaskDetailModal').then((module) => ({ default: module.GlobalTaskDetailModal })))

interface GlobalCreateTaskModalProps {
  open: boolean
  initial: GlobalTaskCreateInitial | null
  onClose: () => void
}

type DefaultAddTaskProjectResponse = {
  projectId: string | null
  project?: Project | null
  fallbackProject?: Project | null
  invalidStoredProjectId?: string | null
}

function activeProjectsOf(projects: Project[]): Project[] {
  return projects.filter((project) => !project.archived)
}

export function GlobalCreateTaskModal({ open, initial, onClose }: GlobalCreateTaskModalProps) {
  const { token } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [createdDetail, setCreatedDetail] = useState<{ taskId: string; projectId: string } | null>(null)
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
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token),
      invokeBridge<DefaultAddTaskProjectResponse>(IPC_CHANNELS.appSettings.getDefaultAddTaskProject, { actorToken: token })
    ]).then(([projectResponse, templateResponse, agentResponse, tagResponse, outputFormatResponse, defaultProjectResponse]) => {
      if (cancelled) return
      const nextProjects = projectResponse.ok && Array.isArray(projectResponse.data) ? activeProjectsOf(projectResponse.data) : []
      if (projectResponse.ok) setProjects(nextProjects)
      if (templateResponse.ok) setTemplates(Array.isArray(templateResponse.data) ? templateResponse.data : [])
      if (agentResponse.ok) setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
      if (tagResponse.ok) setTags(Array.isArray(tagResponse.data) ? tagResponse.data : [])
      if (outputFormatResponse.ok) setOutputFormats(Array.isArray(outputFormatResponse.data) ? outputFormatResponse.data : [])
      const explicitProject = initial?.projectId ? nextProjects.find((project) => project.id === initial.projectId) ?? null : null
      const defaultProject = defaultProjectResponse.ok && defaultProjectResponse.data?.project ? nextProjects.find((project) => project.id === defaultProjectResponse.data?.project?.id) ?? null : null
      const fallbackProject = defaultProjectResponse.ok && defaultProjectResponse.data?.fallbackProject ? nextProjects.find((project) => project.id === defaultProjectResponse.data?.fallbackProject?.id) ?? null : nextProjects[0] ?? null
      setSelectedProjectId((explicitProject ?? defaultProject ?? fallbackProject ?? nextProjects[0] ?? null)?.id ?? '')
      const loadError = !projectResponse.ok
        ? projectResponse.error?.message ?? 'Projects could not be loaded.'
        : !templateResponse.ok
          ? templateResponse.error?.message ?? 'Task templates could not be loaded.'
          : !agentResponse.ok
            ? agentResponse.error?.message ?? 'Agents could not be loaded.'
            : !tagResponse.ok
              ? tagResponse.error?.message ?? 'Tags could not be loaded.'
              : !outputFormatResponse.ok
                ? outputFormatResponse.error?.message ?? 'Output formats could not be loaded.'
                : null
      const defaultWarning = defaultProjectResponse.ok && defaultProjectResponse.data?.invalidStoredProjectId
        ? 'The saved default project is unavailable. An active project was selected instead.'
        : initial?.projectId && !explicitProject
          ? 'The requested project is unavailable. An active project was selected instead.'
          : null
      setError(loadError ?? defaultWarning ?? (nextProjects.length === 0 ? 'No active projects are available for task creation.' : null))
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
      .then((statusResponse) => {
        if (cancelled) return
        setStatusColumns(statusResponse.ok && Array.isArray(statusResponse.data) ? columnsFromProjectStatuses(statusResponse.data) : PROJECT_STATUS_COLUMNS)
      })
      .catch(() => {
        if (!cancelled) {
          setStatusColumns(PROJECT_STATUS_COLUMNS)
        }
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
      void invokeBridge(IPC_CHANNELS.appSettings.setDefaultAddTaskProject, {
        actorToken: token,
        projectId: input.projectId
      })
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
      setCreatedDetail({ taskId: result.task.id, projectId: input.projectId })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Task create failed')
    } finally {
      setBusy(false)
    }
  }

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId)
    if (!projectId) return
    void invokeBridge(IPC_CHANNELS.appSettings.setDefaultAddTaskProject, {
      actorToken: token,
      projectId
    }).then((response) => {
      if (!response.ok) setError(response.error?.message ?? 'Unable to save the default Add Task project.')
    })
  }

  return (
    <>
      <CreateTaskPopup
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
        onProjectChange={handleProjectChange}
        onCreate={(input) => void handleCreate(input)}
      />
      {createdDetail ? (
        <Suspense fallback={null}>
          <GlobalTaskDetailModal
            taskId={createdDetail.taskId}
            projectId={createdDetail.projectId}
            onClose={() => setCreatedDetail(null)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
