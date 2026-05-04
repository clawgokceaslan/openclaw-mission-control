import { useEffect, useMemo, useState } from 'react'

const AVATAR_STORAGE_PREFIX = 'omc:profile-avatar'
const AVATAR_CHANGED_EVENT = 'omc:profile-avatar-changed'

function avatarStorageKey(userId: string | null | undefined): string {
  return `${AVATAR_STORAGE_PREFIX}:${userId?.trim() || 'local'}`
}

function readAvatar(key: string): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

function emitAvatarChanged(key: string) {
  window.dispatchEvent(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: { key } }))
}

export function useLocalAvatar(userId: string | null | undefined) {
  const storageKey = useMemo(() => avatarStorageKey(userId), [userId])
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => readAvatar(storageKey))

  useEffect(() => {
    setAvatarUrl(readAvatar(storageKey))

    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setAvatarUrl(event.newValue)
    }

    const onAvatarChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail
      if (detail?.key === storageKey) setAvatarUrl(readAvatar(storageKey))
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener(AVATAR_CHANGED_EVENT, onAvatarChanged)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(AVATAR_CHANGED_EVENT, onAvatarChanged)
    }
  }, [storageKey])

  const saveAvatar = (nextAvatarUrl: string) => {
    window.localStorage.setItem(storageKey, nextAvatarUrl)
    setAvatarUrl(nextAvatarUrl)
    emitAvatarChanged(storageKey)
  }

  const clearAvatar = () => {
    window.localStorage.removeItem(storageKey)
    setAvatarUrl(null)
    emitAvatarChanged(storageKey)
  }

  return { avatarUrl, saveAvatar, clearAvatar }
}
