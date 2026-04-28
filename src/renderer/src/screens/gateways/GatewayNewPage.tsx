import { Navigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'

export function GatewayNewPage() {
  return <Navigate to={APP_ROUTES.GATEWAYS} replace />
}
