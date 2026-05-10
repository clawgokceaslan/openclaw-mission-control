import { apiBaseUrl } from '@renderer/utils/api'

const REMOTE_IMAGE_URL_PATTERN = /^https:\/\//i
const EMBEDDED_IMAGE_URL_PATTERN = /^(data:image\/|blob:|file:)/i

export function resolveUserAvatarUrl(avatarUrl: string | null | undefined): string | null {
  const normalizedAvatarUrl = avatarUrl?.trim()
  if (!normalizedAvatarUrl) return null

  if (REMOTE_IMAGE_URL_PATTERN.test(normalizedAvatarUrl) || EMBEDDED_IMAGE_URL_PATTERN.test(normalizedAvatarUrl)) {
    return normalizedAvatarUrl
  }

  if (/^http:\/\//i.test(normalizedAvatarUrl)) {
    return null
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedAvatarUrl)) {
    return null
  }

  return `${apiBaseUrl()}${normalizedAvatarUrl.startsWith('/') ? normalizedAvatarUrl : `/${normalizedAvatarUrl}`}`
}
