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

type LoginAttemptState = {
  count: number
  windowStartedAt: number
}

export class AuthService {
  private readonly bootstrapEmail = 'owner@mission.local'
  private readonly bootstrapPassword = 'changeme'
  private readonly minPasswordLength = 8
  private readonly loginAttemptLimit = 10
  private readonly loginAttemptWindowMs = 15 * 60 * 1000
  private readonly roles: User['role'][] = ['owner', 'admin', 'member']
  private readonly failedLoginAttempts = new Map<string, LoginAttemptState>()
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

  private normalizeEmail(email?: string): string {
    return email?.trim().toLowerCase() ?? ''
  }

  private loginAttemptSource(meta?: Record<string, unknown>): string {
    const source = typeof meta?.clientSource === 'string' ? meta.clientSource.trim() : ''
    if (source) return source
    return meta?.transport === 'http' ? 'http:unknown' : 'ipc:local'
  }

  private loginAttemptKey(email: string, meta?: Record<string, unknown>): string {
    return `${email}|${this.loginAttemptSource(meta)}`
  }

  private isLoginRateLimited(key: string, now = Date.now()): boolean {
    const state = this.failedLoginAttempts.get(key)
    if (!state) return false
    if (now - state.windowStartedAt >= this.loginAttemptWindowMs) {
      this.failedLoginAttempts.delete(key)
      return false
    }
    return state.count >= this.loginAttemptLimit
  }

  private recordFailedLogin(key: string, now = Date.now()): void {
    const state = this.failedLoginAttempts.get(key)
    if (!state || now - state.windowStartedAt >= this.loginAttemptWindowMs) {
      this.failedLoginAttempts.set(key, { count: 1, windowStartedAt: now })
      return
    }
    state.count += 1
  }

  private clearFailedLogin(key: string): void {
    this.failedLoginAttempts.delete(key)
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

  private async issueOwnerDesktopSession(): Promise<ServiceResponse> {
    const userRow = await this.authRepo.findDefaultWorkspaceUser()
      ?? await this.authRepo.findByEmail(this.bootstrapEmail)
      ?? await this.authRepo.ensureDefaultOwner(this.bootstrapEmail)

    if (!userRow) {
      return errorResponse(ErrorCodes.Unauthenticated, 'Desktop session could not be initialized')
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

  async login(payload: { email?: string; password?: string; desktopBootstrap?: boolean }, meta?: Record<string, unknown>): Promise<ServiceResponse> {
    if (payload?.desktopBootstrap === true && meta?.transport === 'ipc') {
      return this.issueOwnerDesktopSession()
    }

    const email = this.normalizeEmail(payload?.email)
    const password = payload?.password ?? ''
    if (!email || !password) {
      return errorResponse(ErrorCodes.Validation, 'Missing credentials')
    }

    const attemptKey = this.loginAttemptKey(email, meta)
    if (this.isLoginRateLimited(attemptKey)) {
      return errorResponse(ErrorCodes.RateLimited, 'Too many failed login attempts. Please try again later.', {
        retryAfterMs: this.loginAttemptWindowMs
      })
    }

    let userRow = await this.authRepo.findByEmail(email)
    if (!userRow && email === this.bootstrapEmail && password === this.bootstrapPassword) {
      userRow = await this.authRepo.ensureDefaultOwner(email)
    }

    if (!userRow) {
      this.recordFailedLogin(attemptKey)
      return errorResponse(ErrorCodes.Unauthenticated, 'Invalid credentials')
    }
    const isLegacyBootstrapHash = userRow.password_hash === 'pbkdf2:sha256:260000$local$changeme'
      && email === this.bootstrapEmail
      && password === this.bootstrapPassword
    const passwordVerification = isLegacyBootstrapHash
      ? { valid: true, needsRehash: true }
      : this.verifyPassword(userRow.password_hash || '', password)
    if (!passwordVerification.valid) {
      this.recordFailedLogin(attemptKey)
      return errorResponse(ErrorCodes.Unauthenticated, 'Invalid credentials')
    }
    this.clearFailedLogin(attemptKey)
    if (passwordVerification.needsRehash) {
      await this.authRepo.setPasswordHash(userRow.id, this.hashBcryptPassword(password))
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
