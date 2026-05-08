import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteAdapter } from '../adapter/sqlite.js'
import { TaskRepository } from './task-repo.js'

const tempDirs: string[] = []

async function createDb() {
  const dir = await mkdtemp(join(tmpdir(), 'omc-task-repo-'))
  tempDirs.push(dir)
  const db = await SqliteAdapter.open(join(dir, 'test.sqlite'))
  await db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      workspace_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      metrics_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      agent_id TEXT,
      payload_json TEXT,
      result_json TEXT,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE project_statuses (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      is_default INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return db
}

async function insertProject(db: SqliteAdapter, id: string, orgId: string, name: string, metrics: Record<string, unknown> = {}) {
  await db.prepare(`
    INSERT INTO projects (id, organization_id, name, description, archived, metrics_json, created_at, updated_at)
    VALUES (@id, @orgId, @name, '', 0, @metrics, 1, 1)
  `).run({ id, orgId, name, metrics: JSON.stringify(metrics) })
}

async function insertTask(db: SqliteAdapter, id: string, projectId: string, title: string, updatedAt: number, payload: Record<string, unknown>) {
  await db.prepare(`
    INSERT INTO tasks (id, project_id, title, status, agent_id, payload_json, result_json, updated_at, created_at)
    VALUES (@id, @projectId, @title, 'active', NULL, @payload, '{}', @updatedAt, 1)
  `).run({ id, projectId, title, payload: JSON.stringify(payload), updatedAt })
}

async function insertTaskWithStatus(db: SqliteAdapter, id: string, projectId: string, title: string, status: string, updatedAt: number, payload: Record<string, unknown>) {
  await db.prepare(`
    INSERT INTO tasks (id, project_id, title, status, agent_id, payload_json, result_json, updated_at, created_at)
    VALUES (@id, @projectId, @title, @status, NULL, @payload, '{}', @updatedAt, 1)
  `).run({ id, projectId, title, status, payload: JSON.stringify(payload), updatedAt })
}

async function insertStatus(db: SqliteAdapter, id: string, projectId: string, orgId: string, category: string, sortOrder: number) {
  await db.prepare(`
    INSERT INTO project_statuses (id, organization_id, project_id, name, category, color, sort_order, is_default, created_at, updated_at)
    VALUES (@id, @orgId, @projectId, @category, @category, '#8A99B4', @sortOrder, 0, 1, 1)
  `).run({ id, orgId, projectId, category, sortOrder })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('TaskRepository.listPlannedGateway', () => {
  it('filters planned Codex tasks by organization and paginates newest first', async () => {
    const db = await createDb()
    const repo = new TaskRepository(db)
    await insertProject(db, 'project-a', 'org-1', 'Alpha', { gateway: { gatewayId: 'gw-1', runModel: 'gpt-5.5' } })
    await insertProject(db, 'project-b', 'org-1', 'Beta')
    await insertProject(db, 'project-c', 'org-2', 'Other')
    await insertTask(db, 'task-1', 'project-a', 'First planned', 10, { gatewayPlanState: { state: 'planned' } })
    await insertTask(db, 'task-2', 'project-b', 'Newest planned', 30, { gatewayPlanState: { state: 'planned' } })
    await insertTask(db, 'task-3', 'project-a', 'Needs info', 40, { gatewayPlanState: { state: 'needs-clarification' } })
    await insertTask(db, 'task-4', 'project-c', 'Wrong org', 50, { gatewayPlanState: { state: 'planned' } })

    const firstPage = await repo.listPlannedGateway('org-1', 1, 1)
    const secondPage = await repo.listPlannedGateway('org-1', 2, 1)

    expect(firstPage.total).toBe(2)
    expect(firstPage.rows).toHaveLength(1)
    expect(firstPage.rows[0].task.id).toBe('task-2')
    expect(firstPage.rows[0].project.name).toBe('Beta')
    expect(secondPage.rows[0].task.id).toBe('task-1')
    expect(secondPage.rows[0].project.metrics?.gateway).toEqual({ gatewayId: 'gw-1', runModel: 'gpt-5.5' })

    await db.close()
  })

  it('can scope planned Codex tasks to one project', async () => {
    const db = await createDb()
    const repo = new TaskRepository(db)
    await insertProject(db, 'project-a', 'org-1', 'Alpha')
    await insertProject(db, 'project-b', 'org-1', 'Beta')
    await insertTask(db, 'task-a', 'project-a', 'Alpha planned', 10, { gatewayPlanState: { state: 'planned' } })
    await insertTask(db, 'task-b', 'project-b', 'Beta planned', 20, { gatewayPlanState: { state: 'planned' } })

    const page = await repo.listPlannedGateway('org-1', 1, 10, 'project-a')

    expect(page.total).toBe(1)
    expect(page.rows.map((row) => row.task.id)).toEqual(['task-a'])

    await db.close()
  })

  it('excludes done, closed, and already-run planned Codex tasks', async () => {
    const db = await createDb()
    const repo = new TaskRepository(db)
    await insertProject(db, 'project-a', 'org-1', 'Alpha')
    await insertStatus(db, 'todo-status', 'project-a', 'org-1', 'not_started', 0)
    await insertStatus(db, 'active-status', 'project-a', 'org-1', 'active', 1)
    await insertStatus(db, 'done-status', 'project-a', 'org-1', 'done', 3)
    await insertStatus(db, 'closed-status', 'project-a', 'org-1', 'closed', 4)
    await insertTaskWithStatus(db, 'task-ready', 'project-a', 'Ready planned', 'active-status', 50, { gatewayPlanState: { state: 'planned' } })
    await insertTaskWithStatus(db, 'task-todo', 'project-a', 'Todo planned', 'todo-status', 45, { gatewayPlanState: { state: 'planned' } })
    await insertTaskWithStatus(db, 'task-done', 'project-a', 'Done planned', 'done-status', 40, { gatewayPlanState: { state: 'planned' } })
    await insertTaskWithStatus(db, 'task-closed', 'project-a', 'Closed planned', 'closed-status', 30, { gatewayPlanState: { state: 'planned' } })
    await insertTaskWithStatus(db, 'task-started', 'project-a', 'Started planned', 'active-status', 20, {
      gatewayPlanState: { state: 'planned' },
      activityMessages: [{ source: 'gateway-run', status: 'running' }]
    })
    await insertTaskWithStatus(db, 'task-finished', 'project-a', 'Finished planned', 'active-status', 10, {
      gatewayPlanState: { state: 'planned' },
      activityMessages: [{ source: 'gateway-run', status: 'completed', metadata: { gatewayBlock: 'run-complete' } }]
    })

    const page = await repo.listPlannedGateway('org-1', 1, 10)

    expect(page.total).toBe(1)
    expect(page.rows.map((row) => row.task.id)).toEqual(['task-ready'])

    await db.close()
  })
})

describe('TaskRepository.listRunningGateway', () => {
  it('returns only tasks with Codex activity messages in the organization', async () => {
    const db = await createDb()
    const repo = new TaskRepository(db)
    await insertProject(db, 'project-a', 'org-1', 'Alpha')
    await insertProject(db, 'project-b', 'org-1', 'Beta')
    await insertProject(db, 'project-c', 'org-2', 'Other')
    await insertTask(db, 'task-plan', 'project-a', 'Plan task', 20, {
      activityMessages: [
        { id: 'm-1', runId: 'run-1', source: 'gateway-plan', role: 'assistant', status: 'running', body: 'Planning', createdAt: 20 }
      ]
    })
    await insertTask(db, 'task-run', 'project-b', 'Run task', 30, {
      activityMessages: [
        { id: 'm-2', runId: 'run-2', source: 'gateway-run', role: 'thinking', status: 'running', body: 'Running', createdAt: 30 }
      ]
    })
    await insertTask(db, 'task-chat', 'project-b', 'Chat task', 40, {
      activityMessages: [
        { id: 'm-3', runId: 'run-3', source: 'gateway-chat', role: 'thinking', status: 'running', body: 'Chatting', createdAt: 40 }
      ]
    })
    await insertTask(db, 'task-other', 'project-a', 'No codex activity', 50, {
      activityMessages: [
        { id: 'm-4', runId: 'run-4', source: 'comment', role: 'assistant', status: 'completed', body: 'Note', createdAt: 50 }
      ]
    })
    await insertTask(db, 'task-other-org', 'project-c', 'Wrong org', 60, {
      activityMessages: [
        { id: 'm-5', runId: 'run-5', source: 'gateway-run', role: 'thinking', status: 'running', body: 'Other org', createdAt: 60 }
      ]
    })

    const rows = await repo.listRunningGateway('org-1')

    expect(rows.map((row) => row.task.id)).toEqual(['task-chat', 'task-run', 'task-plan'])
    expect(rows[0].project.name).toBe('Beta')
    expect(rows[0].project.id).toBe('project-b')

    await db.close()
  })

  it('can scope running Codex tasks to one project', async () => {
    const db = await createDb()
    const repo = new TaskRepository(db)
    await insertProject(db, 'project-a', 'org-1', 'Alpha')
    await insertProject(db, 'project-b', 'org-1', 'Beta')
    await insertTask(db, 'task-a', 'project-a', 'Alpha run', 10, {
      activityMessages: [
        { id: 'm-1', runId: 'run-a', source: 'gateway-run', role: 'thinking', status: 'running', body: 'Running A', createdAt: 10 }
      ]
    })
    await insertTask(db, 'task-b', 'project-b', 'Beta run', 20, {
      activityMessages: [
        { id: 'm-2', runId: 'run-b', source: 'gateway-run', role: 'thinking', status: 'running', body: 'Running B', createdAt: 20 }
      ]
    })

    const rows = await repo.listRunningGateway('org-1', 'project-a')

    expect(rows.map((row) => row.task.id)).toEqual(['task-a'])

    await db.close()
  })
})
