import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, type ReactNode, useState } from 'react'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { AppNavigateEvent, AppNavigateState } from '@shared/contracts/ipc'
import { Provider } from 'react-redux'
import { AuthProvider, useAuth } from '@renderer/providers/auth/auth-state'
import { ThemeProvider } from '@renderer/providers/theme/theme-state'
import { store } from '@renderer/store'
import { subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { ProtectedRoute } from '@renderer/components/routes/ProtectedRoute'
import { AppShell } from '@renderer/layout/AppShell'
import { DashboardPage, DetailedDashboardPage } from '@renderer/screens/DashboardPage'
import { ProfilePage } from '@renderer/screens/ProfilePage'
import { ProfileSetupPage } from '@renderer/screens/ProfileSetupPage'
import { ProjectsPage } from '@renderer/screens/projects/ProjectsPage'
import { ProjectNewPage } from '@renderer/screens/projects/ProjectNewPage'
import { ProjectDetailPage } from '@renderer/screens/projects/ProjectDetailPage'
import { WorkspacesPage } from '@renderer/screens/workspaces/WorkspacesPage'
import { AgentsPage } from '@renderer/screens/agents/AgentsPage'
import { AgentNewPage } from '@renderer/screens/agents/AgentNewPage'
import { GatewaysPage } from '@renderer/screens/gateways/GatewaysPage'
import { GatewayNewPage } from '@renderer/screens/gateways/GatewayNewPage'
import { GatewayDetailPage } from '@renderer/screens/gateways/GatewayDetailPage'
import { SettingsPage } from '@renderer/screens/settings/SettingsPage'
import { DocumentationPage } from '@renderer/screens/documentation/DocumentationPage'
import { SkillsPage } from '@renderer/screens/skills/SkillsPage'
import { ProjectGroupsPage } from '@renderer/screens/project-groups/ProjectGroupsPage'
import { ProjectGroupNewPage } from '@renderer/screens/project-groups/ProjectGroupNewPage'
import { ProjectGroupDetailPage } from '@renderer/screens/project-groups/ProjectGroupDetailPage'
import { CustomFieldsPage } from '@renderer/screens/custom-fields/CustomFieldsPage'
import { OutputFormatsPage } from '@renderer/screens/output-formats/OutputFormatsPage'
import { TaskTemplatesPage } from '@renderer/screens/task-templates/TaskTemplatesPage'
import { ProjectInstructionTemplatesPage } from '@renderer/screens/project-instruction-templates/ProjectInstructionTemplatesPage'
import { StatusesPage } from '@renderer/screens/statuses/StatusesPage'
import { TagsPage } from '@renderer/screens/tags/TagsPage'
import { TagAddPage } from '@renderer/screens/tags/TagAddPage'
import { ActivityPage } from '@renderer/screens/ActivityPage'
import { LastChatsPage } from '@renderer/screens/LastChatsPage'
import { InvitePage } from '@renderer/screens/InvitePage'
import { OnboardingPage } from '@renderer/screens/OnboardingPage'
import { CompanionPage } from '@renderer/screens/CompanionPage'
import { GlobalCreateTaskModal } from '@renderer/components/navigation/GlobalCreateTaskModal'
import type { GlobalTaskCreateInitial } from '@renderer/components/navigation/UniversalCommand'
import styles from './App.module.scss'

interface RouteConfig {
  path: string
  element: ReactNode
}

const SIGNED_IN_ROUTES: RouteConfig[] = [
  { path: '/', element: <Navigate to={APP_ROUTES.DASHBOARD} replace /> },
  { path: APP_ROUTES.DASHBOARD, element: <DashboardPage /> },
  { path: APP_ROUTES.DASHBOARD_DETAIL, element: <DetailedDashboardPage /> },
  { path: APP_ROUTES.PROFILE, element: <ProfilePage /> },
  { path: APP_ROUTES.PROJECTS, element: <ProjectsPage /> },
  { path: APP_ROUTES.PROJECTS_NEW, element: <ProjectNewPage /> },
  { path: APP_ROUTES.PROJECT_DETAIL, element: <ProjectDetailPage /> },
  { path: APP_ROUTES.WORKSPACES, element: <WorkspacesPage /> },
  { path: APP_ROUTES.AGENTS, element: <AgentsPage /> },
  { path: APP_ROUTES.AGENTS_NEW, element: <AgentNewPage /> },
  { path: APP_ROUTES.GATEWAYS, element: <GatewaysPage /> },
  { path: APP_ROUTES.GATEWAYS_NEW, element: <GatewayNewPage /> },
  { path: APP_ROUTES.GATEWAY_DETAIL, element: <GatewayDetailPage /> },
  { path: APP_ROUTES.SETTINGS, element: <SettingsPage /> },
  { path: APP_ROUTES.DOCUMENTATION, element: <DocumentationPage /> },
  { path: APP_ROUTES.DOCUMENTATION_GATEWAY, element: <DocumentationPage /> },
  { path: APP_ROUTES.SKILLS, element: <SkillsPage /> },
  { path: APP_ROUTES.PROJECT_GROUPS, element: <ProjectGroupsPage /> },
  { path: APP_ROUTES.PROJECT_GROUPS_NEW, element: <ProjectGroupNewPage /> },
  { path: APP_ROUTES.PROJECT_GROUP_DETAIL, element: <ProjectGroupDetailPage /> },
  { path: APP_ROUTES.CUSTOM_FIELDS, element: <CustomFieldsPage /> },
  { path: APP_ROUTES.OUTPUT_FORMATS, element: <OutputFormatsPage /> },
  { path: APP_ROUTES.TASK_TEMPLATES, element: <TaskTemplatesPage /> },
  { path: APP_ROUTES.PROJECT_INSTRUCTION_TEMPLATES, element: <ProjectInstructionTemplatesPage /> },
  { path: APP_ROUTES.STATUSES, element: <StatusesPage /> },
  { path: APP_ROUTES.TAGS, element: <TagsPage /> },
  { path: APP_ROUTES.TAG_ADD, element: <TagAddPage /> },
  { path: APP_ROUTES.ACTIVITY, element: <ActivityPage /> },
  { path: APP_ROUTES.LAST_CHATS, element: <LastChatsPage /> },
  { path: APP_ROUTES.INVITE, element: <InvitePage /> },
  { path: APP_ROUTES.ONBOARDING, element: <OnboardingPage /> },
  { path: APP_ROUTES.COMPANION, element: <CompanionPage /> },
  { path: '*', element: <Navigate to={APP_ROUTES.DASHBOARD} replace /> }
]

function SignedInRouter() {
  const location = useLocation()
  if (location.pathname === APP_ROUTES.COMPANION) {
    return (
      <ProtectedRoute>
        <CompanionPage />
      </ProtectedRoute>
    )
  }
  return (
    <ProtectedRoute>
      <AppShell>
        <Routes>
          {SIGNED_IN_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
        </Routes>
      </AppShell>
    </ProtectedRoute>
  )
}

function AppRouter() {
  const { initialized, user, errorMessage, refresh } = useAuth()
  const navigate = useNavigate()
  const [taskCreateInitial, setTaskCreateInitial] = useState<GlobalTaskCreateInitial | null>(null)
  const isElectron = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)
  const [autoRetried, setAutoRetried] = useState(false)
  const [manualRetried, setManualRetried] = useState(false)
  const isRuntimeError = isElectron && typeof errorMessage === 'string' && /IPC|ipc|bridge|runtime|renderer/i.test(errorMessage)
  const retryExhausted = autoRetried && manualRetried

  useEffect(() => {
    const onCompanionNavigate = (...args: unknown[]) => {
      const payload = (args[1] ?? args[0]) as AppNavigateEvent | undefined
      if (!payload || typeof payload.path !== 'string' || !payload.path.startsWith('/')) return
      const state = payload.state as AppNavigateState | undefined
      if (state?.openCreateTask) {
        setTaskCreateInitial({
          title: state.title,
          projectId: state.projectId ?? '',
          templateId: state.templateId ?? null
        })
        navigate(payload.path)
        return
      }
      if (payload.state === undefined) {
        navigate(payload.path)
        return
      }
      navigate(payload.path, { state: payload.state })
    }
    subscribeToChannel(IPC_CHANNELS.events.appNavigate, onCompanionNavigate)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.appNavigate, onCompanionNavigate)
  }, [navigate])

  useEffect(() => {
    if (!initialized || user || !isRuntimeError || autoRetried) {
      return
    }
    setAutoRetried(true)
    void refresh()
  }, [initialized, user, isRuntimeError, autoRetried, refresh])

  if (!initialized) {
    return (
      <div className={styles.pageState}>
        <h2>Yukleniyor...</h2>
        <p className={styles.helpText}>Session ve IPC durumu kontrol ediliyor.</p>
      </div>
    )
  }

  const handleRetry = () => {
    if (manualRetried || retryExhausted) {
      return
    }
    setManualRetried(true)
    void refresh()
  }

  if (user && !user.name?.trim()) {
    return (
      <Routes>
        <Route path={APP_ROUTES.PROFILE_SETUP} element={<ProtectedRoute><ProfileSetupPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={APP_ROUTES.PROFILE_SETUP} replace />} />
      </Routes>
    )
  }

  if (user) {
    return (
      <>
        <SignedInRouter />
        <GlobalCreateTaskModal
          open={Boolean(taskCreateInitial)}
          initial={taskCreateInitial}
          onClose={() => setTaskCreateInitial(null)}
        />
      </>
    )
  }

  return (
    <div className={styles.pageState}>
      <h2>Uygulama baslatilamadi</h2>
      {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
      {isRuntimeError && !manualRetried && <p className={styles.helpText}>Tekrar deneme baslatildi...</p>}
      {retryExhausted && <p className={styles.helpText}>Tekrar deneme tamamlanamadi. Uygulamayi kapatip yeniden baslatin.</p>}
      <button className={styles.retryButton} onClick={handleRetry} disabled={retryExhausted}>Tekrar Dene</button>
      <p className={styles.helpText}>
        {isElectron
          ? 'Renderer IPC baslatilamadi. Uygulamayi kapatip tekrar baslatin.'
          : 'Tarayicida actiysaniz bu mesaj normaldir; uygulamayi Electron ile calistirin.'}
      </p>
    </div>
  )
}

export function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </Provider>
  )
}
