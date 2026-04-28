import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Job } from '../../shared/types/entities.js'

export class JobRepository extends BaseRepository<Job> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(status?: string): Promise<Job[]> {
    if (status) {
      const rows = await this.db.prepare('SELECT * FROM jobs WHERE status = @status ORDER BY next_run_at').all({ status })
      return rows.map((row: any) => this.map(row))
    }
    const rows = await this.db.prepare('SELECT * FROM jobs ORDER BY next_run_at').all()
    return rows.map((row: any) => this.map(row))
  }

  async create(job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Promise<Job> {
    const now = Date.now()
    const row: Job = {
      id: randomUUID(),
      ...job,
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO jobs (id, type, payload_json, status, attempts, max_attempts, next_run_at, error, created_at, updated_at)
         VALUES (@id, @type, @payloadJson, @status, @attempts, @maxAttempts, @nextRunAt, @error, @createdAt, @updatedAt)`
      )
      .run({
        id: row.id,
        type: row.type,
        payloadJson: this.toJson(row.payload),
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        nextRunAt: row.nextRunAt,
        error: null,
        createdAt: now,
        updatedAt: now
      })
    return row
  }

  async listDue(beforeTs: number): Promise<Job[]> {
    const rows = await this.db
      .prepare('SELECT * FROM jobs WHERE status = @status AND next_run_at <= @beforeTs ORDER BY next_run_at ASC')
      .all({ status: 'pending', beforeTs })
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<Job | undefined> {
    const row = (await this.db.prepare('SELECT * FROM jobs WHERE id = @id').get({ id })) as any
    return row ? this.map(row) : undefined
  }

  async markRunning(id: string): Promise<void> {
    const now = Date.now()
    await this.db
      .prepare('UPDATE jobs SET status = @status, updated_at = @updatedAt WHERE id = @id')
      .run({ id, status: 'running', updatedAt: now })
  }

  async markDone(id: string): Promise<void> {
    const now = Date.now()
    await this.db.prepare('UPDATE jobs SET status = @status, attempts = attempts + 1, updated_at = @updatedAt WHERE id=@id').run({
      id,
      status: 'done',
      updatedAt: now
    })
  }

  async markFailed(
    id: string,
    errorMessage: string,
    nextRunAt: number,
    retryable = true
  ): Promise<{ status: 'pending' | 'running' | 'done' | 'failed' | 'dead'; attempts: number; maxAttempts: number }> {
    const now = Date.now()
    const row = (await this.db.prepare('SELECT attempts, max_attempts, status FROM jobs WHERE id = @id').get({ id })) as any
    const attempts = (row?.attempts ?? 0) + 1
    const maxAttempts = row?.max_attempts ?? 5
    const status = !retryable || attempts >= maxAttempts ? 'dead' : 'pending'
    await this.db
      .prepare(
        `UPDATE jobs
           SET status=@status,
               attempts=@attempts,
               next_run_at=@nextRunAt,
               error=@error,
               updated_at=@updatedAt
         WHERE id=@id`
      )
      .run({ id, status, attempts, nextRunAt, error: errorMessage, updatedAt: now })

    return {
      status,
      attempts,
      maxAttempts
    }
  }

  async markRetryScheduled(id: string, nextRunAt: number): Promise<void> {
    await this.db
      .prepare('UPDATE jobs SET status=@status, next_run_at=@nextRunAt, updated_at=@updatedAt WHERE id=@id')
      .run({ id, status: 'pending', nextRunAt, updatedAt: Date.now() })
  }

  map(row: any): Job {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextRunAt: row.next_run_at,
      payload: this.parseJson<Record<string, unknown>>(row.payload_json) || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
