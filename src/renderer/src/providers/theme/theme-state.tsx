import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedThemeMode = 'light' | 'dark'
export type ThemePaletteId = 'blue' | 'emerald' | 'violet' | 'amber' | 'rose'
export type ThemeBackgroundId = 'default' | 'soft-grid' | 'radial' | 'paper' | 'midnight'

type ThemeTokens = Record<string, string>

interface ThemePalette {
  id: ThemePaletteId
  name: string
  swatch: string
  light: ThemeTokens
  dark: ThemeTokens
}

interface ThemeBackground {
  id: ThemeBackgroundId
  name: string
  preview: string
  light: string
  dark: string
}

interface ThemeContextValue {
  mode: ThemeMode
  resolvedMode: ResolvedThemeMode
  paletteId: ThemePaletteId
  backgroundId: ThemeBackgroundId
  palettes: ThemePalette[]
  backgrounds: ThemeBackground[]
  setMode: (mode: ThemeMode) => void
  setPaletteId: (paletteId: ThemePaletteId) => void
  setBackgroundId: (backgroundId: ThemeBackgroundId) => void
}

const THEME_MODE_KEY = 'omc:theme-mode'
const THEME_PALETTE_KEY = 'omc:theme-palette'
const THEME_BACKGROUND_KEY = 'omc:theme-background'

const baseLight: ThemeTokens = {
  bg: '#f4f6fb',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  surfaceSoft: '#fbfdff',
  surfaceRaised: '#ffffff',
  border: '#d7deea',
  borderStrong: '#c3d0e0',
  borderSubtle: '#edf2fa',
  text: '#1f2a3f',
  textStrong: '#17233a',
  textMuted: '#7284a4',
  textSoft: '#8392aa',
  inverseText: '#ffffff',
  danger: '#c73e4f',
  dangerStrong: '#ab2f43',
  dangerBg: '#fff1f4',
  dangerBorder: '#f3c3cb',
  dangerText: '#ab2f43',
  success: '#22a068',
  successStrong: '#16744d',
  successBg: '#effaf5',
  successBorder: '#bfe5d3',
  successText: '#16744d',
  warning: '#ff7a1a',
  warningStrong: '#8f6800',
  warningText: '#8f6800',
  warningBg: '#fff7ed',
  warningBorder: '#fed7aa',
  info: '#2d5fda',
  infoBg: '#eef4ff',
  infoBorder: '#c4d9f9',
  infoText: '#254eaf',
  overlay: 'rgba(15, 24, 39, 0.38)',
  overlayStrong: 'rgba(10, 17, 28, 0.58)',
  shadowSoft: '0 8px 22px rgba(24, 43, 77, 0.05)',
  shadowMedium: '0 14px 28px rgba(18, 32, 54, 0.16)',
  shadowLarge: '0 24px 70px rgba(14, 28, 52, 0.24)',
  shadowColor: 'rgba(24, 43, 77, 0.08)',
  shadowRaisedColor: 'rgba(14, 28, 52, 0.24)',
  gradientSurface: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  gradientSubtle: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 52%, #f5f8fd 100%)',
  badgeBg: '#f7faff',
  badgeText: '#4d6383',
  iconBg: '#edf3ff',
  iconText: '#2f62dd',
  tableHeader: '#f8fbff',
  tableBorder: '#edf2fa',
  inputBg: '#ffffff',
  inputBorder: '#d9e3f2',
  inputFocusRing: 'rgba(45, 95, 218, 0.16)',
  ctaBg: '#f8fbff',
  ctaBorder: '#b9c9e4',
  pillBg: '#f7faff',
  pillBorder: '#d8e3f2',
  hoverBg: '#f4f8ff',
  activeBg: '#eef4ff',
  modalBackdrop: 'rgba(15, 24, 39, 0.38)',
  codeBg: '#f7f9fd',
  codeBorder: '#dce6f3',
  shadow: '0 1px 2px rgba(15, 30, 58, 0.08)',
  shadowRaised: '0 18px 34px rgba(19, 35, 58, 0.18)'
}

const baseDark: ThemeTokens = {
  bg: '#101725',
  surface: '#172033',
  surfaceMuted: '#1d293d',
  surfaceSoft: '#202d43',
  surfaceRaised: '#1b263b',
  border: '#33435d',
  borderStrong: '#455a78',
  borderSubtle: '#29384f',
  text: '#e7edf8',
  textStrong: '#f5f8ff',
  textMuted: '#9aabc4',
  textSoft: '#7f91ad',
  inverseText: '#ffffff',
  danger: '#fb7185',
  dangerStrong: '#fecdd3',
  dangerBg: '#3a1720',
  dangerBorder: '#7f2638',
  dangerText: '#fecdd3',
  success: '#34d399',
  successStrong: '#bbf7d0',
  successBg: '#143226',
  successBorder: '#246b4a',
  successText: '#bbf7d0',
  warning: '#fb923c',
  warningStrong: '#fde68a',
  warningText: '#fde68a',
  warningBg: '#3c2515',
  warningBorder: '#8a4b1d',
  info: '#60a5fa',
  infoBg: '#172842',
  infoBorder: '#31537d',
  infoText: '#bfdbfe',
  overlay: 'rgba(3, 7, 18, 0.62)',
  overlayStrong: 'rgba(3, 7, 18, 0.78)',
  shadowSoft: '0 8px 22px rgba(0, 0, 0, 0.22)',
  shadowMedium: '0 14px 30px rgba(0, 0, 0, 0.3)',
  shadowLarge: '0 24px 70px rgba(0, 0, 0, 0.42)',
  shadowColor: 'rgba(0, 0, 0, 0.28)',
  shadowRaisedColor: 'rgba(0, 0, 0, 0.52)',
  gradientSurface: 'linear-gradient(180deg, #1b263b 0%, #172033 100%)',
  gradientSubtle: 'linear-gradient(135deg, #1d293d 0%, #172033 52%, #101725 100%)',
  badgeBg: '#1d2d49',
  badgeText: '#c6d8ff',
  iconBg: '#1d2d49',
  iconText: '#bfdbfe',
  tableHeader: '#202d43',
  tableBorder: '#2b3a52',
  inputBg: '#111a2a',
  inputBorder: '#394b66',
  inputFocusRing: 'rgba(96, 165, 250, 0.2)',
  ctaBg: '#172842',
  ctaBorder: '#4a6386',
  pillBg: '#1d2d49',
  pillBorder: '#3d5272',
  hoverBg: '#21324d',
  activeBg: '#233a60',
  modalBackdrop: 'rgba(3, 7, 18, 0.62)',
  codeBg: '#0f1724',
  codeBorder: '#33435d',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.28)',
  shadowRaised: '0 18px 42px rgba(0, 0, 0, 0.38)'
}

function palette(primary: string, primaryStrong: string, accent: string, id: ThemePaletteId, name: string): ThemePalette {
  return {
    id,
    name,
    swatch: primary,
    light: {
      ...baseLight,
      primary,
      primaryStrong,
      accent,
      link: primaryStrong,
      navHoverBg: `${primary}17`,
      navActiveBg: `${primary}1f`,
      navAccent: primaryStrong
    },
    dark: {
      ...baseDark,
      primary,
      primaryStrong: accent,
      accent,
      link: accent,
      navHoverBg: `${primary}26`,
      navActiveBg: `${primary}33`,
      navAccent: accent
    }
  }
}

export const THEME_PALETTES: ThemePalette[] = [
  palette('#2d5fda', '#264fb8', '#93b4ff', 'blue', 'Blue'),
  palette('#059669', '#047857', '#6ee7b7', 'emerald', 'Emerald'),
  palette('#7c3aed', '#6d28d9', '#c4b5fd', 'violet', 'Violet'),
  palette('#d97706', '#b45309', '#fcd34d', 'amber', 'Amber'),
  palette('#e11d48', '#be123c', '#fda4af', 'rose', 'Rose')
]

export const THEME_BACKGROUNDS: ThemeBackground[] = [
  {
    id: 'default',
    name: 'Default',
    preview: 'linear-gradient(135deg, #f4f6fb, #ffffff)',
    light: '#f4f6fb',
    dark: '#101725'
  },
  {
    id: 'soft-grid',
    name: 'Soft grid',
    preview: 'linear-gradient(135deg, #eef4ff, #ffffff)',
    light: 'linear-gradient(rgba(45, 95, 218, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(45, 95, 218, 0.05) 1px, transparent 1px), #f7faff',
    dark: 'linear-gradient(rgba(147, 180, 255, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(147, 180, 255, 0.06) 1px, transparent 1px), #0f1724'
  },
  {
    id: 'radial',
    name: 'Radial',
    preview: 'radial-gradient(circle at top left, #dbeafe, #ffffff 58%)',
    light: 'radial-gradient(circle at top left, rgba(45, 95, 218, 0.14), transparent 34%), #f6f8fc',
    dark: 'radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 38%), #0c1320'
  },
  {
    id: 'paper',
    name: 'Paper',
    preview: 'linear-gradient(135deg, #fbfaf7, #f2f4f8)',
    light: 'linear-gradient(135deg, #fbfaf7 0%, #f3f6fb 100%)',
    dark: 'linear-gradient(135deg, #141b28 0%, #101725 100%)'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    preview: 'linear-gradient(135deg, #111827, #1e3a8a)',
    light: 'linear-gradient(135deg, #eef2ff 0%, #f8fafc 50%, #eff6ff 100%)',
    dark: 'linear-gradient(135deg, #050816 0%, #101725 48%, #172033 100%)'
  }
]

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isPaletteId(value: string | null): value is ThemePaletteId {
  return THEME_PALETTES.some((paletteItem) => paletteItem.id === value)
}

function isBackgroundId(value: string | null): value is ThemeBackgroundId {
  return THEME_BACKGROUNDS.some((background) => background.id === value)
}

function getSystemMode(): ResolvedThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(mode: ThemeMode, resolvedMode: ResolvedThemeMode, paletteItem: ThemePalette, background: ThemeBackground) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const tokens = paletteItem[resolvedMode]
  root.dataset.themeMode = mode
  root.dataset.theme = resolvedMode
  root.dataset.palette = paletteItem.id
  root.dataset.background = background.id
  Object.entries(tokens).forEach(([key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    root.style.setProperty(`--omc-${cssKey}`, value)
  })
  root.style.setProperty('--omc-app-background', background[resolvedMode])
  root.style.setProperty('--omc-background-size', background.id === 'soft-grid' ? '24px 24px' : 'auto')
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [systemMode, setSystemMode] = useState<ResolvedThemeMode>(() => getSystemMode())
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system'
    const saved = window.localStorage.getItem(THEME_MODE_KEY)
    return isThemeMode(saved) ? saved : 'system'
  })
  const [paletteId, setPaletteIdState] = useState<ThemePaletteId>(() => {
    if (typeof window === 'undefined') return 'blue'
    const saved = window.localStorage.getItem(THEME_PALETTE_KEY)
    return isPaletteId(saved) ? saved : 'blue'
  })
  const [backgroundId, setBackgroundIdState] = useState<ThemeBackgroundId>(() => {
    if (typeof window === 'undefined') return 'default'
    const saved = window.localStorage.getItem(THEME_BACKGROUND_KEY)
    return isBackgroundId(saved) ? saved : 'default'
  })

  const resolvedMode = mode === 'system' ? systemMode : mode
  const activePalette = THEME_PALETTES.find((paletteItem) => paletteItem.id === paletteId) ?? THEME_PALETTES[0]
  const activeBackground = THEME_BACKGROUNDS.find((background) => background.id === backgroundId) ?? THEME_BACKGROUNDS[0]

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const updateSystemMode = () => setSystemMode(media.matches ? 'dark' : 'light')
    updateSystemMode()
    media.addEventListener?.('change', updateSystemMode)
    return () => media.removeEventListener?.('change', updateSystemMode)
  }, [])

  useLayoutEffect(() => {
    applyTheme(mode, resolvedMode, activePalette, activeBackground)
  }, [activeBackground, activePalette, mode, resolvedMode])

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    resolvedMode,
    paletteId,
    backgroundId,
    palettes: THEME_PALETTES,
    backgrounds: THEME_BACKGROUNDS,
    setMode: (nextMode) => {
      setModeState(nextMode)
      window.localStorage.setItem(THEME_MODE_KEY, nextMode)
    },
    setPaletteId: (nextPaletteId) => {
      setPaletteIdState(nextPaletteId)
      window.localStorage.setItem(THEME_PALETTE_KEY, nextPaletteId)
    },
    setBackgroundId: (nextBackgroundId) => {
      setBackgroundIdState(nextBackgroundId)
      window.localStorage.setItem(THEME_BACKGROUND_KEY, nextBackgroundId)
    }
  }), [backgroundId, mode, paletteId, resolvedMode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
