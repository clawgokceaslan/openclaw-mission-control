import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { AuthService } from './auth.service.js'

function authServiceWithPassword(passwordHash: string, options?: { email?: string }) {
  const user = {
    id: 'user-1',
    organization_id: 'org-1',
    organizationId: 'org-1',
    email: options?.email ?? 'pilot@example.com',
    name: 'Owner',
    password_hash: passwordHash,
    role: 'owner'
  }
  let storedPasswordHash = passwordHash
  let ensuredLocalUser = false
  const repo = {
    findDefaultWorkspaceUser: async () => ({ ...user, password_hash: storedPasswordHash }),
    findByEmail: async (email: string) => email === user.email ? { ...user, password_hash: storedPasswordHash } : undefined,
    ensureLocalUser: async () => {
      ensuredLocalUser = true
      return { ...user, email: 'local@open-mission-control.invalid', password_hash: storedPasswordHash }
    },
    setPasswordHash: async (_userId: string, nextHash: string) => {
      storedPasswordHash = nextHash
    },
    createSession: async (userId: string, ttlMs: number) => ({
      id: 'session-1',
      userId,
      token: 'session-token',
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now()
    }),
    createRefreshToken: async (_userId: string, ttlMs: number) => ({
      token: 'refresh-token',
      expiresAt: Date.now() + ttlMs
    }),
    findSessionByToken: async (token: string) => token === 'session-token'
      ? {
          id: 'session-1',
          userId: user.id,
          token,
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now()
        }
      : undefined,
    findUserById: async () => ({
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role
    })
  }

  return {
    service: new AuthService(repo as any),
    getStoredPasswordHash: () => storedPasswordHash,
    wasLocalUserEnsured: () => ensuredLocalUser
  }
}

describe('AuthService password hashing', () => {
  it('issues local desktop sessions without checking or resetting the password', async () => {
    const changedPasswordHash = bcrypt.hashSync('changed-password', 12)
    const { service, getStoredPasswordHash } = authServiceWithPassword(changedPasswordHash)

    const response = await service.createDesktopSession()

    expect(response.ok).toBe(true)
    expect(getStoredPasswordHash()).toBe(changedPasswordHash)
  })

  it('uses the edited profile email for local desktop sessions', async () => {
    const { service, wasLocalUserEnsured } = authServiceWithPassword(bcrypt.hashSync('changed-password', 12), {
      email: 'pilot@example.com'
    })

    const response = await service.createDesktopSession()

    expect(response.ok).toBe(true)
    expect(response.data.user.email).toBe('pilot@example.com')
    expect(wasLocalUserEnsured()).toBe(false)
  })

  it('logs in with a normalized edited profile email and does not create a local user', async () => {
    const { service, wasLocalUserEnsured } = authServiceWithPassword(bcrypt.hashSync('changed-password', 12), {
      email: 'pilot@example.com'
    })

    const response = await service.login({ email: '  PILOT@EXAMPLE.COM  ', password: 'changed-password' }, { transport: 'http' })

    expect(response.ok).toBe(true)
    expect(response.data.user.email).toBe('pilot@example.com')
    expect(wasLocalUserEnsured()).toBe(false)
  })

  it('does not create a local user from web login credentials', async () => {
    const { service, wasLocalUserEnsured } = authServiceWithPassword(bcrypt.hashSync('changed-password', 12), {
      email: 'pilot@example.com'
    })

    const response = await service.login({ email: 'unknown@example.com', password: 'changeme' }, { transport: 'http' })

    expect(response.ok).toBe(false)
    expect(wasLocalUserEnsured()).toBe(false)
  })

  it('rate limits the same email and client source after ten failed logins in fifteen minutes', async () => {
    const { service } = authServiceWithPassword(bcrypt.hashSync('changed-password', 12), {
      email: 'pilot@example.com'
    })
    const meta = { transport: 'http', clientSource: 'http:203.0.113.10' }

    for (let index = 0; index < 10; index += 1) {
      const response = await service.login({ email: 'pilot@example.com', password: 'wrong-password' }, meta)
      expect(response.ok).toBe(false)
      expect(response.error?.code).toBe('ERR_UNAUTHENTICATED')
    }

    const limited = await service.login({ email: 'pilot@example.com', password: 'wrong-password' }, meta)

    expect(limited.ok).toBe(false)
    expect(limited.error?.code).toBe('ERR_RATE_LIMITED')
  })

  it('clears failed login attempts after a successful login for the same email and source', async () => {
    const { service } = authServiceWithPassword('changed-password', {
      email: 'pilot@example.com'
    })
    const meta = { transport: 'http', clientSource: 'http:203.0.113.10' }

    for (let index = 0; index < 9; index += 1) {
      const response = await service.login({ email: 'pilot@example.com', password: 'wrong-password' }, meta)
      expect(response.ok).toBe(false)
    }

    const success = await service.login({ email: 'pilot@example.com', password: 'changed-password' }, meta)
    expect(success.ok).toBe(true)

    for (let index = 0; index < 2; index += 1) {
      const response = await service.login({ email: 'pilot@example.com', password: 'wrong-password' }, meta)
      expect(response.error?.code).toBe('ERR_UNAUTHENTICATED')
    }
  })

  it('upgrades a valid legacy PBKDF2 password to bcrypt after login', async () => {
    const legacyHash = 'pbkdf2:sha256:260000$local$75d92a58383dd943d4868d010791b54d4ad8f2c5f02a7fd08096e83b08f633e6'
    const { service, getStoredPasswordHash } = authServiceWithPassword(legacyHash)

    const response = await service.login({ email: 'pilot@example.com', password: 'changeme' })

    expect(response.ok).toBe(true)
    expect(getStoredPasswordHash()).toMatch(/^\$2[aby]\$/)
    expect(bcrypt.compareSync('changeme', getStoredPasswordHash())).toBe(true)
  })

  it('stores profile password changes as bcrypt without requiring the current password', async () => {
    const { service, getStoredPasswordHash } = authServiceWithPassword(bcrypt.hashSync('old-password', 12))

    const response = await service.changePassword({
      actorToken: 'session-token',
      newPassword: 'new-password',
      confirmPassword: 'new-password'
    })

    expect(response.ok).toBe(true)
    expect(getStoredPasswordHash()).toMatch(/^\$2[aby]\$/)
    expect(bcrypt.compareSync('new-password', getStoredPasswordHash())).toBe(true)
  })

  it('rejects mismatched profile password confirmation', async () => {
    const originalHash = bcrypt.hashSync('old-password', 12)
    const { service, getStoredPasswordHash } = authServiceWithPassword(originalHash)

    const response = await service.changePassword({
      actorToken: 'session-token',
      newPassword: 'new-password',
      confirmPassword: 'different-password'
    })

    expect(response.ok).toBe(false)
    expect(getStoredPasswordHash()).toBe(originalHash)
  })
})
