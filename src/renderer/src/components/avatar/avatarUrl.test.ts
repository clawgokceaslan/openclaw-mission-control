import { describe, expect, it } from 'vitest'
import { resolveUserAvatarUrl } from './avatarUrl'

describe('resolveUserAvatarUrl', () => {
  it('keeps public HTTPS image URLs unchanged', () => {
    expect(resolveUserAvatarUrl(' https://cdn.example.com/profile/avatar.png ')).toBe('https://cdn.example.com/profile/avatar.png')
  })

  it('resolves local avatar routes through the internal API base URL', () => {
    expect(resolveUserAvatarUrl('/api/profile/avatar?v=avatar.png')).toBe('http://127.0.0.1:3000/api/profile/avatar?v=avatar.png')
  })

  it('rejects empty and unsafe avatar URLs so fallback initials can render', () => {
    expect(resolveUserAvatarUrl('')).toBeNull()
    expect(resolveUserAvatarUrl('   ')).toBeNull()
    expect(resolveUserAvatarUrl('http://cdn.example.com/profile/avatar.png')).toBeNull()
    expect(resolveUserAvatarUrl('javascript:alert(1)')).toBeNull()
  })
})
