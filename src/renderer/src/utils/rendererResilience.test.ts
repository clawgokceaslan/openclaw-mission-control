import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  classifyRendererError,
  clearRendererDiagnosticContext,
  collectRendererHealth,
  createRendererErrorSnapshot,
  isPersistableAppRoute,
  parseRouteSnapshot,
  rendererResilienceFallbackCopy,
  serializeRouteSnapshot,
  setRendererDiagnosticContext,
  shouldRestoreRouteFrom
} from './rendererResilience'

describe('renderer resilience utilities', () => {
  it('detects app routes that should be persisted and restored', () => {
    expect(isPersistableAppRoute('/projects/project-1')).toBe(true)
    expect(isPersistableAppRoute('/Users/app/dist/renderer/index.html')).toBe(false)
    expect(shouldRestoreRouteFrom('/Users/app/dist/renderer/index.html')).toBe(true)
    expect(shouldRestoreRouteFrom('/projects/project-1')).toBe(false)
  })

  it('serializes and parses route snapshots', () => {
    const raw = serializeRouteSnapshot({
      path: '/projects/project-1',
      search: '?task=task-1',
      hash: '#chat',
      at: 123
    })

    expect(parseRouteSnapshot(raw)).toEqual({
      path: '/projects/project-1',
      search: '?task=task-1',
      hash: '#chat',
      at: 123
    })
    expect(parseRouteSnapshot('{"path":"/dist/renderer/index.html"}')).toBeNull()
  })

  it('produces fallback copy for root render errors', () => {
    const copy = rendererResilienceFallbackCopy(new Error('Render failed'))

    expect(copy.title).toContain('Renderer')
    expect(copy.message).toContain('Render failed')
    expect(copy.action).toBe('Reload app')
  })

  it('classifies React hook and update-depth render errors', () => {
    expect(classifyRendererError('Rendered more hooks than during the previous render', 'render')).toBe('react-hook')
    expect(classifyRendererError('Rendered fewer hooks than expected', 'render')).toBe('react-hook')
    expect(classifyRendererError('Invalid hook call. Hooks can only be called inside of the body of a function component.', 'render')).toBe('react-hook')
    expect(classifyRendererError('Maximum update depth exceeded.', 'render')).toBe('update-depth')

    const snapshot = createRendererErrorSnapshot(new Error('Too many re-renders.'), 'render', 'at ProjectDetailPage')
    expect(snapshot.kind).toBe('update-depth')
    expect(snapshot.componentStack).toContain('ProjectDetailPage')
  })

  it('includes Project Detail diagnostic context in renderer health', () => {
    setRendererDiagnosticContext({
      area: 'project-detail',
      projectId: 'project-1',
      selectedTaskId: 'task-1',
      selectedChatConversationId: 'conversation-1',
      chatPopupOpen: true
    })

    expect(collectRendererHealth().diagnosticContext).toMatchObject({
      area: 'project-detail',
      projectId: 'project-1',
      selectedTaskId: 'task-1',
      selectedChatConversationId: 'conversation-1',
      chatPopupOpen: true
    })

    clearRendererDiagnosticContext('project-detail')
    expect(collectRendererHealth().diagnosticContext).toBeUndefined()
  })

  it('sets a CSP that avoids unsafe-eval in the renderer entry HTML', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const cspMatch = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)

    expect(cspMatch?.[1]).toContain("script-src 'self'")
    expect(cspMatch?.[1]).not.toContain('unsafe-eval')
    expect(cspMatch?.[1]).toContain("object-src 'none'")
  })
})
