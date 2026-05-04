import { describe, expect, it, vi } from 'vitest'
import { RendererHealthMonitor } from './renderer-health.js'

function createMockWindow() {
  const webContentsHandlers = new Map<string, (...args: any[]) => void>()
  const windowHandlers = new Map<string, (...args: any[]) => void>()
  return {
    loadURL: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: 1,
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        webContentsHandlers.set(event, handler)
      })
    },
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      windowHandlers.set(event, handler)
    }),
    emitWebContents: (event: string, ...args: any[]) => webContentsHandlers.get(event)?.(...args),
    emitWindow: (event: string, ...args: any[]) => windowHandlers.get(event)?.(...args)
  }
}

describe('RendererHealthMonitor', () => {
  it('reloads when heartbeat reports an empty root', () => {
    vi.useFakeTimers()
    const win = createMockWindow()
    const monitor = new RendererHealthMonitor(win as never, {
      getRendererSource: () => 'file:///app/index.html',
      recoveryDelayMs: 1
    })

    monitor.recordHealth({ path: '/projects/1', rootChildCount: 0, timestamp: 1 })
    vi.advanceTimersByTime(1)

    expect(win.loadURL).toHaveBeenCalledWith('file:///app/index.html')
    vi.useRealTimers()
  })

  it('reloads when the heartbeat is stale', () => {
    vi.useFakeTimers()
    let now = 1_000
    const win = createMockWindow()
    const monitor = new RendererHealthMonitor(win as never, {
      getRendererSource: () => 'file:///app/index.html',
      recoveryDelayMs: 1,
      staleHeartbeatMs: 500,
      now: () => now
    })

    monitor.recordHealth({ path: '/projects/1', rootChildCount: 1, timestamp: now })
    now = 2_000
    expect(monitor.recoverIfStale('test-stale')).toBe(true)
    vi.advanceTimersByTime(1)

    expect(win.loadURL).toHaveBeenCalledWith('file:///app/index.html')
    vi.useRealTimers()
  })

  it('stops automatic reload loops with a diagnostic page', () => {
    vi.useFakeTimers()
    let now = 1_000
    const win = createMockWindow()
    const monitor = new RendererHealthMonitor(win as never, {
      getRendererSource: () => 'file:///app/index.html',
      recoveryDelayMs: 1,
      reloadWindowMs: 60_000,
      maxReloads: 2,
      now: () => now
    })

    monitor.recordHealth({
      path: '/projects/project-1',
      rootChildCount: 1,
      lastErrorKind: 'react-hook',
      lastErrorMessage: 'Rendered fewer hooks than expected',
      diagnosticContext: {
        area: 'project-detail',
        selectedTaskId: 'task-1'
      }
    })
    monitor.requestRecovery('first')
    vi.advanceTimersByTime(1)
    now += 1
    monitor.requestRecovery('second')
    vi.advanceTimersByTime(1)
    now += 1
    monitor.requestRecovery('third')
    vi.advanceTimersByTime(1)

    expect(win.loadURL).toHaveBeenCalledTimes(3)
    expect(win.loadURL.mock.calls[0][0]).toBe('file:///app/index.html')
    expect(win.loadURL.mock.calls[1][0]).toBe('file:///app/index.html')
    expect(String(win.loadURL.mock.calls[2][0])).toContain('data:text/html')
    const diagnosticHtml = decodeURIComponent(String(win.loadURL.mock.calls[2][0]).split(',')[1] ?? '')
    expect(diagnosticHtml).toContain('react-hook')
    expect(diagnosticHtml).toContain('Rendered fewer hooks than expected')
    expect(diagnosticHtml).toContain('project-detail')
    vi.useRealTimers()
  })

  it('hooks renderer gone and unresponsive events into recovery', () => {
    vi.useFakeTimers()
    const win = createMockWindow()
    const monitor = new RendererHealthMonitor(win as never, {
      getRendererSource: () => 'file:///app/index.html',
      recoveryDelayMs: 1
    })
    monitor.attachWindowEvents()

    win.emitWebContents('render-process-gone', {}, { reason: 'crashed' })
    vi.advanceTimersByTime(1)
    win.loadURL.mockClear()
    win.emitWindow('unresponsive')
    vi.advanceTimersByTime(1)

    expect(win.loadURL).toHaveBeenCalledWith('file:///app/index.html')
    vi.useRealTimers()
  })
})
