import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDb } from '../../db/config.js'
import { createAppContext } from '../services/service-container.js'
import { registerIpcRoutes } from '../ipc/router.js'
import { JobScheduler } from '../services/scheduler/index.js'
import { electronRuntime } from '../utils/electron-runtime.js'
import { createRendererHealthMonitor, type RendererHealthMonitor, type RendererHealthPayload } from '../utils/renderer-health.js'
import { safeConsole } from '../utils/safe-output.js'
import { IPC_CHANNELS } from '../../shared/contracts/ipc.js'
import type { AppNavigateRequest } from '../../shared/contracts/ipc.js'
import { errorResponse } from '../../shared/contracts/response.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import type * as Electron from 'electron'

const app = electronRuntime.app
const BrowserWindow = electronRuntime.BrowserWindow
const Tray = electronRuntime.Tray
const nativeImage = electronRuntime.nativeImage
const ipcMain = electronRuntime.ipcMain
const powerMonitor = electronRuntime.powerMonitor

const isDev = process.env.ELECTRON_RENDERER_URL !== undefined || process.env.NODE_ENV === 'development' || app?.isPackaged === false

function fileExists(path: string): boolean {
  return existsSync(path)
}

function resolveFromCandidates(candidates: string[]): string | undefined {
  return candidates.find(fileExists)
}

export function resolveRendererSource(): string {
  if (!app) {
    return 'about:blank'
  }

  const baseDir = dirname(fileURLToPath(import.meta.url))
  const viteUrl = process.env.ELECTRON_RENDERER_URL
  const viteDevUrl = process.env.VITE_DEV_SERVER_URL
  if (viteDevUrl) return viteDevUrl
  if (viteUrl) return viteUrl
  if (isDev) return 'http://localhost:5173'

  const fromBuild = resolveFromCandidates([
    join(process.cwd(), 'dist', 'renderer', 'index.html'),
    join(process.cwd(), 'src', 'renderer', 'index.html'),
    join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
    join(process.cwd(), 'out', 'renderer', 'index.html'),
    join(baseDir, '..', '..', 'renderer', 'index.html')
  ])

  const fallback = join(process.cwd(), 'dist', 'renderer', 'index.html')
  if (fromBuild) return `file://${fromBuild}`
  return `file://${fallback}`
}

export function createMainWindow(): Electron.BrowserWindow {
  if (!BrowserWindow) {
    throw new Error('Electron BrowserWindow API is unavailable in this runtime')
  }

  const url = resolveRendererSource()
  safeConsole.log('[main] Creating main window', { isDev, url })
  const icon = resolveFromCandidates([
    join(process.cwd(), 'app-icon.png'),
    join(app?.getAppPath() ?? '', 'app-icon.png'),
    join(process.resourcesPath ?? '', 'app-icon.png'),
    join(__dirname, '..', '..', 'app-icon.png')
  ])

  const window = new BrowserWindow({
    width: 1365,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'Open Mission Control',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(icon ? { icon } : {}),
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false
    }
  })
  const webContents = window.webContents
  webContents.on('console-message', (_event, level, message) => {
    safeConsole.log('[renderer-console]', { level, message })
  })
  webContents.on('did-start-loading', () => {
    safeConsole.log('[main] [window-start-loading]', { url })
  })
  webContents.on('did-finish-load', () => {
    safeConsole.log('[main] [window-finish-load]', { url })
  })
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl) => {
    safeConsole.error('[main] [window-fail-load]', { errorCode, errorDescription, failedUrl })
  })
  attachMainWindowHealthMonitor(window)
  window.maximize()
  window.loadURL(url)
  return window
}

let windowRef: Electron.BrowserWindow | null = null
let companionWindowRef: Electron.BrowserWindow | null = null
let trayRef: Electron.Tray | null = null
let schedulerRef: JobScheduler | null = null
let ipcRoutesRegistered = false
const rendererHealthMonitors = new Map<number, RendererHealthMonitor>()

function normalizeCompanionNavigationRequest(rawRequest: unknown): AppNavigateRequest {
  if (!rawRequest || typeof rawRequest !== 'object') return {}
  const request = rawRequest as Record<string, unknown>
  const payload = request.payload
  if (payload && typeof payload === 'object') return payload as AppNavigateRequest
  return request as AppNavigateRequest
}

function sendMainNavigation(path: string, state?: unknown): void {
  if (!BrowserWindow) return
  const mainWindow = windowRef && !windowRef.isDestroyed() ? windowRef : createMainWindow()
  windowRef = mainWindow

  const navigate = () => {
    mainWindow.webContents.send(IPC_CHANNELS.events.appNavigate, { path, state })
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', navigate)
  } else {
    navigate()
  }
}

function registerCompanionIpcRoutes(): void {
  if (!ipcMain) return
  ipcMain.handle(IPC_CHANNELS.app.navigateFromCompanion, (_event, rawRequest) => {
    const request = normalizeCompanionNavigationRequest(rawRequest)
    const path = typeof request.path === 'string' ? request.path.trim() : ''
    if (!path || !path.startsWith('/')) {
      return errorResponse(ErrorCodes.Validation, 'Companion navigation path is invalid')
    }

    sendMainNavigation(path, request.state)
    companionWindowRef?.hide()
    return { ok: true, data: { path } }
  })

  ipcMain.handle(IPC_CHANNELS.app.rendererHealth, (event, rawRequest) => {
    const request = rawRequest && typeof rawRequest === 'object' ? rawRequest as Record<string, unknown> : {}
    const payload = request.payload && typeof request.payload === 'object'
      ? request.payload as RendererHealthPayload
      : request as RendererHealthPayload
    rendererHealthMonitors.get(event.sender.id)?.recordHealth(payload)
    return { ok: true, data: { received: true } }
  })
}

function attachMainWindowHealthMonitor(window: Electron.BrowserWindow): void {
  const monitor = createRendererHealthMonitor(window, {
    getRendererSource: resolveRendererSource,
    logger: safeConsole
  })
  const webContentsId = window.webContents.id
  rendererHealthMonitors.set(webContentsId, monitor)
  window.on('closed', () => {
    rendererHealthMonitors.delete(webContentsId)
  })
}

function recoverMainWindowIfStale(reason: string): void {
  const mainWindow = windowRef && !windowRef.isDestroyed() ? windowRef : null
  if (!mainWindow) return
  rendererHealthMonitors.get(mainWindow.webContents.id)?.recoverIfStale(reason)
}

function createTrayIcon(): Electron.NativeImage | undefined {
  if (!nativeImage) return undefined
  const image = nativeImage.createFromDataURL(
    'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><rect x="3" y="3" width="16" height="16" rx="5" fill="black"/><path d="M8.1 14.2c-1.55 0-2.65-1.12-2.65-3.2s1.1-3.2 2.65-3.2 2.65 1.12 2.65 3.2-1.1 3.2-2.65 3.2Zm0-1.25c.72 0 1.16-.65 1.16-1.95s-.44-1.95-1.16-1.95-1.16.65-1.16 1.95.44 1.95 1.16 1.95Zm3.42 1.13V7.92h1.54l1.33 2.41 1.32-2.41h1.53v6.16h-1.38v-3.74l-1.05 1.88h-.85l-1.06-1.88v3.74h-1.38Z" fill="white"/></svg>')
  )
  image.setTemplateImage(process.platform === 'darwin')
  return image
}

function createCompanionWindow(): Electron.BrowserWindow {
  if (!BrowserWindow) {
    throw new Error('Electron BrowserWindow API is unavailable in this runtime')
  }
  const source = resolveRendererSource()
  const url = source.startsWith('http') ? `${source.replace(/\/$/, '')}/companion` : source
  const window = new BrowserWindow({
    width: 500,
    height: 680,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'OpenMissionControl Companion',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false
    }
  })
  window.on('blur', () => window.hide())
  window.on('closed', () => {
    companionWindowRef = null
  })
  window.webContents.on('did-finish-load', () => {
    if (!source.startsWith('http')) {
      void window.webContents.executeJavaScript("window.history.pushState({}, '', '/companion'); window.dispatchEvent(new PopStateEvent('popstate'))")
    }
  })
  window.loadURL(url)
  return window
}

function toggleCompanionWindow(): void {
  if (process.platform !== 'darwin' || !BrowserWindow) return
  const window = companionWindowRef ?? createCompanionWindow()
  companionWindowRef = window
  if (window.isVisible()) {
    window.hide()
    return
  }
  const trayBounds = trayRef?.getBounds()
  if (trayBounds) {
    const bounds = window.getBounds()
    window.setPosition(
      Math.round(trayBounds.x + trayBounds.width / 2 - bounds.width / 2),
      Math.round(trayBounds.y + trayBounds.height + 8),
      false
    )
  }
  window.show()
  window.focus()
}

function createCompanionTray(): void {
  if (process.platform !== 'darwin' || !Tray) return
  const icon = createTrayIcon()
  if (!icon) return
  trayRef = new Tray(icon)
  trayRef.setTitle('OpenMissionControl')
  trayRef.setToolTip('OpenMissionControl Companion')
  trayRef.on('click', toggleCompanionWindow)
}

export async function bootstrapApp(): Promise<void> {
  if (!app) {
    throw new Error('Electron app runtime is unavailable')
  }
  if (!BrowserWindow) {
    throw new Error('Electron BrowserWindow API is unavailable in this runtime')
  }

  app.setAppUserModelId?.('OpenMissionControl')

  const context = await createAppContext()

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowRef = createMainWindow()
    }
  })

  app.whenReady().then(() => {
    if (!ipcRoutesRegistered) {
      registerIpcRoutes(context)
      registerCompanionIpcRoutes()
      ipcRoutesRegistered = true
    }

    const scheduler = new JobScheduler(context.services.jobs.repository, context.eventBus, 1500)
    scheduler.start()
    schedulerRef = scheduler
    windowRef = createMainWindow()
    createCompanionTray()
    powerMonitor?.on('resume', () => {
      setTimeout(() => recoverMainWindowIfStale('power:resume'), 1500)
    })
    powerMonitor?.on('unlock-screen', () => {
      setTimeout(() => recoverMainWindowIfStale('power:unlock-screen'), 1500)
    })
  })

  app.on('before-quit', () => {
    schedulerRef?.stop()
    void closeDb()
  })
}
