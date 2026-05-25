export type AlertSoundCategory = 'success' | 'error' | 'warning' | 'completed'
export type AlertSoundVariant =
  | 'success-chime'
  | 'success-rise'
  | 'success-pop'
  | 'success-spark'
  | 'success-bloom'
  | 'error-pulse'
  | 'error-buzz'
  | 'error-drop'
  | 'error-alarm'
  | 'error-thud'
  | 'warning-soft'
  | 'warning-beacon'
  | 'warning-nudge'
  | 'warning-tick'
  | 'warning-sweep'
  | 'completed-bright'
  | 'completed-fanfare'
  | 'completed-glow'
  | 'completed-cascade'
  | 'completed-resolve'

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

export type AlertSoundVariantOption = {
  value: AlertSoundVariant
  label: string
  description: string
}

export const ALERT_SOUND_VARIANTS_BY_CATEGORY: Record<AlertSoundCategory, AlertSoundVariantOption[]> = {
  success: [
    { value: 'success-chime', label: 'Success Chime', description: 'Kısa ve temiz başarılı işlem tonu' },
    { value: 'success-rise', label: 'Success Rise', description: 'Yukarı çıkan iki aşamalı onay sesi' },
    { value: 'success-pop', label: 'Success Pop', description: 'Hafif ve hızlı tamam onayı' },
    { value: 'success-spark', label: 'Success Spark', description: 'Parlak ama kısa başarı vurgusu' },
    { value: 'success-bloom', label: 'Success Bloom', description: 'Yumuşak açılan pozitif bildirim' }
  ],
  error: [
    { value: 'error-pulse', label: 'Error Pulse', description: 'Daha belirgin hata darbesi' },
    { value: 'error-buzz', label: 'Error Buzz', description: 'Kısa ve pürüzlü hata uyarısı' },
    { value: 'error-drop', label: 'Error Drop', description: 'Aşağı düşen başarısızlık tonu' },
    { value: 'error-alarm', label: 'Error Alarm', description: 'Keskin çift vuruşlu hata sinyali' },
    { value: 'error-thud', label: 'Error Thud', description: 'Tok ve düşük frekanslı hata sesi' }
  ],
  warning: [
    { value: 'warning-soft', label: 'Warning Soft', description: 'Düşük yoğunluklu yumuşak uyarı' },
    { value: 'warning-beacon', label: 'Warning Beacon', description: 'Dengeli ve fark edilir uyarı sinyali' },
    { value: 'warning-nudge', label: 'Warning Nudge', description: 'Kısa dikkat çağrısı' },
    { value: 'warning-tick', label: 'Warning Tick', description: 'İnce ve seri kontrol uyarısı' },
    { value: 'warning-sweep', label: 'Warning Sweep', description: 'Yukarı süzülen uyarı tonu' }
  ],
  completed: [
    { value: 'completed-bright', label: 'Completed Bright', description: 'Net ve parlak tamamlanma sesi' },
    { value: 'completed-fanfare', label: 'Completed Fanfare', description: 'Üç notalı güçlü bitiş vurgusu' },
    { value: 'completed-glow', label: 'Completed Glow', description: 'Daha sıcak ve sakin tamamlanma tonu' },
    { value: 'completed-cascade', label: 'Completed Cascade', description: 'Akışkan ardışık bitiş notaları' },
    { value: 'completed-resolve', label: 'Completed Resolve', description: 'Kararlı ve kısa sonuç sesi' }
  ]
}

export const ALERT_SOUND_VARIANTS = ALERT_SOUND_CATEGORIES.flatMap((category) => ALERT_SOUND_VARIANTS_BY_CATEGORY[category.value])

export const DEFAULT_ALERT_SOUND_SETTINGS: AlertSoundSettings = {
  volume: 0.7,
  variants: {
    success: 'success-chime',
    error: 'error-pulse',
    warning: 'warning-soft',
    completed: 'completed-bright'
  }
}

const LEGACY_ALERT_SOUND_VARIANTS: Record<AlertSoundCategory, Record<string, AlertSoundVariant>> = {
  success: {
    chime: 'success-chime',
    pulse: 'success-pop',
    soft: 'success-bloom',
    bright: 'success-spark'
  },
  error: {
    chime: 'error-alarm',
    pulse: 'error-pulse',
    soft: 'error-thud',
    bright: 'error-buzz'
  },
  warning: {
    chime: 'warning-beacon',
    pulse: 'warning-nudge',
    soft: 'warning-soft',
    bright: 'warning-sweep'
  },
  completed: {
    chime: 'completed-resolve',
    pulse: 'completed-cascade',
    soft: 'completed-glow',
    bright: 'completed-bright'
  }
}

export function normalizeAlertSoundCategory(value: unknown): AlertSoundCategory {
  return ALERT_SOUND_CATEGORIES.some((category) => category.value === value)
    ? value as AlertSoundCategory
    : 'completed'
}

export function normalizeAlertSoundVariant(
  value: unknown,
  fallback: AlertSoundVariant = DEFAULT_ALERT_SOUND_SETTINGS.variants.success,
  category?: AlertSoundCategory
): AlertSoundVariant {
  if (ALERT_SOUND_VARIANTS.some((variant) => variant.value === value)) {
    return value as AlertSoundVariant
  }
  if (category && typeof value === 'string') {
    return LEGACY_ALERT_SOUND_VARIANTS[category][value] ?? fallback
  }
  return fallback
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
      DEFAULT_ALERT_SOUND_SETTINGS.variants[category.value],
      category.value
    )
    return next
  }, {} as Record<AlertSoundCategory, AlertSoundVariant>)

  return {
    volume: normalizeAlertSoundVolume(record.volume),
    variants
  }
}
