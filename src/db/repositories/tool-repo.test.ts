import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteAdapter } from '../adapter/sqlite.js'
import { ToolRepository } from './tool-repo.js'

const tempDirs: string[] = []

async function createDb() {
  const dir = await mkdtemp(join(tmpdir(), 'omc-tool-repo-'))
  tempDirs.push(dir)
  const db = await SqliteAdapter.open(join(dir, 'test.sqlite'))
  await db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      heartbeat_at INTEGER,
      config_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE ai_tools (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      tool_type TEXT NOT NULL DEFAULT 'local_command',
      description_markdown TEXT,
      code_language TEXT,
      code_body TEXT,
      function_name TEXT,
      command_template TEXT,
      prepare_command TEXT,
      working_directory_hint TEXT,
      input_schema_json TEXT,
      output_schema_json TEXT,
      execution_flow_markdown TEXT,
      approval_required INTEGER NOT NULL DEFAULT 1,
      timeout_seconds INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (organization_id, slug)
    );
    CREATE TABLE agent_tools (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(agent_id, tool_id)
    );
  `)
  await db.prepare(`
    INSERT INTO agents (id, organization_id, name, status, heartbeat_at, config_json, created_at, updated_at)
    VALUES ('agent-1', 'org-1', 'Engineer', 'idle', 1, '{}', 1, 1)
  `).run()
  return db
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ToolRepository', () => {
  it('creates, paginates, updates, links agents, and removes tools', async () => {
    const db = await createDb()
    const repo = new ToolRepository(db)

    const created = await repo.create('org-1', {
      name: 'List changed files',
      inputSchemaJson: { type: 'object' },
      outputSchemaJson: { type: 'object' },
      agentIds: ['agent-1']
    })
    const page = await repo.listPage('org-1', { page: 1, pageSize: 20, query: 'changed' })
    const updated = await repo.update('org-1', created.id, { name: 'List git changes', status: 'inactive', agentIds: [] })
    const removed = await repo.remove('org-1', created.id)

    expect(created.slug).toBe('list-changed-files')
    expect(created.agentIds).toEqual(['agent-1'])
    expect(page.total).toBe(1)
    expect(updated?.name).toBe('List git changes')
    expect(updated?.status).toBe('inactive')
    expect(updated?.agentIds).toEqual([])
    expect(removed).toBe(true)

    await db.close()
  })
})
