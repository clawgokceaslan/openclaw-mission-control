import EventEmitter from 'node:events'
import { timingSafeEqual, pbkdf2Sync } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors/index.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Session, User } from '../../shared/types/entities.js'
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from '../../shared/constants/config.js'
import { AuthRepository } from '../../db/repositories/auth-repo.js'

interface AuthTokenPair {
  session: Session
  refreshToken: string
  refreshTokenExpiresAt: number
}

type PasswordVerification = {
  valid: boolean
  needsRehash: boolean
}

export class AuthService {
  private readonly bootstrapEmail = 'owner@mission.local'
  private readonly bootstrapPassword = 'changeme'
  private readonly minPasswordLength = 8
  private readonly roles: User['role'][] = ['owner', 'admin', 'member']
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly eventBus?: EventEmitter
  ) {}

  private mapUser(row: { id: string; organization_id?: string; organizationId?: string; email: string; name?: string | null; role: string }): User {
    return {
      id: row.id,
      organizationId: row.organization_id ?? row.organizationId,
      email: row.email,
      name: row.name ?? undefined,
      role: row.role as User['role'],
      // placeholder role normalization
    } as User
  }

  private hashBcryptPassword(password: string): string {
    return bcrypt.hashSync(password, 12)
  }

  private verifyPassword(storedHash: string, password: string): PasswordVerification {
    if (!password || !storedHash) return { valid: false, needsRehash: false }
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
      return { valid: bcrypt.compareSync(password, storedHash), needsRehash: false }
    }
    if (!storedHash.startsWith('pbkdf2:')) {
      const expected = Buffer.from(storedHash)
      const candidate = Buffer.from(password)
      return {
        valid: expected.length === candidate.length && timingSafeEqual(expected, candidate),
        needsRehash: true
      }
    }
    const [algorithmPart, salt, digest] = storedHash.split('$')
    const [, algorithm, iterationsRaw] = algorithmPart.split(':')
    const iterations = Number(iterationsRaw)
    if (algorithm !== 'sha256' || !salt || !digest || !Number.isFinite(iterations)) {
      return { valid: false, needsRehash: false }
    }
    const candidate = pbkdf2Sync(password, salt, iterations, Buffer.from(digest, 'hex').length, 'sha256')
    const expected = Buffer.from(digest, 'hex')
    return {
      valid: candidate.length === expected.length && timingSafeEqual(candidate, expected),
      needsRehash: true
    }
  }

  private validateNewPassword(password?: string, confirmation?: string): string | undefined {
    if (!password?.trim() || !confirmation?.trim()) return 'New password and confirmation are required'
    if (password.length < this.minPasswordLength) return `Password must be at least ${this.minPasswordLength} characters`
    if (password !== confirmation) return 'Password confirmation does not match'
    return undefined
  }

  private async issueTokens(userId: string): Promise<AuthTokenPair> {
    const session = await this.authRepo.createSession(userId, ACCESS_TOKEN_TTL_MS)
    const refresh = await this.authRepo.createRefreshToken(userId, REFRESH_TOKEN_TTL_MS)
    return {
      session,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt
    }
  }

  async getSessionActor(token?: string): Promise<{ session: Session; user: User } | undefined> {
    if (!token) return undefined
    const session = await this.authRepo.findSessionByToken(token)
    if (!session) return undefined
    if (session.expiresAt <= Date.now()) {
      await this.authRepo.revokeSession(token)
      return undefined
    }
    const row = await this.authRepo.findUserById(session.userId)
    if (!row) return undefined
    const user = this.mapUser({
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      name: row.name,
      role: row.role
    })
    return { session, user }
  }

  async requireActor(token?: string): Promise<{ session: Session; user: User }> {
    const actor = await this.getSessionActor(token)
    if (!actor) {
      throw new AppError(ErrorCodes.Unauthenticated, 'No active session')
    }
    return actor
  }

  async login(payload: { email?: string; password?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    if (!payload?.email || !payload?.password) {
      return errorResponse(ErrorCodes.Validation, 'Missing credentials')
    }

    let userRow = await this.authRepo.findByEmail(payload.email)
    if (!userRow && payload.email === this.bootstrapEmail && payload.password === this.bootstrapPassword) {
      userRow = await this.authRepo.ensureDefaultOwner(payload.email)
    }

    if (!userRow) {
      return errorResponse(ErrorCodes.Unauthenticated, 'Invalid credentials')
    }
    const isLegacyBootstrapHash = userRow.password_hash === 'pbkdf2:sha256:260000$local$changeme'
      && payload.email === this.bootstrapEmail
      && payload.password === this.bootstrapPassword
    const passwordVerification = isLegacyBootstrapHash
      ? { valid: true, needsRehash: true }
      : this.verifyPassword(userRow.password_hash || '', payload.password)
    if (!passwordVerification.valid) {
      return errorResponse(ErrorCodes.Unauthenticated, 'Invalid credentials')
    }
    if (passwordVerification.needsRehash) {
      await this.authRepo.setPasswordHash(userRow.id, this.hashBcryptPassword(payload.password))
    }
    const tokens = await this.issueTokens(userRow.id)
    const user = this.mapUser({
      id: userRow.id,
      organizationId: userRow.organization_id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role
    })
    const response = { session: tokens.session, refreshToken: tokens.refreshToken, refreshTokenExpiresAt: tokens.refreshTokenExpiresAt, user }
    if (this.eventBus) {
      this.eventBus.emit('auth:session-established', { userId: user.id })
    }
    return okResponse(response, { requestId: undefined })
  }

  async refresh(payload: { refreshToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const token = payload?.refreshToken?.trim()
    if (!token) return errorResponse(ErrorCodes.Unauthenticated, 'Refresh token required')
    const stored = await this.authRepo.findRefreshToken(token)
    if (!stored || stored.revokedAt || stored.expiresAt <= Date.now()) {
      return errorResponse(ErrorCodes.Unauthenticated, 'Refresh token is invalid')
    }
    const row = await this.authRepo.findUserById(stored.userId)
    if (!row) return errorResponse(ErrorCodes.Unauthenticated, 'Refresh token user is invalid')

    const next = await this.issueTokens(stored.userId)
    await this.authRepo.rotateRefreshToken(token, next.refreshToken)
    const user = this.mapUser({
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      name: row.name,
      role: row.role
    })
    return okResponse({ session: next.session, refreshToken: next.refreshToken, refreshTokenExpiresAt: next.refreshTokenExpiresAt, user })
  }

  async me(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const actor = await this.getSessionActor(payload?.actorToken)
    if (!actor) return errorResponse(ErrorCodes.Unauthenticated, 'No active session')
    return okResponse({ session: actor.session, user: actor.user })
  }

  async logout(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    if (payload?.actorToken) {
      const actor = await this.getSessionActor(payload.actorToken)
      await this.authRepo.revokeSession(payload.actorToken)
      if (actor) await this.authRepo.revokeUserRefreshTokens(actor.user.id)
    }
    return okResponse({ ok: true })
  }

  async updateProfile(
    payload: { actorToken?: string; firstName?: string; lastName?: string; email?: string; role?: User['role'] },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse> {
    const actor = await this.requireActor(payload?.actorToken)
    if (!payload?.firstName?.trim() || !payload.lastName?.trim()) {
      return errorResponse(ErrorCodes.Validation, 'First and last name required')
    }
    const email = (payload.email ?? actor.user.email).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse(ErrorCodes.Validation, 'Valid email required')
    }
    const existing = await this.authRepo.findByEmail(email)
    if (existing && existing.id !== actor.user.id) {
      return errorResponse(ErrorCodes.Validation, 'Email is already in use')
    }
    const role = payload.role ?? actor.user.role
    if (!this.roles.includes(role)) {
      return errorResponse(ErrorCodes.Validation, 'Invalid title')
    }

    const name = `${payload.firstName.trim()} ${payload.lastName.trim()}`
    await this.authRepo.setProfile(actor.user.id, actor.user.organizationId, { name, email, role })

    return okResponse({
      ...actor,
      user: {
        ...actor.user,
        name,
        email,
        role
      }
    })
  }

  async changePassword(
    payload: { actorToken?: string; newPassword?: string; confirmPassword?: string },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse> {
    const actor = await this.requireActor(payload?.actorToken)
    const validationError = this.validateNewPassword(payload?.newPassword, payload?.confirmPassword)
    if (validationError) return errorResponse(ErrorCodes.Validation, validationError)

    await this.authRepo.setPasswordHash(actor.user.id, this.hashBcryptPassword(payload.newPassword as string))
    return okResponse({ ok: true })
  }

  async inviteValidate(payload: { inviteToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    if (!payload?.inviteToken || payload.inviteToken.length < 4) {
      return errorResponse(ErrorCodes.Validation, 'Invalid invite token')
    }
    return okResponse({ valid: true })
  }
}
