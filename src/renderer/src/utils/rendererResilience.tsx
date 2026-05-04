import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'

export const LAST_ROUTE_SESSION_KEY = 'omc:last-route'

export type RouteSnapshot = {
  path: string
  search: string
  hash: string
  at: number
}

export type RendererHealthPayload = {
  path: string
  visibilityState: string
  rootChildCount: number
  timestamp: number
  lastError?: string
  lastErrorKind?: RendererErrorKind
  lastErrorMessage?: string
  componentStack?: string
  diagnosticContext?: RendererDiagnosticContext
}

export type RendererErrorKind = 'react-hook' | 'update-depth' | 'render' | 'promise' | 'unknown'

export type RendererDiagnosticContext = Record<string, string | number | boolean | null | undefined>

export type RendererErrorSnapshot = {
  kind: RendererErrorKind
  message: string
  stack?: string
  componentStack?: string
  at: number
}

let rendererDiagnosticContext: RendererDiagnosticContext | undefined
let lastRendererErrorSnapshot: RendererErrorSnapshot | undefined

function formatUnknownError(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function compactDiagnosticContext(context: RendererDiagnosticContext | undefined): RendererDiagnosticContext | undefined {
  if (!context) return undefined
  const compacted = Object.entries(context).reduce<RendererDiagnosticContext>((acc, [key, value]) => {
    if (value !== undefined) acc[key] = value
    return acc
  }, {})
  return Object.keys(compacted).length > 0 ? compacted : undefined
}

export function setRendererDiagnosticContext(context: RendererDiagnosticContext): void {
  rendererDiagnosticContext = compactDiagnosticContext({
    ...context,
    updatedAt: Date.now()
  })
}

export function clearRendererDiagnosticContext(area?: string): void {
  if (!area || rendererDiagnosticContext?.area === area) {
    rendererDiagnosticContext = undefined
  }
}

export function classifyRendererError(value: unknown, fallback: RendererErrorKind = 'unknown'): RendererErrorKind {
  const text = formatUnknownError(value).toLowerCase()
  if (
    text.includes('rendered more hooks') ||
    text.includes('rendered fewer hooks') ||
    text.includes('invalid hook call') ||
    text.includes('change in the order of hooks') ||
    text.includes('should have a queue')
  ) {
    return 'react-hook'
  }
  if (
    text.includes('maximum update depth exceeded') ||
    text.includes('too many re-renders')
  ) {
    return 'update-depth'
  }
  return fallback
}

export function createRendererErrorSnapshot(
  value: unknown,
  fallback: RendererErrorKind = 'unknown',
  componentStack?: string
): RendererErrorSnapshot {
  const message = value instanceof Error ? value.message : formatUnknownError(value)
  const combined = componentStack ? `${formatUnknownError(value)}\n${componentStack}` : value
  return {
    kind: classifyRendererError(combined, fallback),
    message,
    ...(value instanceof Error && value.stack ? { stack: value.stack } : {}),
    ...(componentStack ? { componentStack } : {}),
    at: Date.now()
  }
}

function rememberRendererError(snapshot: RendererErrorSnapshot): RendererErrorSnapshot {
  lastRendererErrorSnapshot = snapshot
  return snapshot
}

export function isPersistableAppRoute(path: string): boolean {
  if (!path || !path.startsWith('/')) return false
  if (path === '/index.html') return false
  if (path.endsWith('/index.html')) return false
  if (path.includes('/dist/renderer/') || path.includes('/src/renderer/')) return false
  return true
}

export function shouldRestoreRouteFrom(currentPath: string): boolean {
  if (!currentPath || currentPath === '/') return true
  if (currentPath === '/index.html') return true
  if (currentPath.endsWith('/index.html')) return true
  return currentPath.includes('/dist/renderer/') || currentPath.includes('/src/renderer/')
}

export function serializeRouteSnapshot(snapshot: RouteSnapshot): string {
  return JSON.stringify(snapshot)
}

export function parseRouteSnapshot(value: string | null): RouteSnapshot | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<RouteSnapshot>
    if (!parsed || typeof parsed.path !== 'string' || !isPersistableAppRoute(parsed.path)) return null
    return {
      path: parsed.path,
      search: typeof parsed.search === 'string' ? parsed.search : '',
      hash: typeof parsed.hash === 'string' ? parsed.hash : '',
      at: typeof parsed.at === 'number' ? parsed.at : 0
    }
  } catch {
    return null
  }
}

export function rendererResilienceFallbackCopy(error?: Error | null) {
  return {
    title: 'Renderer recovered from an error',
    message: error?.message || 'The app UI stopped rendering. Reload the app to continue.',
    action: 'Reload app'
  }
}

export function collectRendererHealth(lastError?: string): RendererHealthPayload {
  const root = typeof document !== 'undefined' ? document.getElementById('root') : null
  const snapshot = lastRendererErrorSnapshot
  const diagnosticContext = compactDiagnosticContext(rendererDiagnosticContext)
  return {
    path: typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}${window.location.hash}` : '',
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'visible',
    rootChildCount: root?.childElementCount ?? 0,
    timestamp: Date.now(),
    ...(lastError ? { lastError } : snapshot ? { lastError: `${snapshot.kind}: ${snapshot.message}` } : {}),
    ...(snapshot ? {
      lastErrorKind: snapshot.kind,
      lastErrorMessage: snapshot.message,
      ...(snapshot.componentStack ? { componentStack: snapshot.componentStack } : {})
    } : {}),
    ...(diagnosticContext ? { diagnosticContext } : {})
  }
}

function reportRendererHealth(lastError?: string, snapshot?: RendererErrorSnapshot): void {
  if (snapshot) rememberRendererError(snapshot)
  void invokeBridge(IPC_CHANNELS.app.rendererHealth, collectRendererHealth(lastError))
}

export class RootRendererErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const snapshot = createRendererErrorSnapshot(error, 'render', info.componentStack)
    reportRendererHealth(`${snapshot.kind}: ${error.name}: ${error.message}\n${info.componentStack}`, snapshot)
  }

  render() {
    if (!this.state.error) return this.props.children
    const copy = rendererResilienceFallbackCopy(this.state.error)
    return (
      <main style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#111827',
        color: '#e5e7eb',
        padding: 24,
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
      }}>
        <section style={{
          width: 'min(560px, 100%)',
          border: '1px solid #334155',
          borderRadius: 14,
          background: '#182235',
          padding: 24,
          boxShadow: '0 18px 48px rgba(0,0,0,.34)'
        }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>{copy.title}</h1>
          <p style={{ color: '#aab6ca', lineHeight: 1.5 }}>{copy.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 38,
              border: 0,
              borderRadius: 10,
              background: '#3b82f6',
              color: '#fff',
              padding: '0 16px',
              fontWeight: 800
            }}
          >
            {copy.action}
          </button>
        </section>
      </main>
    )
  }
}

export function RendererHealthReporter() {
  const location = useLocation()
  const navigate = useNavigate()
  const restoredRef = useRef(false)
  const lastErrorRef = useRef<string | undefined>(undefined)

  const sendHealth = useCallback((lastError?: string) => {
    reportRendererHealth(lastError ?? lastErrorRef.current)
  }, [])

  useLayoutEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const snapshot = parseRouteSnapshot(window.sessionStorage.getItem(LAST_ROUTE_SESSION_KEY))
    if (!snapshot || !shouldRestoreRouteFrom(location.pathname)) return
    navigate(`${snapshot.path}${snapshot.search}${snapshot.hash}`, { replace: true })
  }, [location.pathname, navigate])

  useEffect(() => {
    if (!isPersistableAppRoute(location.pathname)) return
    window.sessionStorage.setItem(LAST_ROUTE_SESSION_KEY, serializeRouteSnapshot({
      path: location.pathname,
      search: location.search,
      hash: location.hash,
      at: Date.now()
    }))
    sendHealth()
  }, [location.hash, location.pathname, location.search, sendHealth])

  useEffect(() => {
    const timer = window.setInterval(() => sendHealth(), 10_000)
    const onVisibilityChange = () => sendHealth()
    const onFocus = () => sendHealth()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [sendHealth])

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const errorValue = event.error ?? event.message
      const snapshot = rememberRendererError(createRendererErrorSnapshot(errorValue, 'render'))
      const errorText = `${snapshot.kind}: ${formatUnknownError(errorValue)}`
      lastErrorRef.current = errorText
      sendHealth(errorText)
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const snapshot = rememberRendererError(createRendererErrorSnapshot(event.reason, 'promise'))
      const errorText = `${snapshot.kind}: ${formatUnknownError(event.reason)}`
      lastErrorRef.current = errorText
      sendHealth(errorText)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [sendHealth])

  return null
}
