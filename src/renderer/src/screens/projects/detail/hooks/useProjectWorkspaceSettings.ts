import { useEffect, useMemo } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Gateway, Project, ProjectGroup, Workspace } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import { codexConfigOf, projectCodexSettings, projectWorkspaceFolder } from '../projectDetailUtils'
import type { ProjectDetailStateBindings } from '../state/projectDetailState'

interface UseProjectWorkspaceSettingsContext {
  token: string | null
  project: Project | null
  projectGroups: ProjectGroup[]
  workspaces: Workspace[]
  gateways: Gateway[]
  refresh: () => Promise<void>
  state: Pick<
    ProjectDetailStateBindings,
    | 'codexGatewayId'
    | 'codexRuntimeWorkspaceId'
    | 'codexDefaultModel'
    | 'workspaceDraftName'
    | 'workspaceDraftPath'
    | 'projectGroupNameDraft'
    | 'projectGroupDescriptionDraft'
    | 'setCodexSaving'
    | 'setError'
    | 'setProject'
    | 'setWorkspaces'
    | 'setWorkspaceDraftName'
    | 'setWorkspaceDraftPath'
    | 'setProjectFolderPreview'
    | 'setMovingWorkspace'
    | 'setWorkspaceMoveMessage'
    | 'setProjectGroupSaving'
    | 'setIsProjectGroupPickerOpen'
    | 'setProjectGroups'
    | 'setProjectGroupNameDraft'
    | 'setProjectGroupDescriptionDraft'
  >
}

export function useProjectWorkspaceSettings({
  token,
  project,
  projectGroups,
  workspaces,
  gateways,
  refresh,
  state
}: UseProjectWorkspaceSettingsContext) {
  const {
    codexGatewayId,
    codexRuntimeWorkspaceId,
    codexDefaultModel,
    workspaceDraftName,
    workspaceDraftPath,
    projectGroupNameDraft,
    projectGroupDescriptionDraft,
    setCodexSaving,
    setError,
    setProject,
    setWorkspaces,
    setWorkspaceDraftName,
    setWorkspaceDraftPath,
    setProjectFolderPreview,
    setMovingWorkspace,
    setWorkspaceMoveMessage,
    setProjectGroupSaving,
    setIsProjectGroupPickerOpen,
    setProjectGroups,
    setProjectGroupNameDraft,
    setProjectGroupDescriptionDraft
  } = state

  const selectedWorkspace = useMemo(() => {
    if (!project?.workspaceId) return null
    return workspaces.find((workspace) => workspace.id === project.workspaceId) ?? null
  }, [project?.workspaceId, workspaces])

  const savedCodexSettings = useMemo(() => projectCodexSettings(project), [project])
  const selectedCodexGateway = useMemo(
    () => gateways.find((gateway) => gateway.id === (codexGatewayId || savedCodexSettings.gatewayId)) ?? null,
    [codexGatewayId, gateways, savedCodexSettings.gatewayId]
  )
  const selectedCodexConfig = useMemo(() => codexConfigOf(selectedCodexGateway), [selectedCodexGateway])
  const codexModelOptions = selectedCodexConfig.models ?? []
  const codexGatewayOptions = useMemo<AppSelectOption[]>(
    () => gateways.map((gateway) => ({ label: gateway.name, value: gateway.id })),
    [gateways]
  )
  const workspaceOptions = useMemo<AppSelectOption[]>(
    () => workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id })),
    [workspaces]
  )
  const projectCodexModelOptions = useMemo<AppSelectOption[]>(
    () => codexModelOptions.map((model) => ({ label: model.label || model.id, value: model.id })),
    [codexModelOptions]
  )
  const selectedCodexGatewayOption = codexGatewayOptions.find((option) => option.value === codexGatewayId) ?? null
  const selectedRuntimeWorkspaceOption = workspaceOptions.find((option) => option.value === codexRuntimeWorkspaceId) ?? null
  const selectedDefaultModelOption = projectCodexModelOptions.find((option) => option.value === codexDefaultModel) ?? null
  const chatRuntimeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === savedCodexSettings.runtimeWorkspaceId) ?? null,
    [savedCodexSettings.runtimeWorkspaceId, workspaces]
  )

  const projectGroupForExport = useMemo(
    () => projectGroups.find((group) => project?.id && Array.isArray(group.projectIds) && group.projectIds.includes(project.id)) ?? null,
    [project?.id, projectGroups]
  )

  useEffect(() => {
    let cancelled = false
    void projectWorkspaceFolder(selectedWorkspace, project).then((value) => {
      if (!cancelled) setProjectFolderPreview(value)
    })
    return () => {
      cancelled = true
    }
  }, [project, selectedWorkspace, setProjectFolderPreview])

  useEffect(() => {
    setProjectGroupNameDraft(projectGroupForExport?.name ?? '')
    setProjectGroupDescriptionDraft(projectGroupForExport?.description ?? '')
  }, [projectGroupForExport, setProjectGroupDescriptionDraft, setProjectGroupNameDraft])

  const chooseProjectWorkspaceFolder = async () => {
    const pickResponse = await invokeBridge<{ rootPath: string } | null>(IPC_CHANNELS.workspaces.pickFolder, { actorToken: token })
    if (!pickResponse.ok) {
      setError(pickResponse.error?.message ?? 'Unable to select workspace folder')
      return
    }
    const rootPath = pickResponse.data?.rootPath
    if (rootPath) setWorkspaceDraftPath(rootPath)
  }

  const createWorkspaceFromDraft = async (): Promise<Workspace | null> => {
    if (!workspaceDraftName.trim() || !workspaceDraftPath.trim()) return null
    const createResponse = await invokeBridge<Workspace>(IPC_CHANNELS.workspaces.create, {
      actorToken: token,
      name: workspaceDraftName.trim(),
      rootPath: workspaceDraftPath.trim()
    })
    if (!createResponse.ok || !createResponse.data) {
      setError(createResponse.error?.message ?? 'Unable to create workspace')
      return null
    }
    setWorkspaces((current) => [createResponse.data!, ...current.filter((item) => item.id !== createResponse.data!.id)])
    setWorkspaceDraftName('')
    setWorkspaceDraftPath('')
    return createResponse.data
  }

  const updateProjectWorkspace = async (workspaceId: string | null) => {
    if (!project) return
    setMovingWorkspace(true)
    setWorkspaceMoveMessage('Moving project files...')
    const response = await invokeBridge<{ project: Project; movedFiles: number; projectFolderPath?: string }>(IPC_CHANNELS.projects.moveWorkspace, {
      actorToken: token,
      projectId: project.id,
      workspaceId
    })
    setMovingWorkspace(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to update project workspace')
      setWorkspaceMoveMessage(null)
      return
    }
    setProject(response.data.project)
    setWorkspaceMoveMessage(`Workspace updated. ${response.data.movedFiles} file(s) moved.`)
    await refresh()
  }

  const saveProjectCodexSettings = async () => {
    if (!project) return
    setCodexSaving(true)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      codex: {
        gatewayId: codexGatewayId || null,
        runtimeWorkspaceId: codexRuntimeWorkspaceId || null,
        defaultModel: codexDefaultModel || null
      }
    })
    setCodexSaving(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to save Codex settings')
      return
    }
    setProject(response.data)
    setError(null)
  }

  const updateProjectGroupMembership = async (nextGroupId: string | null) => {
    if (!project) return
    const currentGroup = projectGroups.find((group) => Array.isArray(group.projectIds) && group.projectIds.includes(project.id)) ?? null
    if ((currentGroup?.id ?? null) === nextGroupId) {
      setIsProjectGroupPickerOpen(false)
      return
    }

    setProjectGroupSaving(true)
    setError(null)
    if (currentGroup) {
      const removeResponse = await invokeBridge<ProjectGroup>(IPC_CHANNELS.projectGroups.update, {
        actorToken: token,
        id: currentGroup.id,
        name: currentGroup.name,
        description: currentGroup.description ?? '',
        projectIds: (currentGroup.projectIds ?? []).filter((id) => id !== project.id)
      })
      if (!removeResponse.ok) {
        setProjectGroupSaving(false)
        setError(removeResponse.error?.message ?? 'Unable to update current project group')
        return
      }
    }

    if (nextGroupId) {
      const nextGroup = projectGroups.find((group) => group.id === nextGroupId)
      if (nextGroup) {
        const addResponse = await invokeBridge<ProjectGroup>(IPC_CHANNELS.projectGroups.update, {
          actorToken: token,
          id: nextGroup.id,
          name: nextGroup.name,
          description: nextGroup.description ?? '',
          projectIds: Array.from(new Set([...(nextGroup.projectIds ?? []), project.id]))
        })
        if (!addResponse.ok) {
          setProjectGroupSaving(false)
          setError(addResponse.error?.message ?? 'Unable to assign project group')
          return
        }
      }
    }

    setProjectGroupSaving(false)
    setIsProjectGroupPickerOpen(false)
    await refresh()
  }

  const saveSelectedProjectGroup = async () => {
    if (!projectGroupForExport || !projectGroupNameDraft.trim()) return
    setProjectGroupSaving(true)
    setError(null)
    const response = await invokeBridge<ProjectGroup>(IPC_CHANNELS.projectGroups.update, {
      actorToken: token,
      id: projectGroupForExport.id,
      name: projectGroupNameDraft.trim(),
      description: projectGroupDescriptionDraft.trim(),
      projectIds: projectGroupForExport.projectIds ?? []
    })
    setProjectGroupSaving(false)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to save project group')
      return
    }
    setProjectGroups((current) => current.map((group) => group.id === response.data!.id ? response.data! : group))
  }

  return {
    state: {
      selectedWorkspace,
      savedCodexSettings,
      selectedCodexGateway,
      selectedCodexConfig,
      codexModelOptions,
      codexGatewayOptions,
      workspaceOptions,
      projectCodexModelOptions,
      selectedCodexGatewayOption,
      selectedRuntimeWorkspaceOption,
      selectedDefaultModelOption,
      chatRuntimeWorkspace,
      projectGroupForExport
    },
    actions: {
      chooseProjectWorkspaceFolder,
      createWorkspaceFromDraft,
      updateProjectWorkspace,
      saveProjectCodexSettings,
      updateProjectGroupMembership,
      saveSelectedProjectGroup
    }
  }
}
