import { useCallback } from 'react'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Gateway, Project } from '@shared/types/entities'
import type { TaskEntity } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import { buildTaskZipArchive } from '../taskExport'
import { createLocalId, taskCodexGatewayId, taskCodexModel } from '../projectDetailUtils'
import { CodexRunFeedback, ChatAttachmentDraft, ChatOperationFeedbackData, ChatConversationSummary, SlashCommand } from '../types'
import type { ProjectDetailStateBindings } from '../state/projectDetailState'

const slashPlanToken = /(?:^|\s)\/[a-z]*$/i

interface CodexRunResponse {
  runFolderPath: string
  workspacePath: string
  model: string
  gatewayId: string
  executionMode?: 'terminal' | 'exec'
  runId?: string
}

interface CodexPlanResponse {
  runFolderPath: string
  runtimeWorkspacePath: string
  model: string
  gatewayId: string
  bridgeUrl?: string
  executionMode?: 'terminal' | 'exec'
  runId?: string
}

interface CodexChatResponse {
  runId: string
  conversationId: string
  executionMode: 'terminal' | 'exec'
}

interface CodexStopResponse {
  stopped: number
}

interface CodexModelsResponse {
  gateway: Gateway
  models: Array<{ id: string; label?: string; lastModelRefreshAt?: number; executionMode?: string }>
  cached: boolean
  error?: string
}

interface CodexTaskExportContext {
  task: TaskEntity
  project?: Project | null
  projectGroup?: { id: string; name?: string } | null
  agents?: Array<{ id: string }>
  skills?: Array<{ id: string }>
  tags?: Array<{ id: string }>
  customFields?: Array<{ id: string }>
  projectStatuses?: Array<{ id: string; status: string }>
}

export interface ProjectCodexFlowContext {
  token?: string
  project: Project | null
  selectedTask: TaskEntity | null
  selectedTaskExportContext: CodexTaskExportContext | null
  taskRunGatewayId: string
  taskRunModel: string
  savedCodexDefaultGatewayId: string
  savedCodexDefaultModel: string
  chatDraft: string
  chatAttachments: ChatAttachmentDraft[]
  chatGatewayId: string
  chatModel: string
  chatIncludeContext: boolean
  chatComposerMode: 'chat' | 'steer'
  selectedChatConversationId: string
  isStartingNewChat: boolean
  selectedChatSummary: ChatConversationSummary | null
  codexRunFeedback: CodexRunFeedback | null
  codexRunLaunching: boolean
  codexPlanLaunching: boolean
  chatSending: boolean
  chatStopping: boolean
  state: Pick<
    ProjectDetailStateBindings,
    | 'setCodexRunLaunching'
    | 'setCodexPlanLaunching'
    | 'setCodexRunFeedback'
    | 'setChatSending'
    | 'setChatStopping'
    | 'setChatSettingsOpen'
    | 'setIsActivityModalOpen'
    | 'setIsStartingNewChat'
    | 'setSelectedChatConversationId'
    | 'setCodexModelLoading'
    | 'setCodexModelError'
    | 'setCodexDefaultModel'
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

export interface UseProjectCodexFlowResult {
  chatMode: 'chat' | 'plan' | 'steer'
  canRunSelectedTaskWithCodex: boolean
  canPlanSelectedTaskWithCodex: boolean
  canSendChat: boolean
  isPlanDraft: boolean
  chatOperationFeedback: ChatOperationFeedbackData | null
  selectedTaskSummary: string
  refreshCodexGatewayModels: (gatewayId: string) => Promise<void>
  runSelectedTaskWithCodex: () => Promise<void>
  planSelectedTaskWithCodex: () => Promise<void>
  sendCodexChatMessage: () => Promise<void>
  stopCodexChat: () => Promise<void>
  addChatAttachments: (files: FileList | File[]) => Promise<void>
  applySlashCommand: (command: SlashCommand) => Promise<void>
}

export function useProjectCodexFlow({
  token,
  project,
  selectedTask,
  selectedTaskExportContext,
  taskRunGatewayId,
  taskRunModel,
  savedCodexDefaultGatewayId,
  savedCodexDefaultModel,
  chatDraft,
  chatAttachments,
  chatGatewayId,
  chatModel,
  chatIncludeContext,
  chatComposerMode,
  selectedChatConversationId,
  isStartingNewChat,
  selectedChatSummary,
  codexRunFeedback,
  codexRunLaunching,
  codexPlanLaunching,
  chatSending,
  chatStopping,
  state,
  openChatAttachmentPicker,
}: ProjectCodexFlowContext): UseProjectCodexFlowResult {
  const {
    setCodexRunLaunching,
    setCodexPlanLaunching,
    setCodexRunFeedback,
    setChatSending,
    setChatStopping,
    setChatSettingsOpen,
    setIsActivityModalOpen,
    setIsStartingNewChat,
    setSelectedChatConversationId,
    setCodexModelLoading,
    setCodexModelError,
    setCodexDefaultModel,
    setChatDraft,
    setChatAttachments,
    setChatComposerMode,
    setChatIncludeContext,
    setError,
    setDetailTab,
    setGateways
  } = state

  const selectedTaskGatewayId = selectedTask ? taskCodexGatewayId(selectedTask) : ''
  const selectedTaskGatewayModel = selectedTask ? taskCodexModel(selectedTask) : ''
  const resolvedTaskGatewayId = taskRunGatewayId || selectedTaskGatewayId || savedCodexDefaultGatewayId
  const resolvedTaskModel = taskRunModel || selectedTaskGatewayModel || savedCodexDefaultModel

  const isPlanDraft = chatDraft.trim().toLowerCase().startsWith('/plan')
  const chatMode: 'chat' | 'plan' | 'steer' = isPlanDraft ? 'plan' : chatComposerMode
  const canRunSelectedTaskWithCodex = Boolean(selectedTaskExportContext && resolvedTaskGatewayId && resolvedTaskModel)
  const canPlanSelectedTaskWithCodex = Boolean(selectedTask && resolvedTaskGatewayId && resolvedTaskModel)
  const canSendChat = Boolean(chatDraft.trim() || chatAttachments.length > 0)

  const selectedTaskSummary = selectedTask?.title ?? ''

  const refreshCodexGatewayModels = useCallback(async (gatewayId: string) => {
    if (!gatewayId) return
    setCodexModelLoading(true)
    setCodexModelError(null)

    const response = await invokeBridge<CodexModelsResponse>(IPC_CHANNELS.gateways.codexModels, {
      actorToken: token,
      gatewayId
    })
    setCodexModelLoading(false)
    if (!response.ok || !response.data) {
      setCodexModelError(response.error?.message ?? 'Unable to load Codex models')
      return
    }
    if (response.data.error) setCodexModelError(response.data.error)

    setGateways((current) => current.map((gateway) => gateway.id === response.data!.gateway.id ? response.data!.gateway : gateway))
    const modelIds = new Set(response.data.models.map((model) => model.id))
    if (gatewayId === savedCodexDefaultGatewayId && savedCodexDefaultModel && !modelIds.has(savedCodexDefaultModel)) {
      setCodexDefaultModel('')
    }
    if (gatewayId === savedCodexDefaultGatewayId && resolvedTaskModel && !modelIds.has(resolvedTaskModel)) {
      setSelectedChatConversationId('')
    }
    setError(response.data.error ?? null)
  }, [
    token,
    setCodexModelLoading,
    setCodexModelError,
    setGateways,
    setCodexDefaultModel,
    setSelectedChatConversationId,
    setError,
    savedCodexDefaultGatewayId,
    savedCodexDefaultModel,
    resolvedTaskModel
  ])

  const runSelectedTaskWithCodex = useCallback(async () => {
    if (!selectedTask || !selectedTaskExportContext || !project) {
      setCodexRunFeedback({ kind: 'error', message: 'Task is not ready for a Codex run.' })
      return
    }

    if (!resolvedTaskGatewayId) {
      setCodexRunFeedback({ kind: 'error', message: 'Configure a Codex gateway before running this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    if (!resolvedTaskModel) {
      setCodexRunFeedback({ kind: 'error', message: 'Choose a Codex model before running this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }

    setCodexRunFeedback(null)
    setCodexRunLaunching(true)
    setIsActivityModalOpen(true)
    setIsStartingNewChat(false)
    try {
      const { fileName, archive } = await buildTaskZipArchive(selectedTaskExportContext)
      const response = await invokeBridge<CodexRunResponse>(IPC_CHANNELS.tasks.runCodex, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        zipName: fileName,
        zipBytes: archive,
        gatewayId: resolvedTaskGatewayId,
        model: resolvedTaskModel,
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? ''
      })
      if (!response.ok) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to launch Codex' })
        return
      }
      if (response.data?.runId) setSelectedChatConversationId(response.data.runId)
      setCodexRunFeedback({
        kind: 'success',
        message: response.data.executionMode === 'exec'
          ? 'Codex exec started. Chat will update as it runs.'
          : `Codex terminal launched. Workspace: ${response.data.workspacePath}`
      })
      setError(null)
    } catch (error) {
      setCodexRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to launch Codex' })
    } finally {
      setCodexRunLaunching(false)
    }
  }, [
    project,
    selectedTask,
    selectedTaskExportContext,
    resolvedTaskGatewayId,
    resolvedTaskModel,
    token,
    setCodexRunFeedback,
    setCodexRunLaunching,
    setIsActivityModalOpen,
    setIsStartingNewChat,
    setSelectedChatConversationId,
    setError,
    setDetailTab,
    setChatSettingsOpen
  ])

  const planSelectedTaskWithCodex = useCallback(async () => {
    if (!selectedTask || !project) {
      setCodexRunFeedback({ kind: 'error', message: 'Task is not ready for Codex planning.' })
      return
    }

    if (!resolvedTaskGatewayId) {
      setCodexRunFeedback({ kind: 'error', message: 'Configure a Codex gateway before planning this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }
    if (!resolvedTaskModel) {
      setCodexRunFeedback({ kind: 'error', message: 'Choose a Codex model before planning this task.' })
      setChatSettingsOpen(true)
      setDetailTab('model')
      return
    }

    setCodexRunFeedback(null)
    setCodexPlanLaunching(true)
    setIsActivityModalOpen(true)
    setIsStartingNewChat(false)
    try {
      const response = await invokeBridge<CodexPlanResponse>(IPC_CHANNELS.tasks.planWithCodex, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        gatewayId: resolvedTaskGatewayId,
        model: resolvedTaskModel,
        generalContext: project.generalContext ?? '',
        generalPrompt: project.generalPrompt ?? '',
        defaultOutput: project.defaultOutput ?? ''
      })
      if (!response.ok) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to launch Codex planner' })
        return
      }
      if (response.data?.runId) setSelectedChatConversationId(response.data.runId)
      setCodexRunFeedback({
        kind: 'success',
        message: response.data.executionMode === 'exec'
          ? 'Codex planner exec started. Chat will update as it runs.'
          : `Codex planner launched. Runtime workspace: ${response.data.runtimeWorkspacePath}`
      })
      setError(null)
    } catch (error) {
      setCodexRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to launch Codex planner' })
    } finally {
      setCodexPlanLaunching(false)
    }
  }, [
    project,
    selectedTask,
    resolvedTaskGatewayId,
    resolvedTaskModel,
    token,
    setCodexRunFeedback,
    setCodexPlanLaunching,
    setIsActivityModalOpen,
    setIsStartingNewChat,
    setSelectedChatConversationId,
    setError,
    setChatSettingsOpen,
    setDetailTab
  ])

  const sendCodexChatMessage = useCallback(async () => {
    if (!selectedTask || !project) return
    if (!chatDraft.trim() && chatAttachments.length === 0) return
    if (!chatGatewayId || !chatModel) {
      setChatSettingsOpen(true)
      setCodexRunFeedback({ kind: 'error', message: 'Choose a Codex gateway and model before sending chat.' })
      return
    }
    if ((chatMode === 'steer' || selectedChatSummary?.source === 'codex-plan') && !selectedChatConversationId) {
      setCodexRunFeedback({ kind: 'error', message: 'Select a conversation before sending a steer message.' })
      return
    }

    const sendAsPlanRevision = !isStartingNewChat && selectedChatSummary?.source === 'codex-plan'
    setChatSending(true)
    setCodexRunFeedback(null)

    try {
      const response = await invokeBridge<CodexChatResponse>(IPC_CHANNELS.tasks.codexChatSend, {
        actorToken: token,
        taskId: selectedTask.id,
        projectId: project.id,
        message: chatDraft.trim() || 'Review the attached file(s) in the task context.',
        gatewayId: chatGatewayId,
        model: chatModel,
        conversationId: isStartingNewChat ? undefined : selectedChatConversationId || undefined,
        includeTaskContext: chatIncludeContext,
        mode: sendAsPlanRevision ? 'plan' : chatMode,
        attachments: chatAttachments.map((attachment) => ({ name: attachment.name, bytes: attachment.bytes }))
      })
      if (!response.ok || !response.data) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to send Codex chat message.' })
        return
      }
      setSelectedChatConversationId(response.data.conversationId)
      setIsStartingNewChat(false)
      setChatDraft('')
      setChatAttachments([])
      if (response.data.executionMode === 'terminal') {
        setCodexRunFeedback({ kind: 'success', message: 'Codex terminal chat launched.' })
      } else {
        setCodexRunFeedback(null)
      }
    } catch (error) {
      setCodexRunFeedback({
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
    isStartingNewChat,
    chatIncludeContext,
    selectedChatConversationId,
    selectedChatSummary,
    chatMode,
    token,
    setChatSending,
    setCodexRunFeedback,
    setSelectedChatConversationId,
    setIsStartingNewChat,
    setChatDraft,
    setChatAttachments,
    setChatSettingsOpen
  ])

  const stopCodexChat = useCallback(async () => {
    if (!selectedTask) return
    setChatStopping(true)
    setCodexRunFeedback(null)
    try {
      const response = await invokeBridge<CodexStopResponse>(IPC_CHANNELS.tasks.codexChatStop, {
        actorToken: token,
        taskId: selectedTask.id,
        conversationId: selectedChatConversationId || undefined
      })
      if (!response.ok) {
        setCodexRunFeedback({ kind: 'error', message: response.error?.message ?? 'Unable to stop Codex chat.' })
        return
      }
      if (!response.data?.stopped) {
        setCodexRunFeedback({ kind: 'error', message: 'No running Codex chat was found to stop.' })
      }
    } catch (error) {
      setCodexRunFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to stop Codex chat.' })
    } finally {
      setChatStopping(false)
    }
  }, [
    selectedTask,
    selectedChatConversationId,
    token,
    setChatStopping,
    setCodexRunFeedback
  ])

  const addChatAttachments = useCallback(async (files: FileList | File[]) => {
    const next: ChatAttachmentDraft[] = []
    for (const file of Array.from(files).slice(0, 6)) {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
      next.push({ id: createLocalId(), name: file.name, size: file.size, bytes })
    }
    setChatAttachments((current) => [...current, ...next].slice(0, 10))
    if (files.length === 0) {
      openChatAttachmentPicker()
    }
  }, [openChatAttachmentPicker, setChatAttachments])

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

  const chatOperationFeedback: ChatOperationFeedbackData | null = codexPlanLaunching
    ? { state: 'running', title: 'Planning with Codex', message: `Launching ${chatModel || resolvedTaskModel || 'the selected model'} with the current task context.` }
    : codexRunLaunching
      ? { state: 'running', title: 'Running task with Codex', message: `Preparing the task workspace for ${chatModel || resolvedTaskModel || 'the selected model'}.` }
      : chatSending
        ? { state: 'running', title: 'Sending message', message: `Starting ${chatModel || 'the selected model'} for this chat thread.` }
        : chatStopping
          ? { state: 'running', title: 'Stopping chat', message: 'Asking Codex to stop the active run.' }
          : codexRunFeedback
            ? {
                state: codexRunFeedback.kind,
                title: codexRunFeedback.kind === 'error' ? 'Action needs attention' : 'Operation started',
                message: codexRunFeedback.message
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
    selectedTaskSummary,
    refreshCodexGatewayModels,
    runSelectedTaskWithCodex,
    planSelectedTaskWithCodex,
    sendCodexChatMessage,
    stopCodexChat,
    addChatAttachments,
    applySlashCommand
  }
}
