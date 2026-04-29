import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface MigrationPlan {
  id: string
  filename: string
  path: string
  hash: string
}

function resolveHash(filePath: string): string {
  const raw = readFileSync(filePath)
  return createHash('sha256').update(raw).digest('hex')
}

function findProjectRoot(startDir: string): string {
  let current = startDir
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(current, 'package.json')
    if (existsSync(candidate)) {
      return current
    }
    const parent = join(current, '..')
    if (parent === current) {
      break
    }
    current = parent
  }
  return startDir
}

function resolveMigrationPath(basePaths: string[], filename: string): string {
  const candidates = basePaths.map((basePath) => resolve(join(basePath, filename)))
  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (!resolved) {
    throw new Error(`Migration file not found: ${filename}. Tried: ${candidates.join(', ')}`)
  }
  return resolved
}

export function resolveMigrations(basePath: string): MigrationPlan[] {
  const manifestModuleDir = join(fileURLToPath(new URL('.', import.meta.url)))
  const projectRoot = findProjectRoot(process.cwd())
  const workspaceRoot = findProjectRoot(process.cwd())
  const siblingRepoRoot = join(workspaceRoot, '..')
  const filenames = [
    '001_bootstrap_schema.sql',
    '002_jobs.sql',
    '003_users_name_nullable.sql',
    '004_users_reset_default_name.sql',
    '005_task_subtasks_tags.sql',
    '006_tags_metadata.sql',
    '007_projects_rename.sql',
    '008_task_skills.sql',
    '009_project_statuses.sql',
    '010_output_formats.sql'
  ]
  return filenames.map((filename) => {
    const searchPaths = [
      basePath,
      join(manifestModuleDir, '..', '..', '..', 'src', 'db', 'migrations'),
      join(manifestModuleDir, '..', '..', '..', '..', 'src', 'db', 'migrations'),
      join(basePath, '..', '..', '..', 'src', 'db', 'migrations'),
      join(basePath, '..', '..', '..', '..', 'src', 'db', 'migrations'),
      join(process.cwd(), 'src', 'db', 'migrations'),
      join(process.cwd(), 'electron', 'src', 'db', 'migrations'),
      join(projectRoot, 'src', 'db', 'migrations'),
      join(projectRoot, 'electron', 'src', 'db', 'migrations'),
      join(siblingRepoRoot, 'src', 'db', 'migrations')
    ]
    const filePath = resolveMigrationPath(searchPaths, filename)
    return {
      id: filename.replace('.sql', ''),
      filename,
      path: filePath,
      hash: resolveHash(filePath)
    }
  })
}
