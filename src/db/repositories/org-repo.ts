import { BaseRepository } from './base-repo.js'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Organization, Membership } from '../../shared/types/entities.js'

export class OrganizationRepository extends BaseRepository<Organization> {
  constructor(db: SqliteAdapter) {
    super(db)
  }

  async get(id: string): Promise<Organization | undefined> {
    const row = (await this.db.prepare('SELECT * FROM organizations WHERE id = @id').get({ id })) as any
    if (!row) return undefined
    return { id: row.id, name: row.name }
  }

  async members(orgId: string): Promise<Membership[]> {
    return (await this.db
      .prepare(
        `SELECT id, organization_id as organizationId, user_id as userId, role FROM memberships WHERE organization_id = @orgId ORDER BY created_at`
      )
      .all({ orgId })) as Membership[]
  }

  createInviteToken(orgId: string, userId: string): { token: string; userId: string } {
    return { token: `${orgId}:${userId}:invite`, userId }
  }
}
