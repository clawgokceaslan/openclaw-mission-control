import { useEffect, useMemo } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { normalizeGatewayPromptShape } from '@shared/utils/gateway-prompt-shape'
import { AppSelectOption } from '@renderer/components/select/AppSelect'
import type { AiTool, Gateway, Project, ProjectGatewaySettings, ProjectGroup, ProjectStatus, StatusTemplate, Workspace, Tag, Skill, Agent, CustomField, TaskEntity } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import {
  codexConfigOf,
  buildProjectManagementMetrics,
  createLocalId,
  projectGatewaySettings,
  projectWorkspaceFolder
} from '../projectDetailUtils'
import { buildProjectWorkspaceExportTaskPayload } from '../taskExport'
import type { ProjectDetailStateBindings } from '../state/projectDetailState'

interface UseProjectWorkspaceSettingsContext {
  token?: string | null
  project: Project | null
  projectGroups: ProjectGroup[]
  workspaces: Workspace[]
  gateways: Gateway[]
  projectStatuses: ProjectStatus[]
  defaultStatus: ProjectStatus['status']
  tags: Tag[]
  skills: Skill[]
  agents: Agent[]
  tools: AiTool[]
  customFields: CustomField[]
  tasks: TaskEntity[]
  refresh: () => Promise<void>
  state: Pick<
    ProjectDetailStateBindings,
    | 'gatewayId'
    | 'gatewayRuntimeWorkspaceId'
    | 'gatewayDefaultModel'
    | 'gatewayDefaultPlanModel'
    | 'gatewayDefaultRunModel'
    | 'workspaceDraftName'
    | 'workspaceDraftPath'
    | 'projectGroupNameDraft'
    | 'projectGroupDescriptionDraft'
    | 'setGatewaySaving'
    | 'setError'
    | 'setProject'
    | 'setTools'
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
    | 'setProjectPromptContext'
    | 'setProjectPromptPrompt'
    | 'setProjectPromptPlanGuide'
    | 'setProjectPromptOutput'
    | 'setProjectPromptRules'
    | 'setProjectPromptPostRun'
    | 'setProjectPromptTab'
    | 'setProjectPromptError'
    | 'setIsProjectPromptSaving'
    | 'setIsProjectPromptSettingsOpen'
    | 'setGatewayId'
    | 'setGatewayRuntimeWorkspaceId'
    | 'setGatewayDefaultModel'
    | 'setGatewayDefaultPlanModel'
    | 'setGatewayDefaultRunModel'
    | 'setGatewayModelError'
    | 'setIsStatusTemplatePickerOpen'
    | 'setPendingStatusTemplate'
    | 'setIsStatusEditorOpen'
    | 'setStatusDrafts'
    | 'setStatusMapping'
    | 'setProjectSyncMessage'
    | 'setProjectSyncing'
    | 'projectPromptContext'
    | 'projectPromptPrompt'
    | 'projectPromptPlanGuide'
    | 'projectPromptOutput'
    | 'projectPromptRules'
    | 'projectPromptPostRun'
    | 'projectPromptError'
    | 'isStatusTemplatePickerOpen'
    | 'pendingStatusTemplate'
    | 'projectFolderPreview'
    | 'projectSyncMessage'
    | 'projectSyncing'
    | 'statusDrafts'
    | 'statusMapping'
    | 'isStatusEditorOpen'
  >
}

interface UseProjectWorkspaceSettingsResult {
  state: {
    selectedWorkspace: Workspace | null
    selectedGateway: Gateway | null
    selectedCodexConfig: ReturnType<typeof codexConfigOf>
    gatewayModelOptions: ReturnType<typeof codexConfigOf>['models']
    gatewayOptions: AppSelectOption[]
    workspaceOptions: AppSelectOption[]
    projectGatewayModelOptions: AppSelectOption[]
    selectedGatewayOption: AppSelectOption | null
    selectedRuntimeWorkspaceOption: AppSelectOption | null
    selectedDefaultModelOption: AppSelectOption | null
    selectedDefaultPlanModelOption: AppSelectOption | null
    selectedDefaultRunModelOption: AppSelectOption | null
    chatRuntimeWorkspace: Workspace | null
    projectGroupForExport: ProjectGroup | null
    savedGatewaySettings: ReturnType<typeof projectGatewaySettings>
    gatewayModelOptionsNormalized: ReturnType<typeof codexConfigOf>['models']
    gatewayOptionsNormalized: AppSelectOption[]
  }
  actions: {
    chooseProjectWorkspaceFolder: () => Promise<void>
    createWorkspaceFromDraft: () => Promise<Workspace | null>
    updateProjectWorkspace: (workspaceId: string | null) => Promise<void>
    saveProjectDefaultsSettings: (draft: { defaultAgentId: string | null; defaultSkillIds: string[] }) => Promise<Project>
    saveProjectManagementSettings: (draft: { defaultAgentId: string | null; defaultSkillIds: string[]; agentIds: string[]; toolIds: string[] }) => Promise<Project>
    createProjectTool: (draft: { name: string; status: AiTool['status']; toolType: AiTool['toolType']; descriptionMarkdown: string; codeLanguage: string; codeBody: string; functionName: string; commandTemplate: string; prepareCommand: string; workingDirectoryHint: string; inputSchemaJson?: Record<string, unknown>; outputSchemaJson?: Record<string, unknown>; executionFlowMarkdown: string; approvalRequired: boolean; timeoutSeconds?: number | null; agentIds: string[] }) => Promise<AiTool>
    saveProjectMcpSettings: (serverIds: string[]) => Promise<Project>
    saveProjectGatewaySettings: (draft?: { gatewayId?: string; runtimeWorkspaceId?: string; planModel?: string; runModel?: string; language?: string; promptShape?: ProjectGatewaySettings['promptShape']; planReasoningEffort?: string; runReasoningEffort?: string }) => Promise<ProjectGatewaySettings>
    updateProjectGroupMembership: (nextGroupId: string | null) => Promise<void>
    saveSelectedProjectGroup: () => Promise<void>
    syncProjectWorkspace: () => Promise<void>
    openStatusEditor: () => void
    openProjectPromptSettings: () => void
    saveProjectPromptSettings: () => Promise<void>
    updateStatusDraft: (id: string, patch: Partial<ProjectStatus>) => void
    addActiveStatus: () => void
    removeStatusDraft: (status: ProjectStatus) => void
    applyStatusTemplate: (template: StatusTemplate) => Promise<void>
    saveProjectStatuses: () => Promise<void>
    setGateway: (value: string) => void
  }
}

export function useProjectWorkspaceSettings({
  token,
  project,
  projectGroups,
  workspaces,
  gateways,
  projectStatuses,
  defaultStatus,
  tags,
  skills,
  agents,
  tools,
  customFields,
  tasks,
  refresh,
  state
}: UseProjectWorkspaceSettingsContext): UseProjectWorkspaceSettingsResult {
  const {
    gatewayId,
    gatewayRuntimeWorkspaceId,
    gatewayDefaultModel,
    gatewayDefaultPlanModel,
    gatewayDefaultRunModel,
    workspaceDraftName,
    workspaceDraftPath,
    projectGroupNameDraft,
    projectGroupDescriptionDraft,
    setGatewaySaving,
    setError,
    setProject,
    setTools,
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
    setProjectGroupDescriptionDraft,
    setProjectPromptContext,
    setProjectPromptPrompt,
    setProjectPromptPlanGuide,
    setProjectPromptOutput,
    setProjectPromptRules,
    setProjectPromptPostRun,
    setProjectPromptTab,
    setProjectPromptError,
    setIsProjectPromptSaving,
    setIsProjectPromptSettingsOpen,
    setGatewayId,
    setGatewayRuntimeWorkspaceId,
    setGatewayDefaultModel,
    setGatewayDefaultPlanModel,
    setGatewayDefaultRunModel,
    setGatewayModelError,
    setIsStatusTemplatePickerOpen,
    setPendingStatusTemplate,
    setIsStatusEditorOpen,
    setStatusDrafts,
    setStatusMapping,
    setProjectSyncMessage,
    setProjectSyncing,
    projectPromptContext,
    projectPromptPrompt,
    projectPromptPlanGuide,
    projectPromptOutput,
    projectPromptRules,
    projectPromptPostRun,
    projectPromptError,
    isStatusTemplatePickerOpen,
    pendingStatusTemplate,
    projectFolderPreview,
    projectSyncMessage,
    projectSyncing,
    statusDrafts,
    statusMapping,
    isStatusEditorOpen
  } = state

  const selectedWorkspace = useMemo(() => {
    if (!project?.workspaceId) return null
    return workspaces.find((workspace) => workspace.id === project.workspaceId) ?? null
  }, [project?.workspaceId, workspaces])

  const savedGatewaySettings = useMemo(() => projectGatewaySettings(project), [project])
  const selectedGateway = useMemo(
    () => gateways.find((gateway) => gateway.id === (gatewayId || savedGatewaySettings.gatewayId)) ?? null,
    [gatewayId, gateways, savedGatewaySettings.gatewayId]
  )
  const selectedCodexConfig = useMemo(() => codexConfigOf(selectedGateway), [selectedGateway])
  const gatewayModelOptions = selectedCodexConfig.models ?? []
  const gatewayOptions = useMemo<AppSelectOption[]>(
    () => gateways.map((gateway) => ({ label: gateway.name, value: gateway.id })),
    [gateways]
  )
  const workspaceOptions = useMemo<AppSelectOption[]>(
    () => workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id })),
    [workspaces]
  )
  const projectGatewayModelOptions = useMemo<AppSelectOption[]>(
    () => gatewayModelOptions.map((model) => ({ label: model.label || model.id, value: model.id })),
    [gatewayModelOptions]
  )
  const selectedGatewayOption = gatewayOptions.find((option) => option.value === gatewayId) ?? null
  const selectedRuntimeWorkspaceOption = workspaceOptions.find((option) => option.value === gatewayRuntimeWorkspaceId) ?? null
  const selectedDefaultModelOption = projectGatewayModelOptions.find((option) => option.value === gatewayDefaultModel) ?? null
  const selectedDefaultPlanModelOption = projectGatewayModelOptions.find((option) => option.value === (gatewayDefaultPlanModel || gatewayDefaultModel)) ?? null
  const selectedDefaultRunModelOption = projectGatewayModelOptions.find((option) => option.value === (gatewayDefaultRunModel || gatewayDefaultModel)) ?? null

  const chatRuntimeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === savedGatewaySettings.runtimeWorkspaceId) ?? null,
    [savedGatewaySettings.runtimeWorkspaceId, workspaces]
  )

  const projectGroupForExport = useMemo(
    () => projectGroups.find((group) => project?.id && Array.isArray(group.projectIds) && group.projectIds.includes(project.id)) ?? null,
    [project?.id, projectGroups]
  )

  useEffect(() => {
    let cancelled = false
    void projectWorkspaceFolder(selectedWorkspace, project).then((value) => {
      if (!cancelled) {
        setProjectFolderPreview(value)
      }
    })

    return () => {
      cancelled = true
    }
  }, [project, selectedWorkspace, setProjectFolderPreview])

  useEffect(() => {
    setProjectGroupNameDraft(projectGroupForExport?.name ?? '')
    setProjectGroupDescriptionDraft(projectGroupForExport?.description ?? '')
  }, [projectGroupForExport, setProjectGroupNameDraft, setProjectGroupDescriptionDraft])

  const chooseProjectWorkspaceFolder = async () => {
    const pickResponse = await invokeBridge<{ rootPath: string } | null>(IPC_CHANNELS.workspaces.pickFolder, { actorToken: token })
    if (!pickResponse.ok) {
      setError(pickResponse.error?.message ?? 'Unable to select workspace folder')
      return
    }
    const rootPath = pickResponse.data?.rootPath
    if (rootPath) {
      setWorkspaceDraftPath(rootPath)
    }
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
      const message = response.error?.message ?? 'Unable to update project workspace'
      setError(message)
      setWorkspaceMoveMessage(null)
      throw new Error(message)
    }
    setProject(response.data.project)
    setWorkspaceMoveMessage(`Workspace updated. ${response.data.movedFiles} file(s) moved.`)
    await refresh()
  }

  const saveProjectDefaultsSettings = async (draft: { defaultAgentId: string | null; defaultSkillIds: string[] }): Promise<Project> => {
    if (!project) throw new Error('Project is not loaded')
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      metrics: {
        ...(project.metrics ?? {}),
        defaultAgentId: draft.defaultAgentId || null,
        defaultSkillIds: Array.from(new Set(draft.defaultSkillIds.filter(Boolean)))
      }
    })
    if (!response.ok || !response.data) {
      const message = response.error?.message ?? 'Unable to save project defaults'
      setError(message)
      throw new Error(message)
    }
    setProject(response.data)
    setError(null)
    await refresh()
    return response.data
  }

  const saveProjectManagementSettings = async (draft: { defaultAgentId: string | null; defaultSkillIds: string[]; agentIds: string[]; toolIds: string[] }): Promise<Project> => {
    if (!project) throw new Error('Project is not loaded')
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      metrics: buildProjectManagementMetrics(project, draft)
    })
    if (!response.ok || !response.data) {
      const message = response.error?.message ?? 'Unable to save project agent and tool links'
      setError(message)
      throw new Error(message)
    }
    setProject(response.data)
    setError(null)
    await refresh()
    return response.data
  }

  const createProjectTool = async (draft: { name: string; status: AiTool['status']; toolType: AiTool['toolType']; descriptionMarkdown: string; codeLanguage: string; codeBody: string; functionName: string; commandTemplate: string; prepareCommand: string; workingDirectoryHint: string; inputSchemaJson?: Record<string, unknown>; outputSchemaJson?: Record<string, unknown>; executionFlowMarkdown: string; approvalRequired: boolean; timeoutSeconds?: number | null; agentIds: string[] }): Promise<AiTool> => {
    if (!project) throw new Error('Project is not loaded')
    const response = await invokeBridge<AiTool>(IPC_CHANNELS.tools.create, {
      actorToken: token,
      ...draft
    })
    if (!response.ok || !response.data) {
      const message = response.error?.message ?? 'Unable to create project tool'
      setError(message)
      throw new Error(message)
    }
    const created = response.data
    setTools((current) => [created, ...current.filter((item) => item.id !== created.id)])
    await saveProjectManagementSettings({
      defaultAgentId: typeof project.metrics?.defaultAgentId === 'string' ? project.metrics.defaultAgentId : null,
      defaultSkillIds: Array.isArray(project.metrics?.defaultSkillIds) ? project.metrics.defaultSkillIds.filter((item): item is string => typeof item === 'string') : [],
      agentIds: Array.isArray(project.agentIds) ? project.agentIds : [],
      toolIds: Array.from(new Set([...(Array.isArray(project.toolIds) ? project.toolIds : []), created.id]))
    })
    return created
  }

  const saveProjectMcpSettings = async (serverIds: string[]): Promise<Project> => {
    if (!project) throw new Error('Project is not loaded')
    const normalizedServerIds = Array.from(new Set(serverIds.filter(Boolean)))
    const linkResponse = await invokeBridge<{ ok: true }>(IPC_CHANNELS.mcp.linkProjects, {
      actorToken: token,
      ownerId: project.id,
      serverIds: normalizedServerIds
    })
    if (!linkResponse.ok) {
      const message = linkResponse.error?.message ?? 'Unable to save project MCP links'
      setError(message)
      throw new Error(message)
    }
    const projectResponse = await invokeBridge<Project>(IPC_CHANNELS.projects.get, {
      actorToken: token,
      id: project.id
    })
    if (!projectResponse.ok || !projectResponse.data) {
      const message = projectResponse.error?.message ?? 'Unable to refresh project MCP links'
      setError(message)
      throw new Error(message)
    }
    setProject(projectResponse.data)
    setError(null)
    await refresh()
    return projectResponse.data
  }

  const saveProjectGatewaySettings = async (draft?: { gatewayId?: string; runtimeWorkspaceId?: string; planModel?: string; runModel?: string; language?: string; promptShape?: ProjectGatewaySettings['promptShape']; planReasoningEffort?: string; runReasoningEffort?: string }): Promise<ProjectGatewaySettings> => {
    if (!project) throw new Error('Project is not loaded')
    const nextGatewayId = draft?.gatewayId ?? gatewayId
    const nextRuntimeWorkspaceId = draft?.runtimeWorkspaceId ?? gatewayRuntimeWorkspaceId
    const nextPlanModel = draft?.planModel ?? gatewayDefaultPlanModel
    const nextRunModel = draft?.runModel ?? gatewayDefaultRunModel
    const savedGateway = projectGatewaySettings(project)
    const nextLanguage = draft?.language ?? savedGateway.language ?? null
    const nextPromptShape = normalizeGatewayPromptShape(draft?.promptShape ?? savedGateway.promptShape ?? 'markdown')
    const nextPlanReasoningEffort = draft?.planReasoningEffort ?? savedGateway.planReasoningEffort ?? null
    const nextRunReasoningEffort = draft?.runReasoningEffort ?? savedGateway.runReasoningEffort ?? null

    setGatewaySaving(true)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      gateway: {
        gatewayId: nextGatewayId || null,
        runtimeWorkspaceId: nextRuntimeWorkspaceId || null,
        defaultModel: nextRunModel || null,
        planModel: nextPlanModel || null,
        runModel: nextRunModel || null,
        language: nextLanguage || null,
        promptShape: nextPromptShape || 'markdown',
        planReasoningEffort: nextPlanReasoningEffort || null,
        runReasoningEffort: nextRunReasoningEffort || null
      }
    })
    setGatewaySaving(false)
    if (!response.ok || !response.data) {
      const message = response.error?.message ?? 'Unable to save Codex settings'
      setError(message)
      throw new Error(message)
    }
    const saved = projectGatewaySettings(response.data)
    setProject(response.data)
    setGatewayId(saved.gatewayId ?? '')
    setGatewayRuntimeWorkspaceId(saved.runtimeWorkspaceId ?? '')
    setGatewayDefaultModel(saved.defaultModel ?? saved.runModel ?? '')
    setGatewayDefaultPlanModel(saved.planModel ?? saved.defaultModel ?? '')
    setGatewayDefaultRunModel(saved.runModel ?? saved.defaultModel ?? '')
    setError(null)
    await refresh()
    return saved
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
        const message = removeResponse.error?.message ?? 'Unable to update current project group'
        setError(message)
        throw new Error(message)
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
          const message = addResponse.error?.message ?? 'Unable to assign project group'
          setError(message)
          throw new Error(message)
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
      const message = response.error?.message ?? 'Unable to save project group'
      setError(message)
      throw new Error(message)
    }
    setProjectGroups((current) => current.map((group) => group.id === response.data!.id ? response.data! : group))
  }

  const syncProjectWorkspace = async () => {
    if (!project) return
    if (!project.workspaceId) {
      setProjectSyncMessage('Assign a workspace before syncing project exports.')
      return
    }

    setProjectSyncing(true)
    setProjectSyncMessage(`Preparing ${tasks.length} task export(s)...`)
    const exportTasks = tasks.map((taskItem) => buildProjectWorkspaceExportTaskPayload({
      task: taskItem,
      project,
      projectGroup: projectGroupForExport,
      agents,
      tools,
      skills,
      tags,
      customFields,
      projectStatuses
    }))
    const response = await invokeBridge<{ projectFolderPath: string; processedTasks: number; writtenFiles: string[]; skippedFiles: string[]; errors: string[] }>(IPC_CHANNELS.projects.exportWorkspace, {
      actorToken: token,
      projectId: project.id,
      tasks: exportTasks
    })
    setProjectSyncing(false)
    if (!response.ok || !response.data) {
      setProjectSyncMessage(response.error?.message ?? 'Unable to sync project exports.')
      return
    }
    const skipped = response.data.skippedFiles.length ? ` ${response.data.skippedFiles.length} skipped.` : ''
    const errors = response.data.errors.length ? ` ${response.data.errors.length} errors.` : ''
    setProjectSyncMessage(`Synced ${response.data.processedTasks} task(s), wrote ${response.data.writtenFiles.length} file(s).${skipped}${errors}`)
  }

  const openStatusEditor = () => {
    setStatusDrafts(projectStatuses)
    setStatusMapping({})
    setWorkspaceMoveMessage(null)
    setIsStatusEditorOpen(true)
  }

  const openProjectPromptSettings = () => {
    if (!project) return
    setProjectPromptTab('context')
    setProjectPromptContext(project.generalContext ?? '')
    setProjectPromptPrompt(project.generalPrompt ?? '')
    setProjectPromptPlanGuide(typeof project.metrics?.projectPlanGuide === 'string' ? project.metrics.projectPlanGuide : '')
    setProjectPromptOutput(project.defaultOutput ?? '')
    setProjectPromptRules(typeof project.metrics?.projectRules === 'string' ? project.metrics.projectRules : '')
    setProjectPromptPostRun(typeof project.metrics?.projectPostRunPrompt === 'string' ? project.metrics.projectPostRunPrompt : '')
    setProjectPromptError(null)
    setIsProjectPromptSettingsOpen(true)
  }

  const saveProjectPromptSettings = async () => {
    if (!project) return
    setIsProjectPromptSaving(true)
    setProjectPromptError(null)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      generalContext: projectPromptContext,
      generalPrompt: projectPromptPrompt,
      defaultOutput: projectPromptOutput,
      metrics: {
        ...(project.metrics ?? {}),
        projectPlanGuide: projectPromptPlanGuide,
        projectRules: projectPromptRules,
        projectPostRunPrompt: projectPromptPostRun
      }
    })
    setIsProjectPromptSaving(false)
    if (!response.ok || !response.data) {
      setProjectPromptError(response.error?.message ?? 'Unable to save project prompt settings')
      return
    }
    setProject(response.data)
    setIsProjectPromptSettingsOpen(false)
  }

  const updateStatusDraft = (id: string, patch: Partial<ProjectStatus>) => {
    setStatusDrafts((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item))
  }

  const addActiveStatus = () => {
    if (!project) return
    const now = Date.now()
    const id = createLocalId()
    setStatusDrafts((current) => [
      ...current,
      {
        id,
        organizationId: project.organizationId,
        projectId: project.id,
        name: 'New active status',
        category: 'active',
        color: '#5B7CFA',
        sortOrder: current.length,
        isDefault: false,
        createdAt: now,
        updatedAt: now
      }
    ])
  }

  const removeStatusDraft = (status: ProjectStatus) => {
    if (status.category !== 'active') return
    setStatusDrafts((current) => current.filter((item) => item.id !== status.id))
    setStatusMapping((current) => ({ ...current, [status.id]: defaultStatus }))
  }

  const buildStatusTemplateMapping = (template: StatusTemplate): { mapping: Record<string, string>; needsReview: boolean } => {
    const nextItems = template.items ?? []
    const mapping: Record<string, string> = {}
    let needsReview = false

    for (const current of projectStatuses) {
      const exact = nextItems.find((item) => item.id === current.id)
      if (exact) continue

      const named = nextItems.find((item) => item.category === current.category && item.name.trim().toLowerCase() === current.name.trim().toLowerCase())
      if (named) {
        mapping[current.id] = named.id
        continue
      }
      const categoryFallback = nextItems.find((item) => item.category === current.category) ?? nextItems[0]
      if (categoryFallback) {
        mapping[current.id] = categoryFallback.id
        needsReview = true
      }
    }

    return { mapping, needsReview }
  }

  const applyStatusTemplate = async (template: StatusTemplate) => {
    if (!project) return
    const items = template.items ?? []
    if (!items.length) return

    const { mapping, needsReview } = buildStatusTemplateMapping(template)
    const nextDrafts = items.map((item, index) => ({
      ...item,
      projectId: project.id,
      sortOrder: index,
      isDefault: item.category === 'not_started'
    }))

    setStatusDrafts(nextDrafts)
    setStatusMapping(mapping)
    setPendingStatusTemplate(needsReview ? template : null)
    setIsStatusTemplatePickerOpen(false)

    if (!needsReview && project.id) {
      const response = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.updateProjectStatuses, {
        actorToken: token,
        projectId: project.id,
        items: nextDrafts.map((item, index) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          color: item.color,
          sortOrder: index,
          isDefault: item.category === 'not_started'
        })),
        mapping: {}
      })
      if (!response.ok) {
        setError(response.error?.message ?? 'Unable to apply status template')
        return
      }
      setIsStatusEditorOpen(false)
      await refresh()
    }
  }

  const saveProjectStatuses = async () => {
    if (!project?.id) return
    const response = await invokeBridge<ProjectStatus[]>(IPC_CHANNELS.statuses.updateProjectStatuses, {
      actorToken: token,
      projectId: project.id,
      items: statusDrafts.map((item, index) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        color: item.color,
        sortOrder: index,
        isDefault: item.category === 'not_started'
      })),
      mapping: statusMapping
    })
    if (!response.ok) {
      const message = response.error?.message ?? 'Unable to update project statuses'
      setError(message)
      throw new Error(message)
    }
    setIsStatusEditorOpen(false)
    await refresh()
  }

  const setGateway = (value: string) => {
    const nextGateway = gateways.find((item) => item.id === value)
    const models = codexConfigOf(nextGateway).models ?? []
    setGatewayId(value)
    setGatewayModelError(null)
    if (!models.some((model) => model.id === gatewayDefaultModel)) setGatewayDefaultModel('')
    if (!models.some((model) => model.id === gatewayDefaultPlanModel)) setGatewayDefaultPlanModel('')
    if (!models.some((model) => model.id === gatewayDefaultRunModel)) setGatewayDefaultRunModel('')
  }

  return {
    state: {
      selectedWorkspace,
      selectedGateway,
      selectedCodexConfig,
      gatewayModelOptions,
      gatewayOptions,
      workspaceOptions,
      projectGatewayModelOptions,
      selectedGatewayOption,
      selectedRuntimeWorkspaceOption,
      selectedDefaultModelOption,
      selectedDefaultPlanModelOption,
      selectedDefaultRunModelOption,
      chatRuntimeWorkspace,
      projectGroupForExport,
      savedGatewaySettings,
      gatewayModelOptionsNormalized: gatewayModelOptions,
      gatewayOptionsNormalized: gatewayOptions
    },
    actions: {
      chooseProjectWorkspaceFolder,
      createWorkspaceFromDraft,
      updateProjectWorkspace,
      saveProjectDefaultsSettings,
      saveProjectManagementSettings,
      createProjectTool,
      saveProjectMcpSettings,
      saveProjectGatewaySettings,
      updateProjectGroupMembership,
      saveSelectedProjectGroup,
      syncProjectWorkspace,
      openStatusEditor,
      openProjectPromptSettings,
      saveProjectPromptSettings,
      updateStatusDraft,
      addActiveStatus,
      removeStatusDraft,
      applyStatusTemplate,
      saveProjectStatuses,
      setGateway
    }
  }
}
