import { Navigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'

export function ProjectGroupDetailPage() {
  return <Navigate to={APP_ROUTES.PROJECT_GROUPS} replace />
}
