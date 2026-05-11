import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  type ThemeBackgroundId,
  type ThemeMode,
  type ThemePaletteId,
  setBackgroundId,
  setMode,
  setPaletteId,
  setSystemMode
} from '@renderer/store/slices/themeSlice'

export type ResolvedThemeMode = 'light' | 'dark'

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
  bg: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#f7f9fc',
  surfaceSoft: '#fbfdff',
  surfaceRaised: '#ffffff',
  border: '#d8dee8',
  borderStrong: '#bdc8d9',
  borderSubtle: '#edf1f7',
  text: '#1f2a3f',
  textStrong: '#17233a',
  textMuted: '#7284a4',
  textSoft: '#8392aa',
  inverseText: '#ffffff',
  primaryText: '#ffffff',
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
  modalBg: '#ffffff',
  modalShadow: '0 24px 70px rgba(14, 28, 52, 0.22)',
  primarySoft: '#eef4ff',
  primaryBorder: '#b9cef8',
  activeBorder: '#b9cef8',
  inputFocusBorder: '#2d5fda',
  accentContrast: '#0f172a',
  codeText: '#334155',
  shadowMd: '0 12px 28px rgba(18, 32, 54, 0.14)',
  shadowXl: '0 26px 78px rgba(14, 28, 52, 0.24)',
  shadow: '0 1px 2px rgba(15, 30, 58, 0.08)',
  shadowRaised: '0 18px 34px rgba(19, 35, 58, 0.18)'
}

const baseDark: ThemeTokens = {
  bg: '#000000',
  surface: '#101216',
  surfaceMuted: '#161a21',
  surfaceSoft: '#1b2029',
  surfaceRaised: '#141922',
  border: '#2d3441',
  borderStrong: '#475467',
  borderSubtle: '#232a35',
  text: '#e7edf8',
  textStrong: '#f5f8ff',
  textMuted: '#9aabc4',
  textSoft: '#7f91ad',
  inverseText: '#ffffff',
  primaryText: '#ffffff',
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
  gradientSurface: 'linear-gradient(180deg, #171c25 0%, #101216 100%)',
  gradientSubtle: 'linear-gradient(135deg, #1b2029 0%, #101216 52%, #000000 100%)',
  badgeBg: '#182133',
  badgeText: '#c6d8ff',
  iconBg: '#1d2d49',
  iconText: '#bfdbfe',
  tableHeader: '#181d25',
  tableBorder: '#252d39',
  inputBg: '#090c12',
  inputBorder: '#303947',
  inputFocusRing: 'rgba(96, 165, 250, 0.2)',
  ctaBg: '#111827',
  ctaBorder: '#4a6386',
  pillBg: '#1d2d49',
  pillBorder: '#3d5272',
  hoverBg: '#1b2431',
  activeBg: '#1d2a3f',
  modalBackdrop: 'rgba(3, 7, 18, 0.62)',
  codeBg: '#0f1724',
  codeBorder: '#33435d',
  modalBg: '#101216',
  modalShadow: '0 28px 90px rgba(0, 0, 0, 0.62)',
  primarySoft: '#172842',
  primaryBorder: '#31537d',
  activeBorder: '#31537d',
  inputFocusBorder: '#60a5fa',
  accentContrast: '#020617',
  codeText: '#dbeafe',
  shadowMd: '0 14px 34px rgba(0, 0, 0, 0.34)',
  shadowXl: '0 28px 92px rgba(0, 0, 0, 0.52)',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.28)',
  shadowRaised: '0 18px 42px rgba(0, 0, 0, 0.38)'
}

function palette(config: {
  id: ThemePaletteId
  name: string
  swatch: string
  light: Partial<ThemeTokens>
  dark: Partial<ThemeTokens>
}): ThemePalette {
  const primary = config.swatch
  const primaryStrong = config.light.primaryStrong ?? config.swatch
  const accent = config.dark.accent ?? config.swatch
  return {
    id: config.id,
    name: config.name,
    swatch: config.swatch,
    light: {
      ...baseLight,
      primary,
      primaryStrong,
      accent: config.light.accent ?? primary,
      link: primaryStrong,
      navHoverBg: `${primary}17`,
      navActiveBg: `${primary}1f`,
      navAccent: primaryStrong,
      iconText: primaryStrong,
      inputFocusBorder: primary,
      ...config.light
    },
    dark: {
      ...baseDark,
      primary,
      primaryStrong: accent,
      accent,
      link: accent,
      navHoverBg: `${primary}26`,
      navActiveBg: `${primary}33`,
      navAccent: accent,
      iconText: accent,
      inputFocusBorder: accent,
      ...config.dark
    }
  }
}

export const THEME_PALETTES: ThemePalette[] = [
  palette({
    id: 'graphite',
    name: 'Graphite',
    swatch: '#111827',
    light: { primary: '#111827', primaryStrong: '#030712', accent: '#6b7280', primarySoft: '#f3f4f6', activeBg: '#eef0f3', iconBg: '#f3f4f6', primaryBorder: '#cbd5e1' },
    dark: { primary: '#f3f4f6', primaryStrong: '#ffffff', primaryText: '#030712', accent: '#d1d5db', activeBg: '#20242c', primarySoft: '#181b22', primaryBorder: '#4b5563' }
  }),
  palette({
    id: 'blue',
    name: 'Nocturne Blue',
    swatch: '#2563eb',
    light: { primary: '#2563eb', primaryStrong: '#1d4ed8', accent: '#0f766e', surfaceMuted: '#f5f8ff', activeBg: '#eaf1ff', primarySoft: '#eef4ff', primaryBorder: '#bfd2ff' },
    dark: { primary: '#3b82f6', primaryStrong: '#bfdbfe', accent: '#67e8f9', surface: '#101624', surfaceMuted: '#172033', surfaceSoft: '#1b2740', activeBg: '#1d3153', primaryBorder: '#31537d' }
  }),
  palette({
    id: 'brown',
    name: 'Walnut',
    swatch: '#8b5e34',
    light: { primary: '#8b5e34', primaryStrong: '#684322', accent: '#b45309', bg: '#ffffff', surfaceMuted: '#faf7f2', surfaceSoft: '#f8f3eb', border: '#ded1c3', borderSubtle: '#eee5da', activeBg: '#f3e8d8', primarySoft: '#f7efe5', primaryBorder: '#d8bea2', iconBg: '#f7efe5', iconText: '#8b5e34' },
    dark: { primary: '#b8895d', primaryStrong: '#fed7aa', accent: '#f59e0b', surface: '#15110d', surfaceMuted: '#1d1711', surfaceSoft: '#251d15', border: '#3a3027', borderSubtle: '#2b241d', activeBg: '#312417', primarySoft: '#241a12', primaryBorder: '#765334' }
  }),
  palette({
    id: 'red',
    name: 'Oxide Red',
    swatch: '#dc2626',
    light: { primary: '#dc2626', primaryStrong: '#991b1b', accent: '#be185d', surfaceMuted: '#fff7f7', surfaceSoft: '#fff4f2', border: '#ead0d0', borderSubtle: '#f4e3e3', activeBg: '#fee2e2', primarySoft: '#fff1f2', primaryBorder: '#fecaca', iconBg: '#fff1f2', iconText: '#b91c1c' },
    dark: { primary: '#ef4444', primaryStrong: '#fecaca', accent: '#fb7185', surface: '#171011', surfaceMuted: '#201516', surfaceSoft: '#2a191a', border: '#3d292a', borderSubtle: '#2f2021', activeBg: '#3a1d21', primarySoft: '#2a1518', primaryBorder: '#7f2638' }
  }),
  palette({
    id: 'green',
    name: 'Sage Green',
    swatch: '#0f766e',
    light: { primary: '#0f766e', primaryStrong: '#115e59', accent: '#65a30d', surfaceMuted: '#f4faf7', surfaceSoft: '#eff8f3', activeBg: '#dff4ea', primarySoft: '#e8f7f1', primaryBorder: '#addccc', iconBg: '#e8f7f1', iconText: '#0f766e' },
    dark: { primary: '#14b8a6', primaryStrong: '#99f6e4', accent: '#bef264', surface: '#0d1513', surfaceMuted: '#13211e', surfaceSoft: '#172a25', border: '#29433d', borderSubtle: '#203630', activeBg: '#173b34', primarySoft: '#112c28', primaryBorder: '#2f6d62' }
  }),
  palette({
    id: 'purple',
    name: 'Ink Purple',
    swatch: '#7c3aed',
    light: { primary: '#7c3aed', primaryStrong: '#5b21b6', accent: '#db2777', surfaceMuted: '#f9f7ff', surfaceSoft: '#f5f1ff', activeBg: '#ede9fe', primarySoft: '#f3efff', primaryBorder: '#d8b4fe', iconBg: '#f3efff', iconText: '#6d28d9' },
    dark: { primary: '#8b5cf6', primaryStrong: '#ddd6fe', accent: '#f0abfc', surface: '#14111d', surfaceMuted: '#1d172b', surfaceSoft: '#251d38', border: '#3a3150', borderSubtle: '#2c253d', activeBg: '#30264d', primarySoft: '#211936', primaryBorder: '#5b4b80' }
  })
]

export const THEME_BACKGROUNDS: ThemeBackground[] = [
  {
    id: 'default',
    name: 'Default',
    preview: '#ffffff',
    light: '#ffffff',
    dark: '#000000'
  },
  {
    id: 'blue-haze',
    name: 'Slate Blue',
    preview: '#eef5ff',
    light: '#f4f8ff',
    dark: '#061020'
  },
  {
    id: 'walnut',
    name: 'Walnut',
    preview: '#fbf4e8',
    light: '#fff9f1',
    dark: '#130d08'
  },
  {
    id: 'red-clay',
    name: 'Red clay',
    preview: '#fff2f2',
    light: '#fff7f7',
    dark: '#180709'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    preview: '#f8fafc',
    light: '#f8fafc',
    dark: '#020617'
  }
]

const ThemeContext = createContext<ThemeContextValue | null>(null)

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
  root.style.setProperty('--omc-background-size', 'auto')
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isPaletteId(value: string | null): value is ThemePaletteId {
  return THEME_PALETTES.some((paletteItem) => paletteItem.id === value)
}

function isBackgroundId(value: string | null): value is ThemeBackgroundId {
  return THEME_BACKGROUNDS.some((background) => background.id === value)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()
  const { mode, paletteId, backgroundId, systemMode } = useAppSelector((state) => state.theme)
  const resolvedMode = mode === 'system' ? systemMode : mode
  const activePalette = THEME_PALETTES.find((paletteItem) => paletteItem.id === paletteId) ?? THEME_PALETTES[0]
  const activeBackground = THEME_BACKGROUNDS.find((background) => background.id === backgroundId) ?? THEME_BACKGROUNDS[0]

  useLayoutEffect(() => {
    applyTheme(mode, resolvedMode, activePalette, activeBackground)
  }, [activeBackground, activePalette, mode, resolvedMode])

  useEffect(() => {
    window.localStorage.setItem(THEME_MODE_KEY, mode)
    window.localStorage.setItem(THEME_PALETTE_KEY, activePalette.id)
    window.localStorage.setItem(THEME_BACKGROUND_KEY, activeBackground.id)
  }, [activeBackground.id, activePalette.id, mode])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const updateSystemMode = () => dispatch(setSystemMode(media.matches ? 'dark' : 'light'))
    updateSystemMode()
    media.addEventListener?.('change', updateSystemMode)
    return () => media.removeEventListener?.('change', updateSystemMode)
  }, [dispatch])

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    resolvedMode,
    paletteId,
    backgroundId,
    palettes: THEME_PALETTES,
    backgrounds: THEME_BACKGROUNDS,
    setMode: (nextMode) => {
      dispatch(setMode(nextMode))
      if (typeof window !== 'undefined' && isThemeMode(nextMode)) {
        window.localStorage.setItem(THEME_MODE_KEY, nextMode)
      }
    },
    setPaletteId: (nextPaletteId) => {
      dispatch(setPaletteId(nextPaletteId))
      if (typeof window !== 'undefined' && isPaletteId(nextPaletteId)) {
        window.localStorage.setItem(THEME_PALETTE_KEY, nextPaletteId)
      }
    },
    setBackgroundId: (nextBackgroundId) => {
      dispatch(setBackgroundId(nextBackgroundId))
      if (typeof window !== 'undefined' && isBackgroundId(nextBackgroundId)) {
        window.localStorage.setItem(THEME_BACKGROUND_KEY, nextBackgroundId)
      }
    }
  }), [mode, resolvedMode, paletteId, backgroundId, activeBackground.id, activePalette.id, dispatch])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}

export type { ThemeBackgroundId, ThemeMode, ThemePaletteId }
