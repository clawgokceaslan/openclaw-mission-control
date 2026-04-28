import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDb } from '../../db/config.js'
import { createAppContext } from '../services/service-container.js'
import { registerIpcRoutes } from '../ipc/router.js'
import { JobScheduler } from '../services/scheduler/index.js'
import { electronRuntime } from '../utils/electron-runtime.js'
import { safeConsole } from '../utils/safe-output.js'
import type * as Electron from 'electron'

const app = electronRuntime.app
const BrowserWindow = electronRuntime.BrowserWindow

const isDev = process.env.ELECTRON_RENDERER_URL !== undefined || process.env.NODE_ENV === 'development' || app?.isPackaged === false

function fileExists(path: string): boolean {
  return existsSync(path)
}

function resolveFromCandidates(candidates: string[]): string | undefined {
  return candidates.find(fileExists)
}

function resolveRendererSource(): string {
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

  const window = new BrowserWindow({
    width: 1365,
    height: 900,
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
  window.loadURL(url)
  return window
}

let windowRef: Electron.BrowserWindow | null = null
let schedulerRef: JobScheduler | null = null
let ipcRoutesRegistered = false

export async function bootstrapApp(): Promise<void> {
  if (!app) {
    throw new Error('Electron app runtime is unavailable')
  }
  if (!BrowserWindow) {
    throw new Error('Electron BrowserWindow API is unavailable in this runtime')
  }

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
      ipcRoutesRegistered = true
    }

    const scheduler = new JobScheduler(context.services.jobs.repository, context.eventBus, 1500)
    scheduler.start()
    schedulerRef = scheduler
    windowRef = createMainWindow()
  })

  app.on('before-quit', () => {
    schedulerRef?.stop()
    void closeDb()
  })
}
