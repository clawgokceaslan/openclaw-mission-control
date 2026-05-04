import { Navigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'

export function AgentNewPage() {
  return <Navigate to={`${APP_ROUTES.AGENTS}?create=1`} replace />
}
