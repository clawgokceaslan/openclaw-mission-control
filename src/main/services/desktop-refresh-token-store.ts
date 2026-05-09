import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { electronRuntime } from '../utils/electron-runtime.js'

const STORE_FILE = 'desktop-refresh-token.bin'
let memoryToken: string | null = null

function storePath(): string | null {
  const app = electronRuntime.app
  if (!app) return null
  return join(app.getPath('userData'), STORE_FILE)
}

function canUseSafeStorage(): boolean {
  const safeStorage = electronRuntime.safeStorage
  return Boolean(safeStorage && safeStorage.isEncryptionAvailable())
}

export class DesktopRefreshTokenStore {
  async get(): Promise<string | null> {
    if (!canUseSafeStorage()) return memoryToken
    const path = storePath()
    if (!path || !existsSync(path)) return null
    try {
      return electronRuntime.safeStorage?.decryptString(readFileSync(path)) ?? null
    } catch {
      await this.clear()
      return null
    }
  }

  async set(token?: string | null): Promise<void> {
    const nextToken = token?.trim()
    if (!nextToken) {
      await this.clear()
      return
    }
    if (!canUseSafeStorage()) {
      memoryToken = nextToken
      return
    }
    const path = storePath()
    if (!path) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, electronRuntime.safeStorage?.encryptString(nextToken) ?? Buffer.from(''))
    memoryToken = null
  }

  async clear(): Promise<void> {
    memoryToken = null
    const path = storePath()
    if (path && existsSync(path)) rmSync(path, { force: true })
  }
}

export const desktopRefreshTokenStore = new DesktopRefreshTokenStore()
