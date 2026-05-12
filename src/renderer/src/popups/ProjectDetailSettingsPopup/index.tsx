import { useEffect, useMemo, useState } from 'react'
import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import { AppSelect } from '@renderer/components/select/AppSelect'
import { LuCircleCheck, LuTriangleAlert } from 'react-icons/lu'
import { LoadingState } from '@renderer/components/loading'
import type { Agent, Gateway, Project, ProjectGatewaySettings, ProjectGroup, ProjectStatus, ProjectStatusCategory, Skill, StatusTemplate, Workspace } from '@shared/types/entities'
import { GATEWAY_LANGUAGE_OPTIONS, GATEWAY_REASONING_EFFORT_OPTIONS, gatewayModelReasoningEfforts, gatewayModelSupportsReasoning, normalizeGatewayLanguage, normalizeGatewayReasoningEffort } from '@shared/utils/gateway-language'
import { GATEWAY_PROMPT_SHAPES, normalizeGatewayPromptShape } from '@shared/utils/gateway-prompt-shape'
import type { ProjectSettingsTab } from '@renderer/screens/projects/detail/types'
import { StatusTemplatePickerModal } from '@renderer/components/projects/detail/ProjectModals/StatusTemplatePickerModal'
import { ProjectGroupPickerModal } from '@renderer/components/projects/detail/ProjectModals/ProjectGroupPickerModal'
import { WorkspacePickerModal } from '@renderer/components/projects/detail/ProjectModals/WorkspacePickerModal'
import { codexConfigOf } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from './index.module.scss'

type ProjectSettingsOption = Pick<AppSelectOption, 'label' | 'value'>

type WorkspaceLike = Pick<Workspace, 'id' | 'name' | 'rootPath'>

type SettingsSaveFeedback = {
  state: 'saving' | 'success' | 'error'
  title: string
  message: string
}

function saveFeedbackTab(tab: ProjectSettingsTab): ProjectSettingsTab {
  return tab === 'codex' ? 'models' : tab
}

function SettingsSaveToast({ feedback }: { feedback: SettingsSaveFeedback }) {
  const isError = feedback.state === 'error'
  const isSaving = feedback.state === 'saving'

  return (
    <div
      className={`${styles.settingsSaveToast} ${isError ? styles.settingsSaveToastError : isSaving ? styles.settingsSaveToastSaving : styles.settingsSaveToastSuccess}`}
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className={styles.settingsSaveToastIcon} aria-hidden="true">
        {isError ? <LuTriangleAlert size={16} /> : isSaving ? <LoadingState size="compact" message="" /> : <LuCircleCheck size={16} />}
      </span>
      <span className={styles.settingsSaveToastCopy}>
        <strong>{feedback.title}</strong>
        <span>{feedback.message}</span>
      </span>
    </div>
  )
}

export interface ProjectDetailSettingsPopupProps {
  open: boolean
  onClose: () => void
  scope: {
    project: Project | null
    projectSettingsTab: ProjectSettingsTab
    setProjectSettingsTab: (tab: ProjectSettingsTab) => void

    selectedWorkspace: Workspace | null
    selectedWorkspaceId?: string | null
    workspaceOptions?: { label: string; value: string }[]
    workspaceMoveMessage: string | null
    movingWorkspace: boolean
    workspaceDraftName: string
    workspaceDraftPath: string
    workspaces: WorkspaceLike[]
    onWorkspaceDraftChange?: (next: { name: string; path: string }) => void
    onChooseWorkspaceFolder: () => void
    onCreateWorkspace?: () => Promise<Workspace | null> | Workspace | null

    selectedGatewayOption: ProjectSettingsOption | null
    gateways?: Gateway[]
    gatewayOptions: AppSelectOption[]
    selectedRuntimeWorkspaceOption: AppSelectOption | null
    selectedDefaultModelOption: AppSelectOption | null
    selectedDefaultPlanModelOption: AppSelectOption | null
    selectedDefaultRunModelOption: AppSelectOption | null
    projectGatewayModelOptions: AppSelectOption[]
    gatewayModelOptions: unknown[]
    gatewayModelLoading: boolean
    gatewayModelError: string | null
    gatewayDefaultModel: string
    gatewayDefaultPlanModel: string
    gatewayDefaultRunModel: string
    gatewayLanguage: string
    codexPromptShape: ProjectGatewaySettings['promptShape']
    gatewayPlanReasoningEffort: string
    gatewayRunReasoningEffort: string
    gatewayId: string
    gatewayRuntimeWorkspaceId: string
    onSetGatewayId: (value: string) => void
    onSetGatewayDefaultModel: (value: string) => void
    onSetGatewayDefaultPlanModel: (value: string) => void
    onSetGatewayDefaultRunModel: (value: string) => void
    onSetGatewayRuntimeWorkspaceId: (value: string) => void
    onSetGatewayModelError: (value: string | null) => void
    gatewaySaving: boolean
    onSaveProjectGatewaySettings: (draft?: { gatewayId?: string; runtimeWorkspaceId?: string; planModel?: string; runModel?: string; language?: string; promptShape?: ProjectGatewaySettings['promptShape']; planReasoningEffort?: string; runReasoningEffort?: string }) => ProjectGatewaySettings | void | Promise<ProjectGatewaySettings | void>
    onRefreshGatewayModels?: (gatewayId: string) => Promise<void> | void
    agents?: Agent[]
    skills?: Skill[]
    defaultAgentId: string
    defaultSkillIds: string[]
    onSaveProjectDefaultsSettings: (draft: { defaultAgentId: string | null; defaultSkillIds: string[] }) => Project | void | Promise<Project | void>

    isStatusTemplatePickerOpen: boolean
    statusTemplates: StatusTemplate[]
    onStatusTemplatePickerOpen: () => void
    onStatusTemplateClose: () => void
    isProjectGroupPickerOpen: boolean
    projectGroupForExport: ProjectGroup | null
    projectGroups: ProjectGroup[]
    projectGroupNameDraft: string
    projectGroupDescriptionDraft: string
    projectGroupSaving: boolean
    onProjectGroupNameChange: (value: string) => void
    onProjectGroupDescriptionChange: (value: string) => void
    onProjectGroupPickerOpen: () => void
    onProjectGroupPickerClose: () => void
    onProjectGroupClear: () => void | Promise<void>
    onProjectGroupPick: (group: ProjectGroup) => void | Promise<void>
    onSaveProjectGroup: () => void | Promise<void>

    projectStatuses: ProjectStatus[]
    statusDrafts: ProjectStatus[]
    statusMapping: Record<string, string>
    setStatusDrafts: (next: ProjectStatus[] | ((current: ProjectStatus[]) => ProjectStatus[])) => void
    setStatusMapping: (next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void
    onStatusDraftChange: (id: string, patch: Partial<ProjectStatus>) => void
    onAddActiveStatus: () => void
    onRemoveStatusDraft: (status: ProjectStatus) => void
    onSaveProjectStatuses: () => void | Promise<void>

    projectAgentRows: Array<{ agent: { name: string; status?: string; title?: string }; count: number }>

    isWorkspacePickerOpen: boolean
    onCloseWorkspacePicker: () => void
    onMoveProjectWorkspace: (workspaceId: string | null) => Promise<void>

    pendingStatusTemplate: StatusTemplate | null
    onStatusTemplatePick: (template: StatusTemplate) => void
  }
}

export function ProjectDetailSettingsPopup({ open, onClose, scope }: ProjectDetailSettingsPopupProps) {
  const s = scope as any
  const [activeTab, setActiveTab] = useState<ProjectSettingsTab>(scope.projectSettingsTab)
  const [gatewayIdDraft, setGatewayIdDraft] = useState(scope.gatewayId)
  const [runtimeWorkspaceIdDraft, setRuntimeWorkspaceIdDraft] = useState(scope.gatewayRuntimeWorkspaceId)
  const [planModelDraft, setPlanModelDraft] = useState(scope.gatewayDefaultPlanModel || scope.gatewayDefaultModel)
  const [runModelDraft, setRunModelDraft] = useState(scope.gatewayDefaultRunModel || scope.gatewayDefaultModel)
  const [languageDraft, setLanguageDraft] = useState(normalizeGatewayLanguage(scope.gatewayLanguage))
  const [promptShapeDraft, setPromptShapeDraft] = useState(normalizeGatewayPromptShape(scope.codexPromptShape))
  const [planReasoningDraft, setPlanReasoningDraft] = useState(normalizeGatewayReasoningEffort(scope.gatewayPlanReasoningEffort))
  const [runReasoningDraft, setRunReasoningDraft] = useState(normalizeGatewayReasoningEffort(scope.gatewayRunReasoningEffort))
  const [defaultAgentIdDraft, setDefaultAgentIdDraft] = useState(scope.defaultAgentId)
  const [defaultSkillIdsDraft, setDefaultSkillIdsDraft] = useState<string[]>(scope.defaultSkillIds ?? [])
  const [workspaceTargetIdDraft, setWorkspaceTargetIdDraft] = useState(scope.selectedWorkspaceId ?? '')
  const [saveFeedbackByTab, setSaveFeedbackByTab] = useState<Partial<Record<ProjectSettingsTab, SettingsSaveFeedback>>>({})
  const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const nextProjectId = scope.project?.id ?? null
    if (hydratedProjectId === nextProjectId) return
    setHydratedProjectId(nextProjectId)
    setActiveTab(scope.projectSettingsTab === 'codex' ? 'models' : scope.projectSettingsTab)
    setGatewayIdDraft(scope.gatewayId)
    setRuntimeWorkspaceIdDraft(scope.gatewayRuntimeWorkspaceId)
    setPlanModelDraft(scope.gatewayDefaultPlanModel || scope.gatewayDefaultModel)
    setRunModelDraft(scope.gatewayDefaultRunModel || scope.gatewayDefaultModel)
    setLanguageDraft(normalizeGatewayLanguage(scope.gatewayLanguage))
    setPromptShapeDraft(normalizeGatewayPromptShape(scope.codexPromptShape))
    setPlanReasoningDraft(normalizeGatewayReasoningEffort(scope.gatewayPlanReasoningEffort))
    setRunReasoningDraft(normalizeGatewayReasoningEffort(scope.gatewayRunReasoningEffort))
    setDefaultAgentIdDraft(scope.defaultAgentId)
    setDefaultSkillIdsDraft(scope.defaultSkillIds ?? [])
    setWorkspaceTargetIdDraft(scope.selectedWorkspaceId ?? '')
    setSaveFeedbackByTab({})
  }, [open, scope.project?.id, hydratedProjectId, scope.projectSettingsTab, scope.gatewayId, scope.gatewayRuntimeWorkspaceId, scope.gatewayDefaultModel, scope.gatewayDefaultPlanModel, scope.gatewayDefaultRunModel, scope.gatewayLanguage, scope.codexPromptShape, scope.gatewayPlanReasoningEffort, scope.gatewayRunReasoningEffort, scope.defaultAgentId, scope.defaultSkillIds, scope.selectedWorkspaceId])

  useEffect(() => {
    if (!open) setHydratedProjectId(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    setPromptShapeDraft(normalizeGatewayPromptShape(scope.codexPromptShape))
  }, [open, scope.codexPromptShape])

  const localGatewayOptions = useMemo(() => scope.gatewayOptions, [scope.gatewayOptions])
  const localWorkspaceOptions = useMemo(() => scope.workspaceOptions ?? (scope.workspaces ?? []).map((workspace) => ({ label: workspace.name, value: workspace.id })), [scope.workspaceOptions, scope.workspaces])
  const localSelectedGateway = useMemo(() => (scope.gateways ?? []).find((gateway) => gateway.id === gatewayIdDraft) ?? null, [scope.gateways, gatewayIdDraft])
  const localGatewayModels = useMemo(() => codexConfigOf(localSelectedGateway).models ?? [], [localSelectedGateway])
  const localModelOptions = useMemo<AppSelectOption[]>(() => {
    if (localGatewayModels.length > 0) return localGatewayModels.map((model) => ({ label: model.label || model.id, value: model.id }))
    return gatewayIdDraft === scope.gatewayId ? scope.projectGatewayModelOptions : []
  }, [gatewayIdDraft, localGatewayModels, scope.gatewayId, scope.projectGatewayModelOptions])
  const localSelectedGatewayOption = useMemo(() => localGatewayOptions.find((option) => option.value === gatewayIdDraft) ?? null, [gatewayIdDraft, localGatewayOptions])
  const localSelectedWorkspaceOption = useMemo(() => localWorkspaceOptions.find((option) => option.value === runtimeWorkspaceIdDraft) ?? null, [localWorkspaceOptions, runtimeWorkspaceIdDraft])
  const localSelectedPlanModelOption = useMemo(() => localModelOptions.find((option) => option.value === planModelDraft) ?? null, [localModelOptions, planModelDraft])
  const localSelectedRunModelOption = useMemo(() => localModelOptions.find((option) => option.value === runModelDraft) ?? null, [localModelOptions, runModelDraft])
  const languageOptions = useMemo<AppSelectOption[]>(() => GATEWAY_LANGUAGE_OPTIONS.map((option) => ({ label: option.label, value: option.value })), [])
  const promptShapeOptions = useMemo<AppSelectOption[]>(() => GATEWAY_PROMPT_SHAPES.map((shape) => ({ label: shape === 'json' ? 'JSON' : shape === 'toon' ? 'Toon' : 'Markdown', value: shape })), [])
  const localPlanModel = useMemo(() => localGatewayModels.find((model) => model.id === planModelDraft) ?? null, [localGatewayModels, planModelDraft])
  const localRunModel = useMemo(() => localGatewayModels.find((model) => model.id === runModelDraft) ?? null, [localGatewayModels, runModelDraft])
  const planSupportsReasoning = gatewayModelSupportsReasoning(localPlanModel)
  const runSupportsReasoning = gatewayModelSupportsReasoning(localRunModel)
  const planReasoningOptions = useMemo<AppSelectOption[]>(() => {
    const efforts = gatewayModelReasoningEfforts(localPlanModel)
    return GATEWAY_REASONING_EFFORT_OPTIONS.filter((option) => efforts.includes(option.value)).map((option) => ({ label: option.label, value: option.value }))
  }, [localPlanModel])
  const runReasoningOptions = useMemo<AppSelectOption[]>(() => {
    const efforts = gatewayModelReasoningEfforts(localRunModel)
    return GATEWAY_REASONING_EFFORT_OPTIONS.filter((option) => efforts.includes(option.value)).map((option) => ({ label: option.label, value: option.value }))
  }, [localRunModel])
  const selectedLanguageOption = useMemo(() => languageOptions.find((option) => option.value === languageDraft) ?? languageOptions[0] ?? null, [languageDraft, languageOptions])
  const selectedPromptShapeOption = useMemo(() => promptShapeOptions.find((option) => option.value === promptShapeDraft) ?? promptShapeOptions[0] ?? null, [promptShapeDraft, promptShapeOptions])
  const selectedPlanReasoningOption = useMemo(() => planReasoningOptions.find((option) => option.value === planReasoningDraft) ?? planReasoningOptions.find((option) => option.value === 'medium') ?? planReasoningOptions[0] ?? null, [planReasoningDraft, planReasoningOptions])
  const selectedRunReasoningOption = useMemo(() => runReasoningOptions.find((option) => option.value === runReasoningDraft) ?? runReasoningOptions.find((option) => option.value === 'medium') ?? runReasoningOptions[0] ?? null, [runReasoningDraft, runReasoningOptions])
  const agentOptions = useMemo<AppSelectOption[]>(() => (scope.agents ?? []).map((agent) => ({ label: agent.name, value: agent.id })).sort((a, b) => a.label.localeCompare(b.label, 'tr')), [scope.agents])
  const selectedDefaultAgentOption = useMemo(() => agentOptions.find((option) => option.value === defaultAgentIdDraft) ?? null, [agentOptions, defaultAgentIdDraft])
  const skillOptions = useMemo<AppSelectOption[]>(() => (scope.skills ?? []).filter((skill) => skill.status === 'active' || skill.enabled || defaultSkillIdsDraft.includes(skill.id)).map((skill) => ({ label: skill.name, value: skill.id })).sort((a, b) => a.label.localeCompare(b.label, 'tr')), [defaultSkillIdsDraft, scope.skills])
  const selectedDefaultSkillOptions = useMemo(() => skillOptions.filter((option) => defaultSkillIdsDraft.includes(option.value)), [defaultSkillIdsDraft, skillOptions])
  const workspaceTargetOption = useMemo(() => localWorkspaceOptions.find((option) => option.value === workspaceTargetIdDraft) ?? null, [localWorkspaceOptions, workspaceTargetIdDraft])
  const workspaceTarget = useMemo(() => (scope.workspaces ?? []).find((workspace) => workspace.id === workspaceTargetIdDraft) ?? null, [scope.workspaces, workspaceTargetIdDraft])

  useEffect(() => {
    if (!gatewayIdDraft) return
    const modelIds = new Set(localModelOptions.map((option) => option.value))
    if (planModelDraft && modelIds.size > 0 && !modelIds.has(planModelDraft)) setPlanModelDraft('')
    if (runModelDraft && modelIds.size > 0 && !modelIds.has(runModelDraft)) setRunModelDraft('')
  }, [gatewayIdDraft, localModelOptions, planModelDraft, runModelDraft])

  const handleTabChange = (tab: ProjectSettingsTab) => {
    setActiveTab(tab)
  }

  const setSaveFeedback = (tab: ProjectSettingsTab, feedback: SettingsSaveFeedback) => {
    setSaveFeedbackByTab((current) => ({ ...current, [saveFeedbackTab(tab)]: feedback }))
  }

  const clearSaveFeedback = (tab: ProjectSettingsTab) => {
    setSaveFeedbackByTab((current) => {
      const next = { ...current }
      delete next[saveFeedbackTab(tab)]
      return next
    })
  }

  const clearActiveSaveFeedback = () => clearSaveFeedback(activeTab)

  const handleSaveGatewaySettings = async () => {
    const feedbackTab = saveFeedbackTab(activeTab)
    setSaveFeedback(feedbackTab, {
      state: 'saving',
      title: 'Saving',
      message: 'Project Codex settings are being saved.'
    })
    try {
      const codexDraft = activeTab === 'promptShape'
        ? { promptShape: promptShapeDraft }
        : activeTab === 'language'
          ? { language: languageDraft }
          : { gatewayId: gatewayIdDraft, runtimeWorkspaceId: runtimeWorkspaceIdDraft, planModel: planModelDraft, runModel: runModelDraft, language: languageDraft, promptShape: promptShapeDraft, planReasoningEffort: planSupportsReasoning ? planReasoningDraft : '', runReasoningEffort: runSupportsReasoning ? runReasoningDraft : '' }
      const saved = await s.onSaveProjectGatewaySettings(codexDraft)
      if (saved && typeof saved === 'object') {
        setGatewayIdDraft(saved.gatewayId ?? '')
        setRuntimeWorkspaceIdDraft(saved.runtimeWorkspaceId ?? '')
        setPlanModelDraft(saved.planModel ?? saved.defaultModel ?? '')
        setRunModelDraft(saved.runModel ?? saved.defaultModel ?? '')
        setLanguageDraft(normalizeGatewayLanguage(saved.language ?? languageDraft))
        setPromptShapeDraft(normalizeGatewayPromptShape(saved.promptShape ?? promptShapeDraft))
        setPlanReasoningDraft(normalizeGatewayReasoningEffort(saved.planReasoningEffort ?? planReasoningDraft))
        setRunReasoningDraft(normalizeGatewayReasoningEffort(saved.runReasoningEffort ?? runReasoningDraft))
      }
      setSaveFeedback(feedbackTab, {
        state: 'success',
        title: 'Saved',
        message: 'Project Codex settings are up to date.'
      })
    } catch (error) {
      setSaveFeedback(feedbackTab, {
        state: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Unable to save Codex settings'
      })
    }
  }

  const handleSaveDefaultsSettings = async () => {
    const feedbackTab = saveFeedbackTab(activeTab)
    setSaveFeedback(feedbackTab, {
      state: 'saving',
      title: 'Saving',
      message: activeTab === 'agents' ? 'Project agent default is being saved.' : 'Project skill defaults are being saved.'
    })
    try {
      await s.onSaveProjectDefaultsSettings({
        defaultAgentId: defaultAgentIdDraft || null,
        defaultSkillIds: defaultSkillIdsDraft
      })
      setSaveFeedback(feedbackTab, {
        state: 'success',
        title: 'Saved',
        message: activeTab === 'agents' ? 'Project agent default is up to date.' : 'Project skill defaults are up to date.'
      })
    } catch (error) {
      setSaveFeedback(feedbackTab, {
        state: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Unable to save project defaults'
      })
    }
  }

  const handleSaveProjectStatuses = async () => {
    setSaveFeedback('statuses', {
      state: 'saving',
      title: 'Saving',
      message: 'Project statuses are being saved.'
    })
    try {
      await s.onSaveProjectStatuses()
      setSaveFeedback('statuses', {
        state: 'success',
        title: 'Saved',
        message: 'Project statuses are up to date.'
      })
    } catch (error) {
      setSaveFeedback('statuses', {
        state: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Unable to update project statuses'
      })
    }
  }

  const handleSaveProjectGroup = async () => {
    if (!s.projectGroupForExport) {
      onClose()
      return
    }
    setSaveFeedback('projectGroup', {
      state: 'saving',
      title: 'Saving',
      message: 'Project group is being saved.'
    })
    try {
      await s.onSaveProjectGroup()
      setSaveFeedback('projectGroup', {
        state: 'success',
        title: 'Saved',
        message: 'Project group is up to date.'
      })
    } catch (error) {
      setSaveFeedback('projectGroup', {
        state: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Unable to save project group'
      })
    }
  }

  const handleProjectGroupAssignment = async (action: () => void | Promise<void>) => {
    setSaveFeedback('projectGroup', {
      state: 'saving',
      title: 'Saving',
      message: 'Project group assignment is being saved.'
    })
    try {
      await action()
      setSaveFeedback('projectGroup', {
        state: 'success',
        title: 'Saved',
        message: 'Project group assignment is up to date.'
      })
    } catch (error) {
      setSaveFeedback('projectGroup', {
        state: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Unable to update project group assignment'
      })
    }
  }

  const handleMoveProjectWorkspace = async (workspaceId: string | null) => {
    setSaveFeedback('workspace', {
      state: 'saving',
      title: 'Saving',
      message: workspaceId ? 'Project workspace is being updated.' : 'Project workspace is being detached.'
    })
    try {
      await s.onMoveProjectWorkspace(workspaceId)
      setWorkspaceTargetIdDraft(workspaceId ?? '')
      setSaveFeedback('workspace', {
        state: 'success',
        title: 'Saved',
        message: 'Project workspace is up to date.'
      })
    } catch (error) {
      setSaveFeedback('workspace', {
        state: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Unable to update project workspace'
      })
    }
  }

  const handleGatewayDraftChange = (value: string) => {
    setGatewayIdDraft(value)
    setPlanModelDraft('')
    setRunModelDraft('')
    clearActiveSaveFeedback()
    s.onSetGatewayModelError(null)
    if (value) void s.onRefreshGatewayModels?.(value)
  }

  const codexValidationMessage = !gatewayIdDraft
    ? 'Select a gateway.'
    : !runtimeWorkspaceIdDraft
      ? 'Select a runtime workspace.'
      : !planModelDraft
        ? 'Select a plan model.'
        : !runModelDraft
          ? 'Select a run model.'
          : ''

  const activeSaveFeedback = saveFeedbackByTab[saveFeedbackTab(activeTab)] ?? null

  if (!open) return null

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <section className={`${styles.shell} ${styles.projectSettingsModal}`} role="dialog" aria-modal="true" aria-label="Project settings">
        <header className={styles.header}>
          <div>
            <h3>Project settings</h3>
            <p>Manage workflow statuses and project workspace.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close project settings">×</button>
        </header>
        <div className={styles.tabs}>
          <div className={styles.tabList}>
            {(['statuses', 'agents', 'skills', 'models', 'language', 'promptShape', 'workspace', 'projectGroup'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                {tab === 'projectGroup' ? 'Project group' : tab === 'models' ? 'Models' : tab === 'language' ? 'Language' : tab === 'promptShape' ? 'Prompt format' : tab === 'workspace' ? 'Workspace' : tab === 'agents' ? 'Agents' : tab === 'skills' ? 'Skills' : 'Statuses'}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.saveFeedbackRegion}>
          {activeSaveFeedback ? <SettingsSaveToast feedback={activeSaveFeedback} /> : null}
        </div>
        <div className={styles.body}>
          {activeTab === 'statuses' ? (
            <>
              <div className={styles.tabCtaCard}>
                <div>
                  <strong>Apply status template</strong>
                  <span>Use a saved workflow and map existing task statuses when needed.</span>
                </div>
                <button type="button" className={styles.tabActionButton} onClick={s.onStatusTemplatePickerOpen}>
                  Apply template
                </button>
              </div>
              {(['not_started', 'active', 'done', 'closed'] as ProjectStatusCategory[]).map((category) => {
                const rows = s.statusDrafts.filter((item: ProjectStatus) => item.category === category)
                return (
                  <div key={category} className={styles.drawerSection}>
                    <h4>{category === 'not_started' ? 'Not started' : category === 'active' ? 'Active' : category === 'done' ? 'Done' : 'Closed'}</h4>
                    <div className={styles.settingsFormGrid}>
                      {rows.map((status: ProjectStatus) => (
                        <div key={status.id} className={styles.statusEditorRow}>
                          <input
                            className={styles.subtaskInlineInput}
                            value={status.name}
                            onChange={(event) => s.onStatusDraftChange(status.id, { name: event.target.value })}
                          />
                          <div className={styles.statusColorCell}>
                            <input
                              type="color"
                              value={status.color}
                              onChange={(event) => s.onStatusDraftChange(status.id, { color: event.target.value })}
                              aria-label={`${status.name} color`}
                            />
                            <input
                              className={styles.subtaskInlineInput}
                              value={status.color}
                              onChange={(event) => s.onStatusDraftChange(status.id, { color: event.target.value })}
                            />
                          </div>
                          <div className={styles.statusActionsCell}>
                            {category === 'active' ? (
                              <button type="button" className={styles.iconBtn} onClick={() => s.onRemoveStatusDraft(status)} aria-label={`Remove ${status.name}`}>
                                <span>x</span>
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {category === 'active' ? (
                      <button type="button" className={styles.subtaskAddButton} onClick={s.onAddActiveStatus}>
                        Add active status
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </>
          ) : null}

          {activeTab === 'statuses' && Object.keys(s.statusMapping).length > 0 ? (
            <div className={styles.drawerSection}>
              <h4>{s.pendingStatusTemplate ? `Map statuses for ${s.pendingStatusTemplate.name}` : 'Status migration mapping'}</h4>
              {Object.entries(s.statusMapping).map(([sourceId, targetId]) => {
                const source = s.projectStatuses.find((item: ProjectStatus) => item.id === sourceId)
                return (
                  <div key={sourceId} className={styles.statusMappingRow}>
                    <span>{source?.name ?? sourceId}</span>
                    <AppSelect
                      mode="single"
                      variant="borderless"
                      value={{
                        value: String(targetId),
                        label: s.statusDrafts.find((item: ProjectStatus) => item.id === String(targetId))?.name ?? 'Select target'
                      }}
                      options={s.statusDrafts.map((item: ProjectStatus) => ({ value: item.id, label: item.name, color: item.color }))}
                      onChange={(option) => {
                        if (!Array.isArray(option) && option?.value) {
                          s.setStatusMapping((current: Record<string, string>) => ({ ...current, [sourceId]: option.value }))
                        }
                      }}
                    />
                  </div>
                )
              })}
            </div>
          ) : null}

          {activeTab === 'workspace' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Workspace</h4>
                  <p>Review the current workspace and choose an explicit target before moving files.</p>
                </div>
                <button type="button" className={styles.tabActionButton} onClick={() => s.setIsWorkspacePickerOpen?.(true)} disabled={s.movingWorkspace}>
                  New workspace
                </button>
              </div>
              <div className={styles.settingsInfoGrid}>
                <div>
                  <span>Current workspace</span>
                  <strong>{s.selectedWorkspace?.name ?? 'No workspace'}</strong>
                </div>
                <div>
                  <span>Current root path</span>
                  <code>{s.selectedWorkspace?.rootPath ?? 'Project files are currently stored in staging until a workspace is assigned.'}</code>
                </div>
                <div>
                  <span>Project folder</span>
                  <code>{s.selectedWorkspace ? s.projectFolderPreview : 'Assign a workspace to create a project folder.'}</code>
                </div>
              </div>
              <div className={styles.settingsFormGrid}>
                <label>
                  <span>Target workspace</span>
                  <AppSelect
                    value={workspaceTargetOption}
                    options={localWorkspaceOptions}
                    placeholder="Keep no workspace"
                    isClearable
                    onChange={(option) => {
                      if (Array.isArray(option)) return
                      setWorkspaceTargetIdDraft(option?.value ?? '')
                    }}
                  />
                </label>
                <label>
                  <span>Target root path</span>
                  <code>{workspaceTarget?.rootPath ?? 'No workspace selected'}</code>
                </label>
              </div>
              <div className={styles.tabCtaCard}>
                <div>
                  <strong>{workspaceTargetIdDraft ? 'Move to selected workspace' : 'Detach workspace'}</strong>
                  <span>{workspaceTargetIdDraft === (s.selectedWorkspaceId ?? '') ? 'Selected target matches the current workspace.' : 'This will move stored project attachments into the target project folder.'}</span>
                </div>
                <button type="button" className={styles.tabActionButton} disabled={s.movingWorkspace || workspaceTargetIdDraft === (s.selectedWorkspaceId ?? '')} onClick={() => void handleMoveProjectWorkspace(workspaceTargetIdDraft || null)}>
                  {s.movingWorkspace ? 'Moving...' : 'Apply workspace'}
                </button>
              </div>
            </div>
          ) : null}

          {activeTab === 'projectGroup' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Project group</h4>
                  <p>{s.projectGroupForExport ? 'Assigned project group' : 'No project group assigned'}</p>
                </div>
                <button
                  type="button"
                  className={styles.tabActionButton}
                  onClick={s.onProjectGroupPickerOpen}
                  disabled={s.projectGroupSaving}
                >
                  Change group
                </button>
              </div>
              {s.projectGroupForExport ? (
                <div className={styles.settingsFormGrid}>
                  <label>
                    <span>Group name</span>
                    <input value={s.projectGroupNameDraft} onChange={(event) => s.onProjectGroupNameChange(event.target.value)} />
                  </label>
                  <label>
                    <span>Description</span>
                    <textarea value={s.projectGroupDescriptionDraft} onChange={(event) => s.onProjectGroupDescriptionChange(event.target.value)} rows={4} />
                  </label>
                  <div className={styles.settingsInfoGrid}>
                    <div>
                      <span>Projects</span>
                      <strong>{s.projectGroupForExport.projectIds?.length ?? 0}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{new Date(s.projectGroupForExport.updatedAt).toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.settingsEmptyState}>No project group assigned.</div>
              )}
            </div>
          ) : null}

          {activeTab === 'agents' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Agents</h4>
                  <p>Select the project agent inherited by Task Detail when a task has no explicit agent.</p>
                </div>
              </div>
              <div className={styles.settingsFormGrid}>
                <label>
                  <span>Project agent</span>
                  <AppSelect
                    value={selectedDefaultAgentOption}
                    options={agentOptions}
                    placeholder="No project agent"
                    isClearable
                    onChange={(option) => {
                      if (Array.isArray(option)) return
                      setDefaultAgentIdDraft(option?.value ?? '')
                      clearActiveSaveFeedback()
                    }}
                  />
                </label>
              </div>
              <div className={styles.settingsInfoGrid}>
                <div>
                  <span>Inherited agent</span>
                  <strong>{selectedDefaultAgentOption?.label ?? 'None'}</strong>
                </div>
              </div>
              {s.projectAgentRows.length > 0 ? (
                <div className={styles.settingsMiniTable}>
                  <div>
                    <span>Agent</span>
                    <span>Source count</span>
                    <span>Title</span>
                    <span>Tags</span>
                  </div>
                  {s.projectAgentRows.map(({ agent, count }: { agent: Agent; count: number }) => (
                    <div key={agent.id}>
                      <strong>{agent.name}</strong>
                      <span>{count}</span>
                      <span>{agent.title || '-'}</span>
                      <span>{(agent.tags ?? []).map((tag) => tag.name).join(', ') || '-'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.settingsEmptyState}>No agents assigned.</div>
              )}
            </div>
          ) : null}

          {activeTab === 'skills' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Skills</h4>
                  <p>Select the project skills inherited by Task Detail when a task has no explicit skills.</p>
                </div>
              </div>
              <div className={styles.settingsFormGrid}>
                <label>
                  <span>Project skills</span>
                  <AppSelect
                    mode="multi"
                    value={selectedDefaultSkillOptions}
                    options={skillOptions}
                    placeholder="No project skills"
                    onChange={(options) => {
                      setDefaultSkillIdsDraft(Array.isArray(options) ? options.map((option) => option.value) : [])
                      clearActiveSaveFeedback()
                    }}
                  />
                </label>
              </div>
              <div className={styles.settingsInfoGrid}>
                <div>
                  <span>Inherited skills</span>
                  <strong>{selectedDefaultSkillOptions.length} skill(s)</strong>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'language' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Language</h4>
                  <p>Codex reads prompts, writes responses, asks planning questions, and updates task JSON in this language.</p>
                </div>
              </div>
              <div className={styles.settingsFormGrid}>
                <label>
                  <span>Project Codex language</span>
                  <AppSelect
                    value={selectedLanguageOption}
                    options={languageOptions}
                    placeholder="Select language"
                    onChange={(option) => {
                      setLanguageDraft(normalizeGatewayLanguage(option?.value))
                      clearActiveSaveFeedback()
                    }}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {activeTab === 'promptShape' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Prompt data type</h4>
                  <p>Choose whether Codex receives task context and prompts as Markdown, JSON, or TOON.</p>
                </div>
              </div>
              <div className={styles.settingsFormGrid}>
                <label>
                  <span>Project prompt data type</span>
                  <AppSelect
                    value={selectedPromptShapeOption}
                    options={promptShapeOptions}
                    placeholder="Select prompt data type"
                    onChange={(option) => {
                      setPromptShapeDraft(normalizeGatewayPromptShape(option?.value))
                      clearActiveSaveFeedback()
                    }}
                  />
                </label>
              </div>
              <div className={styles.promptShapeGrid}>
                {[
                  { value: 'markdown', label: 'Markdown', description: 'Human-readable Task.md and Markdown prompt sections.' },
                  { value: 'json', label: 'JSON', description: 'Structured Task.json and prompt sections serialized as valid JSON.' },
                  { value: 'toon', label: 'TOON', description: 'Compact Task.toon and named prompt fields for lower-token context.' }
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.promptShapeCard} ${promptShapeDraft === option.value ? styles.promptShapeActive : ''}`}
                    onClick={() => {
                      setPromptShapeDraft(normalizeGatewayPromptShape(option.value))
                      clearActiveSaveFeedback()
                    }}
                    aria-pressed={promptShapeDraft === option.value}
                    aria-label={`Use ${option.label} prompt data type`}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {activeTab === 'models' || activeTab === 'codex' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Models</h4>
                  <p>Choose the CLI gateway, runtime workspace, and separate Plan/Run Codex models and reasoning levels.</p>
                </div>
              </div>
              <div className={styles.settingsFormGrid}>
                <label>
                  <span>Active gateway</span>
                  <AppSelect
                    value={localSelectedGatewayOption}
                    options={localGatewayOptions}
                    placeholder="Select gateway"
                    onChange={(option) => {
                      handleGatewayDraftChange(option?.value ?? '')
                    }}
                  />
                </label>
                <label>
                  <span>Runtime workspace</span>
                  <AppSelect
                    value={localSelectedWorkspaceOption}
                    options={localWorkspaceOptions}
                    placeholder="Select workspace"
                    onChange={(option) => {
                      setRuntimeWorkspaceIdDraft(option?.value ?? '')
                      clearActiveSaveFeedback()
                    }}
                  />
                </label>
                <label>
                  <span>Plan model</span>
                  <AppSelect
                    value={localSelectedPlanModelOption}
                    options={localModelOptions}
                    placeholder={s.gatewayModelLoading ? 'Modeller hazırlanıyor...' : localModelOptions.length > 0 ? 'Select plan model' : 'Select a gateway to load models'}
                    isDisabled={!gatewayIdDraft || localModelOptions.length === 0}
                    onChange={(option) => {
                      setPlanModelDraft(option?.value ?? '')
                      clearActiveSaveFeedback()
                    }}
                  />
                </label>
                {planSupportsReasoning ? (
                  <label>
                    <span>Plan reasoning</span>
                    <AppSelect
                      value={selectedPlanReasoningOption}
                      options={planReasoningOptions}
                      placeholder="Select reasoning"
                      onChange={(option) => {
                        setPlanReasoningDraft(normalizeGatewayReasoningEffort(option?.value))
                        clearActiveSaveFeedback()
                      }}
                    />
                  </label>
                ) : null}
                <label>
                  <span>Run model</span>
                  <AppSelect
                    value={localSelectedRunModelOption}
                    options={localModelOptions}
                    placeholder={s.gatewayModelLoading ? 'Modeller hazırlanıyor...' : localModelOptions.length > 0 ? 'Select run model' : 'Select a gateway to load models'}
                    isDisabled={!gatewayIdDraft || localModelOptions.length === 0}
                    onChange={(option) => {
                      setRunModelDraft(option?.value ?? '')
                      clearActiveSaveFeedback()
                    }}
                  />
                </label>
                {runSupportsReasoning ? (
                  <label>
                    <span>Run reasoning</span>
                    <AppSelect
                      value={selectedRunReasoningOption}
                      options={runReasoningOptions}
                      placeholder="Select reasoning"
                      onChange={(option) => {
                        setRunReasoningDraft(normalizeGatewayReasoningEffort(option?.value))
                        clearActiveSaveFeedback()
                      }}
                    />
                  </label>
                ) : null}
              </div>
              {s.gatewayModelLoading ? <LoadingState size="compact" messageIndex={4} /> : null}
              {s.gatewayModelError ? <div className={styles.settingsEmptyState}>{s.gatewayModelError}</div> : null}
            </div>
          ) : null}
        </div>
        <footer className={styles.footer}>
          {activeTab === 'statuses' ? (
            <>
              <span>Removing or replacing a status requires mapping old tasks and subtasks to a remaining status.</span>
              <button type="button" onClick={() => void handleSaveProjectStatuses()}>Save statuses</button>
            </>
          ) : activeTab === 'workspace' ? (
            <>
              <span>Workspace changes move existing attachment files into the selected project folder.</span>
              <button type="button" onClick={onClose} disabled={s.movingWorkspace}>Done</button>
            </>
          ) : activeTab === 'projectGroup' ? (
            <>
              <span>Project group assignment controls where this project appears in group views.</span>
              <button
                type="button"
                onClick={() => void handleSaveProjectGroup()}
                disabled={s.projectGroupSaving || Boolean(s.projectGroupForExport && !s.projectGroupNameDraft.trim())}
              >
                {s.projectGroupForExport ? 'Save group' : 'Done'}
              </button>
            </>
          ) : activeTab === 'models' || activeTab === 'codex' ? (
            <>
              <span>{codexValidationMessage || 'Task and template model tabs inherit this gateway default unless they explicitly override it.'}</span>
              <button
                type="button"
                onClick={() => void handleSaveGatewaySettings()}
                disabled={s.gatewaySaving || Boolean(codexValidationMessage)}
              >
                {s.gatewaySaving ? <LoadingState size="compact" messageIndex={2} /> : 'Save Model Settings'}
              </button>
            </>
          ) : activeTab === 'language' ? (
            <>
              <span>Language is a high-priority Codex instruction for planning, running, chat, and JSON updates.</span>
              <button
                type="button"
                onClick={() => void handleSaveGatewaySettings()}
                disabled={s.gatewaySaving}
              >
                {s.gatewaySaving ? 'Saving...' : 'Save language'}
              </button>
            </>
          ) : activeTab === 'promptShape' ? (
            <>
              <span>Choose the project prompt data type: Markdown, JSON, or TOON. Unsaved and legacy projects fall back to Markdown.</span>
              <button
                type="button"
                onClick={() => void handleSaveGatewaySettings()}
                disabled={s.gatewaySaving}
              >
                {s.gatewaySaving ? 'Saving...' : 'Save prompt format'}
              </button>
            </>
          ) : activeTab === 'agents' ? (
            <>
              <span>The project agent is inherited by tasks without an explicit task agent and is sent to Codex.</span>
              <button type="button" onClick={() => void handleSaveDefaultsSettings()}>Save agent</button>
            </>
          ) : (
            <>
              <span>Project skills are inherited by tasks without explicit skills and are sent to Codex on demand.</span>
              <button type="button" onClick={() => void handleSaveDefaultsSettings()}>Save skills</button>
            </>
          )}
        </footer>
      </section>

      {s.isStatusTemplatePickerOpen ? (
        <StatusTemplatePickerModal
          open={s.isStatusTemplatePickerOpen}
          templates={s.statusTemplates}
          onClose={s.onStatusTemplateClose}
          onPickTemplate={(template) => {
            s.onStatusTemplateClose()
            s.onStatusTemplatePick(template)
          }}
        />
      ) : null}

      {s.isProjectGroupPickerOpen ? (
        <ProjectGroupPickerModal
          open={s.isProjectGroupPickerOpen}
          projectGroupId={s.projectGroupForExport?.id}
          projectGroups={s.projectGroups}
          projectGroupSaving={s.projectGroupSaving}
          onClose={s.onProjectGroupPickerClose}
          onClearGroup={() => void handleProjectGroupAssignment(s.onProjectGroupClear)}
          onPickGroup={(group) => void handleProjectGroupAssignment(() => s.onProjectGroupPick(group))}
        />
      ) : null}

      {s.isWorkspacePickerOpen ? (
        <WorkspacePickerModal
          open
          selectedWorkspaceId={s.selectedWorkspaceId}
          workspaces={s.workspaces ?? []}
          moving={s.movingWorkspace}
          onClose={s.onCloseWorkspacePicker}
          onPickNoWorkspace={() => {
            s.onCloseWorkspacePicker()
            void handleMoveProjectWorkspace(null)
          }}
          onPickWorkspace={(workspace: Workspace) => {
            s.onCloseWorkspacePicker()
            void handleMoveProjectWorkspace(workspace.id)
          }}
          workspaceDraftName={s.workspaceDraftName}
          workspaceDraftPath={s.workspaceDraftPath}
          onDraftChange={s.onWorkspaceDraftChange ?? (() => undefined)}
          onChooseFolder={s.onChooseWorkspaceFolder}
          onCreateWorkspace={() => {
            return (async () => {
              const workspace = await s.onCreateWorkspace?.()
              if (!workspace) return
              s.onCloseWorkspacePicker()
              await handleMoveProjectWorkspace(workspace.id)
            })()
          }}
          createWorkspaceDisabled={!s.workspaceDraftName.trim() || !s.workspaceDraftPath.trim()}
        />
      ) : null}
    </>
  )
}
