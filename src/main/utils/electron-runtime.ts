import { createRequire } from 'node:module'
import type * as Electron from 'electron'

const require = createRequire(import.meta.url)

type ElectronRuntimeModule = {
  app?: Electron.App
  BrowserWindow?: typeof Electron.BrowserWindow
  Tray?: typeof Electron.Tray
  nativeImage?: typeof Electron.nativeImage
  dialog?: typeof Electron.dialog
  ipcMain?: Electron.IpcMain
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
