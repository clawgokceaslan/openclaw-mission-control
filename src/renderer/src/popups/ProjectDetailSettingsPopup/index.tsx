import { useEffect, useMemo, useState } from 'react'
import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import { AppSelect } from '@renderer/components/select/AppSelect'
import type { Gateway, Project, ProjectGroup, ProjectStatus, ProjectStatusCategory, StatusTemplate, Workspace } from '@shared/types/entities'
import type { ProjectSettingsTab } from '@renderer/screens/projects/detail/types'
import { StatusTemplatePickerModal } from '@renderer/components/projects/detail/ProjectModals/StatusTemplatePickerModal'
import { ProjectGroupPickerModal } from '@renderer/components/projects/detail/ProjectModals/ProjectGroupPickerModal'
import { WorkspacePickerModal } from '@renderer/components/projects/detail/ProjectModals/WorkspacePickerModal'
import { codexConfigOf } from '@renderer/screens/projects/detail/projectDetailUtils'
import styles from './index.module.scss'

type ProjectSettingsOption = Pick<AppSelectOption, 'label' | 'value'>

type WorkspaceLike = Pick<Workspace, 'id' | 'name' | 'rootPath'>


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

    selectedCodexGatewayOption: ProjectSettingsOption | null
    gateways?: Gateway[]
    codexGatewayOptions: AppSelectOption[]
    selectedRuntimeWorkspaceOption: AppSelectOption | null
    selectedDefaultModelOption: AppSelectOption | null
    selectedDefaultPlanModelOption: AppSelectOption | null
    selectedDefaultRunModelOption: AppSelectOption | null
    projectCodexModelOptions: AppSelectOption[]
    codexModelOptions: unknown[]
    codexModelLoading: boolean
    codexModelError: string | null
    codexDefaultModel: string
    codexDefaultPlanModel: string
    codexDefaultRunModel: string
    codexGatewayId: string
    codexRuntimeWorkspaceId: string
    onSetCodexGatewayId: (value: string) => void
    onSetCodexDefaultModel: (value: string) => void
    onSetCodexDefaultPlanModel: (value: string) => void
    onSetCodexDefaultRunModel: (value: string) => void
    onSetCodexRuntimeWorkspaceId: (value: string) => void
    onSetCodexModelError: (value: string | null) => void
    codexSaving: boolean
    onSaveProjectCodexSettings: (draft?: { gatewayId: string; runtimeWorkspaceId: string; planModel: string; runModel: string }) => void | Promise<void>

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
    onProjectGroupClear: () => void
    onProjectGroupPick: (group: ProjectGroup) => void
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
  const [gatewayIdDraft, setGatewayIdDraft] = useState(scope.codexGatewayId)
  const [runtimeWorkspaceIdDraft, setRuntimeWorkspaceIdDraft] = useState(scope.codexRuntimeWorkspaceId)
  const [planModelDraft, setPlanModelDraft] = useState(scope.codexDefaultPlanModel || scope.codexDefaultModel)
  const [runModelDraft, setRunModelDraft] = useState(scope.codexDefaultRunModel || scope.codexDefaultModel)

  useEffect(() => {
    if (!open) return
    setActiveTab(scope.projectSettingsTab)
    setGatewayIdDraft(scope.codexGatewayId)
    setRuntimeWorkspaceIdDraft(scope.codexRuntimeWorkspaceId)
    setPlanModelDraft(scope.codexDefaultPlanModel || scope.codexDefaultModel)
    setRunModelDraft(scope.codexDefaultRunModel || scope.codexDefaultModel)
  }, [open, scope.project?.id, scope.projectSettingsTab, scope.codexGatewayId, scope.codexRuntimeWorkspaceId, scope.codexDefaultModel, scope.codexDefaultPlanModel, scope.codexDefaultRunModel])

  const localGatewayOptions = useMemo(() => scope.codexGatewayOptions, [scope.codexGatewayOptions])
  const localWorkspaceOptions = useMemo(() => scope.workspaceOptions ?? (scope.workspaces ?? []).map((workspace) => ({ label: workspace.name, value: workspace.id })), [scope.workspaceOptions, scope.workspaces])
  const localSelectedGateway = useMemo(() => (scope.gateways ?? []).find((gateway) => gateway.id === gatewayIdDraft) ?? null, [scope.gateways, gatewayIdDraft])
  const localModelOptions = useMemo<AppSelectOption[]>(() => {
    const gatewayModels = codexConfigOf(localSelectedGateway).models ?? []
    if (gatewayModels.length > 0) return gatewayModels.map((model) => ({ label: model.label || model.id, value: model.id }))
    return gatewayIdDraft === scope.codexGatewayId ? scope.projectCodexModelOptions : []
  }, [gatewayIdDraft, localSelectedGateway, scope.codexGatewayId, scope.projectCodexModelOptions])
  const localSelectedGatewayOption = useMemo(() => localGatewayOptions.find((option) => option.value === gatewayIdDraft) ?? null, [gatewayIdDraft, localGatewayOptions])
  const localSelectedWorkspaceOption = useMemo(() => localWorkspaceOptions.find((option) => option.value === runtimeWorkspaceIdDraft) ?? null, [localWorkspaceOptions, runtimeWorkspaceIdDraft])
  const localSelectedPlanModelOption = useMemo(() => localModelOptions.find((option) => option.value === planModelDraft) ?? null, [localModelOptions, planModelDraft])
  const localSelectedRunModelOption = useMemo(() => localModelOptions.find((option) => option.value === runModelDraft) ?? null, [localModelOptions, runModelDraft])

  useEffect(() => {
    if (!gatewayIdDraft) return
    const modelIds = new Set(localModelOptions.map((option) => option.value))
    if (planModelDraft && modelIds.size > 0 && !modelIds.has(planModelDraft)) setPlanModelDraft('')
    if (runModelDraft && modelIds.size > 0 && !modelIds.has(runModelDraft)) setRunModelDraft('')
  }, [gatewayIdDraft, localModelOptions, planModelDraft, runModelDraft])

  const handleTabChange = (tab: ProjectSettingsTab) => {
    setActiveTab(tab)
  }

  const handleSaveCodexSettings = async () => {
    s.onSetCodexGatewayId(gatewayIdDraft)
    s.onSetCodexRuntimeWorkspaceId(runtimeWorkspaceIdDraft)
    s.onSetCodexDefaultPlanModel(planModelDraft)
    s.onSetCodexDefaultRunModel(runModelDraft)
    s.onSetCodexDefaultModel(runModelDraft)
    s.onSetCodexModelError(null)
    await s.onSaveProjectCodexSettings({ gatewayId: gatewayIdDraft, runtimeWorkspaceId: runtimeWorkspaceIdDraft, planModel: planModelDraft, runModel: runModelDraft })
  }

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
            {(['statuses', 'workspace', 'projectGroup', 'agents', 'codex'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                {tab === 'projectGroup' ? 'Project group' : tab === 'codex' ? 'Gateway settings' : tab === 'workspace' ? 'Workspace' : tab === 'agents' ? 'Agents' : 'Statuses'}
              </button>
            ))}
          </div>
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
                  <p>{s.selectedWorkspace ? 'Assigned workspace' : 'No workspace assigned'}</p>
                </div>
                <button type="button" className={styles.tabActionButton} onClick={() => s.setIsWorkspacePickerOpen?.(true)} disabled={s.movingWorkspace}>
                  Change workspace
                </button>
              </div>
              <div className={styles.settingsInfoGrid}>
                <div>
                  <span>Name</span>
                  <strong>{s.selectedWorkspace?.name ?? 'No workspace'}</strong>
                </div>
                <div>
                  <span>Root path</span>
                  <code>{s.selectedWorkspace?.rootPath ?? 'Project files are currently stored in staging until a workspace is assigned.'}</code>
                </div>
                <div>
                  <span>Project folder</span>
                  <code>{s.selectedWorkspace ? s.projectFolderPreview : 'Assign a workspace to create a project folder.'}</code>
                </div>
              </div>
              {s.movingWorkspace ? (
                <div className={styles.workspaceProgress} aria-label="Moving project workspace">
                  <span />
                </div>
              ) : null}
              {s.workspaceMoveMessage ? <p className={styles.customFieldEmpty}>{s.workspaceMoveMessage}</p> : null}
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
                  <p>Unique agents assigned to this project's tasks and subtasks.</p>
                </div>
              </div>
              {s.projectAgentRows.length > 0 ? (
                <div className={styles.settingsMiniTable}>
                  <div>
                    <span>Agent</span>
                    <span>Source count</span>
                    <span>Status</span>
                    <span>Title</span>
                  </div>
                  {s.projectAgentRows.map(({ agent, count }: { agent: { id?: string; name: string; status?: string; title?: string }; count: number }) => (
                    <div key={agent.id}>
                      <strong>{agent.name}</strong>
                      <span>{count}</span>
                      <span>{agent.status}</span>
                      <span>{agent.title || '-'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.settingsEmptyState}>No agents assigned.</div>
              )}
            </div>
          ) : null}

          {activeTab === 'codex' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Gateway settings</h4>
                  <p>Choose the CLI gateway, runtime workspace, and separate Plan/Run Codex models for this project.</p>
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
                      setGatewayIdDraft(option?.value ?? '')
                      s.onSetCodexModelError(null)
                    }}
                  />
                </label>
                <label>
                  <span>Runtime workspace</span>
                  <AppSelect
                    value={localSelectedWorkspaceOption}
                    options={localWorkspaceOptions}
                    placeholder="Select workspace"
                    onChange={(option) => setRuntimeWorkspaceIdDraft(option?.value ?? '')}
                  />
                </label>
                <label>
                  <span>Plan model</span>
                  <AppSelect
                    value={localSelectedPlanModelOption}
                    options={localModelOptions}
                    placeholder={s.codexModelLoading && gatewayIdDraft === s.codexGatewayId ? 'Loading models...' : localModelOptions.length > 0 ? 'Select plan model' : 'Select a gateway to load models'}
                    isDisabled={!gatewayIdDraft || localModelOptions.length === 0}
                    onChange={(option) => setPlanModelDraft(option?.value ?? '')}
                  />
                </label>
                <label>
                  <span>Run model</span>
                  <AppSelect
                    value={localSelectedRunModelOption}
                    options={localModelOptions}
                    placeholder={s.codexModelLoading && gatewayIdDraft === s.codexGatewayId ? 'Loading models...' : localModelOptions.length > 0 ? 'Select run model' : 'Select a gateway to load models'}
                    isDisabled={!gatewayIdDraft || localModelOptions.length === 0}
                    onChange={(option) => setRunModelDraft(option?.value ?? '')}
                  />
                </label>
              </div>
              {s.codexModelLoading && gatewayIdDraft === s.codexGatewayId ? <div className={styles.settingsEmptyState}>Loading models from Codex CLI...</div> : null}
              {s.codexModelError ? <div className={styles.settingsEmptyState}>{s.codexModelError}</div> : null}
            </div>
          ) : null}
        </div>
        <footer className={styles.footer}>
          {activeTab === 'statuses' ? (
            <>
              <span>Removing or replacing a status requires mapping old tasks and subtasks to a remaining status.</span>
              <button type="button" onClick={() => void s.onSaveProjectStatuses()}>Save statuses</button>
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
                onClick={() => {
                  if (s.projectGroupForExport) {
                    void s.onSaveProjectGroup()
                  } else {
                    onClose()
                  }
                }}
                disabled={s.projectGroupSaving || Boolean(s.projectGroupForExport && !s.projectGroupNameDraft.trim())}
              >
                {s.projectGroupForExport ? 'Save group' : 'Done'}
              </button>
            </>
          ) : activeTab === 'codex' ? (
            <>
              <span>Task and template model tabs inherit this gateway default unless they explicitly override it.</span>
              <button
                type="button"
                onClick={() => void handleSaveCodexSettings()}
                disabled={s.codexSaving || !gatewayIdDraft || !runtimeWorkspaceIdDraft || !planModelDraft || !runModelDraft}
              >
                {s.codexSaving ? 'Saving...' : 'Save Codex settings'}
              </button>
            </>
          ) : (
            <>
              <span>Agents are listed from current task and subtask assignments.</span>
              <button type="button" onClick={onClose}>Done</button>
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
          onClearGroup={s.onProjectGroupClear}
          onPickGroup={(group) => s.onProjectGroupPick(group)}
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
            void s.onMoveProjectWorkspace(null)
          }}
          onPickWorkspace={(workspace: Workspace) => {
            s.onCloseWorkspacePicker()
            void s.onMoveProjectWorkspace(workspace.id)
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
              await s.onMoveProjectWorkspace(workspace.id)
            })()
          }}
          createWorkspaceDisabled={!s.workspaceDraftName.trim() || !s.workspaceDraftPath.trim()}
        />
      ) : null}
    </>
  )
}
