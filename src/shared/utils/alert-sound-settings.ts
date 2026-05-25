export type AlertSoundCategory = 'success' | 'error' | 'warning' | 'completed'
export type AlertSoundVariant = 'chime' | 'pulse' | 'soft' | 'bright'

export interface AlertSoundSettings {
  volume: number
  variants: Record<AlertSoundCategory, AlertSoundVariant>
}

export const ALERT_SOUND_CATEGORIES: Array<{ value: AlertSoundCategory; label: string }> = [
  { value: 'success', label: 'Başarılı' },
  { value: 'error', label: 'Hata' },
  { value: 'warning', label: 'Uyarı' },
  { value: 'completed', label: 'Tamamlandı' }
]

export const ALERT_SOUND_VARIANTS: Array<{ value: AlertSoundVariant; label: string; description: string }> = [
  { value: 'chime', label: 'Chime', description: 'Kısa ve temiz çift ton' },
  { value: 'pulse', label: 'Pulse', description: 'Daha belirgin uyarı darbesi' },
  { value: 'soft', label: 'Soft', description: 'Düşük yoğunluklu yumuşak ton' },
  { value: 'bright', label: 'Bright', description: 'Net ve parlak tamamlanma sesi' }
]

export const DEFAULT_ALERT_SOUND_SETTINGS: AlertSoundSettings = {
  volume: 0.7,
  variants: {
    success: 'chime',
    error: 'pulse',
    warning: 'soft',
    completed: 'bright'
  }
}

export function normalizeAlertSoundCategory(value: unknown): AlertSoundCategory {
  return ALERT_SOUND_CATEGORIES.some((category) => category.value === value)
    ? value as AlertSoundCategory
    : 'completed'
}

export function normalizeAlertSoundVariant(value: unknown, fallback: AlertSoundVariant = 'chime'): AlertSoundVariant {
  return ALERT_SOUND_VARIANTS.some((variant) => variant.value === value)
    ? value as AlertSoundVariant
    : fallback
}

export function normalizeAlertSoundVolume(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : DEFAULT_ALERT_SOUND_SETTINGS.volume
  if (!Number.isFinite(numeric)) return DEFAULT_ALERT_SOUND_SETTINGS.volume
  return Math.min(1, Math.max(0, numeric))
}

export function normalizeAlertSoundSettings(value: unknown): AlertSoundSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const rawVariants = record.variants && typeof record.variants === 'object' && !Array.isArray(record.variants)
    ? record.variants as Record<string, unknown>
    : {}
  const variants = ALERT_SOUND_CATEGORIES.reduce((next, category) => {
    next[category.value] = normalizeAlertSoundVariant(
      rawVariants[category.value],
      DEFAULT_ALERT_SOUND_SETTINGS.variants[category.value]
    )
    return next
  }, {} as Record<AlertSoundCategory, AlertSoundVariant>)

  return {
    volume: normalizeAlertSoundVolume(record.volume),
    variants
  }
}

