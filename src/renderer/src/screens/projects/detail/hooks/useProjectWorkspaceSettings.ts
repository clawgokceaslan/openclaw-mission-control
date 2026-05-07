import { useEffect, useMemo } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { AppSelectOption } from '@renderer/components/select/AppSelect'
import type { Gateway, Project, ProjectCodexSettings, ProjectGroup, ProjectStatus, StatusTemplate, Workspace, Tag, Skill, Agent, CustomField, TaskEntity } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import {
  codexConfigOf,
  createLocalId,
  getTableViewConfig,
  projectCodexSettings,
  projectWorkspaceFolder
} from '../projectDetailUtils'
import { buildProjectWorkspaceExportTaskPayload } from '../taskExport'
import type { ProjectDetailStateBindings } from '../state/projectDetailState'
import type { ProjectTableViewConfig, TableColumnConfig } from '../types'

interface UseProjectWorkspaceSettingsContext {
  token?: string | null
  project: Project | null
  projectGroups: ProjectGroup[]
  workspaces: Workspace[]
  gateways: Gateway[]
  projectStatuses: ProjectStatus[]
  defaultStatus: ProjectStatus['status']
  tableColumns: TableColumnConfig[]
  tags: Tag[]
  skills: Skill[]
  agents: Agent[]
  customFields: CustomField[]
  tasks: TaskEntity[]
  refresh: () => Promise<void>
  state: Pick<
    ProjectDetailStateBindings,
    | 'codexGatewayId'
    | 'codexRuntimeWorkspaceId'
    | 'codexDefaultModel'
    | 'codexDefaultPlanModel'
    | 'codexDefaultRunModel'
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
    | 'setCodexGatewayId'
    | 'setCodexRuntimeWorkspaceId'
    | 'setCodexDefaultModel'
    | 'setCodexDefaultPlanModel'
    | 'setCodexDefaultRunModel'
    | 'setCodexModelError'
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
    selectedCodexGateway: Gateway | null
    selectedCodexConfig: ReturnType<typeof codexConfigOf>
    codexModelOptions: ReturnType<typeof codexConfigOf>['models']
    codexGatewayOptions: AppSelectOption[]
    workspaceOptions: AppSelectOption[]
    projectCodexModelOptions: AppSelectOption[]
    selectedCodexGatewayOption: AppSelectOption | null
    selectedRuntimeWorkspaceOption: AppSelectOption | null
    selectedDefaultModelOption: AppSelectOption | null
    selectedDefaultPlanModelOption: AppSelectOption | null
    selectedDefaultRunModelOption: AppSelectOption | null
    chatRuntimeWorkspace: Workspace | null
    projectGroupForExport: ProjectGroup | null
    savedCodexSettings: ReturnType<typeof projectCodexSettings>
    codexModelOptionsNormalized: ReturnType<typeof codexConfigOf>['models']
    codexGatewayOptionsNormalized: AppSelectOption[]
  }
  actions: {
    chooseProjectWorkspaceFolder: () => Promise<void>
    createWorkspaceFromDraft: () => Promise<Workspace | null>
    updateProjectWorkspace: (workspaceId: string | null) => Promise<void>
    saveProjectDefaultsSettings: (draft: { defaultAgentId: string | null; defaultSkillIds: string[] }) => Promise<Project>
    saveProjectCodexSettings: (draft?: { gatewayId: string; runtimeWorkspaceId: string; planModel: string; runModel: string; language?: string; promptShape?: ProjectCodexSettings['promptShape']; planReasoningEffort?: string; runReasoningEffort?: string }) => Promise<ProjectCodexSettings>
    updateProjectGroupMembership: (nextGroupId: string | null) => Promise<void>
    saveSelectedProjectGroup: () => Promise<void>
    syncProjectWorkspace: () => Promise<void>
    openStatusEditor: () => void
    openProjectPromptSettings: () => void
    saveProjectPromptSettings: () => Promise<void>
    saveProjectTableView: (nextConfig: ProjectTableViewConfig) => Promise<void>
    setTableColumns: (columns: TableColumnConfig[]) => Promise<void>
    setTableColumnWidth: (columnId: string, width: number) => Promise<void>
    updateStatusDraft: (id: string, patch: Partial<ProjectStatus>) => void
    addActiveStatus: () => void
    removeStatusDraft: (status: ProjectStatus) => void
    applyStatusTemplate: (template: StatusTemplate) => Promise<void>
    saveProjectStatuses: () => Promise<void>
    setCodexGateway: (value: string) => void
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
  tableColumns,
  tags,
  skills,
  agents,
  customFields,
  tasks,
  refresh,
  state
}: UseProjectWorkspaceSettingsContext): UseProjectWorkspaceSettingsResult {
  const {
    codexGatewayId,
    codexRuntimeWorkspaceId,
    codexDefaultModel,
    codexDefaultPlanModel,
    codexDefaultRunModel,
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
    setCodexGatewayId,
    setCodexRuntimeWorkspaceId,
    setCodexDefaultModel,
    setCodexDefaultPlanModel,
    setCodexDefaultRunModel,
    setCodexModelError,
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
  const selectedDefaultPlanModelOption = projectCodexModelOptions.find((option) => option.value === (codexDefaultPlanModel || codexDefaultModel)) ?? null
  const selectedDefaultRunModelOption = projectCodexModelOptions.find((option) => option.value === (codexDefaultRunModel || codexDefaultModel)) ?? null

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
      setError(response.error?.message ?? 'Unable to update project workspace')
      setWorkspaceMoveMessage(null)
      return
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

  const saveProjectCodexSettings = async (draft?: { gatewayId: string; runtimeWorkspaceId: string; planModel: string; runModel: string; language?: string; promptShape?: ProjectCodexSettings['promptShape']; planReasoningEffort?: string; runReasoningEffort?: string }): Promise<ProjectCodexSettings> => {
    if (!project) throw new Error('Project is not loaded')
    const nextGatewayId = draft?.gatewayId ?? codexGatewayId
    const nextRuntimeWorkspaceId = draft?.runtimeWorkspaceId ?? codexRuntimeWorkspaceId
    const nextPlanModel = draft?.planModel ?? codexDefaultPlanModel
    const nextRunModel = draft?.runModel ?? codexDefaultRunModel
    const savedCodex = projectCodexSettings(project)
    const nextLanguage = draft?.language ?? savedCodex.language ?? null
    const nextPromptShape = draft?.promptShape ?? savedCodex.promptShape ?? 'markdown'
    const nextPlanReasoningEffort = draft?.planReasoningEffort ?? savedCodex.planReasoningEffort ?? null
    const nextRunReasoningEffort = draft?.runReasoningEffort ?? savedCodex.runReasoningEffort ?? null

    setCodexSaving(true)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      codex: {
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
    setCodexSaving(false)
    if (!response.ok || !response.data) {
      const message = response.error?.message ?? 'Unable to save Codex settings'
      setError(message)
      throw new Error(message)
    }
    const saved = projectCodexSettings(response.data)
    setProject(response.data)
    setCodexGatewayId(saved.gatewayId ?? '')
    setCodexRuntimeWorkspaceId(saved.runtimeWorkspaceId ?? '')
    setCodexDefaultModel(saved.defaultModel ?? saved.runModel ?? '')
    setCodexDefaultPlanModel(saved.planModel ?? saved.defaultModel ?? '')
    setCodexDefaultRunModel(saved.runModel ?? saved.defaultModel ?? '')
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

  const saveProjectTableView = async (nextConfig: ProjectTableViewConfig) => {
    if (!project) return
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.update, {
      actorToken: token,
      id: project.id,
      metrics: {
        ...(project.metrics ?? {}),
        tableView: nextConfig
      }
    })
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'Unable to save table view settings')
      return
    }
    setProject(response.data)
  }

  const setTableColumns = async (columns: TableColumnConfig[]) => {
    const current = getTableViewConfig(project)
    await saveProjectTableView({ ...current, columns: columns.slice(0, 12) })
  }

  const setTableColumnWidth = async (columnId: string, width: number) => {
    const current = getTableViewConfig(project)
    await saveProjectTableView({
      ...current,
      columns: tableColumns.map((column) => (column.id === columnId ? { ...column, width } : column)),
      columnWidths: {
        ...(current.columnWidths ?? {}),
        [columnId]: Math.max(80, Math.min(520, Math.round(width)))
      }
    })
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
      setError(response.error?.message ?? 'Unable to update project statuses')
      return
    }
    setIsStatusEditorOpen(false)
    await refresh()
  }

  const setCodexGateway = (value: string) => {
    const nextGateway = gateways.find((item) => item.id === value)
    const models = codexConfigOf(nextGateway).models ?? []
    setCodexGatewayId(value)
    setCodexModelError(null)
    if (!models.some((model) => model.id === codexDefaultModel)) setCodexDefaultModel('')
    if (!models.some((model) => model.id === codexDefaultPlanModel)) setCodexDefaultPlanModel('')
    if (!models.some((model) => model.id === codexDefaultRunModel)) setCodexDefaultRunModel('')
  }

  return {
    state: {
      selectedWorkspace,
      selectedCodexGateway,
      selectedCodexConfig,
      codexModelOptions,
      codexGatewayOptions,
      workspaceOptions,
      projectCodexModelOptions,
      selectedCodexGatewayOption,
      selectedRuntimeWorkspaceOption,
      selectedDefaultModelOption,
      selectedDefaultPlanModelOption,
      selectedDefaultRunModelOption,
      chatRuntimeWorkspace,
      projectGroupForExport,
      savedCodexSettings,
      codexModelOptionsNormalized: codexModelOptions,
      codexGatewayOptionsNormalized: codexGatewayOptions
    },
    actions: {
      chooseProjectWorkspaceFolder,
      createWorkspaceFromDraft,
      updateProjectWorkspace,
      saveProjectDefaultsSettings,
      saveProjectCodexSettings,
      updateProjectGroupMembership,
      saveSelectedProjectGroup,
      syncProjectWorkspace,
      openStatusEditor,
      openProjectPromptSettings,
      saveProjectPromptSettings,
      saveProjectTableView,
      setTableColumns,
      setTableColumnWidth,
      updateStatusDraft,
      addActiveStatus,
      removeStatusDraft,
      applyStatusTemplate,
      saveProjectStatuses,
      setCodexGateway
    }
  }
}
