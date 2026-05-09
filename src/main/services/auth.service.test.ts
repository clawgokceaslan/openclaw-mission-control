import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { AuthService } from './auth.service.js'

function authServiceWithPassword(passwordHash: string) {
  const user = {
    id: 'user-1',
    organization_id: 'org-1',
    organizationId: 'org-1',
    email: 'owner@mission.local',
    name: 'Owner',
    password_hash: passwordHash,
    role: 'owner'
  }
  let storedPasswordHash = passwordHash
  const repo = {
    findByEmail: async () => ({ ...user, password_hash: storedPasswordHash }),
    ensureDefaultOwner: async () => ({ ...user, password_hash: storedPasswordHash }),
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
    getStoredPasswordHash: () => storedPasswordHash
  }
}

describe('AuthService password hashing', () => {
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
