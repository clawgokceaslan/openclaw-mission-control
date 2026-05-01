import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { OpenClawResourceMapping, OpenClawResourceType } from '../../shared/types/entities.js'

type MappingRow = {
  id: string
  organization_id: string
  gateway_id: string
  resource_type: OpenClawResourceType
  local_id: string
  openclaw_id: string
  sync_status: OpenClawResourceMapping['syncStatus']
  content_hash: string | null
  last_synced_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

export class OpenClawResourceMappingRepository extends BaseRepository<OpenClawResourceMapping> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async get(gatewayId: string, resourceType: OpenClawResourceType, localId: string): Promise<OpenClawResourceMapping | undefined> {
    const row = await this.db
      .prepare('SELECT * FROM openclaw_resource_mappings WHERE gateway_id = @gatewayId AND resource_type = @resourceType AND local_id = @localId')
      .get<MappingRow>({ gatewayId, resourceType, localId })
    return row ? this.map(row) : undefined
  }

  async listForGateway(gatewayId: string, resourceType: OpenClawResourceType): Promise<OpenClawResourceMapping[]> {
    const rows = await this.db
      .prepare('SELECT * FROM openclaw_resource_mappings WHERE gateway_id = @gatewayId AND resource_type = @resourceType ORDER BY updated_at DESC')
      .all<MappingRow>({ gatewayId, resourceType })
    return rows.map((row) => this.map(row))
  }

  async ensure(input: {
    organizationId: string
    gatewayId: string
    resourceType: OpenClawResourceType
    localId: string
    openClawId: string
  }): Promise<OpenClawResourceMapping> {
    const current = await this.get(input.gatewayId, input.resourceType, input.localId)
    if (current) return current
    const now = Date.now()
    const row = {
      id: randomUUID(),
      organizationId: input.organizationId,
      gatewayId: input.gatewayId,
      resourceType: input.resourceType,
      localId: input.localId,
      openClawId: input.openClawId,
      syncStatus: 'pending' as const,
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .prepare(
        `INSERT INTO openclaw_resource_mappings
         (id, organization_id, gateway_id, resource_type, local_id, openclaw_id, sync_status, created_at, updated_at)
         VALUES (@id, @organizationId, @gatewayId, @resourceType, @localId, @openClawId, @syncStatus, @createdAt, @updatedAt)`
      )
      .run(row)
    return row
  }

  async markSynced(id: string, contentHash: string): Promise<OpenClawResourceMapping | undefined> {
    const now = Date.now()
    await this.db
      .prepare(
        `UPDATE openclaw_resource_mappings
         SET sync_status = 'synced', content_hash = @contentHash, last_synced_at = @now, last_error = NULL, updated_at = @now
         WHERE id = @id`
      )
      .run({ id, contentHash, now })
    return this.getById(id)
  }

  async markFailed(id: string, error: string): Promise<OpenClawResourceMapping | undefined> {
    const now = Date.now()
    await this.db
      .prepare(
        `UPDATE openclaw_resource_mappings
         SET sync_status = 'failed', last_error = @error, updated_at = @now
         WHERE id = @id`
      )
      .run({ id, error, now })
    return this.getById(id)
  }

  private async getById(id: string): Promise<OpenClawResourceMapping | undefined> {
    const row = await this.db.prepare('SELECT * FROM openclaw_resource_mappings WHERE id = @id').get<MappingRow>({ id })
    return row ? this.map(row) : undefined
  }

  private map(row: MappingRow): OpenClawResourceMapping {
    return {
      id: row.id,
      organizationId: row.organization_id,
      gatewayId: row.gateway_id,
      resourceType: row.resource_type,
      localId: row.local_id,
      openClawId: row.openclaw_id,
      syncStatus: row.sync_status,
      contentHash: row.content_hash ?? undefined,
      lastSyncedAt: row.last_synced_at ?? undefined,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
