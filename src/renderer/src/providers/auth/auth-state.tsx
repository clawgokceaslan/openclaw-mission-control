import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { clearSessionToken, getSessionToken } from '@renderer/utils/api'
import type { Session, User } from '@shared/types/entities'
import {
  loginAuth,
  logoutAuth,
  refreshAuth,
  setToken as setAuthToken,
  updateProfile as updateProfileThunk
} from '@renderer/store/slices/authSlice'

interface AuthContextValue {
  user: User | null
  session: Session | null
  initialized: boolean
  token: string | null
  errorMessage: string | null
  login: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>
  updateProfile: (firstName: string, lastName: string, options?: { email?: string; role?: User['role'] }) => Promise<{ ok: boolean; message?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()
  const { user, session, initialized, token, errorMessage } = useAppSelector((state) => state.auth)

  useEffect(() => {
    void dispatch(refreshAuth())
      .unwrap()
      .catch(() => {
        // Auth bootstrap errors are surfaced through context.
      })
  }, [dispatch])

  useEffect(() => {
    const persistedToken = getSessionToken()
    if (persistedToken && persistedToken !== token) {
      dispatch(setAuthToken(persistedToken))
      void dispatch(refreshAuth())
    }
  }, [dispatch, token])

  const login = async (email: string, password: string) => {
    try {
      await dispatch(loginAuth({ email, password })).unwrap()
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Login failed' }
    }
  }

  const updateProfile = async (
    firstName: string,
    lastName: string,
    options?: { email?: string; role?: User['role'] }
  ) => {
    try {
      await dispatch(updateProfileThunk({ firstName, lastName, options })).unwrap()
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Profile update failed' }
    }
  }

  const logout = async () => {
    await dispatch(logoutAuth())
      .unwrap()
      .catch(() => undefined)
    clearSessionToken()
  }

  const refresh = async () => {
    await dispatch(refreshAuth()).unwrap().catch(() => undefined)
  }

  const value = useMemo(
    () => ({
      user,
      session,
      initialized,
      token,
      errorMessage,
      login,
      updateProfile,
      logout,
      refresh
    }),
    [user, session, initialized, token, errorMessage]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
