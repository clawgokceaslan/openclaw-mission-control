import { Dispatch, useCallback, useMemo, useReducer } from 'react'
import { AppSelectOption } from '@renderer/components/select/AppSelect'
import { Agent, CustomField, Gateway, OutputFormat, Project, ProjectGroup, ProjectStatus, Skill, StatusTemplate, TaskEntity, TaskTemplate, Workspace, Tag } from '@shared/types/entities'
import { ChatAttachmentDraft, ChatComposerMode, CodexRunFeedback, CustomFieldDraftRow, DataFormatRole, DetailTab, DetailViewMode, ProjectPromptTab, ProjectSettingsTab, TaskHistoryItem, TextDraftRow, ThreadEntry } from '../types'
import { createLocalId } from '../projectDetailUtils'

export interface ProjectDetailDataState {
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
}

export interface ProjectDetailSelectionState {
  viewMode: 'board' | 'list' | 'table'
  selectedTaskId: string | null
  selectedSubtaskId: string | null
  detailTab: DetailTab
  detailViewMode: DetailViewMode
}

export interface ProjectDetailUiState {
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
  projectPromptPlanGuide: string
  projectPromptOutput: string
  projectPromptRules: string
  projectPromptPostRun: string
  projectPromptError: string | null
  isProjectPromptSaving: boolean
  error: string | null
  busy: boolean
  isChatPopupOpen: boolean
  isTitleEditing: boolean
  titleDraft: string
  taskTitle: string
  listCreateStatus: TaskEntity['status'] | null
  listCreateTitle: string
  tableCreateActive: boolean
  collapsedStatuses: TaskEntity['status'][]
  isResizingSplit: boolean
  detailRatio: number
  isTableColumnPickerOpen: boolean
}

export interface ProjectDetailFormsState {
  statusDrafts: ProjectStatus[]
  statusMapping: Record<string, string>
  createTaskStatus: TaskEntity['status']
  createTaskInitialTitle: string
  createTaskInitialTemplateId: string | null
  subtaskRows: TextDraftRow[]
  isChecklistModalOpen: boolean
  checklistRows: TextDraftRow[]
  checklistDraft: string
  isDescriptionEditing: boolean
  isDescriptionSaving: boolean
  isAttachmentUploading: boolean
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
  localChatEntries: ThreadEntry[]
}

export interface ProjectDetailCodexState {
  codexGatewayId: string
  codexRuntimeWorkspaceId: string
  codexDefaultModel: string
  codexDefaultPlanModel: string
  codexDefaultRunModel: string
  codexModelLoading: boolean
  codexModelError: string | null
  codexSaving: boolean
  codexRunLaunching: boolean
  codexPlanLaunching: boolean
  codexRunFeedback: CodexRunFeedback | null
}

export interface ProjectDetailChatState {
  chatDraft: string
  chatSending: boolean
  chatStopping: boolean
  chatSettingsOpen: boolean
  chatGatewayId: string
  chatModel: string
  chatPlanModel: string
  chatRunModel: string
  chatPlanReasoningEffort: string
  chatRunReasoningEffort: string
  chatIncludeContext: boolean
  chatComposerMode: ChatComposerMode
  chatAttachments: ChatAttachmentDraft[]
  selectedChatConversationId: string
  isStartingNewChat: boolean
  chatDragDepth: number
  slashCommandIndex: number
  chatComposerFocused: boolean
  chatVisibleLimit: number
}

export interface ProjectDetailState {
  data: ProjectDetailDataState
  selection: ProjectDetailSelectionState
  ui: ProjectDetailUiState
  forms: ProjectDetailFormsState
  codex: ProjectDetailCodexState
  chat: ProjectDetailChatState
}

export type ProjectDetailFlatState = ProjectDetailDataState &
  ProjectDetailSelectionState &
  ProjectDetailUiState &
  ProjectDetailFormsState &
  ProjectDetailCodexState &
  ProjectDetailChatState

export type FieldSetter<Value> = (next: Value | ((previous: Value) => Value)) => void

type ModalActionKey = keyof Pick<
  ProjectDetailFlatState,
  | 'isCreateTaskOpen'
  | 'isStatusEditorOpen'
  | 'isWorkspacePickerOpen'
  | 'isProjectGroupPickerOpen'
  | 'isStatusTemplatePickerOpen'
  | 'isProjectPromptSettingsOpen'
  | 'isChatPopupOpen'
  | 'isAddSubtaskOpen'
  | 'isTaskImportOpen'
  | 'isChecklistModalOpen'
  | 'isCustomFieldModalOpen'
  | 'isCreateCustomFieldOpen'
  | 'isOutputFormatModalOpen'
>

export type ProjectDetailAction =
  | { type: 'loadSuccess'; payload: Partial<ProjectDetailDataState> }
  | { type: 'setSelection'; payload: Partial<ProjectDetailSelectionState> }
  | { type: 'setUi'; payload: Partial<ProjectDetailUiState> }
  | { type: 'setForms'; payload: Partial<ProjectDetailFormsState> }
  | { type: 'setCodex'; payload: Partial<ProjectDetailCodexState> }
  | { type: 'setChatState'; payload: Partial<ProjectDetailChatState> }
  | { type: 'setBusy'; busy: boolean }
  | { type: 'setError'; error: string | null }
  | { type: 'openModal'; modal: ModalActionKey; value?: boolean }
  | { type: 'closeModal'; modal: ModalActionKey }
  | { type: 'setDraft'; payload: Partial<ProjectDetailState> }
  | { type: 'setField'; key: keyof ProjectDetailFlatState; value: unknown }
  | { type: 'setState'; state: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState> }
  | { type: 'patch'; patch: Partial<ProjectDetailState> }
  | { type: 'reset'; state?: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState> }

export type ProjectDetailStateBindings = ProjectDetailFlatState & {
  [K in keyof ProjectDetailFlatState as `set${Capitalize<string & K>}`]: FieldSetter<ProjectDetailFlatState[K]>
  setState: (patch: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState>) => void
  resetState: (state?: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState>) => void
  dispatch: Dispatch<ProjectDetailAction>
  dispatchers: {
    data: {
      loadSuccess: (next: Partial<ProjectDetailDataState>) => void
      replace: (next: ProjectDetailDataState) => void
    }
    selection: {
      setSelection: (next: Partial<ProjectDetailSelectionState>) => void
    }
    ui: {
      setBusy: (busy: boolean) => void
      setError: (error: string | null) => void
      openModal: (modal: ModalActionKey, value?: boolean) => void
      closeModal: (modal: ModalActionKey) => void
    }
    forms: {
      setDraft: (next: Partial<ProjectDetailFormsState>) => void
    }
    codex: {
      setCodexStatus: (next: Partial<ProjectDetailCodexState>) => void
    }
    chat: {
      setChatState: (next: Partial<ProjectDetailChatState>) => void
    }
  }
}

export const PROJECT_DETAIL_INITIAL_STATE: ProjectDetailState = {
  data: {
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
    statusTemplates: []
  },
  selection: {
    viewMode: 'board',
    selectedTaskId: null,
    selectedSubtaskId: null,
    detailTab: 'subtasks',
    detailViewMode: 'task'
  },
  ui: {
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
    projectPromptPlanGuide: '',
    projectPromptOutput: '',
    projectPromptRules: '',
    projectPromptPostRun: '',
    projectPromptError: null,
    isProjectPromptSaving: false,
    error: null,
    busy: false,
    isChatPopupOpen: false,
    isTitleEditing: false,
    titleDraft: '',
    taskTitle: '',
    listCreateStatus: null,
    listCreateTitle: '',
    tableCreateActive: false,
    collapsedStatuses: [],
    isResizingSplit: false,
    detailRatio: 0.7,
    isTableColumnPickerOpen: false
  },
  forms: {
    statusDrafts: [],
    statusMapping: {},
    createTaskStatus: 'pending',
    createTaskInitialTitle: '',
    createTaskInitialTemplateId: null,
    subtaskRows: [{ id: createLocalId(), title: '' }],
    isChecklistModalOpen: false,
    checklistRows: [{ id: createLocalId(), title: '' }],
    checklistDraft: '',
    isDescriptionEditing: false,
    isDescriptionSaving: false,
    isAttachmentUploading: false,
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
    localChatEntries: []
  },
  codex: {
    codexGatewayId: '',
    codexRuntimeWorkspaceId: '',
    codexDefaultModel: '',
    codexDefaultPlanModel: '',
    codexDefaultRunModel: '',
    codexModelLoading: false,
    codexModelError: null,
    codexSaving: false,
    codexRunLaunching: false,
    codexPlanLaunching: false,
    codexRunFeedback: null
  },
  chat: {
    chatDraft: '',
    chatSending: false,
    chatStopping: false,
    chatSettingsOpen: false,
    chatGatewayId: '',
    chatModel: '',
    chatPlanModel: '',
    chatRunModel: '',
    chatPlanReasoningEffort: 'medium',
    chatRunReasoningEffort: 'medium',
    chatIncludeContext: true,
    chatComposerMode: 'chat',
    chatAttachments: [],
    selectedChatConversationId: '',
    isStartingNewChat: false,
    chatDragDepth: 0,
    slashCommandIndex: 0,
    chatComposerFocused: false,
    chatVisibleLimit: 40
  }
}

const PROJECT_DETAIL_FIELD_TO_PATH = {
  project: ['data', 'project'],
  projectGroups: ['data', 'projectGroups'],
  tasks: ['data', 'tasks'],
  agents: ['data', 'agents'],
  gateways: ['data', 'gateways'],
  tags: ['data', 'tags'],
  skills: ['data', 'skills'],
  customFields: ['data', 'customFields'],
  outputFormats: ['data', 'outputFormats'],
  taskTemplates: ['data', 'taskTemplates'],
  workspaces: ['data', 'workspaces'],
  projectStatuses: ['data', 'projectStatuses'],
  statusTemplates: ['data', 'statusTemplates'],
  viewMode: ['selection', 'viewMode'],
  selectedTaskId: ['selection', 'selectedTaskId'],
  selectedSubtaskId: ['selection', 'selectedSubtaskId'],
  detailTab: ['selection', 'detailTab'],
  detailViewMode: ['selection', 'detailViewMode'],
  isCreateTaskOpen: ['ui', 'isCreateTaskOpen'],
  isStatusEditorOpen: ['ui', 'isStatusEditorOpen'],
  projectSettingsTab: ['ui', 'projectSettingsTab'],
  isWorkspacePickerOpen: ['ui', 'isWorkspacePickerOpen'],
  isProjectGroupPickerOpen: ['ui', 'isProjectGroupPickerOpen'],
  projectGroupNameDraft: ['ui', 'projectGroupNameDraft'],
  projectGroupDescriptionDraft: ['ui', 'projectGroupDescriptionDraft'],
  projectGroupSaving: ['ui', 'projectGroupSaving'],
  projectSyncing: ['ui', 'projectSyncing'],
  projectSyncMessage: ['ui', 'projectSyncMessage'],
  workspaceDraftName: ['ui', 'workspaceDraftName'],
  workspaceDraftPath: ['ui', 'workspaceDraftPath'],
  movingWorkspace: ['ui', 'movingWorkspace'],
  workspaceMoveMessage: ['ui', 'workspaceMoveMessage'],
  isStatusTemplatePickerOpen: ['ui', 'isStatusTemplatePickerOpen'],
  pendingStatusTemplate: ['ui', 'pendingStatusTemplate'],
  projectFolderPreview: ['ui', 'projectFolderPreview'],
  isProjectPromptSettingsOpen: ['ui', 'isProjectPromptSettingsOpen'],
  projectPromptTab: ['ui', 'projectPromptTab'],
  projectPromptContext: ['ui', 'projectPromptContext'],
  projectPromptPrompt: ['ui', 'projectPromptPrompt'],
  projectPromptPlanGuide: ['ui', 'projectPromptPlanGuide'],
  projectPromptOutput: ['ui', 'projectPromptOutput'],
  projectPromptRules: ['ui', 'projectPromptRules'],
  projectPromptPostRun: ['ui', 'projectPromptPostRun'],
  projectPromptError: ['ui', 'projectPromptError'],
  isProjectPromptSaving: ['ui', 'isProjectPromptSaving'],
  error: ['ui', 'error'],
  busy: ['ui', 'busy'],
  isChatPopupOpen: ['ui', 'isChatPopupOpen'],
  isTitleEditing: ['ui', 'isTitleEditing'],
  titleDraft: ['ui', 'titleDraft'],
  taskTitle: ['ui', 'taskTitle'],
  listCreateStatus: ['ui', 'listCreateStatus'],
  listCreateTitle: ['ui', 'listCreateTitle'],
  tableCreateActive: ['ui', 'tableCreateActive'],
  collapsedStatuses: ['ui', 'collapsedStatuses'],
  isResizingSplit: ['ui', 'isResizingSplit'],
  detailRatio: ['ui', 'detailRatio'],
  isTableColumnPickerOpen: ['ui', 'isTableColumnPickerOpen'],
  statusDrafts: ['forms', 'statusDrafts'],
  statusMapping: ['forms', 'statusMapping'],
  createTaskStatus: ['forms', 'createTaskStatus'],
  createTaskInitialTitle: ['forms', 'createTaskInitialTitle'],
  createTaskInitialTemplateId: ['forms', 'createTaskInitialTemplateId'],
  subtaskRows: ['forms', 'subtaskRows'],
  isChecklistModalOpen: ['forms', 'isChecklistModalOpen'],
  checklistRows: ['forms', 'checklistRows'],
  checklistDraft: ['forms', 'checklistDraft'],
  isDescriptionEditing: ['forms', 'isDescriptionEditing'],
  isDescriptionSaving: ['forms', 'isDescriptionSaving'],
  isAttachmentUploading: ['forms', 'isAttachmentUploading'],
  descriptionDraft: ['forms', 'descriptionDraft'],
  subtaskDescriptionDraft: ['forms', 'subtaskDescriptionDraft'],
  isSubtaskDescriptionSaving: ['forms', 'isSubtaskDescriptionSaving'],
  commentDraft: ['forms', 'commentDraft'],
  editingCommentId: ['forms', 'editingCommentId'],
  subtaskCommentDraft: ['forms', 'subtaskCommentDraft'],
  editingSubtaskCommentId: ['forms', 'editingSubtaskCommentId'],
  isAddSubtaskOpen: ['forms', 'isAddSubtaskOpen'],
  isTaskImportOpen: ['forms', 'isTaskImportOpen'],
  isTaskImporting: ['forms', 'isTaskImporting'],
  editingSubtaskId: ['forms', 'editingSubtaskId'],
  subtaskDraft: ['forms', 'subtaskDraft'],
  selectedCustomFieldOption: ['forms', 'selectedCustomFieldOption'],
  editingCustomFieldId: ['forms', 'editingCustomFieldId'],
  customFieldDraft: ['forms', 'customFieldDraft'],
  customFieldError: ['forms', 'customFieldError'],
  isCustomFieldModalOpen: ['forms', 'isCustomFieldModalOpen'],
  isCreateCustomFieldOpen: ['forms', 'isCreateCustomFieldOpen'],
  customFieldRows: ['forms', 'customFieldRows'],
  quickFieldName: ['forms', 'quickFieldName'],
  quickFieldType: ['forms', 'quickFieldType'],
  isOutputFormatModalOpen: ['forms', 'isOutputFormatModalOpen'],
  isCreateOutputFormatOpen: ['forms', 'isCreateOutputFormatOpen'],
  outputFormatDraftOption: ['forms', 'outputFormatDraftOption'],
  dataFormatRoleDraft: ['forms', 'dataFormatRoleDraft'],
  dataFormatTarget: ['forms', 'dataFormatTarget'],
  quickOutputFormatName: ['forms', 'quickOutputFormatName'],
  quickOutputFormatDescription: ['forms', 'quickOutputFormatDescription'],
  pendingDeleteSubtaskId: ['forms', 'pendingDeleteSubtaskId'],
  selectedSubtaskIds: ['forms', 'selectedSubtaskIds'],
  subtaskStatusMenu: ['forms', 'subtaskStatusMenu'],
  history: ['forms', 'history'],
  localChatEntries: ['forms', 'localChatEntries'],
  codexGatewayId: ['codex', 'codexGatewayId'],
  codexRuntimeWorkspaceId: ['codex', 'codexRuntimeWorkspaceId'],
  codexDefaultModel: ['codex', 'codexDefaultModel'],
  codexDefaultPlanModel: ['codex', 'codexDefaultPlanModel'],
  codexDefaultRunModel: ['codex', 'codexDefaultRunModel'],
  codexModelLoading: ['codex', 'codexModelLoading'],
  codexModelError: ['codex', 'codexModelError'],
  codexSaving: ['codex', 'codexSaving'],
  codexRunLaunching: ['codex', 'codexRunLaunching'],
  codexPlanLaunching: ['codex', 'codexPlanLaunching'],
  codexRunFeedback: ['codex', 'codexRunFeedback'],
  chatDraft: ['chat', 'chatDraft'],
  chatSending: ['chat', 'chatSending'],
  chatStopping: ['chat', 'chatStopping'],
  chatSettingsOpen: ['chat', 'chatSettingsOpen'],
  chatGatewayId: ['chat', 'chatGatewayId'],
  chatModel: ['chat', 'chatModel'],
  chatPlanModel: ['chat', 'chatPlanModel'],
  chatRunModel: ['chat', 'chatRunModel'],
  chatPlanReasoningEffort: ['chat', 'chatPlanReasoningEffort'],
  chatRunReasoningEffort: ['chat', 'chatRunReasoningEffort'],
  chatIncludeContext: ['chat', 'chatIncludeContext'],
  chatComposerMode: ['chat', 'chatComposerMode'],
  chatAttachments: ['chat', 'chatAttachments'],
  selectedChatConversationId: ['chat', 'selectedChatConversationId'],
  isStartingNewChat: ['chat', 'isStartingNewChat'],
  chatDragDepth: ['chat', 'chatDragDepth'],
  slashCommandIndex: ['chat', 'slashCommandIndex'],
  chatComposerFocused: ['chat', 'chatComposerFocused'],
  chatVisibleLimit: ['chat', 'chatVisibleLimit']
} as const

const PROJECT_DETAIL_FIELD_KEYS = Object.keys(PROJECT_DETAIL_FIELD_TO_PATH) as Array<keyof ProjectDetailFlatState>

function toFlatState(state: ProjectDetailState): ProjectDetailFlatState {
  return {
    ...state.data,
    ...state.selection,
    ...state.ui,
    ...state.forms,
    ...state.codex,
    ...state.chat
  } as ProjectDetailFlatState
}

function setFieldValue(state: ProjectDetailState, key: keyof ProjectDetailFlatState, rawValue: unknown): ProjectDetailState {
  const path = PROJECT_DETAIL_FIELD_TO_PATH[key]
  if (!path) return state
  const [sliceName, fieldName] = path
  const slice = state[sliceName]
  const previous = slice[fieldName as keyof typeof slice]
  const nextValue = typeof rawValue === 'function' ? (rawValue as (value: unknown) => unknown)(previous) : rawValue
  if (Object.is(previous, nextValue)) return state
  return {
    ...state,
    [sliceName]: {
      ...slice,
      [fieldName]: nextValue
    }
  } as ProjectDetailState
}

function mergeNestedState<T>(state: T, patch: T | undefined): T {
  if (!patch) return state
  let changed = false
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!Object.is((state as Record<string, unknown>)[key], value)) {
      changed = true
      break
    }
  }
  return changed ? { ...state, ...patch } : state
}

function applyStatePatch(state: ProjectDetailState, patch: Partial<ProjectDetailState>): ProjectDetailState {
  const next = {
    data: mergeNestedState(state.data, patch.data),
    selection: mergeNestedState(state.selection, patch.selection),
    ui: mergeNestedState(state.ui, patch.ui),
    forms: mergeNestedState(state.forms, patch.forms),
    codex: mergeNestedState(state.codex, patch.codex),
    chat: mergeNestedState(state.chat, patch.chat)
  }
  if (
    next.data === state.data &&
    next.selection === state.selection &&
    next.ui === state.ui &&
    next.forms === state.forms &&
    next.codex === state.codex &&
    next.chat === state.chat
  ) return state
  return { ...state, ...next }
}

function flatPatchToState(patch: Partial<ProjectDetailFlatState>): ProjectDetailState {
  let nextState = PROJECT_DETAIL_INITIAL_STATE
  for (const key of PROJECT_DETAIL_FIELD_KEYS) {
    const value = patch[key]
    if (typeof value === 'undefined') continue
    nextState = setFieldValue(nextState, key, value)
  }
  return nextState
}

function isNestedOverrides(overrides: Record<string, unknown>): overrides is Partial<ProjectDetailState> {
  return (
    'data' in overrides ||
    'selection' in overrides ||
    'ui' in overrides ||
    'forms' in overrides ||
    'codex' in overrides ||
    'chat' in overrides
  )
}

function toInitialState(overrides?: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState>): ProjectDetailState {
  const normalized = { ...PROJECT_DETAIL_INITIAL_STATE } as ProjectDetailState
  if (!overrides) return normalized
  if (isNestedOverrides(overrides as Record<string, unknown>)) {
    return applyStatePatch(normalized, overrides as Partial<ProjectDetailState>)
  }
  return applyStatePatch(normalized, flatPatchToState(overrides as Partial<ProjectDetailFlatState>))
}

function projectDetailReducer(state: ProjectDetailState, action: ProjectDetailAction): ProjectDetailState {
  switch (action.type) {
    case 'loadSuccess':
      return applyStatePatch(state, { data: { ...(state.data ?? {}), ...action.payload } })
    case 'setSelection':
      return applyStatePatch(state, { selection: { ...state.selection, ...action.payload } })
    case 'setUi':
      return applyStatePatch(state, { ui: { ...state.ui, ...action.payload } })
    case 'setForms':
      return applyStatePatch(state, { forms: { ...state.forms, ...action.payload } })
    case 'setCodex':
      return applyStatePatch(state, { codex: { ...state.codex, ...action.payload } })
    case 'setChatState':
      return applyStatePatch(state, { chat: { ...state.chat, ...action.payload } })
    case 'setBusy':
      return applyStatePatch(state, { ui: { ...state.ui, busy: action.busy } })
    case 'setError':
      return applyStatePatch(state, { ui: { ...state.ui, error: action.error } })
    case 'openModal':
      return setFieldValue(state, action.modal, action.value ?? true)
    case 'closeModal':
      return setFieldValue(state, action.modal, false)
    case 'setDraft':
      return applyStatePatch(state, action.payload)
    case 'setField':
      return setFieldValue(state, action.key, action.value)
    case 'setState':
      return applyStatePatch(
        state,
        isNestedOverrides(action.state as Record<string, unknown>)
          ? (action.state as Partial<ProjectDetailState>)
          : flatPatchToState(action.state as Partial<ProjectDetailFlatState>)
      )
    case 'patch':
      return applyStatePatch(state, action.patch)
    case 'reset':
      return toInitialState({ ...(action.state ?? {}) } as Partial<ProjectDetailState>)
    default:
      return state
  }
}

function capitalizeField(key: string): string {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

function buildBindings(
  state: ProjectDetailState,
  setField: (key: keyof ProjectDetailFlatState, value: unknown) => void
): Omit<
  ProjectDetailStateBindings,
  | 'setState'
  | 'resetState'
  | 'dispatch'
  | 'dispatchers'
> {
  const flat = toFlatState(state)
  const bindings = { ...flat } as Omit<ProjectDetailStateBindings, 'setState' | 'resetState' | 'dispatch' | 'dispatchers'>

  for (const key of PROJECT_DETAIL_FIELD_KEYS) {
    const setterName = `set${capitalizeField(key as string)}` as keyof Omit<
      ProjectDetailStateBindings,
      'setState' | 'resetState' | 'dispatch' | 'dispatchers'
    >
    ;(bindings as Record<string, unknown>)[setterName as string] = (value: unknown) => {
      setField(key, value)
    }
  }

  return bindings
}

export function useProjectDetailReducer(
  overrides: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState> = {}
): [ProjectDetailState, Dispatch<ProjectDetailAction>] {
  const [state, dispatch] = useReducer(projectDetailReducer, overrides as Partial<ProjectDetailState> | undefined, toInitialState)
  return [state, dispatch]
}

export function useProjectDetailDispatcher(
  state: ProjectDetailState,
  dispatch: Dispatch<ProjectDetailAction>
): ProjectDetailStateBindings {
  const setField = useCallback((key: keyof ProjectDetailFlatState, value: unknown) => {
    dispatch({ type: 'setField', key, value })
  }, [dispatch])

  const setState = useCallback((patch: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState>) => {
    dispatch({ type: 'setState', state: patch })
  }, [dispatch])

  const resetState = useCallback((statePatch?: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState>) => {
    dispatch({ type: 'reset', state: statePatch })
  }, [dispatch])

  const dispatchers = useMemo(() => ({
    data: {
      loadSuccess: (next: Partial<ProjectDetailDataState>) => dispatch({ type: 'setState', state: { data: { ...state.data, ...next } } }),
      replace: (next: ProjectDetailDataState) => dispatch({ type: 'setState', state: { data: next } })
    },
    selection: {
      setSelection: (next: Partial<ProjectDetailSelectionState>) => dispatch({ type: 'setSelection', payload: next })
    },
    ui: {
      setBusy: (busy: boolean) => dispatch({ type: 'setBusy', busy }),
      setError: (error: string | null) => dispatch({ type: 'setError', error }),
      openModal: (modal: ModalActionKey, value = true) => dispatch({ type: 'openModal', modal, value }),
      closeModal: (modal: ModalActionKey) => dispatch({ type: 'closeModal', modal })
    },
    forms: {
      setDraft: (next: Partial<ProjectDetailFormsState>) => dispatch({ type: 'setForms', payload: next })
    },
    codex: {
      setCodexStatus: (next: Partial<ProjectDetailCodexState>) => dispatch({ type: 'setCodex', payload: next })
    },
    chat: {
      setChatState: (next: Partial<ProjectDetailChatState>) => dispatch({ type: 'setChatState', payload: next })
    }
  }), [dispatch, state.data])

  return useMemo(() => {
    const bindings = buildBindings(state, setField)
    const wrapped = bindings as Omit<ProjectDetailStateBindings, 'setState' | 'resetState' | 'dispatch' | 'dispatchers'>
    wrapped.setState = setState
    wrapped.resetState = resetState
    wrapped.dispatch = dispatch
    wrapped.dispatchers = dispatchers
    return wrapped
  }, [dispatch, state, setField, setState, resetState, dispatchers])
}

export function useProjectDetailState(
  overrides: Partial<ProjectDetailState> | Partial<ProjectDetailFlatState> = {}
): ProjectDetailStateBindings {
  const [state, dispatch] = useProjectDetailReducer(overrides)
  return useProjectDetailDispatcher(state, dispatch)
}
