import type { AppNavigateOpenTaskChatState } from '../../shared/contracts/ipc.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import { safeConsole } from './safe-output.js'
import { electronRuntime } from './electron-runtime.js'

export type CodexNotificationKind = 'completed' | 'failed' | 'stopped' | 'question'
export type CodexNotificationMode = 'chat' | 'plan' | 'run' | 'steer'

export type CodexNotificationInput = {
  kind: CodexNotificationKind
  mode: CodexNotificationMode
  taskTitle: string
  taskId: string
  projectId: string
  conversationId: string
  exitCode?: number | null
  questionCount?: number | null
  model?: string | null
  summary?: string | null
}

type LegacyCodexChatNotificationInput = Omit<CodexNotificationInput, 'kind' | 'mode'> & {
  mode: Extract<CodexNotificationMode, 'chat' | 'plan' | 'steer'>
  success: boolean
}

type LegacyCodexChatCompletionNotificationInput = LegacyCodexChatNotificationInput & {
  executionMode: 'exec' | 'terminal'
  stopped?: boolean
}

const NOTIFICATION_TITLE_LIMIT = 110
const NOTIFICATION_BODY_LIMIT = 420

function safeText(value: string, limit: number): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Görev'
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, Math.max(0, limit - 1))}…`
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function modeLabel(mode: CodexNotificationMode): string {
  return titleCase(mode)
}

function kindLabel(kind: CodexNotificationKind): string {
  return titleCase(kind)
}

function buildNotificationCopy(input: CodexNotificationInput): { title: string; subtitle: string; body: string } {
  const mode = modeLabel(input.mode)
  const kind = kindLabel(input.kind)
  const taskTitle = safeText(input.taskTitle, NOTIFICATION_TITLE_LIMIT)
  const title = safeText(`${kind} · ${mode} · ${taskTitle}`, NOTIFICATION_TITLE_LIMIT + 28)
  const modelPart = input.model?.trim() ? `Model: ${input.model.trim()}. ` : ''
  const taskPart = `Task: ${input.taskTitle.trim() || 'Task'}. `

  if (input.kind === 'question') {
    const count = typeof input.questionCount === 'number' && input.questionCount > 0
      ? `${input.questionCount} question${input.questionCount === 1 ? '' : 's'} need attention. `
      : 'Planner needs clarification. '
    const summary = input.summary?.trim() ? `Question summary: ${input.summary.trim()}. ` : ''
    return {
      title,
      subtitle: `Codex ${mode} needs input`,
      body: safeText(`${count}${taskPart}${modelPart}${summary}Click to open the plan conversation.`, NOTIFICATION_BODY_LIMIT)
    }
  }

  if (input.kind === 'failed') {
    const exitPart = input.exitCode === undefined || input.exitCode === null ? '' : `Exit code: ${input.exitCode}. `
    return {
      title,
      subtitle: `Codex ${mode} failed`,
      body: safeText(`Codex ${mode} failed. ${exitPart}${taskPart}${modelPart}Click to open the related chat.`, NOTIFICATION_BODY_LIMIT)
    }
  }

  if (input.kind === 'stopped') {
    return {
      title,
      subtitle: `Codex ${mode} stopped`,
      body: safeText(`Codex ${mode} was stopped. ${taskPart}${modelPart}Click to open the related chat.`, NOTIFICATION_BODY_LIMIT)
    }
  }

  return {
    title,
    subtitle: `Codex ${mode} completed`,
    body: safeText(`Codex ${mode} completed. ${taskPart}${modelPart}Click to open the related chat.`, NOTIFICATION_BODY_LIMIT)
  }
}

function getMainWindowForNotification(runtime = electronRuntime) {
  const BrowserWindow = runtime.BrowserWindow
  if (!BrowserWindow) return null
  const candidates = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  if (candidates.length === 0) return null
  return candidates.find((win) => !win.getTitle().toLowerCase().includes('companion')) ?? candidates[0]
}

function openProjectTaskChat(projectId: string, state: AppNavigateOpenTaskChatState, runtime = electronRuntime): void {
  const mainWindow = getMainWindowForNotification(runtime)
  if (!mainWindow) return

  const send = () => {
    mainWindow.webContents.send(IPC_CHANNELS.events.appNavigate, {
      path: `/projects/${projectId}`,
      state
    })
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send)
    return
  }

  send()
}

export function shouldShowCodexChatCompletionNotification(input: Pick<LegacyCodexChatCompletionNotificationInput, 'executionMode' | 'stopped'>): boolean {
  return input.executionMode === 'exec'
}

export function buildCodexNotificationOptions(
  input: CodexNotificationInput,
  platform: NodeJS.Platform = process.platform
): Electron.NotificationConstructorOptions {
  const copy = buildNotificationCopy(input)
  const options: Electron.NotificationConstructorOptions = {
    title: copy.title,
    subtitle: copy.subtitle,
    body: copy.body,
    silent: false
  }

  if (platform === 'darwin') {
    options.sound = 'Glass'
    options.closeButtonText = 'Open'
  }

  if (platform === 'linux') {
    options.urgency = 'critical'
    options.timeoutType = 'never'
  }

  if (platform === 'win32') {
    options.timeoutType = 'never'
  }

  return options
}

export function showCodexNotification(input: CodexNotificationInput, runtime = electronRuntime): void {
  const Notification = runtime.Notification
  if (!Notification || !Notification.isSupported()) return

  try {
    const notification = new Notification(buildCodexNotificationOptions(input))

    const state: AppNavigateOpenTaskChatState = {
      openTaskId: input.taskId,
      openTaskConversationId: input.conversationId,
      openTaskChat: true
    }

    notification.once('click', () => {
      openProjectTaskChat(input.projectId, state, runtime)
    })

    notification.show()
  } catch (error) {
    safeConsole.warn('[main] Notification failed', error)
  }
}

export function maybeShowCodexNotification(input: CodexNotificationInput, runtime = electronRuntime): void {
  showCodexNotification(input, runtime)
}

export function showCodexChatCompletionNotification(input: LegacyCodexChatNotificationInput, runtime = electronRuntime): void {
  showCodexNotification({
    ...input,
    kind: input.success ? 'completed' : 'failed'
  }, runtime)
}

export function maybeShowCodexChatCompletionNotification(input: LegacyCodexChatCompletionNotificationInput, runtime = electronRuntime): void {
  if (!shouldShowCodexChatCompletionNotification(input)) return
  showCodexNotification({
    ...input,
    kind: input.stopped ? 'stopped' : input.success ? 'completed' : 'failed'
  }, runtime)
}
