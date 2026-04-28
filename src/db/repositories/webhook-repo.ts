import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Webhook } from '../../shared/types/entities.js'

export class WebhookRepository extends BaseRepository<Webhook> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Webhook[]> {
    const rows = await this.db.prepare('SELECT * FROM webhooks WHERE organization_id = @orgId ORDER BY created_at DESC').all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<Webhook | undefined> {
    const row = (await this.db.prepare('SELECT * FROM webhooks WHERE id = @id').get({ id })) as any
    if (!row) return undefined
    return this.map(row)
  }

  async create(input: Omit<Webhook, 'id'>): Promise<Webhook> {
    const now = Date.now()
    const row: Webhook = {
      id: randomUUID(),
      organizationId: input.organizationId,
      url: input.url,
      active: input.active,
      secret: input.secret,
      eventTypes: input.eventTypes,
      failureCount: input.failureCount
    }
    await this.db
      .prepare(
        `INSERT INTO webhooks (id, organization_id, url, active, secret, event_types_json, failure_count, created_at, updated_at)
         VALUES (@id, @organizationId, @url, @active, @secret, @eventTypesJson, @failureCount, @createdAt, @updatedAt)`
      )
      .run({
        id: row.id,
        organizationId: row.organizationId,
        url: row.url,
        active: row.active ? 1 : 0,
        secret: row.secret,
        eventTypesJson: this.toJson(row.eventTypes),
        failureCount: row.failureCount,
        createdAt: now,
        updatedAt: now
      })
    return row
  }

  async update(id: string, patch: Partial<Webhook>): Promise<Webhook | undefined> {
    const current = (await this.db.prepare('SELECT * FROM webhooks WHERE id = @id').get({ id })) as any
    if (!current) return undefined
    const next: Webhook = { ...this.map(current), ...patch }
    await this.db
      .prepare('UPDATE webhooks SET url=@url, active=@active, secret=@secret, event_types_json=@eventTypesJson, failure_count=@failureCount, updated_at=@updatedAt WHERE id=@id')
      .run({
        id,
        url: next.url,
        active: next.active ? 1 : 0,
        secret: next.secret,
        eventTypesJson: this.toJson(next.eventTypes),
        failureCount: next.failureCount,
        updatedAt: Date.now()
      })
    return next
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM webhooks WHERE id = @id').run({ id })
  }

  async enqueueDelivery(payload: {
    webhookId: string
    eventType: string
    body: Record<string, unknown>
  }): Promise<void> {
    const now = Date.now()
    await this.db
      .prepare(
        `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload_json, status, attempts, created_at)
         VALUES (@id, @webhookId, @eventType, @payloadJson, @status, 0, @createdAt)`
      )
      .run({
        id: randomUUID(),
        webhookId: payload.webhookId,
        eventType: payload.eventType,
        payloadJson: this.toJson(payload.body),
        status: 'pending',
        createdAt: now
      })
  }

  private map(row: any): Webhook {
    return {
      id: row.id,
      organizationId: row.organization_id,
      url: row.url,
      active: Boolean(row.active),
      secret: row.secret,
      eventTypes: this.parseJson<string[]>(row.event_types_json) ?? [],
      failureCount: row.failure_count
    }
  }
}
