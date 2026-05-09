import { BaseRepository } from './base-repo.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Session, User } from '../../shared/types/entities.js'

export interface RefreshTokenRecord {
  id: string
  userId: string
  tokenHash: string
  expiresAt: number
  createdAt: number
  revokedAt?: number | null
  replacedByHash?: string | null
}

export class AuthRepository extends BaseRepository<User & { passwordHash: string }> {
  private readonly defaultOrgId = '00000000-0000-4000-8000-000000000001'
  private readonly defaultOrgName = 'Default Organization'
  private readonly defaultPasswordHash = '$2b$12$42NmjQ.8tLD3O5pYRn.acuvLjpnTbPAGLEnzResDNGwU/CuinF8VS'

  private users = this.db.prepare(
    `SELECT id, organization_id, email, name, password_hash, role, created_at FROM users WHERE email = @email`
  )
  private defaultWorkspaceUser = this.db.prepare(
    `SELECT u.id, u.organization_id, u.email, u.name, u.password_hash, u.role, u.created_at
     FROM users u
     LEFT JOIN memberships m ON m.user_id = u.id AND m.organization_id = @orgId
     WHERE u.organization_id = @orgId
     ORDER BY CASE WHEN m.role = 'owner' OR u.role = 'owner' THEN 0 ELSE 1 END, u.created_at ASC
     LIMIT 1`
  )
  private updateUserName = this.db.prepare('UPDATE users SET name = @name WHERE id = @userId')
  private updateUserProfile = this.db.prepare('UPDATE users SET name = @name, email = @email, role = @role WHERE id = @userId')
  private updateUserPasswordHash = this.db.prepare('UPDATE users SET password_hash = @passwordHash WHERE id = @userId')
  private updateMembershipRole = this.db.prepare('UPDATE memberships SET role = @role WHERE organization_id = @orgId AND user_id = @userId')
  private sessionsInsert = this.db.prepare(
    `INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (@id, @userId, @token, @expiresAt, @createdAt)`
  )
  private sessionsByToken = this.db.prepare(`SELECT * FROM sessions WHERE token = @token`)
  private sessionsByUser = this.db.prepare('SELECT * FROM sessions WHERE user_id = @userId')
  private sessionsDeleteByUser = this.db.prepare('DELETE FROM sessions WHERE user_id = @userId')
  private sessionsDeleteByToken = this.db.prepare('DELETE FROM sessions WHERE token = @token')
  private refreshTokensInsert = this.db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (@id, @userId, @tokenHash, @expiresAt, @createdAt)`
  )
  private refreshTokenByHash = this.db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = @tokenHash')
  private refreshTokenRevoke = this.db.prepare(
    'UPDATE refresh_tokens SET revoked_at = @revokedAt, replaced_by_hash = @replacedByHash WHERE token_hash = @tokenHash AND revoked_at IS NULL'
  )
  private refreshTokensDeleteByUser = this.db.prepare('UPDATE refresh_tokens SET revoked_at = @revokedAt WHERE user_id = @userId AND revoked_at IS NULL')
  private findOrganizationById = this.db.prepare('SELECT id, name, created_at FROM organizations WHERE id = @orgId')
  private insertOrganization = this.db.prepare(
    'INSERT OR IGNORE INTO organizations (id, name, created_at) VALUES (@id, @name, @createdAt)'
  )
  private insertUser = this.db.prepare(
    `INSERT OR IGNORE INTO users (id, organization_id, email, name, password_hash, role, created_at)
     VALUES (@id, @organizationId, @email, @name, @passwordHash, @role, @createdAt)`
  )
  private findMembership = this.db.prepare(
    'SELECT id, organization_id, user_id, role FROM memberships WHERE organization_id = @orgId AND user_id = @userId'
  )
  private insertMembership = this.db.prepare(
    'INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role) VALUES (@id, @orgId, @userId, @role)'
  )

  constructor(db: SqliteAdapter) {
    super(db)
  }

  async findByEmail(email: string) {
    return (await this.users.get({ email })) as any | undefined
  }

  async findDefaultWorkspaceUser(): Promise<{ id: string; organization_id: string; email: string; name: string; password_hash: string; role: string } | undefined> {
    return (await this.defaultWorkspaceUser.get({ orgId: this.defaultOrgId })) as
      | { id: string; organization_id: string; email: string; name: string; password_hash: string; role: string }
      | undefined
  }

  async setName(userId: string, name: string): Promise<void> {
    await this.updateUserName.run({ userId, name })
  }

  async setProfile(userId: string, orgId: string, input: { name: string; email: string; role: User['role'] }): Promise<void> {
    await this.updateUserProfile.run({ userId, name: input.name, email: input.email, role: input.role })
    await this.updateMembershipRole.run({ userId, orgId, role: input.role })
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.updateUserPasswordHash.run({ userId, passwordHash })
  }

  async ensureDefaultOwner(email: string): Promise<{ id: string; organization_id: string; email: string; name: string; password_hash: string; role: string } | undefined> {
    const now = Date.now()
    const organizationId = this.defaultOrgId

    const org = await this.findOrganizationById.get({ orgId: organizationId })
    if (!org) {
      await this.insertOrganization.run({
        id: organizationId,
        name: this.defaultOrgName,
        createdAt: now
      })
    }

    let user = await this.findByEmail(email)
    if (!user) {
      const userId = randomUUID()
      await this.insertUser.run({
        id: userId,
        organizationId,
        email,
        name: '',
        passwordHash: this.defaultPasswordHash,
        role: 'owner',
        createdAt: now
      })
      user = await this.findByEmail(email)
    } else if (user.password_hash !== this.defaultPasswordHash) {
      await this.setPasswordHash(user.id, this.defaultPasswordHash)
      user = await this.findByEmail(email)
    }

    if (user) {
      const membership = await this.findMembership.get({
        orgId: organizationId,
        userId: user.id
      })
      if (!membership) {
        await this.insertMembership.run({
          id: randomUUID(),
          orgId: organizationId,
          userId: user.id,
          role: 'owner'
        })
      }
    }

    return user as
      | { id: string; organization_id: string; email: string; name: string; password_hash: string; role: string }
      | undefined
  }

  async createSession(userId: string, ttlMs: number): Promise<Session> {
    const now = Date.now()
    const session: Session = {
      id: randomUUID(),
      userId,
      token: randomUUID(),
      expiresAt: now + ttlMs,
      createdAt: now
    }
    await this.sessionsInsert.run({
      id: session.id,
      userId: session.userId,
      token: session.token,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt
    })
    return session
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  async createRefreshToken(userId: string, ttlMs: number): Promise<{ token: string; expiresAt: number }> {
    const now = Date.now()
    const token = randomBytes(48).toString('base64url')
    const tokenHash = this.hashToken(token)
    const expiresAt = now + ttlMs
    await this.refreshTokensInsert.run({
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: now
    })
    return { token, expiresAt }
  }

  async findRefreshToken(token: string): Promise<RefreshTokenRecord | undefined> {
    const row = (await this.refreshTokenByHash.get({ tokenHash: this.hashToken(token) })) as any
    if (!row) return undefined
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      replacedByHash: row.replaced_by_hash
    }
  }

  async rotateRefreshToken(token: string, nextToken: string): Promise<void> {
    await this.refreshTokenRevoke.run({
      tokenHash: this.hashToken(token),
      revokedAt: Date.now(),
      replacedByHash: this.hashToken(nextToken)
    })
  }

  async findSessionByToken(token: string): Promise<Session | undefined> {
    const row = (await this.sessionsByToken.get({ token })) as any
    if (!row) return undefined
    return {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }
  }

  async findUserById(userId: string): Promise<User | undefined> {
    const row = (await this.db.prepare('SELECT id, organization_id as organizationId, email, name, role FROM users WHERE id = @userId').get({
      userId
    })) as User | undefined
    return row
  }

  async findSessionByUserId(userId: string): Promise<Session | undefined> {
    const row = (await this.sessionsByUser.get({ userId })) as any
    if (!row) return undefined
    return {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }
  }

  async revokeSession(token: string): Promise<void> {
    await this.sessionsDeleteByToken.run({ token })
  }

  async revokeUserSessions(userId: string): Promise<void> {
    await this.sessionsDeleteByUser.run({ userId })
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.refreshTokensDeleteByUser.run({ userId, revokedAt: Date.now() })
  }
}
