import { useCallback, useMemo, useReducer } from 'react'
import { AppSelectOption } from '@renderer/components/select/AppSelect'
import {
  Agent,
  CustomField,
  Gateway,
  OutputFormat,
  Project,
  ProjectGroup,
  ProjectStatus,
  Skill,
  StatusTemplate,
  TaskEntity,
  TaskTemplate,
  Workspace,
  Tag
} from '@shared/types/entities'
import {
  ChatAttachmentDraft,
  ChatComposerMode,
  CodexRunFeedback,
  CustomFieldDraftRow,
  DataFormatRole,
  DetailTab,
  DetailViewMode,
  ProjectPromptTab,
  ProjectSettingsTab,
  TaskHistoryItem,
  TextDraftRow,
  ThreadEntry
} from './types'
import { createLocalId } from './projectDetailUtils'

export interface ProjectDetailState {
  project: Project | null
  projectGroups: ProjectGroup[]
  tasks: TaskEntity[]
  agents: Agent[]
  gateways: Gateway[]
  tags: Tag[]
  skills: Skill[]
  customFields: CustomField[]
  outputFormats: OutputFormat[]
  taskTemplates: TaskTemplate[]
  workspaces: Workspace[]
  projectStatuses: ProjectStatus[]
  statusTemplates: StatusTemplate[]
  viewMode: 'board' | 'list' | 'table'
  taskTitle: string
  listCreateStatus: TaskEntity['status'] | null
  listCreateTitle: string
  tableCreateActive: boolean
  isCreateTaskOpen: boolean
  isStatusEditorOpen: boolean
  projectSettingsTab: ProjectSettingsTab
  isWorkspacePickerOpen: boolean
  isProjectGroupPickerOpen: boolean
  projectGroupNameDraft: string
  projectGroupDescriptionDraft: string
  projectGroupSaving: boolean
  projectSyncing: boolean
  projectSyncMessage: string | null
  workspaceDraftName: string
  workspaceDraftPath: string
  movingWorkspace: boolean
  workspaceMoveMessage: string | null
  isStatusTemplatePickerOpen: boolean
  pendingStatusTemplate: StatusTemplate | null
  projectFolderPreview: string
  isProjectPromptSettingsOpen: boolean
  projectPromptTab: ProjectPromptTab
  projectPromptContext: string
  projectPromptPrompt: string
  projectPromptOutput: string
  projectPromptError: string | null
  isProjectPromptSaving: boolean
  codexGatewayId: string
  codexRuntimeWorkspaceId: string
  codexDefaultModel: string
  codexModelLoading: boolean
  codexModelError: string | null
  codexSaving: boolean
  codexRunLaunching: boolean
  codexPlanLaunching: boolean
  codexRunFeedback: CodexRunFeedback | null
  chatDraft: string
  chatSending: boolean
  chatStopping: boolean
  chatSettingsOpen: boolean
  chatGatewayId: string
  chatModel: string
  chatIncludeContext: boolean
  chatComposerMode: ChatComposerMode
  chatAttachments: ChatAttachmentDraft[]
  selectedChatConversationId: string
  isStartingNewChat: boolean
  chatDragDepth: number
  slashCommandIndex: number
  chatComposerFocused: boolean
  chatVisibleLimit: number
  statusDrafts: ProjectStatus[]
  statusMapping: Record<string, string>
  createTaskStatus: TaskEntity['status']
  createTaskInitialTitle: string
  createTaskInitialTemplateId: string | null
  collapsedStatuses: TaskEntity['status'][]
  error: string | null
  busy: boolean
  selectedTaskId: string | null
  isActivityModalOpen: boolean
  isTitleEditing: boolean
  titleDraft: string
  isDescriptionEditing: boolean
  isDescriptionSaving: boolean
  isAttachmentUploading: boolean
  detailTab: DetailTab
  detailViewMode: DetailViewMode
  selectedSubtaskId: string | null
  descriptionDraft: string
  subtaskDescriptionDraft: string
  isSubtaskDescriptionSaving: boolean
  commentDraft: string
  editingCommentId: string | null
  subtaskCommentDraft: string
  editingSubtaskCommentId: string | null
  isAddSubtaskOpen: boolean
  isTaskImportOpen: boolean
  isTaskImporting: boolean
  subtaskRows: TextDraftRow[]
  isChecklistModalOpen: boolean
  checklistRows: TextDraftRow[]
  checklistDraft: string
  editingSubtaskId: string | null
  subtaskDraft: string
  selectedCustomFieldOption: AppSelectOption | null
  editingCustomFieldId: string | null
  customFieldDraft: string
  customFieldError: string | null
  isCustomFieldModalOpen: boolean
  isCreateCustomFieldOpen: boolean
  customFieldRows: CustomFieldDraftRow[]
  quickFieldName: string
  quickFieldType: CustomField['type']
  isOutputFormatModalOpen: boolean
  isCreateOutputFormatOpen: boolean
  outputFormatDraftOption: AppSelectOption | null
  dataFormatRoleDraft: DataFormatRole
  dataFormatTarget: { role: DataFormatRole; scope: DetailViewMode } | null
  quickOutputFormatName: string
  quickOutputFormatDescription: string
  pendingDeleteSubtaskId: string | null
  selectedSubtaskIds: string[]
  subtaskStatusMenu: { subtaskId: string; left: number; top: number } | null
  history: TaskHistoryItem[]
  localActivityEntries: ThreadEntry[]
  detailRatio: number
  isResizingSplit: boolean
  isTableColumnPickerOpen: boolean
}

export type FieldSetter<Value> = (next: Value | ((previous: Value) => Value)) => void

export type ProjectDetailStateBindings = ProjectDetailState & {
  [K in keyof ProjectDetailState as `set${Capitalize<string & K>}`]: FieldSetter<ProjectDetailState[K]>
  setState: (patch: Partial<ProjectDetailState>) => void
  resetState: (state?: Partial<ProjectDetailState>) => void
}

type SetFieldAction = {
  type: 'setField'
  key: keyof ProjectDetailState
  value: any
}

type PatchAction = {
  type: 'patch'
  patch: Partial<ProjectDetailState>
}

type ResetAction = { type: 'reset'; state?: Partial<ProjectDetailState> }
type ProjectDetailStateAction = SetFieldAction | PatchAction | ResetAction

export const PROJECT_DETAIL_INITIAL_STATE: ProjectDetailState = {
  project: null,
  projectGroups: [],
  tasks: [],
  agents: [],
  gateways: [],
  tags: [],
  skills: [],
  customFields: [],
  outputFormats: [],
  taskTemplates: [],
  workspaces: [],
  projectStatuses: [],
  statusTemplates: [],
  viewMode: 'board',
  taskTitle: '',
  listCreateStatus: null,
  listCreateTitle: '',
  tableCreateActive: false,
  isCreateTaskOpen: false,
  isStatusEditorOpen: false,
  projectSettingsTab: 'statuses',
  isWorkspacePickerOpen: false,
  isProjectGroupPickerOpen: false,
  projectGroupNameDraft: '',
  projectGroupDescriptionDraft: '',
  projectGroupSaving: false,
  projectSyncing: false,
  projectSyncMessage: null,
  workspaceDraftName: '',
  workspaceDraftPath: '',
  movingWorkspace: false,
  workspaceMoveMessage: null,
  isStatusTemplatePickerOpen: false,
  pendingStatusTemplate: null,
  projectFolderPreview: '',
  isProjectPromptSettingsOpen: false,
  projectPromptTab: 'context',
  projectPromptContext: '',
  projectPromptPrompt: '',
  projectPromptOutput: '',
  projectPromptError: null,
  isProjectPromptSaving: false,
  codexGatewayId: '',
  codexRuntimeWorkspaceId: '',
  codexDefaultModel: '',
  codexModelLoading: false,
  codexModelError: null,
  codexSaving: false,
  codexRunLaunching: false,
  codexPlanLaunching: false,
  codexRunFeedback: null,
  chatDraft: '',
  chatSending: false,
  chatStopping: false,
  chatSettingsOpen: false,
  chatGatewayId: '',
  chatModel: '',
  chatIncludeContext: true,
  chatComposerMode: 'chat',
  chatAttachments: [],
  selectedChatConversationId: '',
  isStartingNewChat: false,
  chatDragDepth: 0,
  slashCommandIndex: 0,
  chatComposerFocused: false,
  chatVisibleLimit: 40,
  statusDrafts: [],
  statusMapping: {},
  createTaskStatus: 'pending',
  createTaskInitialTitle: '',
  createTaskInitialTemplateId: null,
  collapsedStatuses: [],
  error: null,
  busy: false,
  selectedTaskId: null,
  isActivityModalOpen: false,
  isTitleEditing: false,
  titleDraft: '',
  isDescriptionEditing: false,
  isDescriptionSaving: false,
  isAttachmentUploading: false,
  detailTab: 'subtasks',
  detailViewMode: 'task',
  selectedSubtaskId: null,
  descriptionDraft: '',
  subtaskDescriptionDraft: '',
  isSubtaskDescriptionSaving: false,
  commentDraft: '',
  editingCommentId: null,
  subtaskCommentDraft: '',
  editingSubtaskCommentId: null,
  isAddSubtaskOpen: false,
  isTaskImportOpen: false,
  isTaskImporting: false,
  subtaskRows: [{ id: createLocalId(), title: '' }],
  isChecklistModalOpen: false,
  checklistRows: [{ id: createLocalId(), title: '' }],
  checklistDraft: '',
  editingSubtaskId: null,
  subtaskDraft: '',
  selectedCustomFieldOption: null,
  editingCustomFieldId: null,
  customFieldDraft: '',
  customFieldError: null,
  isCustomFieldModalOpen: false,
  isCreateCustomFieldOpen: false,
  customFieldRows: [{ id: createLocalId(), field: null, value: '' }],
  quickFieldName: '',
  quickFieldType: 'text',
  isOutputFormatModalOpen: false,
  isCreateOutputFormatOpen: false,
  outputFormatDraftOption: null,
  dataFormatRoleDraft: 'output',
  dataFormatTarget: null,
  quickOutputFormatName: '',
  quickOutputFormatDescription: '',
  pendingDeleteSubtaskId: null,
  selectedSubtaskIds: [],
  subtaskStatusMenu: null,
  history: [],
  localActivityEntries: [],
  detailRatio: 0.7,
  isResizingSplit: false,
  isTableColumnPickerOpen: false
}

function projectDetailReducer(state: ProjectDetailState, action: ProjectDetailStateAction): ProjectDetailState {
  switch (action.type) {
    case 'setField': {
      const { key, value } = action
      const prev = state[key]
      const next = typeof value === 'function' ? value(prev) : value
      return { ...state, [key]: next }
    }
    case 'patch':
      return { ...state, ...action.patch }
    case 'reset':
      return { ...PROJECT_DETAIL_INITIAL_STATE, ...action.state }
    default:
      return state
  }
}

function capitalizeField(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function buildBindings(
  state: ProjectDetailState,
  setField: (key: keyof ProjectDetailState, value: unknown) => void
): Omit<ProjectDetailStateBindings, 'setState' | 'resetState'> {
  const bindings = { ...state } as Omit<ProjectDetailStateBindings, 'setState' | 'resetState'>

  ;(Object.keys(state) as Array<keyof ProjectDetailState>).forEach((key) => {
    const setterName = `set${capitalizeField(key as string)}` as keyof Omit<ProjectDetailStateBindings, 'setState' | 'resetState'>
    ;(bindings as Record<string, unknown>)[setterName as string] = (value: unknown) => {
      setField(key, value)
    }
  })

  return bindings
}

export function useProjectDetailState(overrides: Partial<ProjectDetailState> = {}): ProjectDetailStateBindings {
  const [state, dispatch] = useReducer(projectDetailReducer, { ...PROJECT_DETAIL_INITIAL_STATE, ...overrides })

  const setField = useCallback((key: keyof ProjectDetailState, value: unknown) => {
    dispatch({ type: 'setField', key, value })
  }, [])

  const setState = useCallback((patch: Partial<ProjectDetailState>) => {
    dispatch({ type: 'patch', patch })
  }, [])

  const resetState = useCallback((statePatch?: Partial<ProjectDetailState>) => {
    dispatch({ type: 'reset', state: statePatch })
  }, [])

  return useMemo(() => {
    const bindings = buildBindings(state, setField)
    const wrapped = bindings as ProjectDetailStateBindings
    wrapped.setState = setState
    wrapped.resetState = resetState
    return wrapped
  }, [state, setField, setState, resetState])
}
