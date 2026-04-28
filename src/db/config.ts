import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SqliteAdapter } from './adapter/sqlite.js'
import { electronRuntime } from '../main/utils/electron-runtime.js'

let dbSingleton: SqliteAdapter | null = null

export function getDbPath(): string {
  const app = electronRuntime.app
  const base = app?.isReady() ? app.getPath('userData') : process.cwd()
  const dataDir = join(base, 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  return join(dataDir, 'mission-control.sqlite')
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
