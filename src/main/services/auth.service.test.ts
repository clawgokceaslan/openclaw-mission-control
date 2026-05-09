import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { AuthService } from './auth.service.js'

function authServiceWithPassword(passwordHash: string, options?: { email?: string }) {
  const user = {
    id: 'user-1',
    organization_id: 'org-1',
    organizationId: 'org-1',
    email: options?.email ?? 'owner@mission.local',
    name: 'Owner',
    password_hash: passwordHash,
    role: 'owner'
  }
  let storedPasswordHash = passwordHash
  let ensuredDefaultOwner = false
  const repo = {
    findDefaultWorkspaceUser: async () => ({ ...user, password_hash: storedPasswordHash }),
    findByEmail: async (email: string) => email === user.email ? { ...user, password_hash: storedPasswordHash } : undefined,
    ensureDefaultOwner: async () => {
      ensuredDefaultOwner = true
      return { ...user, email: 'owner@mission.local', password_hash: storedPasswordHash }
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
    wasDefaultOwnerEnsured: () => ensuredDefaultOwner
  }
}

describe('AuthService password hashing', () => {
  it('issues desktop bootstrap sessions over IPC without checking or resetting the password', async () => {
    const changedPasswordHash = bcrypt.hashSync('changed-password', 12)
    const { service, getStoredPasswordHash } = authServiceWithPassword(changedPasswordHash)

    const response = await service.login({ desktopBootstrap: true }, { transport: 'ipc' })

    expect(response.ok).toBe(true)
    expect(getStoredPasswordHash()).toBe(changedPasswordHash)
  })

  it('does not allow desktop bootstrap through the HTTP transport', async () => {
    const { service } = authServiceWithPassword(bcrypt.hashSync('changed-password', 12))

    const response = await service.login({ desktopBootstrap: true }, { transport: 'http' })

    expect(response.ok).toBe(false)
  })

  it('uses the edited profile email for desktop bootstrap sessions', async () => {
    const { service, wasDefaultOwnerEnsured } = authServiceWithPassword(bcrypt.hashSync('changed-password', 12), {
      email: 'pilot@example.com'
    })

    const response = await service.login({ desktopBootstrap: true }, { transport: 'ipc' })

    expect(response.ok).toBe(true)
    expect(response.data.user.email).toBe('pilot@example.com')
    expect(wasDefaultOwnerEnsured()).toBe(false)
  })

  it('upgrades a valid PBKDF2 password to bcrypt after login', async () => {
    const legacyHash = 'pbkdf2:sha256:260000$local$75d92a58383dd943d4868d010791b54d4ad8f2c5f02a7fd08096e83b08f633e6'
    const { service, getStoredPasswordHash } = authServiceWithPassword(legacyHash)

    const response = await service.login({ email: 'owner@mission.local', password: 'changeme' })

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
