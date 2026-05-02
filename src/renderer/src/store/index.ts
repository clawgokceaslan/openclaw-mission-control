import { configureStore } from '@reduxjs/toolkit'
import { authSlice } from '@renderer/store/slices/authSlice'
import { themeSlice } from '@renderer/store/slices/themeSlice'
import { uiSlice } from '@renderer/store/slices/uiSlice'

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    theme: themeSlice.reducer,
    ui: uiSlice.reducer
  }
})

export const { dispatch } = store

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
