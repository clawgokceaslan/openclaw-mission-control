import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Gateway, GatewaySession, GatewayCommand, GatewayHistoryItem } from '../../shared/types/entities.js'

export class GatewayRepository extends BaseRepository<Gateway> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async list(orgId: string): Promise<Gateway[]> {
    const rows = await this.db
      .prepare('SELECT * FROM gateways WHERE organization_id = @orgId ORDER BY created_at DESC')
      .all({ orgId })
    return rows.map((row: any) => this.map(row))
  }

  async listAutoConnect(): Promise<Gateway[]> {
    const rows = await this.db
      .prepare("SELECT * FROM gateways WHERE json_extract(template_json, '$.provider') = 'openclaw' AND json_extract(template_json, '$.autoConnect') = 1")
      .all()
    return rows.map((row: any) => this.map(row))
  }

  async get(id: string): Promise<Gateway | undefined> {
    const row = (await this.db.prepare('SELECT * FROM gateways WHERE id = @id').get({ id })) as any
    return row ? this.map(row) : undefined
  }

  async create(input: Omit<Gateway, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<Gateway> {
    const now = Date.now()
    const row: Gateway = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      endpoint: input.endpoint,
      token: input.token,
      status: 'offline',
      template: input.template,
      createdAt: now,
      updatedAt: now
    }
    await this.db.prepare(
      `INSERT INTO gateways (id, organization_id, name, endpoint, token, status, template_json, created_at, updated_at)
       VALUES (@id, @organizationId, @name, @endpoint, @token, @status, @templateJson, @createdAt, @updatedAt)`
    ).run({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      endpoint: row.endpoint,
      token: row.token,
      status: row.status,
      templateJson: this.toJson(row.template),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })

    await this.db
      .prepare(
        `INSERT INTO gateway_sessions (id, gateway_id, status, state_json, last_seen_at, backoff_ms, metadata_json, created_at, updated_at)
         VALUES (@id, @gatewayId, @status, @stateJson, @lastSeenAt, @backoffMs, @metadataJson, @createdAt, @updatedAt)`
      )
      .run({
        id: randomUUID(),
        gatewayId: row.id,
        status: 'disconnected',
        stateJson: null,
        lastSeenAt: now,
        backoffMs: 1000,
        metadataJson: this.toJson({ init: true }),
        createdAt: now,
        updatedAt: now
      })

    return row
  }

  async update(
    id: string,
    input: Partial<Pick<Gateway, 'name' | 'endpoint' | 'token' | 'status' | 'template'>>
  ): Promise<Gateway | undefined> {
    const current = await this.get(id)
    if (!current) return undefined
    const next = {
      name: input.name ?? current.name,
      endpoint: input.endpoint ?? current.endpoint,
      token: input.token ?? current.token,
      status: input.status ?? current.status,
      template: input.template ?? current.template,
      updatedAt: Date.now()
    }
    await this.db
      .prepare(
        `UPDATE gateways
         SET name=@name, endpoint=@endpoint, token=@token, status=@status, template_json=@templateJson, updated_at=@updatedAt
         WHERE id=@id`
      )
      .run({
        id,
        name: next.name,
        endpoint: next.endpoint,
        token: next.token,
        status: next.status,
        templateJson: this.toJson(next.template),
        updatedAt: next.updatedAt
      })
    return this.get(id)
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM gateway_history WHERE gateway_id = @id').run({ id })
    await this.db.prepare('DELETE FROM gateway_commands WHERE gateway_id = @id').run({ id })
    await this.db.prepare('DELETE FROM gateway_sessions WHERE gateway_id = @id').run({ id })
    await this.db.prepare('DELETE FROM gateways WHERE id = @id').run({ id })
  }

  async sessions(gatewayId: string) {
    const rows = await this.db
      .prepare('SELECT * FROM gateway_sessions WHERE gateway_id = @gatewayId ORDER BY updated_at DESC')
      .all({ gatewayId })
    return rows.map((row: any) => ({
      id: row.id,
      gatewayId: row.gateway_id,
      status: row.status,
      state: this.parseJson<Record<string, unknown>>(row.state_json),
      lastSeenAt: row.last_seen_at,
      backoffMs: row.backoff_ms
    }))
  }

  async commands(gatewayId: string): Promise<GatewayCommand[]> {
    const rows = await this.db
      .prepare('SELECT * FROM gateway_commands WHERE gateway_id = @gatewayId ORDER BY created_at DESC LIMIT 200')
      .all({ gatewayId })
    return rows.map((row: any) => ({
      id: row.id,
      gatewayId: row.gateway_id,
      requestId: row.request_id,
      command: row.command,
      payload: this.parseJson<Record<string, unknown>>(row.payload_json) || {},
      result: this.parseJson<Record<string, unknown>>(row.result_json) || undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  async history(gatewayId: string): Promise<GatewayHistoryItem[]> {
    const rows = await this.db
      .prepare('SELECT * FROM gateway_history WHERE gateway_id = @gatewayId ORDER BY created_at DESC LIMIT 300')
      .all({ gatewayId })
    return rows.map((row: any) => ({
      id: row.id,
      gatewayId: row.gateway_id,
      eventType: row.event_type,
      payload: this.parseJson<Record<string, unknown>>(row.payload_json),
      createdAt: row.created_at
    }))
  }

  async appendHistory(gatewayId: string, eventType: string, payload?: Record<string, unknown>): Promise<GatewayHistoryItem> {
    const row = {
      id: randomUUID(),
      gatewayId,
      eventType,
      payload,
      createdAt: Date.now()
    }
    await this.db
      .prepare(
        'INSERT INTO gateway_history (id, gateway_id, event_type, payload_json, created_at) VALUES (@id,@gatewayId,@eventType,@payloadJson,@createdAt)'
      )
      .run({
        id: row.id,
        gatewayId,
        eventType,
        payloadJson: this.toJson(payload),
        createdAt: row.createdAt
      })
    return row
  }

  async setSessionState(
    gatewayId: string,
    status: GatewaySession['status'],
    state?: Record<string, unknown>,
    backoffMs?: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now()
    const existing = (await this.db
      .prepare('SELECT id FROM gateway_sessions WHERE gateway_id = @gatewayId ORDER BY updated_at DESC LIMIT 1')
      .get({ gatewayId })) as { id: string } | undefined
    if (existing) {
      await this.db
        .prepare(
          `UPDATE gateway_sessions
           SET status=@status, state_json=@stateJson, last_seen_at=@lastSeenAt, backoff_ms=@backoffMs, metadata_json=@metadataJson, updated_at=@updatedAt
           WHERE id=@id`
        )
        .run({
          id: existing.id,
          status,
          stateJson: this.toJson(state),
          lastSeenAt: now,
          backoffMs: backoffMs ?? null,
          metadataJson: this.toJson(metadata),
          updatedAt: now
        })
      return
    }
    await this.db
      .prepare(
        `INSERT INTO gateway_sessions (id, gateway_id, status, state_json, last_seen_at, backoff_ms, metadata_json, created_at, updated_at)
         VALUES (@id, @gatewayId, @status, @stateJson, @lastSeenAt, @backoffMs, @metadataJson, @createdAt, @updatedAt)`
      )
      .run({
        id: randomUUID(),
        gatewayId,
        status,
        stateJson: this.toJson(state),
        lastSeenAt: now,
        backoffMs: backoffMs ?? null,
        metadataJson: this.toJson(metadata),
        createdAt: now,
        updatedAt: now
      })
  }

  async queueCommand(input: {
    gatewayId: string
    requestId: string
    command: string
    payload?: Record<string, unknown>
  }): Promise<GatewayCommand> {
    const now = Date.now()
    const row = {
      id: randomUUID(),
      gatewayId: input.gatewayId,
      requestId: input.requestId,
      command: input.command,
      payload: input.payload,
      status: 'queued' as const,
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO gateway_commands (id, gateway_id, request_id, command, payload_json, status, result_json, created_at, updated_at)
         VALUES (@id, @gatewayId, @requestId, @command, @payloadJson, @status, NULL, @createdAt, @updatedAt)`
      )
      .run({
        id: row.id,
        gatewayId: row.gatewayId,
        requestId: row.requestId,
        command: row.command,
        payloadJson: this.toJson(row.payload),
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      })
    return row
  }

  async setCommandCompleted(
    id: string,
    status: GatewayCommand['status'],
    result?: Record<string, unknown>
  ): Promise<GatewayCommand> {
    const now = Date.now()
    await this.db
      .prepare('UPDATE gateway_commands SET status=@status, result_json=@resultJson, updated_at=@updatedAt WHERE id=@id')
      .run({ id, status, resultJson: this.toJson(result), updatedAt: now })
    const row = (await this.db.prepare('SELECT * FROM gateway_commands WHERE id = @id').get({ id })) as any
    return {
      id: row.id,
      gatewayId: row.gateway_id,
      requestId: row.request_id,
      command: row.command,
      payload: this.parseJson<Record<string, unknown>>(row.payload_json) || {},
      result: this.parseJson<Record<string, unknown>>(row.result_json) || undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  async setCommandStatus(
    id: string,
    status: GatewayCommand['status'],
    result?: Record<string, unknown>
  ): Promise<GatewayCommand> {
    return this.setCommandCompleted(id, status, result)
  }

  async setGatewayStatus(id: string, status: Gateway['status']) {
    const now = Date.now()
    await this.db.prepare('UPDATE gateways SET status=@status, updated_at=@updatedAt WHERE id=@id').run({
      id,
      status,
      updatedAt: now
    })
    await this.db
      .prepare('UPDATE gateway_sessions SET status=@status, last_seen_at=@lastSeenAt, updated_at=@updatedAt WHERE gateway_id=@id')
      .run({
        status: status === 'online' ? 'connected' : status === 'connecting' ? 'reconnecting' : 'disconnected',
        lastSeenAt: now,
        updatedAt: now,
        id
      })

    await this.appendHistory(id, 'gateway.status', { status })
  }

  async listWithSessions(orgId: string): Promise<Array<Gateway & { sessions: GatewaySession[] }>> {
    const rows = await this.list(orgId)
    const withSessions = await Promise.all(
      rows.map(async (gw) => ({ ...gw, sessions: await this.sessions(gw.id) as GatewaySession[] }))
    )
    return withSessions
  }

  private map(row: any): Gateway {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      endpoint: row.endpoint,
      token: row.token,
      status: row.status,
      template: this.parseJson<Record<string, unknown>>(row.template_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
