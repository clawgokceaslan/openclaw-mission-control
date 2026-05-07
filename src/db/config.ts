import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { SqliteAdapter } from './adapter/sqlite.js'
import { electronRuntime } from '../main/utils/electron-runtime.js'

let dbSingleton: SqliteAdapter | null = null
const DB_FILENAME = 'mission-control.sqlite'
const DB_LOCATION_META_FILE = 'database-location.json'
const LEGACY_DB_FOLDER_NAME = 'data'
const DEFAULT_DB_FOLDER_NAME = 'db'

interface StoredDbLocationMeta {
  activeDbFolder?: string
  pendingDbFolder?: string | null
}

export interface DatabaseLocationState {
  currentFolderPath: string
  currentDbPath: string
  currentDbExists: boolean
  pendingFolderPath: string | null
  pendingDbPath: string | null
  pendingDbExists: boolean
  recommendedSourceDbPath: string | null
  restartRequired: boolean
}

function resolveUserDataRoot(): string {
  const app = electronRuntime.app
  if (app) {
    try {
      return app.getPath('userData')
    } catch {
      return process.cwd()
    }
  }
  return process.cwd()
}

function resolveDataDirectory(): string {
  const base = resolveUserDataRoot()
  return join(base, '.omc')
}

function getRepoDataFolder(): string {
  return join(process.cwd(), LEGACY_DB_FOLDER_NAME)
}

function dbLocationMetaPath(): string {
  return join(resolveDataDirectory(), DB_LOCATION_META_FILE)
}

function defaultDbFolder(): string {
  if (isDevelopmentRuntime()) {
    return getRepoDataFolder()
  }
  
  return join(resolveUserDataRoot(), DEFAULT_DB_FOLDER_NAME)
}

function isDevelopmentRuntime(): boolean {
  return process.env.ELECTRON_RENDERER_URL !== undefined || process.env.NODE_ENV === 'development'
}

function sanitizeFolderPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const normalized = isAbsolute(trimmed) ? resolve(trimmed) : resolve(resolveUserDataRoot(), trimmed)
  return normalized
}

function normalizeState(meta: StoredDbLocationMeta | null): { activeDbFolder: string; pendingDbFolder: string | null } {
  const defaultFolder = defaultDbFolder()
  if (isDevelopmentRuntime()) {
    return { activeDbFolder: defaultFolder, pendingDbFolder: null }
  }

  const storedActiveDbFolder = sanitizeFolderPath(typeof meta?.activeDbFolder === 'string' ? meta.activeDbFolder : '') || defaultFolder
  const activeDbFolder = isDevelopmentRuntime() && !isFilePath(join(storedActiveDbFolder, DB_FILENAME)) && isFilePath(join(process.cwd(), LEGACY_DB_FOLDER_NAME, DB_FILENAME))
    ? join(process.cwd(), LEGACY_DB_FOLDER_NAME)
    : storedActiveDbFolder
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

function isFilePath(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  return statSync(filePath).isFile()
}

function recommendedSourceDbPath(currentDbPath: string): string | null {
  const app = electronRuntime.app
  if (!isDevelopmentRuntime()) return null

  const candidates = [
    join(process.cwd(), 'data', DB_FILENAME),
    app ? join(app.getAppPath(), 'data', DB_FILENAME) : '',
    join(resolveUserDataRoot(), LEGACY_DB_FOLDER_NAME, DB_FILENAME)
  ].filter(Boolean)

  const resolvedCurrent = resolve(currentDbPath)
  const found = candidates
    .map((candidate) => resolve(candidate))
    .find((candidate) => candidate !== resolvedCurrent && isFilePath(candidate))
  return found ?? null
}

function escapeSqliteString(value: string): string {
  return value.replace(/'/g, "''")
}

async function writeDatabaseSnapshot(sourcePath: string, targetPath: string, useLiveConnection: boolean): Promise<void> {
  if (useLiveConnection && dbSingleton) {
    await dbSingleton.exec(`VACUUM INTO '${escapeSqliteString(targetPath)}'`)
    return
  }

  await copyFile(sourcePath, targetPath)
}

function applyPendingDbLocationIfReady(): { activeDbFolder: string; pendingDbFolder: string | null } {
  if (isDevelopmentRuntime()) {
    return {
      activeDbFolder: defaultDbFolder(),
      pendingDbFolder: null
    }
  }

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

function legacyDefaultDbFolder(): string {
  return join(resolveUserDataRoot(), LEGACY_DB_FOLDER_NAME)
}

function sqliteSidecarPaths(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
}

function adoptLegacyDefaultDatabaseIfNeeded(activeDbFolder: string): string {
  if (isDevelopmentRuntime()) {
    return activeDbFolder
  }

  if (activeDbFolder !== defaultDbFolder()) return activeDbFolder

  const targetDbPath = join(activeDbFolder, DB_FILENAME)
  const legacyFolder = legacyDefaultDbFolder()
  const legacyDbPath = join(legacyFolder, DB_FILENAME)
  if (isFilePath(targetDbPath) || !isFilePath(legacyDbPath)) {
    return activeDbFolder
  }

  try {
    mkdirSync(activeDbFolder, { recursive: true })
    for (const sourcePath of sqliteSidecarPaths(legacyDbPath)) {
      if (isFilePath(sourcePath)) {
        const targetPath = join(activeDbFolder, sourcePath.slice(legacyFolder.length + 1))
        copyFileSync(sourcePath, targetPath)
      }
    }
    return activeDbFolder
  } catch {
    for (const targetPath of sqliteSidecarPaths(targetDbPath)) {
      rmSync(targetPath, { force: true })
    }
    return legacyFolder
  }
}

function getCurrentDbLocationState(): DatabaseLocationState {
  const source = normalizeState(readDbLocationMeta())
  const currentDbPath = join(source.activeDbFolder, DB_FILENAME)
  const pendingDbPath = source.pendingDbFolder ? join(source.pendingDbFolder, DB_FILENAME) : null
  return {
    currentFolderPath: source.activeDbFolder,
    currentDbPath,
    currentDbExists: isFilePath(currentDbPath),
    pendingFolderPath: source.pendingDbFolder,
    pendingDbPath,
    pendingDbExists: pendingDbPath ? isFilePath(pendingDbPath) : false,
    recommendedSourceDbPath: recommendedSourceDbPath(currentDbPath),
    restartRequired: Boolean(source.pendingDbFolder)
  }
}

function readCurrentDbPath(): string {
  const { activeDbFolder } = applyPendingDbLocationIfReady()
  return join(adoptLegacyDefaultDatabaseIfNeeded(activeDbFolder), DB_FILENAME)
}

export function getDatabaseLocationState(): DatabaseLocationState {
  return getCurrentDbLocationState()
}

export async function moveDatabaseToFolder(destinationFolder: string, sourceDbPathInput?: string | null): Promise<DatabaseLocationState> {
  const toFolder = sanitizeFolderPath(destinationFolder)
  if (!toFolder) {
    throw new Error('Destination folder is required')
  }

  const existingState = getCurrentDbLocationState()
  const activeState = normalizeState(readDbLocationMeta())
  if (toFolder === existingState.pendingFolderPath) {
    return existingState
  }
  if (toFolder === existingState.currentFolderPath) {
    persistDbLocationMeta({
      activeDbFolder: activeState.activeDbFolder,
      pendingDbFolder: null
    })
    return getCurrentDbLocationState()
  }

  const currentPath = join(activeState.activeDbFolder, DB_FILENAME)
  const targetPath = join(toFolder, DB_FILENAME)
  const sourcePath = sanitizeFolderPath(sourceDbPathInput ?? '') || currentPath
  const sourceIsActiveDb = resolve(sourcePath) === resolve(currentPath)

  if (existsSync(toFolder) && !isDirectoryPath(toFolder)) {
    throw new Error('Destination path is not a folder')
  }
  mkdirSync(toFolder, { recursive: true })

  if (resolve(sourcePath) === resolve(targetPath)) {
    persistDbLocationMeta({
      activeDbFolder: activeState.activeDbFolder,
      pendingDbFolder: toFolder
    })
    return getCurrentDbLocationState()
  }

  if (existsSync(targetPath) && !statSync(targetPath).isFile()) {
    throw new Error('Destination path contains an existing non-file named mission-control.sqlite')
  }
  if (existsSync(targetPath)) {
    throw new Error('Destination folder already contains mission-control.sqlite')
  }

  const sourceExists = isFilePath(sourcePath)
  if (!sourceExists) {
    throw new Error(sourceDbPathInput ? 'Selected database file cannot be found' : 'Current database file cannot be found')
  }

  await writeDatabaseSnapshot(sourcePath, targetPath, sourceIsActiveDb)
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
