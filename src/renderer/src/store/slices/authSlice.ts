import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { ErrorCodes } from '@shared/contracts/error-codes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Session, User } from '@shared/types/entities'
import {
  clearSessionToken,
  getSessionToken,
  getRefreshToken,
  getMeWithAuthApi,
  invokeBridge,
  isElectronRuntime,
  loginWithAuthApi,
  logoutWithAuthApi,
  refreshWithAuthApi,
  setRefreshToken,
  setSessionToken
} from '@renderer/utils/api'

export interface AuthState {
  user: User | null
  session: Session | null
  initialized: boolean
  token: string | null
  errorMessage: string | null
  status: 'idle' | 'loading' | 'succeeded' | 'failed'
}

interface AuthResult {
  user: User
  session: Session
  refreshToken?: string
}

const getSafeToken = () => (typeof window === 'undefined' ? null : getSessionToken())

const runBootstrapLogin = async () => {
  const bootstrapResult = await loginWithAuthApi<AuthResult>({ desktopBootstrap: true })

  if (!bootstrapResult.ok || !bootstrapResult.data) {
    throw new Error(bootstrapResult.error?.message ?? 'Bootstrap login failed')
  }

  setSessionToken(bootstrapResult.data.session.token)
  if (bootstrapResult.data.refreshToken) setRefreshToken(bootstrapResult.data.refreshToken)
  return bootstrapResult.data
}

export const refreshAuth = createAsyncThunk<AuthResult, void, { state: { auth: AuthState } }>(
  'auth/refresh',
  async (_, { getState, rejectWithValue }) => {
    const { token: currentToken } = getState().auth
    const token = currentToken ?? getSafeToken()

    if (!token) {
      if (getRefreshToken()) {
        const refreshResponse = await refreshWithAuthApi<AuthResult>()
        if (refreshResponse.ok && refreshResponse.data) return refreshResponse.data
        clearSessionToken()
        return rejectWithValue(refreshResponse.error?.message ?? 'Login required') as never
      }
      if (!isElectronRuntime()) {
        return rejectWithValue('Login required') as never
      }
      return runBootstrapLogin().catch((error) => {
        return rejectWithValue(error instanceof Error ? error.message : 'Auth bootstrap failed') as never
      })
    }

    const response = await getMeWithAuthApi<AuthResult>(token)
    if (response.ok && response.data) {
      setSessionToken(response.data.session.token)
      return response.data
    }

    if (response.error?.code === ErrorCodes.Unauthenticated) {
      clearSessionToken()
      return rejectWithValue('Oturum doğrulanamadı. Lütfen tekrar giriş yapın.') as never
    }

    if (!isElectronRuntime()) {
      return rejectWithValue(response.error?.message ?? 'Login required') as never
    }

    try {
      return await runBootstrapLogin()
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Auth bootstrap failed') as never
    }
  }
)

export const loginAuth = createAsyncThunk<AuthResult, { email: string; password: string }>(
  'auth/login',
  async ({ email, password }) => {
    const response = await loginWithAuthApi<AuthResult>({ email, password })
    if (!response.ok || !response.data) {
      throw new Error(response.error?.message || 'Login failed')
    }
    setSessionToken(response.data.session.token)
    if (response.data.refreshToken) setRefreshToken(response.data.refreshToken)
    return response.data
  }
)

export const updateProfile = createAsyncThunk<
  AuthResult,
  { firstName: string; lastName: string; options?: { email?: string; role?: User['role'] } },
  { state: { auth: AuthState } }
>('auth/updateProfile', async ({ firstName, lastName, options }, { getState }) => {
  const { token } = getState().auth
  if (!token) {
    throw new Error('No active session')
  }

  const response = await invokeBridge<{ user: User; session: Session }>(IPC_CHANNELS.auth.updateProfile, {
    actorToken: token,
    firstName,
    lastName,
    email: options?.email,
    role: options?.role
  })
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Profile update failed')
  }
  return response.data
})

export const changePassword = createAsyncThunk<
  { ok: true },
  { newPassword: string; confirmPassword: string },
  { state: { auth: AuthState } }
>('auth/changePassword', async ({ newPassword, confirmPassword }, { getState }) => {
  const { token } = getState().auth
  if (!token) {
    throw new Error('No active session')
  }

  const response = await invokeBridge<{ ok: true }>(IPC_CHANNELS.auth.changePassword, {
    actorToken: token,
    newPassword,
    confirmPassword
  })
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Password could not be changed')
  }
  return response.data
})

export const logoutAuth = createAsyncThunk<void, void, { state: { auth: AuthState } }>(
  'auth/logout',
  async (_, { getState }) => {
    const { token } = getState().auth
    if (token) {
      await logoutWithAuthApi(token)
    }
    clearSessionToken()
  }
)

const initialState: AuthState = {
  user: null,
  session: null,
  initialized: false,
  token: getSafeToken(),
  errorMessage: null,
  status: 'idle'
}

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setToken(state, action: PayloadAction<string | null>) {
      state.token = action.payload
    }
  },
  extraReducers: (builder) => {
    builder.addCase(refreshAuth.pending, (state) => {
      state.status = 'loading'
      state.errorMessage = null
    })
    builder.addCase(refreshAuth.fulfilled, (state, action) => {
      state.status = 'succeeded'
      state.initialized = true
      state.user = action.payload.user
      state.session = action.payload.session
      state.token = action.payload.session.token
      state.errorMessage = null
    })
    builder.addCase(refreshAuth.rejected, (state, action) => {
      state.status = 'failed'
      state.initialized = true
      state.errorMessage = (action.payload as string) ?? action.error.message ?? 'Auth bootstrap failed'
      state.user = null
      state.session = null
      state.token = null
      clearSessionToken()
    })

    builder.addCase(loginAuth.pending, (state) => {
      state.status = 'loading'
      state.errorMessage = null
    })
    builder.addCase(loginAuth.fulfilled, (state, action) => {
      state.status = 'succeeded'
      state.user = action.payload.user
      state.session = action.payload.session
      state.token = action.payload.session.token
      state.errorMessage = null
      state.initialized = true
    })
    builder.addCase(loginAuth.rejected, (state, action) => {
      state.status = 'failed'
      state.errorMessage = action.error.message ?? 'Login failed'
    })

    builder.addCase(updateProfile.pending, (state) => {
      state.status = 'loading'
    })
    builder.addCase(updateProfile.fulfilled, (state, action) => {
      state.status = 'succeeded'
      state.user = action.payload.user
      state.session = action.payload.session
    })
    builder.addCase(updateProfile.rejected, (state, action) => {
      state.status = 'failed'
      state.errorMessage = action.error.message ?? 'Profile update failed'
    })

    builder.addCase(changePassword.pending, (state) => {
      state.errorMessage = null
    })
    builder.addCase(changePassword.fulfilled, (state) => {
      state.errorMessage = null
    })
    builder.addCase(changePassword.rejected, (state, action) => {
      state.errorMessage = action.error.message ?? 'Password could not be changed'
    })

    builder.addCase(logoutAuth.fulfilled, (state) => {
      state.user = null
      state.session = null
      state.token = null
      state.initialized = true
      state.status = 'succeeded'
      state.errorMessage = null
    })
    builder.addCase(logoutAuth.rejected, (state, action) => {
      state.errorMessage = action.error.message ?? 'Logout failed'
      clearSessionToken()
      state.user = null
      state.session = null
      state.token = null
    })
  }
})

export const { setToken } = authSlice.actions
