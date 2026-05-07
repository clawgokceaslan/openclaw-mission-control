import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { SqliteAdapter } from './adapter/sqlite.js'
import { electronRuntime } from '../main/utils/electron-runtime.js'

let dbSingleton: SqliteAdapter | null = null
const DB_FILENAME = 'mission-control.sqlite'
const DB_LOCATION_META_FILE = 'database-location.json'

interface StoredDbLocationMeta {
  activeDbFolder?: string
  pendingDbFolder?: string | null
}

export interface DatabaseLocationState {
  currentFolderPath: string
  currentDbPath: string
  pendingFolderPath: string | null
  pendingDbPath: string | null
  restartRequired: boolean
}

function resolveUserDataRoot(): string {
  const app = electronRuntime.app
  return app?.isReady() ? app.getPath('userData') : process.cwd()
}

function resolveDataDirectory(): string {
  const base = resolveUserDataRoot()
  return join(base, '.omc')
}

function dbLocationMetaPath(): string {
  return join(resolveDataDirectory(), DB_LOCATION_META_FILE)
}

function defaultDbFolder(): string {
  return join(resolveUserDataRoot(), 'data')
}

function sanitizeFolderPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const normalized = isAbsolute(trimmed) ? resolve(trimmed) : resolve(resolveUserDataRoot(), trimmed)
  return normalized
}

function normalizeState(meta: StoredDbLocationMeta | null): { activeDbFolder: string; pendingDbFolder: string | null } {
  const defaultFolder = defaultDbFolder()
  const activeDbFolder = sanitizeFolderPath(typeof meta?.activeDbFolder === 'string' ? meta.activeDbFolder : '') || defaultFolder
  const pendingDbFolder = sanitizeFolderPath(typeof meta?.pendingDbFolder === 'string' ? meta.pendingDbFolder : '') || ''
  return { activeDbFolder, pendingDbFolder: pendingDbFolder || null }
}

function readDbLocationMeta(): StoredDbLocationMeta {
  const metaPath = dbLocationMetaPath()
  if (!existsSync(metaPath)) {
    return {}
  }

  try {
    const raw = readFileSync(metaPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const candidate = parsed as StoredDbLocationMeta
    return {
      activeDbFolder: typeof candidate.activeDbFolder === 'string' ? candidate.activeDbFolder : undefined,
      pendingDbFolder: typeof candidate.pendingDbFolder === 'string' ? candidate.pendingDbFolder : candidate.pendingDbFolder == null ? null : undefined
    }
  } catch {
    return {}
  }
}

function persistDbLocationMeta(meta: StoredDbLocationMeta): void {
  const metaPath = dbLocationMetaPath()
  mkdirSync(dirname(metaPath), { recursive: true })
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))
}

function isDirectoryPath(folderPath: string): boolean {
  if (!existsSync(folderPath)) return false
  return statSync(folderPath).isDirectory()
}

function applyPendingDbLocationIfReady(): { activeDbFolder: string; pendingDbFolder: string | null } {
  const source = normalizeState(readDbLocationMeta())
  const { activeDbFolder, pendingDbFolder } = source
  if (!pendingDbFolder) return source

  if (!isDirectoryPath(pendingDbFolder)) {
    persistDbLocationMeta({
      activeDbFolder,
      pendingDbFolder: null
    })
    return {
      activeDbFolder,
      pendingDbFolder: null
    }
  }

  if (pendingDbFolder === activeDbFolder) {
    persistDbLocationMeta({
      activeDbFolder,
      pendingDbFolder: null
    })
    return {
      activeDbFolder,
      pendingDbFolder: null
    }
  }

  const applied = {
    activeDbFolder: pendingDbFolder,
    pendingDbFolder: null
  }
  persistDbLocationMeta(applied)
  return applied
}

function getCurrentDbLocationState(): DatabaseLocationState {
  const source = normalizeState(readDbLocationMeta())
  return {
    currentFolderPath: source.activeDbFolder,
    currentDbPath: join(source.activeDbFolder, DB_FILENAME),
    pendingFolderPath: source.pendingDbFolder,
    pendingDbPath: source.pendingDbFolder ? join(source.pendingDbFolder, DB_FILENAME) : null,
    restartRequired: Boolean(source.pendingDbFolder)
  }
}

function readCurrentDbPath(): string {
  const { activeDbFolder } = applyPendingDbLocationIfReady()
  return join(activeDbFolder, DB_FILENAME)
}

export function getDatabaseLocationState(): DatabaseLocationState {
  return getCurrentDbLocationState()
}

export async function moveDatabaseToFolder(destinationFolder: string): Promise<DatabaseLocationState> {
  const toFolder = sanitizeFolderPath(destinationFolder)
  if (!toFolder) {
    throw new Error('Destination folder is required')
  }

  const existingState = getCurrentDbLocationState()
  const activeState = normalizeState(readDbLocationMeta())
  if (toFolder === existingState.currentFolderPath) {
    persistDbLocationMeta({
      activeDbFolder: activeState.activeDbFolder,
      pendingDbFolder: null
    })
    return getCurrentDbLocationState()
  }

  const currentPath = join(activeState.activeDbFolder, DB_FILENAME)
  const targetPath = join(toFolder, DB_FILENAME)

  if (!isDirectoryPath(toFolder)) {
    throw new Error('Destination folder does not exist')
  }

  if (existsSync(targetPath) && !statSync(targetPath).isFile()) {
    throw new Error('Destination path contains an existing non-file named mission-control.sqlite')
  }
  if (existsSync(targetPath)) {
    throw new Error('Destination folder already contains mission-control.sqlite')
  }

  const sourceExists = existsSync(currentPath)
  if (!sourceExists) {
    throw new Error('Current database file cannot be found')
  }

  await copyFile(currentPath, targetPath)
  persistDbLocationMeta({
    activeDbFolder: activeState.activeDbFolder,
    pendingDbFolder: toFolder
  })
  return getCurrentDbLocationState()
}

export function getDbPath(): string {
  const current = readCurrentDbPath()
  const dataDir = dirname(current)
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  return current
}

export async function getDb(): Promise<SqliteAdapter> {
  if (dbSingleton) return dbSingleton

  const db = await SqliteAdapter.open(getDbPath())
  await db.exec('PRAGMA foreign_keys = ON')
  dbSingleton = db
  return db
}

export async function closeDb(): Promise<void> {
  if (dbSingleton) {
    await dbSingleton.close()
    dbSingleton = null
  }
}

export function readMigrationSQL(migrationPath: string): string {
  return readFileSync(migrationPath, 'utf8')
}
