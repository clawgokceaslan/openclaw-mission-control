const SMART_COLORS = ['#3B82F6', '#14B8A6', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#0EA5E9', '#F97316', '#64748B', '#22C55E']

export function normalizeTagHex(color?: string | null): string | undefined {
  if (!color) return undefined
  const value = color.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(value)
  if (short) return `#${short[1].split('').map((char) => `${char}${char}`).join('')}`.toUpperCase()
  return /^#([0-9a-f]{6})$/i.test(value) ? value.toUpperCase() : undefined
}

export function suggestTagColor(seed: string): string {
  const source = seed.trim() || 'tag'
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index)
    hash |= 0
  }
  return SMART_COLORS[Math.abs(hash) % SMART_COLORS.length]
}

export function resolveTagColor(color: string | null | undefined, name: string): string {
  return normalizeTagHex(color) ?? suggestTagColor(name)
}
