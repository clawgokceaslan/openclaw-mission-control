import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDatabaseLocationState, getDbPath, moveDatabaseToFolder } from './config.js'

let originalCwd = ''

beforeEach(() => {
  originalCwd = process.cwd()
})

afterEach(() => {
  process.chdir(originalCwd)
})

function withTemporaryWorkspace<T>(runner: (workspace: string) => Promise<T> | T): Promise<T> {
  const workspace = mkdtempSync(join(tmpdir(), 'omc-config-test-'))
  process.chdir(workspace)
  const metadataPath = join(workspace, '.omc', 'database-location.json')
  try {
    return Promise.resolve(runner(workspace))
      .finally(() => {
        rmSync(workspace, { recursive: true, force: true })
      })
  } catch (error) {
    rmSync(metadataPath, { force: true })
    rmSync(workspace, { recursive: true, force: true })
    throw error
  }
}

describe('Database location persistence', () => {
  it('falls back to userData/data equivalent when no metadata exists', async () => {
    await withTemporaryWorkspace(async () => {
      const state = getDatabaseLocationState()
      expect(state.currentFolderPath).toBe(join(process.cwd(), 'data'))
      expect(state.currentDbPath).toBe(join(process.cwd(), 'data', 'mission-control.sqlite'))
      expect(state.pendingFolderPath).toBeNull()
    })
  })

  it('copies the sqlite file into the selected folder and marks restart required', async () => {
    await withTemporaryWorkspace(async () => {
      const sourceFolder = join(process.cwd(), 'data')
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

  it('throws when destination folder cannot be found', async () => {
    await withTemporaryWorkspace(async () => {
      const sourceFolder = join(process.cwd(), 'data')
      mkdirSync(sourceFolder, { recursive: true })
      writeFileSync(join(sourceFolder, 'mission-control.sqlite'), 'seed db')

      await expect(moveDatabaseToFolder(join(process.cwd(), 'does-not-exist'))).rejects.toThrow('Destination folder does not exist')
    })
  })

  it('applies pending location on startup-like database path resolution', async () => {
    await withTemporaryWorkspace(async () => {
      const oldFolder = join(process.cwd(), 'data')
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
      const sourceFolder = join(process.cwd(), 'data')
      mkdirSync(sourceFolder, { recursive: true })
      writeFileSync(join(sourceFolder, 'mission-control.sqlite'), 'seed db')

      const response = await moveDatabaseToFolder(sourceFolder)
      expect(response.pendingFolderPath).toBeNull()
      expect(response.restartRequired).toBe(false)
      expect(readFileSync(join(sourceFolder, 'mission-control.sqlite'), 'utf8')).toBe('seed db')
    })
  })
})
