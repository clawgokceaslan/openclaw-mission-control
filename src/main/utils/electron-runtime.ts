import { createRequire } from 'node:module'
import type * as Electron from 'electron'

const require = createRequire(import.meta.url)

type ElectronRuntimeModule = {
  app?: Electron.App
  BrowserWindow?: typeof Electron.BrowserWindow
  Notification?: typeof Electron.Notification
  Tray?: typeof Electron.Tray
  nativeImage?: typeof Electron.nativeImage
  powerMonitor?: typeof Electron.powerMonitor
  dialog?: typeof Electron.dialog
  shell?: typeof Electron.shell
  ipcMain?: Electron.IpcMain
  safeStorage?: Electron.SafeStorage
}

function loadElectronModule(): ElectronRuntimeModule {
  try {
    const resolved = require('electron')
    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      return resolved as ElectronRuntimeModule
    }
  } catch {
    // Electron module not available in this runtime (expected in Electron binary bootstrap edge-cases)
  }

  return {}
}

export const electronRuntime = loadElectronModule()
export const isElectronRuntimeAvailable = Boolean(electronRuntime.app && electronRuntime.BrowserWindow && electronRuntime.ipcMain)
