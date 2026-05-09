import EventEmitter from 'node:events'
import { randomUUID, timingSafeEqual, pbkdf2Sync } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors/index.js'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Session, User } from '../../shared/types/entities.js'
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from '../../shared/constants/config.js'
import { AuthRepository } from '../../db/repositories/auth-repo.js'
import { electronRuntime } from '../utils/electron-runtime.js'
import { desktopRefreshTokenStore } from './desktop-refresh-token-store.js'

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

type UserRow = {
  id: string
  organization_id?: string
  organizationId?: string
  email: string
  name?: string | null
  role: string
  avatar_path?: string | null
  avatarPath?: string | null
}

export interface ActiveAvatarFile {
  path: string
  mimeType: string
  etag: string
  size: number
  mtimeMs: number
  stream: ReturnType<typeof createReadStream>
}

const PROFILE_AVATAR_ROUTE = '/api/profile/avatar'
const AVATAR_DIRECTORY_NAME = 'profile-avatars'
const AVATAR_MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
])

export class AuthService {
  private readonly minPasswordLength = 8
  private readonly loginAttemptLimit = 10
  private readonly loginAttemptWindowMs = 15 * 60 * 1000
  private readonly roles: User['role'][] = ['owner', 'admin', 'member']
  private readonly failedLoginAttempts = new Map<string, LoginAttemptState>()
  private activeUserId: string | null = null
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly eventBus?: EventEmitter
  ) {}

  private mapUser(row: UserRow): User {
    const avatarVersion = this.avatarVersion(row.avatar_path ?? row.avatarPath ?? null)
    return {
      id: row.id,
      organizationId: row.organization_id ?? row.organizationId,
      email: row.email,
      name: row.name ?? undefined,
      role: row.role as User['role'],
      avatarUrl: avatarVersion ? `${PROFILE_AVATAR_ROUTE}?v=${encodeURIComponent(avatarVersion)}` : null
      // placeholder role normalization
    } as User
  }

  private markActiveUser(userId: string): void {
    this.activeUserId = userId
  }

  private avatarRoot(): string {
    const userData = electronRuntime.app?.getPath('userData') ?? process.cwd()
    return join(userData, AVATAR_DIRECTORY_NAME)
  }

  private userAvatarDirectory(userId: string): string {
    return join(this.avatarRoot(), userId)
  }

  private safeAvatarPath(userId: string, filename: string): string {
    const root = resolve(this.userAvatarDirectory(userId))
    const filePath = resolve(root, basename(filename))
    if (!filePath.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new AppError(ErrorCodes.Validation, 'Invalid avatar path')
    }
    return filePath
  }

  private avatarVersion(avatarPath: string | null): string | null {
    if (!avatarPath) return null
    return basename(avatarPath).replace(/[^a-zA-Z0-9._-]/g, '')
  }

  private parseAvatarDataUrl(dataUrl?: string): { buffer: Buffer; extension: string } | string {
    const value = dataUrl?.trim() ?? ''
    const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/i.exec(value)
    if (!match) return 'Avatar must be a PNG, JPG, WEBP, or GIF data URL'
    const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
    const extension = mimeType === 'image/jpeg' ? '.jpg' : `.${mimeType.split('/')[1]}`
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length === 0) return 'Avatar image is empty'
    if (buffer.length > 5 * 1024 * 1024) return 'Avatar image must be 5 MB or smaller'
    return { buffer, extension }
  }

  private async removeStoredAvatar(avatarPath?: string | null): Promise<void> {
    if (!avatarPath) return
    const resolvedPath = resolve(avatarPath)
    const root = resolve(this.avatarRoot())
    if (!resolvedPath.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) return
    await rm(resolvedPath, { force: true }).catch(() => undefined)
    await rm(dirname(resolvedPath), { force: true, recursive: false }).catch(() => undefined)
  }

  private async getStoredAvatarFile(userId: string | null): Promise<ActiveAvatarFile | null> {
    if (!userId) return null
    const row = await this.authRepo.findUserById(userId)
    const avatarPath = row && 'avatarPath' in row ? row.avatarPath : null
    if (!avatarPath) return null

    const extension = extname(avatarPath).toLowerCase()
    const mimeType = AVATAR_MIME_BY_EXTENSION.get(extension)
    if (!mimeType) return null

    const expectedPath = this.safeAvatarPath(row.id, basename(avatarPath))
    if (resolve(avatarPath) !== expectedPath) return null

    try {
      const fileStat = await stat(expectedPath)
      if (!fileStat.isFile()) return null
      return {
        path: expectedPath,
        mimeType,
        etag: `"${basename(expectedPath)}-${fileStat.size}-${Math.floor(fileStat.mtimeMs)}"`,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        stream: createReadStream(expectedPath)
      }
    } catch {
      return null
    }
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

  private isDesktopMeta(meta?: Record<string, unknown>): boolean {
    return meta?.transport === 'ipc'
  }

  private async persistDesktopRefreshToken(token: string, meta?: Record<string, unknown>): Promise<void> {
    if (this.isDesktopMeta(meta)) await desktopRefreshTokenStore.set(token)
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
      role: row.role,
      avatarPath: row.avatarPath
    })
    this.markActiveUser(user.id)
    return { session, user }
  }

  async requireActor(token?: string): Promise<{ session: Session; user: User }> {
    const actor = await this.getSessionActor(token)
    if (!actor) {
      throw new AppError(ErrorCodes.Unauthenticated, 'No active session')
    }
    return actor
  }

  async createDesktopSession(): Promise<ServiceResponse> {
    const storedRefreshToken = await desktopRefreshTokenStore.get()
    if (storedRefreshToken) {
      const refreshed = await this.refresh({ refreshToken: storedRefreshToken }, { transport: 'ipc' })
      if (refreshed.ok) return refreshed
      await desktopRefreshTokenStore.clear()
    }

    const userRow = await this.authRepo.findDefaultWorkspaceUser()
      ?? await this.authRepo.ensureLocalUser()

    if (!userRow) {
      return errorResponse(ErrorCodes.Unauthenticated, 'Local desktop session could not be initialized')
    }

    const tokens = await this.issueTokens(userRow.id)
    const user = this.mapUser({
      id: userRow.id,
      organizationId: userRow.organization_id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
      avatar_path: userRow.avatar_path
    })
    this.markActiveUser(user.id)
    const response = { session: tokens.session, refreshToken: tokens.refreshToken, refreshTokenExpiresAt: tokens.refreshTokenExpiresAt, user }
    await desktopRefreshTokenStore.set(tokens.refreshToken)
    if (this.eventBus) {
      this.eventBus.emit('auth:session-established', { userId: user.id })
    }
    return okResponse(response, { requestId: undefined })
  }

  async login(payload: { email?: string; password?: string }, meta?: Record<string, unknown>): Promise<ServiceResponse> {
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

    const userRow = await this.authRepo.findByEmail(email)

    if (!userRow) {
      this.recordFailedLogin(attemptKey)
      return errorResponse(ErrorCodes.Unauthenticated, 'Invalid credentials')
    }
    const passwordVerification = this.verifyPassword(userRow.password_hash || '', password)
    if (!passwordVerification.valid) {
      this.recordFailedLogin(attemptKey)
      return errorResponse(ErrorCodes.Unauthenticated, 'Invalid credentials')
    }
    this.clearFailedLogin(attemptKey)
    if (passwordVerification.needsRehash) {
      await this.authRepo.setPasswordHash(userRow.id, this.hashBcryptPassword(password))
    }
    const tokens = await this.issueTokens(userRow.id)
    await this.persistDesktopRefreshToken(tokens.refreshToken, meta)
    const user = this.mapUser({
      id: userRow.id,
      organizationId: userRow.organization_id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
      avatar_path: userRow.avatar_path
    })
    this.markActiveUser(user.id)
    const response = { session: tokens.session, refreshToken: tokens.refreshToken, refreshTokenExpiresAt: tokens.refreshTokenExpiresAt, user }
    if (this.eventBus) {
      this.eventBus.emit('auth:session-established', { userId: user.id })
    }
    return okResponse(response, { requestId: undefined })
  }

  async refresh(payload: { refreshToken?: string }, meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const token = payload?.refreshToken?.trim() || (this.isDesktopMeta(meta) ? await desktopRefreshTokenStore.get() : null)
    if (!token) return errorResponse(ErrorCodes.Unauthenticated, 'Refresh token required')
    const stored = await this.authRepo.findRefreshToken(token)
    if (!stored || stored.revokedAt || stored.expiresAt <= Date.now()) {
      if (this.isDesktopMeta(meta)) await desktopRefreshTokenStore.clear()
      return errorResponse(ErrorCodes.Unauthenticated, 'Refresh token is invalid')
    }
    const row = await this.authRepo.findUserById(stored.userId)
    if (!row) return errorResponse(ErrorCodes.Unauthenticated, 'Refresh token user is invalid')

    const nextRefresh = await this.authRepo.rotateRefreshToken(token, stored.userId, REFRESH_TOKEN_TTL_MS)
    if (!nextRefresh) {
      if (this.isDesktopMeta(meta)) await desktopRefreshTokenStore.clear()
      return errorResponse(ErrorCodes.Unauthenticated, 'Refresh token is invalid')
    }
    const session = await this.authRepo.createSession(stored.userId, ACCESS_TOKEN_TTL_MS)
    const next = {
      session,
      refreshToken: nextRefresh.token,
      refreshTokenExpiresAt: nextRefresh.expiresAt
    }
    await this.persistDesktopRefreshToken(next.refreshToken, meta)
    const user = this.mapUser({
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      name: row.name,
      role: row.role,
      avatarPath: row.avatarPath
    })
    this.markActiveUser(user.id)
    return okResponse({ session: next.session, refreshToken: next.refreshToken, refreshTokenExpiresAt: next.refreshTokenExpiresAt, user })
  }

  async me(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const actor = await this.getSessionActor(payload?.actorToken)
    if (!actor) return errorResponse(ErrorCodes.Unauthenticated, 'No active session')
    this.markActiveUser(actor.user.id)
    return okResponse({ session: actor.session, user: actor.user })
  }

  async logout(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    if (payload?.actorToken) {
      const actor = await this.getSessionActor(payload.actorToken)
      await this.authRepo.revokeSession(payload.actorToken)
      if (actor) await this.authRepo.revokeUserRefreshTokens(actor.user.id)
    }
    if (this.isDesktopMeta(_meta)) await desktopRefreshTokenStore.clear()
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

  async updateAvatar(
    payload: { actorToken?: string; dataUrl?: string },
    _meta?: Record<string, unknown>
  ): Promise<ServiceResponse> {
    const actor = await this.requireActor(payload?.actorToken)
    const parsed = this.parseAvatarDataUrl(payload?.dataUrl)
    if (typeof parsed === 'string') return errorResponse(ErrorCodes.Validation, parsed)

    const row = await this.authRepo.findUserById(actor.user.id)
    const oldAvatarPath = row && 'avatarPath' in row ? row.avatarPath : null
    const avatarDirectory = this.userAvatarDirectory(actor.user.id)
    await mkdir(avatarDirectory, { recursive: true })
    const avatarPath = this.safeAvatarPath(actor.user.id, `${randomUUID()}${parsed.extension}`)
    await writeFile(avatarPath, parsed.buffer, { flag: 'wx' })
    await this.authRepo.setAvatarPath(actor.user.id, avatarPath)
    await this.removeStoredAvatar(oldAvatarPath)

    this.markActiveUser(actor.user.id)
    const user = this.mapUser({
      ...actor.user,
      organizationId: actor.user.organizationId,
      avatarPath
    })
    return okResponse({ session: actor.session, user })
  }

  async removeAvatar(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const actor = await this.requireActor(payload?.actorToken)
    const row = await this.authRepo.findUserById(actor.user.id)
    const oldAvatarPath = row && 'avatarPath' in row ? row.avatarPath : null
    await this.authRepo.setAvatarPath(actor.user.id, null)
    await this.removeStoredAvatar(oldAvatarPath)
    this.markActiveUser(actor.user.id)
    return okResponse({
      session: actor.session,
      user: {
        ...actor.user,
        avatarUrl: null
      }
    })
  }

  async getActiveAvatarFile(): Promise<ActiveAvatarFile | null> {
    if (this.activeUserId) {
      const activeAvatar = await this.getStoredAvatarFile(this.activeUserId)
      if (activeAvatar) return activeAvatar
    }

    const defaultUser = await this.authRepo.findDefaultWorkspaceUser()
    if (!defaultUser) return null
    return this.getStoredAvatarFile(defaultUser.id)
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
