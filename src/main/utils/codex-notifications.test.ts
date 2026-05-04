import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import {
  maybeShowCodexChatCompletionNotification,
  showCodexChatCompletionNotification
} from './codex-notifications.js'

function createWindow() {
  const sent: unknown[] = []
  return {
    sent,
    window: {
      isDestroyed: () => false,
      getTitle: () => 'OpenMissionControl',
      isFocused: () => true,
      isVisible: () => true,
      isMinimized: () => false,
      restore: () => undefined,
      show: () => undefined,
      focus: () => undefined,
      webContents: {
        isLoading: () => false,
        once: () => undefined,
        send: (...args: unknown[]) => sent.push(args)
      }
    }
  }
}

function createRuntime(options: { supported?: boolean } = {}) {
  const instances: Array<{
    options: Record<string, unknown>
    shown: boolean
    click?: () => void
  }> = []
  const mainWindow = createWindow()

  class FakeNotification {
    options: Record<string, unknown>
    shown = false
    click?: () => void

    static isSupported() {
      return options.supported ?? true
    }

    constructor(notificationOptions: Record<string, unknown>) {
      this.options = notificationOptions
      instances.push(this)
    }

    once(event: string, handler: () => void) {
      if (event === 'click') this.click = handler
    }

    show() {
      this.shown = true
    }
  }

  return {
    instances,
    sent: mainWindow.sent,
    runtime: {
      Notification: FakeNotification,
      BrowserWindow: {
        getAllWindows: () => [mainWindow.window]
      }
    } as never
  }
}

describe('codex chat completion notifications', () => {
  it('shows one success notification for exec completion and opens the task chat on click', () => {
    const { instances, runtime, sent } = createRuntime()

    maybeShowCodexChatCompletionNotification({
      taskTitle: 'Task Alpha',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      mode: 'plan',
      executionMode: 'exec',
      success: true
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      title: 'Codex plan: Task Alpha',
      body: 'Codex plan başarıyla tamamlandı. · Task Alpha',
      silent: false,
      timeoutType: 'default',
      urgency: 'normal'
    })
    expect(instances[0].shown).toBe(true)

    instances[0].click?.()

    expect(sent).toEqual([[
      IPC_CHANNELS.events.appNavigate,
      {
        path: '/projects/project-1',
        state: {
          openTaskId: 'task-1',
          openTaskConversationId: 'conversation-1',
          openTaskChat: true
        }
      }
    ]])
  })

  it('includes the exit code for exec failure notifications', () => {
    const { instances, runtime } = createRuntime()

    maybeShowCodexChatCompletionNotification({
      taskTitle: 'Task Beta',
      projectId: 'project-2',
      taskId: 'task-2',
      conversationId: 'conversation-2',
      mode: 'chat',
      executionMode: 'exec',
      success: false,
      exitCode: 2
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      title: 'Codex chat: Task Beta',
      body: 'Codex chat başarısız oldu (kod: 2). · Task Beta'
    })
  })

  it('shows the native notification even when the main window is visible and focused', () => {
    const { instances, runtime } = createRuntime()

    maybeShowCodexChatCompletionNotification({
      taskTitle: 'Focused Window Task',
      projectId: 'project-focused',
      taskId: 'task-focused',
      conversationId: 'conversation-focused',
      mode: 'chat',
      executionMode: 'exec',
      success: true
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].shown).toBe(true)
  })

  it('does not notify for stopped or terminal-mode runs', () => {
    const { instances, runtime } = createRuntime()

    maybeShowCodexChatCompletionNotification({
      taskTitle: 'Stopped Task',
      projectId: 'project-3',
      taskId: 'task-3',
      conversationId: 'conversation-3',
      mode: 'chat',
      executionMode: 'exec',
      success: true,
      stopped: true
    }, runtime)
    maybeShowCodexChatCompletionNotification({
      taskTitle: 'Terminal Task',
      projectId: 'project-4',
      taskId: 'task-4',
      conversationId: 'conversation-4',
      mode: 'chat',
      executionMode: 'terminal',
      success: true
    }, runtime)

    expect(instances).toHaveLength(0)
  })

  it('exits silently when notifications are unsupported', () => {
    const { instances, runtime } = createRuntime({ supported: false })

    expect(() => showCodexChatCompletionNotification({
      taskTitle: 'Unsupported Task',
      projectId: 'project-5',
      taskId: 'task-5',
      conversationId: 'conversation-5',
      mode: 'chat',
      success: true
    }, runtime)).not.toThrow()

    expect(instances).toHaveLength(0)
  })
})
