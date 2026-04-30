import type { CSSProperties } from 'react'
import type { Tag } from '@shared/types/entities'
import styles from './TagPill.module.scss'

const FALLBACK_BG = 'var(--omc-badge-bg)'
const FALLBACK_FG = 'var(--omc-badge-text)'

function normalizeHex(color?: string) {
  if (!color) return null
  const value = color.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(value)
  if (short) {
    return `#${short[1].split('').map((char) => `${char}${char}`).join('')}`
  }
  return /^#([0-9a-f]{6})$/i.test(value) ? value : null
}

export function readableTextColor(color?: string) {
  const hex = normalizeHex(color)
  if (!hex) return FALLBACK_FG
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.58 ? 'var(--omc-text-strong)' : 'var(--omc-inverse-text)'
}

export function tagColorStyle(color?: string): CSSProperties {
  const background = normalizeHex(color) ?? FALLBACK_BG
  return {
    '--tag-bg': background,
    '--tag-fg': normalizeHex(color) ? readableTextColor(background) : FALLBACK_FG
  } as CSSProperties
}

export function TagPill({ tag, compact = false }: { tag: Pick<Tag, 'name' | 'color'>; compact?: boolean }) {
  return (
    <span className={`${styles.tagPill} ${compact ? styles.compact : ''}`} style={tagColorStyle(tag.color)} title={tag.name}>
      <span className={styles.label}>{tag.name}</span>
    </span>
  )
}
