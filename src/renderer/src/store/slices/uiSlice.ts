import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface UiState {
  globalLoading: boolean
  globalError: string | null
}

const initialState: UiState = {
  globalLoading: false,
  globalError: null
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setGlobalLoading(state, action: PayloadAction<boolean>) {
      state.globalLoading = action.payload
    },
    setGlobalError(state, action: PayloadAction<string | null>) {
      state.globalError = action.payload
    },
    clearGlobalError(state) {
      state.globalError = null
    }
  }
})

export const { setGlobalLoading, setGlobalError, clearGlobalError } = uiSlice.actions
