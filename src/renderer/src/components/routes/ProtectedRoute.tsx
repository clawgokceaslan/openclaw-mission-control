import { Navigate, useLocation } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { useAuth } from '@renderer/providers/auth/auth-state'

export function ProtectedRoute({ children, inverse = false }: { children: React.ReactNode; inverse?: boolean }) {
  const { user } = useAuth()
  const location = useLocation()
  const isAuthenticated = Boolean(user)

  if (!inverse && !isAuthenticated) {
    return <Navigate to={APP_ROUTES.PROFILE_SETUP} replace state={{ from: location }} />
  }

  if (inverse && isAuthenticated) {
    return <Navigate to={APP_ROUTES.DASHBOARD} replace />
  }

  return <>{children}</>
}
