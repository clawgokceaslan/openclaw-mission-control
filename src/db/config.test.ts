import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDatabaseLocationState, getDb, getDbPath, moveDatabaseToFolder } from './config.js'
import { SqliteAdapter } from './adapter/sqlite.js'

let originalCwd = ''
let originalNodeEnv: string | undefined

beforeEach(() => {
  originalCwd = process.cwd()
  originalNodeEnv = process.env.NODE_ENV
})

afterEach(async () => {
  await closeDb()
  process.chdir(originalCwd)
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
})

function withTemporaryWorkspace<T>(runner: (workspace: string) => Promise<T> | T): Promise<T> {
  const workspace = mkdtempSync(join(tmpdir(), 'omc-config-test-'))
  process.chdir(workspace)
  const metadataPath = join(workspace, '.omc', 'database-location.json')
  try {
    return Promise.resolve(runner(workspace))
      .finally(async () => {
        await closeDb()
        rmSync(workspace, { recursive: true, force: true })
      })
  } catch (error) {
    rmSync(metadataPath, { force: true })
    rmSync(workspace, { recursive: true, force: true })
    throw error
  }
}

describe('Database location persistence', () => {
  it('falls back to userData/db equivalent when no metadata exists', async () => {
    await withTemporaryWorkspace(async () => {
      const state = getDatabaseLocationState()
      expect(state.currentFolderPath).toBe(join(process.cwd(), 'db'))
      expect(state.currentDbPath).toBe(join(process.cwd(), 'db', 'mission-control.sqlite'))
      expect(state.pendingFolderPath).toBeNull()
    })
  })

  it('writes the sqlite snapshot into the selected folder and marks restart required', async () => {
    await withTemporaryWorkspace(async () => {
      const sourceFolder = join(process.cwd(), 'db')
      const destinationFolder = join(process.cwd(), 'new-db-folder')
      const sourceDb = join(sourceFolder, 'mission-control.sqlite')
      mkdirSync(sourceFolder, { recursive: true })
      mkdirSync(destinationFolder, { recursive: true })
      writeFileSync(sourceDb, 'seed db')

      const moved = await moveDatabaseToFolder(destinationFolder)
      expect(moved.currentFolderPath).toBe(sourceFolder)
      expect(moved.pendingFolderPath).toBe(destinationFolder)
      expect(moved.restartRequired).toBe(true)
      expect(readFileSync(join(destinationFolder, 'mission-control.sqlite'), 'utf8')).toBe('seed db')
      expect(readFileSync(sourceDb, 'utf8')).toBe('seed db')
    })
  })

  it('uses a live sqlite snapshot when the database connection is open', async () => {
    await withTemporaryWorkspace(async () => {
      const destinationFolder = join(process.cwd(), 'live-snapshot-folder')
      const db = await getDb()
      await db.exec('CREATE TABLE sample_settings_move (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
      await db.run('INSERT INTO sample_settings_move (id, value) VALUES (?, ?)', ['row-1', 'live value'])

      const moved = await moveDatabaseToFolder(destinationFolder)
      expect(moved.pendingFolderPath).toBe(destinationFolder)

      const snapshot = await SqliteAdapter.open(join(destinationFolder, 'mission-control.sqlite'))
      try {
        const row = await snapshot.get<{ value: string }>('SELECT value FROM sample_settings_move WHERE id = ?', ['row-1'])
        expect(row?.value).toBe('live value')
      } finally {
        await snapshot.close()
      }
    })
  })

  it('can move from a manually selected source database file', async () => {
    await withTemporaryWorkspace(async () => {
      const selectedSourceFolder = join(process.cwd(), 'manual-source')
      const destinationFolder = join(process.cwd(), 'manual-destination')
      const selectedSourceDb = join(selectedSourceFolder, 'mission-control.sqlite')
      mkdirSync(selectedSourceFolder, { recursive: true })
      writeFileSync(selectedSourceDb, 'manual db')

      const moved = await moveDatabaseToFolder(destinationFolder, selectedSourceDb)

      expect(moved.pendingFolderPath).toBe(destinationFolder)
      expect(readFileSync(join(destinationFolder, 'mission-control.sqlite'), 'utf8')).toBe('manual db')
    })
  })

  it('uses the repo data database as the current development folder when stored metadata is missing file', async () => {
    await withTemporaryWorkspace(async () => {
      process.env.NODE_ENV = 'development'
      const repoDataFolder = join(process.cwd(), 'data')
      const staleFolder = join(process.cwd(), 'missing-user-data')
      const metadataDirectory = join(process.cwd(), '.omc')
      const metadataPath = join(metadataDirectory, 'database-location.json')
      mkdirSync(repoDataFolder, { recursive: true })
      mkdirSync(metadataDirectory, { recursive: true })
      writeFileSync(join(repoDataFolder, 'mission-control.sqlite'), 'dev db')
      writeFileSync(metadataPath, JSON.stringify({
        activeDbFolder: staleFolder,
        pendingDbFolder: null
      }))

      const state = getDatabaseLocationState()

      expect(state.currentFolderPath).toBe(repoDataFolder)
      expect(state.currentDbPath).toBe(join(repoDataFolder, 'mission-control.sqlite'))
      expect(state.currentDbExists).toBe(true)
    })
  })

  it('ignores production metadata and pending folder in development runtime', async () => {
    await withTemporaryWorkspace(async () => {
      process.env.NODE_ENV = 'development'
      const repoDataFolder = join(process.cwd(), 'data')
      const prodFolder = join(process.cwd(), 'prod-db')
      const pendingFolder = join(process.cwd(), 'pending-prod')
      const metadataDirectory = join(process.cwd(), '.omc')
      const metadataPath = join(metadataDirectory, 'database-location.json')
      mkdirSync(prodFolder, { recursive: true })
      mkdirSync(pendingFolder, { recursive: true })
      mkdirSync(repoDataFolder, { recursive: true })
      writeFileSync(join(repoDataFolder, 'mission-control.sqlite'), 'dev db')
      writeFileSync(join(prodFolder, 'mission-control.sqlite'), 'prod db')
      mkdirSync(metadataDirectory, { recursive: true })
      writeFileSync(metadataPath, JSON.stringify({
        activeDbFolder: prodFolder,
        pendingDbFolder: pendingFolder
      }))

      const state = getDatabaseLocationState()

      expect(state.currentFolderPath).toBe(repoDataFolder)
      expect(state.currentDbPath).toBe(join(repoDataFolder, 'mission-control.sqlite'))
      expect(state.currentDbExists).toBe(true)
      expect(state.pendingFolderPath).toBeNull()
      expect(getDbPath()).toBe(join(repoDataFolder, 'mission-control.sqlite'))
    })
  })

  it('creates the destination folder when it does not exist', async () => {
    await withTemporaryWorkspace(async () => {
      const sourceFolder = join(process.cwd(), 'db')
      const destinationFolder = join(process.cwd(), 'does-not-exist-yet')
      mkdirSync(sourceFolder, { recursive: true })
      writeFileSync(join(sourceFolder, 'mission-control.sqlite'), 'seed db')

      const moved = await moveDatabaseToFolder(destinationFolder)
      expect(moved.pendingFolderPath).toBe(destinationFolder)
      expect(readFileSync(join(destinationFolder, 'mission-control.sqlite'), 'utf8')).toBe('seed db')
    })
  })

  it('applies pending location on startup-like database path resolution', async () => {
    await withTemporaryWorkspace(async () => {
      const oldFolder = join(process.cwd(), 'db')
      const nextFolder = join(process.cwd(), 'next-data')
      const metadataDirectory = join(process.cwd(), '.omc')
      const metadataPath = join(metadataDirectory, 'database-location.json')
      mkdirSync(metadataDirectory, { recursive: true })
      writeFileSync(metadataPath, JSON.stringify({
        activeDbFolder: oldFolder,
        pendingDbFolder: nextFolder
      }))
      mkdirSync(nextFolder, { recursive: true })

      const dbPath = getDbPath()
      expect(dbPath).toBe(join(nextFolder, 'mission-control.sqlite'))
      expect(getDatabaseLocationState().pendingFolderPath).toBeNull()
    })
  })

  it('does not require db path movement when destination equals current folder', async () => {
    await withTemporaryWorkspace(async () => {
      const sourceFolder = join(process.cwd(), 'db')
      mkdirSync(sourceFolder, { recursive: true })
      writeFileSync(join(sourceFolder, 'mission-control.sqlite'), 'seed db')

      const response = await moveDatabaseToFolder(sourceFolder)
      expect(response.pendingFolderPath).toBeNull()
      expect(response.restartRequired).toBe(false)
      expect(readFileSync(join(sourceFolder, 'mission-control.sqlite'), 'utf8')).toBe('seed db')
    })
  })

  it('does not fail when the selected folder is already the pending database folder', async () => {
    await withTemporaryWorkspace(async () => {
      const sourceFolder = join(process.cwd(), 'db')
      const destinationFolder = join(process.cwd(), 'next-data')
      mkdirSync(sourceFolder, { recursive: true })
      mkdirSync(destinationFolder, { recursive: true })
      writeFileSync(join(sourceFolder, 'mission-control.sqlite'), 'seed db')

      const firstMove = await moveDatabaseToFolder(destinationFolder)
      const secondMove = await moveDatabaseToFolder(destinationFolder)

      expect(firstMove.pendingFolderPath).toBe(destinationFolder)
      expect(secondMove.pendingFolderPath).toBe(destinationFolder)
      expect(secondMove.restartRequired).toBe(true)
    })
  })

  it('adopts a legacy default data database into the db folder before opening', async () => {
    await withTemporaryWorkspace(async () => {
      const legacyFolder = join(process.cwd(), 'data')
      const defaultFolder = join(process.cwd(), 'db')
      mkdirSync(legacyFolder, { recursive: true })
      writeFileSync(join(legacyFolder, 'mission-control.sqlite'), 'legacy db')

      const dbPath = getDbPath()

      expect(dbPath).toBe(join(defaultFolder, 'mission-control.sqlite'))
      expect(readFileSync(join(defaultFolder, 'mission-control.sqlite'), 'utf8')).toBe('legacy db')
      expect(readFileSync(join(legacyFolder, 'mission-control.sqlite'), 'utf8')).toBe('legacy db')
    })
  })
})
