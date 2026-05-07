import { useCallback, useState } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Agent, CustomField, Gateway, Project, ProjectGroup, ProjectStatus, Skill, Tag, TaskEntity } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import { buildProjectWorkspaceExportTaskPayload, buildTaskZipArchive } from '../taskExport'
import { createLocalId, taskGatewayId, taskGatewayModel } from '../projectDetailUtils'
import { GatewayRunFeedback, ChatAttachmentDraft, ChatOperationFeedbackData, ChatConversationSummary, SlashCommand, type PlannerClarificationMode } from '../types'
import type { ProjectDetailStateBindings } from '../state/projectDetailState'

const slashPlanToken = /(?:^|\s)\/[a-z]*$/i
const CHAT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
const CHAT_ATTACHMENT_MAX_COUNT = 10

interface GatewayRunResponse {
  runFolderPath: string
  workspacePath: string
  runtimeWorkspacePath?: string
  model: string
  gatewayId: string
  executionMode?: 'terminal' | 'exec'
  runId?: string
  conversationId?: string
}

interface GatewayPlanResponse {
  runFolderPath: string
  runtimeWorkspacePath: string
  model: string
  gatewayId: string
  bridgeUrl?: string
  executionMode?: 'terminal' | 'exec'
  runId?: string
  conversationId?: string
}

interface GatewayChatResponse {
  runId: string
  conversationId: string
  executionMode: 'terminal' | 'exec'
}

interface CodexStopResponse {
  stopped: number
}

export type CodexStopResult = {
  conversationId: string
  stopped: number
  notFound: boolean
}

interface GatewayModelsResponse {
  gateway: Gateway
  models: Array<{ id: string; label?: string; lastModelRefreshAt?: number; executionMode?: string }>
  cached: boolean
  error?: string
}

interface CodexTaskExportContext {
  task: TaskEntity
  project?: Project | null
  projectGroup?: ProjectGroup | null
  agents: Agent[]
  skills: Skill[]
  tags: Tag[]
  customFields: CustomField[]
  projectStatuses?: ProjectStatus[]
  gatewayLanguage?: string
  gatewayPlanReasoningEffort?: string
  gatewayRunReasoningEffort?: string
}

export interface ProjectGatewayFlowContext {
  token?: string
  project: Project | null
  selectedTask: TaskEntity | null
  selectedTaskExportContext: CodexTaskExportContext | null
  taskRunGatewayId: string
  taskPlanModel: string
  taskRunModel: string
  savedGatewayDefaultGatewayId: string
  savedGatewayDefaultModel: string
  savedGatewayDefaultPlanModel: string
  savedGatewayDefaultRunModel: string
  chatDraft: string
  chatAttachments: ChatAttachmentDraft[]
  chatGatewayId: string
  chatModel: string
  chatPlanModel: string
  chatRunModel: string
  gatewayLanguage: string
  planReasoningEffort?: string
  runReasoningEffort?: string
  chatIncludeContext: boolean
  chatComposerMode: 'chat' | 'steer'
  selectedChatConversationId: string
  isStartingNewChat: boolean
  selectedChatSummary: ChatConversationSummary | null
  gatewayRunFeedback: GatewayRunFeedback | null
  gatewayRunLaunching: boolean
  gatewayPlanLaunching: boolean
  chatSending: boolean
  chatStopping: boolean
  chatFollowUpContext?: string
  state: Pick<
    ProjectDetailStateBindings,
    | 'setGatewayRunLaunching'
    | 'setGatewayPlanLaunching'
    | 'setGatewayRunFeedback'
    | 'setChatSending'
    | 'setChatStopping'
    | 'setChatSettingsOpen'
    | 'setIsChatPopupOpen'
    | 'setIsStartingNewChat'
    | 'setSelectedChatConversationId'
    | 'setGatewayModelLoading'
    | 'setGatewayModelError'
    | 'setGatewayDefaultModel'
    | 'setChatDraft'
    | 'setChatAttachments'
    | 'setChatComposerMode'
    | 'setChatIncludeContext'
    | 'setError'
    | 'setDetailTab'
    | 'setGateways'
  >
  openChatAttachmentPicker: () => void
}

export interface UseProjectGatewayFlowResult {
  chatMode: 'chat' | 'plan' | 'steer'
  canRunSelectedTaskWithCodex: boolean
  canPlanSelectedTaskWithCodex: boolean
  canSendChat: boolean
  isPlanDraft: boolean
  chatOperationFeedback: ChatOperationFeedbackData | null
  planChoiceOpen: boolean
  selectedTaskSummary: string
  refreshGatewayModels: (gatewayId: string) => Promise<void>
  runSelectedTaskWithCodex: () => Promise<void>
  planSelectedTaskWithCodex: () => Promise<void>
  confirmPlanWithGateway: (clarificationMode: PlannerClarificationMode) => Promise<void>
  closePlanChoice: () => void
  sendGatewayChatMessage: () => Promise<void>
  sendPlannerClarification: (answer: string) => Promise<void>
  stopGatewayChat: (conversationIdOverride?: string) => Promise<CodexStopResult>
  addChatAttachments: (files: FileList | File[]) => Promise<void>
  applySlashCommand: (command: SlashCommand) => Promise<void>
}

export function useProjectGatewayFlow({
  token,
  project,
  selectedTask,
  selectedTaskExportContext,
  taskRunGatewayId,
  taskPlanModel,
  taskRunModel,
  savedGatewayDefaultGatewayId,
  savedGatewayDefaultModel,
  savedGatewayDefaultPlanModel,
  savedGatewayDefaultRunModel,
  chatDraft,
  chatAttachments,
  chatGatewayId,
  chatModel,
  chatPlanModel,
  chatRunModel,
  gatewayLanguage,
  planReasoningEffort = 'medium',
  runReasoningEffort = 'medium',
  chatIncludeContext,
  chatFollowUpContext = '',
  chatComposerMode,
  selectedChatConversationId,
  isStartingNewChat,
  selectedChatSummary,
  gatewayRunFeedback,
  gatewayRunLaunching,
  gatewayPlanLaunching,
  chatSending,
  chatStopping,
  state,
  openChatAttachmentPicker,
}: ProjectGatewayFlowContext): UseProjectGatewayFlowResult {
  const {
    setGatewayRunLaunching,
    setGatewayPlanLaunching,
    setGatewayRunFeedback,
    setChatSending,
    setChatStopping,
    setChatSettingsOpen,
    setIsChatPopupOpen,
    setIsStartingNewChat,
    setSelectedChatConversationId,
    setGatewayModelLoading,
    setGatewayModelError,
    setGatewayDefaultModel,
    setChatDraft,
    setChatAttachments,
    setChatComposerMode,
    setChatIncludeContext,
    setError,
    setDetailTab,
    setGateways
  } = state

  const selectedTaskGatewayId = selectedTask ? taskGatewayId(selectedTask) : ''
  const selectedTaskGatewayModel = selectedTask ? taskGatewayModel(selectedTask) : ''
  const resolvedTaskGatewayId = taskRunGatewayId || selectedTaskGatewayId || savedGatewayDefaultGatewayId
  const resolvedPlanModel = taskPlanModel || selectedTaskGatewayModel || savedGatewayDefaultPlanModel || savedGatewayDefaultModel
  const resolvedRunModel = taskRunModel || selectedTaskGatewayModel || savedGatewayDefaultRunModel || savedGatewayDefaultModel

  const isPlanDraft = chatDraft.trim().toLowerCase().startsWith('/plan')
  const chatMode: 'chat' | 'plan' | 'steer' = isPlanDraft ? 'plan' : chatComposerMode
  const canRunSelectedTaskWithCodex = Boolean(selectedTaskExportContext && resolvedTaskGatewayId && resolvedRunModel)
  const canPlanSelectedTaskWithCodex = Boolean(selectedTask && resolvedTaskGatewayId && resolvedPlanModel)
  const canSendChat = Boolean(chatDraft.trim() || chatAttachments.length > 0)

  const selectedTaskSummary = selectedTask?.title ?? ''
  const [planChoiceOpen, setPlanChoiceOpen] = useState(false)

  const refreshGatewayModels = useCallback(async (gatewayId: string) => {
    if (!gatewayId) return
    setGatewayModelLoading(true)
    setGatewayModelError(null)

    const response = await invokeBridge<GatewayModelsResponse>(IPC_CHANNELS.gateways.gatewayModels, {
      actorToken: token,
      gatewayId
    })
    setGatewayModelLoading(false)
    if (!response.ok || !response.data) {
      setGatewayModelError(response.error?.message ?? 'Unable to load Codex models')
      return
    }
    if (response.data.error) setGatewayModelError(response.data.error)

    setGateways((current) => current.map((gateway) => gateway.id === response.data!.gateway.id ? response.data!.gateway : gateway))
    const modelIds = new Set(response.data.models.map((model) => model.id))
    if (gatewayId === savedGatewayDefaultGatewayId && savedGatewayDefaultModel && !modelIds.has(savedGatewayDefaultModel)) {
      setGatewayDefaultModel('')
    }
    if (gatewayId === savedGatewayDefaultGatewayId && resolvedRunModel && !modelIds.has(resolvedRunModel)) {
      setSelectedChatConversationId('')
    }
    setError(response.data.error ?? null)
  }, [
    token,
    setGatewayModelLoading,
    setGatewayModelError,
    setGateways,
    setGatewayDefaultModel,
    setSelectedChatConversationId,
    setError,
    savedGatewayDefaultGatewayId,
    savedGatewayDefaultModel,
    resolvedRunModel
  ])

  const runSelectedTaskWithCodex = useCallback(async () => {
    if (!selectedTask || !selectedTaskExportContext || !project) {
      setGatewayRunFeedback({ kind: 'error', message: 'Task is not ready for a Codex run.' })
      return
    }

    if (!resolvedTaskGatewayId) {
      setGatewayRunFeedback({ kind: 'error', message: 'Configure a Codex gateway before running this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    if (!resolvedRunModel) {
      setGatewayRunFeedback({ kind: 'error', message: 'Choose a Codex model before running this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }

    setGatewayRunFeedback(null)
    setGatewayRunLaunching(true)
    setIsChatPopupOpen(true)
    setIsStartingNewChat(false)
    try {
      const snapshot = buildProjectWorkspaceExportTaskPayload(selectedTaskExportContext)
      const basePayload = {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        gatewayId: resolvedTaskGatewayId,
        model: resolvedRunModel,
        language: gatewayLanguage,
        reasoningEffort: runReasoningEffort,
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? ''
      }
      let response = await invokeBridge<GatewayRunResponse>(IPC_CHANNELS.tasks.runGateway, {
        ...basePayload,
        taskMarkdown: snapshot.taskMarkdown,
        agentMarkdown: snapshot.agentMarkdown,
        skillsMarkdown: snapshot.skillsMarkdown,
        attachments: snapshot.attachments
      })
      const errorMessage = response.ok ? '' : response.error?.message ?? ''
      if (!response.ok && /zip bytes|required/i.test(errorMessage)) {
        const zip = await buildTaskZipArchive(selectedTaskExportContext)
        response = await invokeBridge<GatewayRunResponse>(IPC_CHANNELS.tasks.runGateway, {
          ...basePayload,
          zipName: zip.fileName,
          zipBytes: zip.archive
        })
      }
      if (!response.ok) {
        setGatewayRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to launch Codex' })
        return
      }
      if (response.data?.conversationId || response.data?.runId) setSelectedChatConversationId(response.data.conversationId ?? response.data.runId ?? '')
      setGatewayRunFeedback({
        kind: 'success',
        message: response.data.executionMode === 'exec'
          ? 'Codex exec started. Chat will update as it runs.'
          : `Codex terminal launched. Workspace: ${response.data.workspacePath}`
      })
      setError(null)
    } catch (error) {
      setGatewayRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to launch Codex' })
    } finally {
      setGatewayRunLaunching(false)
    }
  }, [
    project,
    selectedTask,
    selectedTaskExportContext,
    resolvedTaskGatewayId,
    resolvedRunModel,
    gatewayLanguage,
    runReasoningEffort,
    token,
    setGatewayRunFeedback,
    setGatewayRunLaunching,
    setIsChatPopupOpen,
    setIsStartingNewChat,
    setSelectedChatConversationId,
    setError,
    setDetailTab,
    setChatSettingsOpen
  ])

  const planSelectedTaskWithCodex = useCallback(async () => {
    if (!selectedTask || !project) {
      setGatewayRunFeedback({ kind: 'error', message: 'Task is not ready for Codex planning.' })
      return
    }
    setGatewayRunFeedback(null)
    setIsChatPopupOpen(true)
    setIsStartingNewChat(false)
    setChatSettingsOpen(false)
    setPlanChoiceOpen(true)
  }, [
    project,
    selectedTask,
    setGatewayRunFeedback,
    setIsChatPopupOpen,
    setIsStartingNewChat,
    setChatSettingsOpen
  ])

  const closePlanChoice = useCallback(() => {
    setPlanChoiceOpen(false)
  }, [])

  const confirmPlanWithGateway = useCallback(async (clarificationMode: PlannerClarificationMode) => {
    if (!selectedTask || !project) {
      setGatewayRunFeedback({ kind: 'error', message: 'Task is not ready for Codex planning.' })
      return
    }
    setPlanChoiceOpen(false)

    if (!resolvedTaskGatewayId) {
      setGatewayRunFeedback({ kind: 'error', message: 'Configure a Codex gateway before planning this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    if (!resolvedPlanModel) {
      setGatewayRunFeedback({ kind: 'error', message: 'Choose a Codex plan model before planning this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }

    setGatewayRunFeedback(null)
    setGatewayPlanLaunching(true)
    setIsChatPopupOpen(true)
    setIsStartingNewChat(false)
    try {
      const response = await invokeBridge<GatewayPlanResponse>(IPC_CHANNELS.tasks.planWithGateway, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        gatewayId: resolvedTaskGatewayId,
        model: resolvedPlanModel,
        language: gatewayLanguage,
        reasoningEffort: planReasoningEffort,
        clarificationMode,
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? ''
      })
      if (!response.ok) {
        setGatewayRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to launch Codex planner' })
        return
      }
      if (response.data?.conversationId || response.data?.runId) setSelectedChatConversationId(response.data.conversationId ?? response.data.runId ?? '')
      setGatewayRunFeedback({
        kind: 'success',
        message: response.data.executionMode === 'exec'
          ? 'Codex planner exec started. Chat will update as it runs.'
          : `Codex planner launched. Runtime workspace: ${response.data.runtimeWorkspacePath}`
      })
      setError(null)
    } catch (error) {
      setGatewayRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to launch Codex planner' })
    } finally {
      setGatewayPlanLaunching(false)
    }
  }, [
    project,
    selectedTask,
    resolvedTaskGatewayId,
    resolvedPlanModel,
    gatewayLanguage,
    planReasoningEffort,
    token,
    setGatewayRunFeedback,
    setGatewayPlanLaunching,
    setIsChatPopupOpen,
    setIsStartingNewChat,
    setSelectedChatConversationId,
    setError,
    setChatSettingsOpen,
    setDetailTab
  ])

  const sendGatewayChatMessage = useCallback(async (draftOverride?: string) => {
    if (!selectedTask || !project) return
    const draftText = draftOverride ?? chatDraft
    if (!draftText.trim() && chatAttachments.length === 0) return
    const effectiveSelectedChatSummary = isStartingNewChat ? null : selectedChatSummary
    const sendAsPlanRevision = chatMode !== 'steer' && !isStartingNewChat && effectiveSelectedChatSummary?.source === 'gateway-plan'
    const effectiveChatMode = chatMode === 'steer' ? 'steer' : sendAsPlanRevision ? 'plan' : chatMode
    const sendAsPlannerClarification = !isStartingNewChat && effectiveSelectedChatSummary?.source === 'gateway-plan'
    const resolvedChatModel = sendAsPlannerClarification || effectiveChatMode === 'plan'
      ? (chatPlanModel || chatModel)
      : (chatRunModel || chatModel)
    if (!chatGatewayId || !resolvedChatModel) {
      setChatSettingsOpen(true)
      setGatewayRunFeedback({ kind: 'error', message: 'Choose a Codex gateway and model before sending chat.' })
      return
    }
    if ((chatMode === 'steer' || effectiveSelectedChatSummary?.source === 'gateway-plan') && !selectedChatConversationId) {
      setGatewayRunFeedback({ kind: 'error', message: 'Select a conversation before sending a steer message.' })
      return
    }

    setChatSending(true)
    setGatewayRunFeedback(null)

    try {
      if (sendAsPlannerClarification) {
        if (chatAttachments.length > 0) {
          setGatewayRunFeedback({ kind: 'error', message: 'Planner clarification does not support attachments. Remove attachments and send the answer as text.' })
          return
        }
        const response = await invokeBridge<GatewayPlanResponse>(IPC_CHANNELS.tasks.planWithGateway, {
          actorToken: token,
          taskId: selectedTask.id,
          projectId: project.id,
          gatewayId: chatGatewayId,
          model: resolvedChatModel,
          language: gatewayLanguage,
          reasoningEffort: planReasoningEffort,
          conversationId: selectedChatConversationId,
          clarificationMessage: draftText.trim()
        })
        if (!response.ok || !response.data) {
          setGatewayRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to send planner clarification.' })
          return
        }
        setSelectedChatConversationId(response.data.conversationId ?? selectedChatConversationId)
        setIsStartingNewChat(false)
        setChatDraft('')
        setChatAttachments([])
        setChatComposerMode('chat')
        setGatewayRunFeedback(response.data.executionMode === 'terminal'
          ? { kind: 'success', message: 'Codex planner launched with your clarification.' }
          : null)
        return
      }

      const response = await invokeBridge<GatewayChatResponse>(IPC_CHANNELS.tasks.gatewayChatSend, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        message: draftText.trim() || 'Review the attached file(s) in the task context.',
        gatewayId: chatGatewayId,
        followUpContext: isStartingNewChat ? chatFollowUpContext?.trim() || undefined : undefined,
        model: resolvedChatModel,
        language: gatewayLanguage,
        reasoningEffort: effectiveChatMode === 'plan' ? planReasoningEffort : runReasoningEffort,
        conversationId: isStartingNewChat ? undefined : selectedChatConversationId || undefined,
        includeTaskContext: isStartingNewChat ? false : chatIncludeContext,
        mode: effectiveChatMode,
        attachments: chatAttachments.map((attachment) => ({ name: attachment.name, bytes: attachment.bytes }))
      })
      if (!response.ok || !response.data) {
        setGatewayRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to send Codex chat message.' })
        return
      }
      setSelectedChatConversationId(response.data.conversationId)
      setIsStartingNewChat(false)
      setChatDraft('')
      setChatAttachments([])
      setChatComposerMode('chat')
      if (response.data.executionMode === 'terminal') {
        setGatewayRunFeedback({ kind: 'success', message: 'Codex terminal chat launched.' })
      } else {
        setGatewayRunFeedback(null)
      }
    } catch (error) {
      setGatewayRunFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unable to send Codex chat message.'
      })
    } finally {
      setChatSending(false)
    }
  }, [
    project,
    selectedTask,
    chatDraft,
    chatAttachments,
    chatGatewayId,
    chatModel,
    chatPlanModel,
    chatRunModel,
    gatewayLanguage,
    planReasoningEffort,
    runReasoningEffort,
    isStartingNewChat,
    chatIncludeContext,
    selectedChatConversationId,
    selectedChatSummary,
    chatMode,
    chatFollowUpContext,
    token,
    setChatSending,
    setGatewayRunFeedback,
    setSelectedChatConversationId,
    setIsStartingNewChat,
    setChatDraft,
    setChatAttachments,
    setChatComposerMode,
    setChatSettingsOpen
  ])

  const sendPlannerClarification = useCallback(async (answer: string) => {
    await sendGatewayChatMessage(answer)
  }, [sendGatewayChatMessage])

  const stopGatewayChat = useCallback(async (conversationIdOverride?: string): Promise<CodexStopResult> => {
    const conversationId = conversationIdOverride || selectedChatConversationId
    if (!selectedTask) return { conversationId, stopped: 0, notFound: true }
    setChatStopping(true)
    setGatewayRunFeedback(null)
    try {
      const response = await invokeBridge<CodexStopResponse>(IPC_CHANNELS.tasks.gatewayChatStop, {
        actorToken: token,
        taskId: selectedTask.id,
        conversationId: conversationId || undefined
      })
      if (!response.ok) {
        setGatewayRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to stop Codex chat.' })
        return { conversationId, stopped: 0, notFound: false }
      }
      if (!response.data?.stopped) {
        setGatewayRunFeedback({ kind: 'error', message: 'No active Codex chat was found to stop.' })
        return { conversationId, stopped: 0, notFound: true }
      }
      return { conversationId, stopped: response.data.stopped, notFound: false }
    } catch (error) {
      setGatewayRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to stop Codex chat.' })
      return { conversationId, stopped: 0, notFound: false }
    } finally {
      setChatStopping(false)
    }
  }, [
    selectedTask,
    selectedChatConversationId,
    token,
    setChatStopping,
    setGatewayRunFeedback
  ])

  const addChatAttachments = useCallback(async (files: FileList | File[]) => {
    const next: ChatAttachmentDraft[] = []
    const selectedFiles = Array.from(files)
    if (selectedFiles.length === 0) {
      openChatAttachmentPicker()
      return
    }
    for (const file of selectedFiles.slice(0, CHAT_ATTACHMENT_MAX_COUNT)) {
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        setGatewayRunFeedback({ kind: 'error', message: `${file.name} is larger than 25 MB and was not attached.` })
        continue
      }
      try {
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
        next.push({ id: createLocalId(), name: file.name, size: file.size, bytes })
      } catch (error) {
        setGatewayRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : `Unable to read ${file.name}.` })
      }
    }
    if (next.length > 0) {
      setChatAttachments((current) => [...current, ...next].slice(0, CHAT_ATTACHMENT_MAX_COUNT))
    }
  }, [openChatAttachmentPicker, setChatAttachments, setGatewayRunFeedback])

  const applySlashCommand = useCallback(async (command: SlashCommand) => {
    if (command.id === 'plan') {
      setChatDraft((value) => value.replace(slashPlanToken, (match) => `${match.startsWith(' ') ? ' ' : ''}/plan `))
      setChatComposerMode('chat')
      return
    }
    if (command.id === 'run') {
      setChatDraft((value) => value.replace(slashPlanToken, ''))
      await runSelectedTaskWithCodex()
      return
    }
    if (command.id === 'steer') {
      setChatComposerMode('steer')
      setChatDraft((value) => value.replace(slashPlanToken, ''))
      return
    }
    if (command.id === 'settings') {
      setChatSettingsOpen(true)
      setChatDraft((value) => value.replace(slashPlanToken, ''))
      return
    }
    if (command.id === 'attach') {
      setChatDraft((value) => value.replace(slashPlanToken, ''))
      openChatAttachmentPicker()
      return
    }
    setChatIncludeContext((value) => !value)
    setChatDraft((value) => value.replace(slashPlanToken, ''))
  }, [
    openChatAttachmentPicker,
    runSelectedTaskWithCodex,
    setChatDraft,
    setChatComposerMode,
    setChatIncludeContext,
    setChatSettingsOpen
  ])

  const chatOperationFeedback: ChatOperationFeedbackData | null = gatewayPlanLaunching
    ? { state: 'running', title: 'Planning with Codex', message: `Launching ${chatPlanModel || resolvedPlanModel || 'the selected model'} with the current task context.` }
    : gatewayRunLaunching
      ? { state: 'running', title: 'Working with Codex', message: `Preparing the task workspace for ${chatRunModel || chatModel || resolvedRunModel || 'the selected model'}.` }
      : chatSending
        ? { state: 'running', title: 'Sending message', message: `Starting ${chatRunModel || chatModel || 'the selected model'} for this chat thread.` }
        : chatStopping
          ? { state: 'running', title: 'Stopping chat', message: 'Asking Codex to stop the active chat.' }
          : gatewayRunFeedback
            ? {
                state: gatewayRunFeedback.kind,
                title: gatewayRunFeedback.kind === 'error' ? 'Action needs attention' : 'Operation started',
                message: gatewayRunFeedback.message
              }
            : null

  // Focus and composer helpers kept as no-op wiring for popup handlers.
  return {
    chatMode,
    canRunSelectedTaskWithCodex,
    canPlanSelectedTaskWithCodex,
    canSendChat,
    isPlanDraft,
    chatOperationFeedback,
    planChoiceOpen,
    selectedTaskSummary,
    refreshGatewayModels,
    runSelectedTaskWithCodex,
    planSelectedTaskWithCodex,
    confirmPlanWithGateway,
    closePlanChoice,
    sendGatewayChatMessage,
    sendPlannerClarification,
    stopGatewayChat,
    addChatAttachments,
    applySlashCommand
  }
}
