import type { AppNavigateOpenTaskChatState } from '../../shared/contracts/ipc.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import { safeConsole } from './safe-output.js'
import { electronRuntime } from './electron-runtime.js'

type CodexChatMode = 'chat' | 'plan' | 'steer'

type CodexChatNotificationInput = {
  taskTitle: string
  taskId: string
  projectId: string
  conversationId: string
  mode: CodexChatMode
  success: boolean
  exitCode?: number | null
}

const NOTIFICATION_TITLE_LIMIT = 82
const NOTIFICATION_BODY_LIMIT = 200

function safeText(value: string, limit: number): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Görev'
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, Math.max(0, limit - 1))}…`
}

function modeLabel(mode: CodexChatMode): string {
  return mode === 'plan' ? 'plan' : 'chat'
}

function getMainWindowForNotification() {
  const BrowserWindow = electronRuntime.BrowserWindow
  if (!BrowserWindow) return null
  const candidates = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  if (candidates.length === 0) return null
  return candidates.find((win) => !win.getTitle().toLowerCase().includes('companion')) ?? candidates[0]
}

function openProjectTaskChat(projectId: string, state: AppNavigateOpenTaskChatState): void {
  const mainWindow = getMainWindowForNotification()
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

export function showCodexChatCompletionNotification(input: CodexChatNotificationInput): void {
  const Notification = electronRuntime.Notification
  if (!Notification || !Notification.isSupported()) return

  const title = safeText(input.taskTitle, NOTIFICATION_TITLE_LIMIT)
  const mode = modeLabel(input.mode)
  const resultText = input.success
    ? 'başarıyla tamamlandı.'
    : `başarısız oldu${input.exitCode === undefined ? '.' : ` (kod: ${input.exitCode}).`}`

  const body = safeText(`Codex ${mode} ${resultText} · ${input.taskTitle}`, NOTIFICATION_BODY_LIMIT)

  try {
    const notification = new Notification({
      title: `Codex ${mode}: ${title}`,
      body,
      silent: false
    })

    const state: AppNavigateOpenTaskChatState = {
      openTaskId: input.taskId,
      openTaskConversationId: input.conversationId,
      openTaskChat: true
    }

    notification.once('click', () => {
      openProjectTaskChat(input.projectId, state)
    })

    notification.show()
  } catch (error) {
    safeConsole.warn('[main] Notification failed', error)
  }
}
