import { BaseRepository } from './base-repo.js'
import { randomUUID } from 'node:crypto'
import { SqliteAdapter } from '../adapter/sqlite.js'
import type { Session, User } from '../../shared/types/entities.js'

export class AuthRepository extends BaseRepository<User & { passwordHash: string }> {
  private readonly defaultOrgId = '00000000-0000-4000-8000-000000000001'
  private readonly defaultOrgName = 'Default Organization'
  private readonly defaultPasswordHash = 'pbkdf2:sha256:260000$local$changeme'

  private users = this.db.prepare(
    `SELECT id, organization_id, email, name, password_hash, role, created_at FROM users WHERE email = @email`
  )
  private updateUserName = this.db.prepare('UPDATE users SET name = @name WHERE id = @userId')
  private sessionsInsert = this.db.prepare(
    `INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (@id, @userId, @token, @expiresAt, @createdAt)`
  )
  private sessionsByToken = this.db.prepare(`SELECT * FROM sessions WHERE token = @token`)
  private sessionsByUser = this.db.prepare('SELECT * FROM sessions WHERE user_id = @userId')
  private sessionsDeleteByUser = this.db.prepare('DELETE FROM sessions WHERE user_id = @userId')
  private sessionsDeleteByToken = this.db.prepare('DELETE FROM sessions WHERE token = @token')
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
    'INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role, created_at) VALUES (@id, @orgId, @userId, @role, @createdAt)'
  )

  constructor(db: SqliteAdapter) {
    super(db)
  }

  async findByEmail(email: string) {
    return (await this.users.get({ email })) as any | undefined
  }

  async setName(userId: string, name: string): Promise<void> {
    await this.updateUserName.run({ userId, name })
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
      await this.db.prepare('UPDATE users SET password_hash = @passwordHash WHERE id = @userId').run({
        passwordHash: this.defaultPasswordHash,
        userId: user.id
      })
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
          role: 'owner',
          createdAt: now
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
}
