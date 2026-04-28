import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../config.js'
import { resolveMigrations } from './manifest.js'

export async function runMigrations(): Promise<void> {
  const db = await getDb()
  const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), '.')
  const migrationList = resolveMigrations(migrationDir)

  await db.exec(
    'CREATE TABLE IF NOT EXISTS migration_manifest (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)'
  )

  const appliedRows = await db.prepare('SELECT id, hash FROM migration_manifest').all<{ id: string; hash: string }>()
  const applied = new Map<string, string>(appliedRows.map((row) => [row.id, row.hash]))

  await db.transaction(async () => {
    for (const migration of migrationList) {
      if (applied.get(migration.id) === migration.hash) {
        continue
      }

      const sql = readFileSync(migration.path, 'utf8')

      await db.exec(sql)
      await db.prepare(
        `
        INSERT INTO migration_manifest (id, filename, hash, applied_at)
        VALUES (@id, @filename, @hash, @appliedAt)
        ON CONFLICT(id) DO UPDATE SET
          hash = excluded.hash,
          filename = excluded.filename,
          applied_at = excluded.applied_at
        `
      ).run({
        id: migration.id,
        filename: migration.filename,
        hash: migration.hash,
        appliedAt: Date.now()
      })
    }
  })
}
