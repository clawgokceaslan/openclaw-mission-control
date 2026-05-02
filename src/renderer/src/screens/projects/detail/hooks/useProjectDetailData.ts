import { useCallback, useEffect } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type {
  Agent,
  CustomField,
  Gateway,
  OutputFormat,
  Project,
  ProjectGroup,
  ProjectStatus,
  Skill,
  StatusTemplate,
  Tag,
  TaskEntity,
  TaskTemplate,
  Workspace
} from '@shared/types/entities'
import { invokeBridge, loadList, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { projectCodexSettings, withTaskMeta } from '../projectDetailUtils'
import type { ProjectDetailStateBindings } from './state/projectDetailState'

export interface ProjectDetailDataContext {
  token: string | undefined
  projectId?: string
  state: Pick<
    ProjectDetailStateBindings,
    |
      | 'setError'
      | 'setProject'
      | 'setTasks'
      | 'setTags'
      | 'setSkills'
      | 'setCustomFields'
      | 'setAgents'
      | 'setGateways'
      | 'setOutputFormats'
      | 'setTaskTemplates'
      | 'setProjectStatuses'
      | 'setWorkspaces'
      | 'setStatusTemplates'
      | 'setProjectGroups'
      | 'setCodexGatewayId'
      | 'setCodexRuntimeWorkspaceId'
      | 'setCodexDefaultModel'
      | 'setSelectedTaskId'
      | 'project'
  >
}

export interface UseProjectDetailDataResult {
  refresh: () => Promise<void>
  projectLoadError: string | null
}

export function useProjectDetailData({ token, projectId, state }: ProjectDetailDataContext): UseProjectDetailDataResult {
  const {
    setError,
    setProject,
    setTasks,
    setTags,
    setSkills,
    setCustomFields,
    setAgents,
    setGateways,
    setOutputFormats,
    setTaskTemplates,
    setProjectStatuses,
    setWorkspaces,
    setStatusTemplates,
    setProjectGroups,
    setCodexGatewayId,
    setCodexRuntimeWorkspaceId,
    setCodexDefaultModel,
    setSelectedTaskId,
    project
  } = state

  const projectLoadError = projectId ? null : 'Project id not found.'

  const refresh = useCallback(async () => {
    if (!projectId) return

    const [
      projectResponse,
      taskResponse,
      tagsResponse,
      skillsResponse,
      customFieldsResponse,
      agentsResponse,
      gatewaysResponse,
      outputFormatsResponse,
      taskTemplatesResponse,
      statusesResponse,
      workspacesResponse,
      statusTemplatesResponse,
      projectGroupsResponse
    ] = await Promise.all([
      invokeBridge<Project>(IPC_CHANNELS.projects.get, { actorToken: token, id: projectId }),
      invokeBridge<TaskEntity[]>(IPC_CHANNELS.tasks.list, { actorToken: token, projectId }),
      loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token),
      loadList<Skill[]>(IPC_CHANNELS.skills.list, token),
      loadList<CustomField[]>(IPC_CHANNELS.customFields.list, token),
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      loadList<Gateway[]>(IPC_CHANNELS.gateways.list, token),
      loadList<OutputFormat[]>(IPC_CHANNELS.outputFormats.list, token),
      loadList<TaskTemplate[]>(IPC_CHANNELS.taskTemplates.list, token),
      invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.getProjectStatuses, { actorToken: token, projectId }),
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token),
      invokeBridge<StatusTemplate[]>(IPC_CHANNELS.statuses.listTemplates, { actorToken: token }),
      loadList<ProjectGroup[]>(IPC_CHANNELS.projectGroups.list, token)
    ])

    if (!projectResponse.ok || !projectResponse.data) {
      setError(projectResponse.error?.message ?? 'Project not found')
      setProject(null)
      return
    }

    setProject(projectResponse.data)
    setTasks(Array.isArray(taskResponse.data) ? taskResponse.data.map(withTaskMeta) : [])
    setTags(Array.isArray(tagsResponse.data) ? tagsResponse.data : [])
    setSkills(Array.isArray(skillsResponse.data) ? skillsResponse.data : [])
    setCustomFields(Array.isArray(customFieldsResponse.data) ? customFieldsResponse.data : [])
    setAgents(Array.isArray(agentsResponse.data) ? agentsResponse.data : [])
    setGateways(Array.isArray(gatewaysResponse.data) ? gatewaysResponse.data : [])
    setOutputFormats(Array.isArray(outputFormatsResponse.data) ? outputFormatsResponse.data : [])
    setTaskTemplates(Array.isArray(taskTemplatesResponse.data) ? taskTemplatesResponse.data : [])
    setProjectStatuses(Array.isArray(statusesResponse.data) ? statusesResponse.data : [])
    setWorkspaces(Array.isArray(workspacesResponse.data) ? workspacesResponse.data : [])
    setStatusTemplates(Array.isArray(statusTemplatesResponse.data) ? statusTemplatesResponse.data : [])

    if (projectGroupsResponse.ok) {
      setProjectGroups(Array.isArray(projectGroupsResponse.data) ? projectGroupsResponse.data : [])
    }

    setError(
      !taskResponse.ok
        ? taskResponse.error?.message ?? 'Unable to load tasks'
        : !outputFormatsResponse.ok
          ? outputFormatsResponse.error?.message ?? 'Unable to load data formats'
          : !taskTemplatesResponse.ok
            ? taskTemplatesResponse.error?.message ?? 'Unable to load task templates'
            : null
    )
  }, [
    projectId,
    token,
    setError,
    setProject,
    setTasks,
    setTags,
    setSkills,
    setCustomFields,
    setAgents,
    setGateways,
    setOutputFormats,
    setTaskTemplates,
    setProjectStatuses,
    setWorkspaces,
    setStatusTemplates,
    setProjectGroups
  ])

  useEffect(() => {
    void refresh()
  }, [projectId, token, refresh])

  useEffect(() => {
    const onTaskUpdated = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as { projectId?: string; taskId?: string; action?: string } | undefined
      if (!payload?.projectId || payload.projectId !== projectId) return
      void refresh()
      if (payload.action === 'created' && payload.taskId) setSelectedTaskId(payload.taskId)
    }

    subscribeToChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.taskUpdated, onTaskUpdated)
  }, [projectId, refresh, setSelectedTaskId])

  useEffect(() => {
    const codex = projectCodexSettings(project)
    setCodexGatewayId(codex.gatewayId ?? '')
    setCodexRuntimeWorkspaceId(codex.runtimeWorkspaceId ?? '')
    setCodexDefaultModel(codex.defaultModel ?? '')
  }, [project?.id, project?.metrics, project, setCodexGatewayId, setCodexRuntimeWorkspaceId, setCodexDefaultModel])

  return {
    refresh,
    projectLoadError
  }
}
