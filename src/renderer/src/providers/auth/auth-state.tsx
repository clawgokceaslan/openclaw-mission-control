import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ErrorCodes } from '@shared/contracts/error-codes'
import { invokeBridge, setSessionToken, getSessionToken, clearSessionToken } from '@renderer/utils/api'
import type { Session, User } from '@shared/types/entities'
import { IPC_CHANNELS } from '@shared/contracts/ipc'

const DEFAULT_BOOTSTRAP_USER = {
  email: 'owner@mission.local',
  password: 'changeme'
}

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

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [token, setTokenState] = useState<string | null>(getSessionToken())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const refresh = async () => {
    const runBootstrapLogin = async () => {
      const bootstrapResult = await invokeBridge<{ user: User; session: Session }>(IPC_CHANNELS.auth.login, {
        email: DEFAULT_BOOTSTRAP_USER.email,
        password: DEFAULT_BOOTSTRAP_USER.password
      })

      if (!bootstrapResult.ok || !bootstrapResult.data) {
        if (bootstrapResult.error?.code === ErrorCodes.GatewayUnavailable) {
          setErrorMessage(bootstrapResult.error.message)
        } else {
          setErrorMessage(bootstrapResult.error?.message ?? 'Bootstrap login failed')
        }
        setUser(null)
        setSession(null)
        setInitialized(true)
        return false
      }

      const bootstrapData = bootstrapResult.data as { user: User; session: Session }
      setSession(bootstrapData.session)
      setUser(bootstrapData.user)
      setTokenState(bootstrapData.session.token)
      setSessionToken(bootstrapData.session.token)
      setErrorMessage(null)
      setInitialized(true)
      return true
    }

    try {
      if (!token) {
        const bootstrapped = await runBootstrapLogin()
        if (bootstrapped) {
          return
        }
        return
      }

      const response = await invokeBridge('auth:me', { actorToken: token })
      if (response.ok && response.data) {
        const data = response.data as { user: User; session: Session }
        setUser(data.user)
        setSession(data.session)
        setErrorMessage(null)
        return
      }

      setErrorMessage(response.error?.message ?? 'Session not valid')
      setUser(null)
      setSession(null)
      setTokenState(null)
      clearSessionToken()
      await runBootstrapLogin()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Auth bootstrap failed')
      setUser(null)
      setSession(null)
      setTokenState(null)
      clearSessionToken()
    } finally {
      setInitialized(true)
    }
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const login = async (email: string, password: string) => {
    const response = await invokeBridge('auth:login', { email, password })
    if (!response.ok || !response.data) {
      return { ok: false, message: response.error?.message || 'Login failed' }
    }
    const data = response.data as { user: User; session: Session }
    setSession(data.session)
    setUser(data.user)
    setTokenState(data.session.token)
    setSessionToken(data.session.token)
    return { ok: true }
  }

  const updateProfile = async (firstName: string, lastName: string, options?: { email?: string; role?: User['role'] }) => {
    const response = await invokeBridge(IPC_CHANNELS.auth.updateProfile, {
      actorToken: token,
      firstName,
      lastName,
      email: options?.email,
      role: options?.role
    })
    if (!response.ok || !response.data) {
      return { ok: false, message: response.error?.message || 'Profile update failed' }
    }
    const data = response.data as { user: User; session: Session }
    setUser(data.user)
    setSession(data.session)
    return { ok: true }
  }

  const logout = async () => {
    if (token) {
      await invokeBridge('auth:logout', { actorToken: token })
    }
    setUser(null)
    setSession(null)
    setTokenState(null)
    clearSessionToken()
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

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
