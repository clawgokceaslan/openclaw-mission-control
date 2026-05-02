import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import { AppSelect } from '@renderer/components/select/AppSelect'
import type { Project, ProjectGroup, ProjectStatus, ProjectStatusCategory, StatusTemplate, TaskEntity, Workspace } from '@shared/types/entities'
import type { ProjectSettingsTab } from '@renderer/screens/projects/detail/types'
import { StatusTemplatePickerModal } from '../ProjectModals/StatusTemplatePickerModal'
import { ProjectGroupPickerModal } from '../ProjectModals/ProjectGroupPickerModal'
import { WorkspacePickerModal } from '../ProjectModals/WorkspacePickerModal'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

type ProjectSettingsOption = Pick<AppSelectOption, 'label' | 'value'>

type WorkspaceLike = Pick<Workspace, 'id' | 'name' | 'rootPath'>


export interface ProjectSettingsModalProps {
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
    codexGatewayOptions: AppSelectOption[]
    selectedRuntimeWorkspaceOption: AppSelectOption | null
    selectedDefaultModelOption: AppSelectOption | null
    projectCodexModelOptions: AppSelectOption[]
    codexModelOptions: AppSelectOption[]
    codexModelLoading: boolean
    codexModelError: string | null
    codexDefaultModel: string
    codexGatewayId: string
    codexRuntimeWorkspaceId: string
    onSetCodexGatewayId: (value: string) => void
    onSetCodexDefaultModel: (value: string) => void
    onSetCodexRuntimeWorkspaceId: (value: string) => void
    onSetCodexModelError: (value: string | null) => void
    codexSaving: boolean
    onSaveProjectCodexSettings: () => void | Promise<void>

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

export function ProjectSettingsModal({ open, onClose, scope }: ProjectSettingsModalProps) {
  if (!open) return null
  const s = scope as any

  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={`${styles.createTaskModal} ${styles.projectSettingsModal}`} role="dialog" aria-modal="true" aria-label="Project settings">
        <header className={styles.projectSettingsHeader}>
          <div>
            <h3>Project settings</h3>
            <p>Manage workflow statuses and project workspace.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close project settings">×</button>
        </header>
        <div className={styles.projectSettingsTabs}>
          <div className={styles.projectPromptTabs}>
            {(['statuses', 'workspace', 'projectGroup', 'agents', 'codex'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`${styles.projectPromptTab} ${s.projectSettingsTab === tab ? styles.projectPromptTabActive : ''}`}
                onClick={() => s.setProjectSettingsTab(tab)}
              >
                {tab === 'projectGroup' ? 'Project group' : tab === 'codex' ? 'Gateway settings' : tab === 'workspace' ? 'Workspace' : tab === 'agents' ? 'Agents' : 'Statuses'}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.projectSettingsBody}>
          {s.projectSettingsTab === 'statuses' ? (
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

          {s.projectSettingsTab === 'statuses' && Object.keys(s.statusMapping).length > 0 ? (
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
                        value: targetId,
                        label: s.statusDrafts.find((item: ProjectStatus) => item.id === targetId)?.name ?? 'Select target'
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

          {s.projectSettingsTab === 'workspace' ? (
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

          {s.projectSettingsTab === 'projectGroup' ? (
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

          {s.projectSettingsTab === 'agents' ? (
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
                  {s.projectAgentRows.map(({ agent, count }: { agent: TaskEntity; count: number }) => (
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

          {s.projectSettingsTab === 'codex' ? (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsPanelHeader}>
                <div>
                  <h4>Gateway settings</h4>
                  <p>Choose the CLI gateway, runtime workspace, and default Codex model for this project.</p>
                </div>
              </div>
              <div className={styles.settingsFormGrid}>
                <label>
                  <span>Active gateway</span>
                  <AppSelect
                    value={s.selectedCodexGatewayOption}
                    options={s.codexGatewayOptions}
                    placeholder="Select gateway"
                    onChange={(option) => {
                      const nextGatewayId = option?.value ?? ''
                      s.onSetCodexGatewayId(nextGatewayId)
                      s.onSetCodexModelError(null)
                    }}
                  />
                </label>
                <label>
                  <span>Runtime workspace</span>
                  <AppSelect
                    value={s.selectedRuntimeWorkspaceOption}
                    options={s.workspaceOptions ?? s.workspaces ?? []}
                    placeholder="Select workspace"
                    onChange={(option) => s.onSetCodexRuntimeWorkspaceId(option?.value ?? '')}
                  />
                </label>
                <label>
                  <span>Default model</span>
                  <AppSelect
                    value={s.selectedDefaultModelOption}
                    options={s.projectCodexModelOptions}
                    placeholder={s.codexModelLoading ? 'Loading models...' : s.codexModelOptions.length > 0 ? 'Select default model' : 'Select a gateway to load models'}
                    isDisabled={!s.codexGatewayId || s.codexModelOptions.length === 0}
                    onChange={(option) => s.onSetCodexDefaultModel(option?.value ?? '')}
                  />
                </label>
              </div>
              {s.codexModelLoading ? <div className={styles.settingsEmptyState}>Loading models from Codex CLI...</div> : null}
              {s.codexModelError ? <div className={styles.settingsEmptyState}>{s.codexModelError}</div> : null}
            </div>
          ) : null}
        </div>
        <footer className={styles.createTaskFooter}>
          {s.projectSettingsTab === 'statuses' ? (
            <>
              <span>Removing or replacing a status requires mapping old tasks and subtasks to a remaining status.</span>
              <button type="button" onClick={() => void s.onSaveProjectStatuses()}>Save statuses</button>
            </>
          ) : s.projectSettingsTab === 'workspace' ? (
            <>
              <span>Workspace changes move existing attachment files into the selected project folder.</span>
              <button type="button" onClick={onClose} disabled={s.movingWorkspace}>Done</button>
            </>
          ) : s.projectSettingsTab === 'projectGroup' ? (
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
          ) : s.projectSettingsTab === 'codex' ? (
            <>
              <span>Task and template model tabs inherit this gateway default unless they explicitly override it.</span>
              <button
                type="button"
                onClick={() => void s.onSaveProjectCodexSettings()}
                disabled={s.codexSaving || !s.codexGatewayId || !s.codexRuntimeWorkspaceId || !s.codexDefaultModel}
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
            s.onPickTemplate(template)
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
