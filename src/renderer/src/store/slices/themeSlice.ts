import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemePaletteId = 'blue' | 'emerald' | 'violet' | 'amber' | 'rose'
export type ThemeBackgroundId = 'default' | 'soft-grid' | 'radial' | 'paper' | 'midnight'

const THEME_MODE_KEY = 'omc:theme-mode'
const THEME_PALETTE_KEY = 'omc:theme-palette'
const THEME_BACKGROUND_KEY = 'omc:theme-background'
const VALID_PALETTES: ThemePaletteId[] = ['blue', 'emerald', 'violet', 'amber', 'rose']
const VALID_BACKGROUNDS: ThemeBackgroundId[] = ['default', 'soft-grid', 'radial', 'paper', 'midnight']

function resolveThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const saved = window.localStorage.getItem(THEME_MODE_KEY)
  return saved === 'system' || saved === 'light' || saved === 'dark' ? (saved as ThemeMode) : 'system'
}

function resolvePaletteId(): ThemePaletteId {
  if (typeof window === 'undefined') return 'blue'
  const saved = window.localStorage.getItem(THEME_PALETTE_KEY)
  return saved && VALID_PALETTES.includes(saved as ThemePaletteId) ? (saved as ThemePaletteId) : 'blue'
}

function resolveBackgroundId(): ThemeBackgroundId {
  if (typeof window === 'undefined') return 'default'
  const saved = window.localStorage.getItem(THEME_BACKGROUND_KEY)
  return saved && VALID_BACKGROUNDS.includes(saved as ThemeBackgroundId) ? (saved as ThemeBackgroundId) : 'default'
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
