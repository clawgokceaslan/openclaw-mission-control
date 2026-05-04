import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import {
  buildCodexNotificationOptions,
  maybeShowCodexChatCompletionNotification,
  showCodexNotification
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

const baseNotification = {
  taskTitle: 'Task Alpha',
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
  mode: 'run' as const
}

describe('codex notifications', () => {
  it('shows a completed notification and opens the task chat on click', () => {
    const { instances, runtime, sent } = createRuntime()

    showCodexNotification({
      ...baseNotification,
      kind: 'completed',
      model: 'gpt-5.3-codex'
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      title: 'Completed · Run · Task Alpha',
      subtitle: 'Codex Run completed',
      body: 'Codex Run completed. Task: Task Alpha. Model: gpt-5.3-codex. Click to open the related chat.',
      silent: false
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

  it('includes the exit code for failed notifications', () => {
    const { instances, runtime } = createRuntime()

    showCodexNotification({
      ...baseNotification,
      kind: 'failed',
      mode: 'chat',
      exitCode: 2
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      title: 'Failed · Chat · Task Alpha',
      subtitle: 'Codex Chat failed',
      body: 'Codex Chat failed. Exit code: 2. Task: Task Alpha. Click to open the related chat.'
    })
  })

  it('shows stopped notifications for observable exec runs', () => {
    const { instances, runtime } = createRuntime()

    maybeShowCodexChatCompletionNotification({
      ...baseNotification,
      mode: 'steer',
      executionMode: 'exec',
      success: true,
      stopped: true
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      title: 'Stopped · Steer · Task Alpha',
      subtitle: 'Codex Steer stopped'
    })
  })

  it('shows question notifications for planner clarification', () => {
    const { instances, runtime } = createRuntime()

    showCodexNotification({
      ...baseNotification,
      kind: 'question',
      mode: 'plan',
      questionCount: 3,
      summary: 'Scope needs confirmation'
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      title: 'Question · Plan · Task Alpha',
      subtitle: 'Codex Plan needs input',
      body: '3 questions need attention. Task: Task Alpha. Question summary: Scope needs confirmation. Click to open the plan conversation.'
    })
  })

  it('shows the native notification even when the main window is visible and focused', () => {
    const { instances, runtime } = createRuntime()

    showCodexNotification({
      ...baseNotification,
      kind: 'completed'
    }, runtime)

    expect(instances).toHaveLength(1)
    expect(instances[0].shown).toBe(true)
  })

  it('sets stronger native notification options by platform', () => {
    expect(buildCodexNotificationOptions({ ...baseNotification, kind: 'completed' }, 'darwin')).toMatchObject({
      silent: false,
      sound: 'Glass',
      closeButtonText: 'Open'
    })
    expect(buildCodexNotificationOptions({ ...baseNotification, kind: 'failed' }, 'linux')).toMatchObject({
      silent: false,
      urgency: 'critical',
      timeoutType: 'never'
    })
    expect(buildCodexNotificationOptions({ ...baseNotification, kind: 'question' }, 'win32')).toMatchObject({
      silent: false,
      timeoutType: 'never'
    })
  })

  it('does not fake notifications for unobservable terminal-mode completion', () => {
    const { instances, runtime } = createRuntime()

    maybeShowCodexChatCompletionNotification({
      ...baseNotification,
      mode: 'chat',
      executionMode: 'terminal',
      success: true
    }, runtime)

    expect(instances).toHaveLength(0)
  })

  it('exits silently when notifications are unsupported', () => {
    const { instances, runtime } = createRuntime({ supported: false })

    expect(() => showCodexNotification({
      ...baseNotification,
      kind: 'completed'
    }, runtime)).not.toThrow()

    expect(instances).toHaveLength(0)
  })
})
