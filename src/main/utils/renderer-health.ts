import type * as Electron from 'electron'

export interface RendererHealthPayload {
  path?: string
  visibilityState?: string
  rootChildCount?: number
  timestamp?: number
  lastError?: string
  lastErrorKind?: string
  lastErrorMessage?: string
  componentStack?: string
  diagnosticContext?: Record<string, unknown>
}

export interface RendererHealthMonitorOptions {
  getRendererSource: () => string
  now?: () => number
  maxReloads?: number
  reloadWindowMs?: number
  staleHeartbeatMs?: number
  recoveryDelayMs?: number
  staleCheckIntervalMs?: number
  logger?: Pick<Console, 'log' | 'error'>
}

type Timer = ReturnType<typeof setTimeout>
type Interval = ReturnType<typeof setInterval>

const DEFAULT_MAX_RELOADS = 2
const DEFAULT_RELOAD_WINDOW_MS = 60_000
const DEFAULT_STALE_HEARTBEAT_MS = 45_000
const DEFAULT_RECOVERY_DELAY_MS = 250
const DEFAULT_STALE_CHECK_INTERVAL_MS = 15_000

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function diagnosticUrl(reason: string, targetUrl: string, lastHealth?: RendererHealthPayload | null): string {
  const safeReason = escapeHtml(reason)
  const safeTarget = escapeHtml(targetUrl)
  const detailRows = [
    lastHealth?.path ? ['Path', lastHealth.path] : null,
    lastHealth?.lastErrorKind ? ['Error kind', lastHealth.lastErrorKind] : null,
    lastHealth?.lastErrorMessage ? ['Last error', lastHealth.lastErrorMessage] : lastHealth?.lastError ? ['Last error', lastHealth.lastError] : null,
    lastHealth?.diagnosticContext ? ['Context', JSON.stringify(lastHealth.diagnosticContext)] : null
  ].filter((row): row is [string, string] => Boolean(row))
  const detailsHtml = detailRows.length
    ? [
        '<dl>',
        ...detailRows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(value)}</code></dd>`),
        '</dl>'
      ].join('')
    : ''
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;">',
    '<title>Open Mission Control recovery</title>',
    '<style>',
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'main{max-width:560px;padding:28px;border:1px solid #334155;border-radius:14px;background:#182235;box-shadow:0 18px 48px rgba(0,0,0,.34)}',
    'h1{margin:0 0 10px;font-size:22px}p{line-height:1.5;color:#aab6ca}code{color:#fca5a5;word-break:break-word}',
    'dl{margin:16px 0;color:#aab6ca}dt{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7c8ba1}dd{margin:4px 0 10px}',
    'a{display:inline-flex;align-items:center;height:38px;border:0;border-radius:10px;background:#3b82f6;color:white;padding:0 16px;font-weight:800;text-decoration:none}',
    '</style></head><body><main>',
    '<h1>Renderer recovery paused</h1>',
    '<p>Open Mission Control tried to recover the renderer several times and stopped to avoid a reload loop.</p>',
    `<p>Last reason: <code>${safeReason}</code></p>`,
    detailsHtml,
    `<a href="${safeTarget}">Reload app</a>`,
    '</main></body></html>'
  ].join('')
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function routeFromHealthPath(path: string): string | null {
  const hashRouteIndex = path.indexOf('#/')
  if (hashRouteIndex >= 0) {
    const route = path.slice(hashRouteIndex + 1)
    return route.length > 1 ? route : null
  }

  if (!path.startsWith('/')) return null
  if (path === '/' || path === '/index.html' || path.endsWith('/index.html')) return null
  if (path.includes('/dist/renderer/') || path.includes('/src/renderer/')) return null
  return path
}

export function buildRendererRecoveryUrl(source: string, lastPath: string): string {
  const route = routeFromHealthPath(lastPath)
  if (!route) return source

  if (/^https?:\/\//i.test(source)) {
    try {
      return new URL(route, source).toString()
    } catch {
      return source
    }
  }

  if (source.startsWith('file://')) {
    const base = source.split('#')[0]
    return `${base}#${route}`
  }

  return source
}

export class RendererHealthMonitor {
  private reloadTimestamps: number[] = []
  private lastHealthAt: number | null = null
  private lastRootChildCount: number | null = null
  private lastHealth: RendererHealthPayload | null = null
  private lastLoggedErrorKey = ''
  private lastPath = ''
  private recoveryTimer: Timer | null = null
  private staleInterval: Interval | null = null
  private disposed = false

  constructor(
    private readonly window: Electron.BrowserWindow,
    private readonly options: RendererHealthMonitorOptions
  ) {}

  recordHealth(payload: RendererHealthPayload): void {
    if (this.disposed) return
    const now = this.now()
    this.lastHealthAt = now
    this.lastHealth = payload
    if (typeof payload.path === 'string') this.lastPath = payload.path
    if (typeof payload.rootChildCount === 'number') this.lastRootChildCount = payload.rootChildCount
    this.logRendererError(payload)
    if (payload.rootChildCount === 0) this.requestRecovery('renderer-root-empty')
  }

  start(): void {
    if (this.staleInterval) return
    this.staleInterval = setInterval(() => {
      this.recoverIfStale('renderer-heartbeat-stale')
    }, this.options.staleCheckIntervalMs ?? DEFAULT_STALE_CHECK_INTERVAL_MS)
  }

  stop(): void {
    this.disposed = true
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
    if (this.staleInterval) {
      clearInterval(this.staleInterval)
      this.staleInterval = null
    }
  }

  attachWindowEvents(): void {
    this.window.webContents.on('render-process-gone', (_event, details) => {
      this.requestRecovery(`render-process-gone:${details.reason}`)
    })
    this.window.on('unresponsive', () => {
      this.requestRecovery('window-unresponsive')
    })
    this.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
      if (isMainFrame === false) return
      this.requestRecovery(`did-fail-load:${errorCode}:${errorDescription}:${failedUrl}`)
    })
    this.window.on('closed', () => {
      this.stop()
    })
  }

  recoverIfStale(reason: string): boolean {
    if (this.disposed || this.window.isDestroyed()) return false
    const now = this.now()
    const staleHeartbeatMs = this.options.staleHeartbeatMs ?? DEFAULT_STALE_HEARTBEAT_MS
    const heartbeatStale = this.lastHealthAt === null || now - this.lastHealthAt > staleHeartbeatMs
    const rootEmpty = this.lastRootChildCount === 0
    if (!heartbeatStale && !rootEmpty) return false
    this.requestRecovery(reason)
    return true
  }

  requestRecovery(reason: string): boolean {
    if (this.disposed || this.window.isDestroyed()) return false
    if (this.recoveryTimer) return false
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      this.performRecovery(reason)
    }, this.options.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS)
    return true
  }

  getLastPath(): string {
    return this.lastPath
  }

  private performRecovery(reason: string): void {
    if (this.disposed || this.window.isDestroyed()) return
    const now = this.now()
    const reloadWindowMs = this.options.reloadWindowMs ?? DEFAULT_RELOAD_WINDOW_MS
    const maxReloads = this.options.maxReloads ?? DEFAULT_MAX_RELOADS
    this.reloadTimestamps = this.reloadTimestamps.filter((timestamp) => now - timestamp < reloadWindowMs)
    const targetUrl = buildRendererRecoveryUrl(this.options.getRendererSource(), this.lastPath)

    if (this.reloadTimestamps.length >= maxReloads) {
      this.options.logger?.error?.('[renderer-health] reload loop stopped', {
        reason,
        path: this.lastPath,
        lastErrorKind: this.lastHealth?.lastErrorKind,
        lastErrorMessage: this.lastHealth?.lastErrorMessage,
        diagnosticContext: this.lastHealth?.diagnosticContext
      })
      void this.window.loadURL(diagnosticUrl(reason, targetUrl, this.lastHealth))
      return
    }

    this.reloadTimestamps.push(now)
    this.options.logger?.log?.('[renderer-health] reloading renderer', { reason, path: this.lastPath })
    void this.window.loadURL(targetUrl)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private logRendererError(payload: RendererHealthPayload): void {
    const errorText = payload.lastErrorMessage ?? payload.lastError
    if (!errorText) return
    const key = `${payload.lastErrorKind ?? 'unknown'}:${errorText}:${payload.componentStack ?? ''}`
    if (key === this.lastLoggedErrorKey) return
    this.lastLoggedErrorKey = key
    this.options.logger?.error?.('[renderer-health] renderer error reported', {
      path: payload.path,
      lastErrorKind: payload.lastErrorKind,
      lastErrorMessage: payload.lastErrorMessage ?? payload.lastError,
      componentStack: payload.componentStack,
      diagnosticContext: payload.diagnosticContext
    })
  }
}

export function createRendererHealthMonitor(
  window: Electron.BrowserWindow,
  options: RendererHealthMonitorOptions
): RendererHealthMonitor {
  const monitor = new RendererHealthMonitor(window, options)
  monitor.attachWindowEvents()
  monitor.start()
  return monitor
}
