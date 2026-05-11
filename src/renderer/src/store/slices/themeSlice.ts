import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemePaletteId = 'graphite' | 'blue' | 'brown' | 'red' | 'green' | 'purple'
export type ThemeBackgroundId = 'default' | 'blue-haze' | 'walnut' | 'red-clay' | 'midnight'

const THEME_MODE_KEY = 'omc:theme-mode'
const THEME_PALETTE_KEY = 'omc:theme-palette'
const THEME_BACKGROUND_KEY = 'omc:theme-background'
const VALID_PALETTES: ThemePaletteId[] = ['graphite', 'blue', 'brown', 'red', 'green', 'purple']
const VALID_BACKGROUNDS: ThemeBackgroundId[] = ['default', 'blue-haze', 'walnut', 'red-clay', 'midnight']
const LEGACY_PALETTE_MAP: Record<string, ThemePaletteId> = {
  emerald: 'green',
  violet: 'purple',
  amber: 'brown',
  rose: 'red'
}
const LEGACY_BACKGROUND_MAP: Record<string, ThemeBackgroundId> = {
  'soft-grid': 'blue-haze',
  radial: 'blue-haze',
  paper: 'walnut'
}

function resolveThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(THEME_MODE_KEY)
  return saved === 'system' || saved === 'light' || saved === 'dark' ? (saved as ThemeMode) : 'dark'
}

function resolvePaletteId(): ThemePaletteId {
  if (typeof window === 'undefined') return 'graphite'
  const saved = window.localStorage.getItem(THEME_PALETTE_KEY)
  if (saved && VALID_PALETTES.includes(saved as ThemePaletteId)) return saved as ThemePaletteId
  return saved ? LEGACY_PALETTE_MAP[saved] ?? 'graphite' : 'graphite'
}

function resolveBackgroundId(): ThemeBackgroundId {
  if (typeof window === 'undefined') return 'default'
  const saved = window.localStorage.getItem(THEME_BACKGROUND_KEY)
  if (saved && VALID_BACKGROUNDS.includes(saved as ThemeBackgroundId)) return saved as ThemeBackgroundId
  return saved ? LEGACY_BACKGROUND_MAP[saved] ?? 'default' : 'default'
}

function getSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface ThemeState {
  mode: ThemeMode
  paletteId: ThemePaletteId
  backgroundId: ThemeBackgroundId
  systemMode: 'light' | 'dark'
}

const initialState: ThemeState = {
  mode: resolveThemeMode(),
  paletteId: resolvePaletteId(),
  backgroundId: resolveBackgroundId(),
  systemMode: getSystemMode()
}

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setMode(state, action: PayloadAction<ThemeMode>) {
      state.mode = action.payload
    },
    setPaletteId(state, action: PayloadAction<ThemePaletteId>) {
      state.paletteId = action.payload
    },
    setBackgroundId(state, action: PayloadAction<ThemeBackgroundId>) {
      state.backgroundId = action.payload
    },
    setSystemMode(state, action: PayloadAction<'light' | 'dark'>) {
      state.systemMode = action.payload
    },
    hydrateThemeFromStorage(state) {
      state.mode = resolveThemeMode()
      state.paletteId = resolvePaletteId()
      state.backgroundId = resolveBackgroundId()
      state.systemMode = getSystemMode()
    }
  }
})

export const { setMode, setPaletteId, setBackgroundId, setSystemMode, hydrateThemeFromStorage } = themeSlice.actions
