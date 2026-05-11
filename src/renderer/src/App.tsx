import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect, type ReactNode, useState } from 'react'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { AppNavigateEvent, AppNavigateState } from '@shared/contracts/ipc'
import { Provider } from 'react-redux'
import { AuthProvider, useAuth } from '@renderer/providers/auth/auth-state'
import { ThemeProvider } from '@renderer/providers/theme/theme-state'
import { store } from '@renderer/store'
import { ConfirmationProvider } from '@renderer/components/confirmation'
import { subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'
import { ProtectedRoute } from '@renderer/components/routes/ProtectedRoute'
import { AppShell } from '@renderer/layout/AppShell'
import { useRouteMetadata } from '@renderer/hooks/useRouteMetadata'
import { DashboardPage, DetailedDashboardPage } from '@renderer/screens/DashboardPage'
import { ProfilePage } from '@renderer/screens/ProfilePage'
import { ProfileSetupPage } from '@renderer/screens/ProfileSetupPage'
import { SignInPage } from '@renderer/screens/SignInPage'
import { ProjectsPage } from '@renderer/screens/projects/ProjectsPage'
import { ProjectNewPage } from '@renderer/screens/projects/ProjectNewPage'
import { ProjectDetailPage } from '@renderer/screens/projects/ProjectDetailPage'
import { PlanPipelinePage } from '@renderer/screens/plan-pipeline'
import { PlanPipelineRunsPage } from '@renderer/screens/plan-pipeline-runs'
import { RunPipelinePage } from '@renderer/screens/run-pipeline'
import { PipelineStatusPage } from '@renderer/screens/pipeline-status'
import { AgentsPage } from '@renderer/screens/agents/AgentsPage'
import { AgentNewPage } from '@renderer/screens/agents/AgentNewPage'
import { SettingsPage } from '@renderer/screens/settings/SettingsPage'
import { DocumentationPage } from '@renderer/screens/documentation/DocumentationPage'
import { SkillsPage } from '@renderer/screens/skills/SkillsPage'
import { ToolsPage } from '@renderer/screens/tools/ToolsPage'
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
import { RendererHealthReporter } from '@renderer/utils/rendererResilience'
import { SplashOverlay } from '@renderer/components/splash/SplashOverlay'
import styles from './App.module.scss'

interface RouteConfig {
  path: string
  element: ReactNode
}

function SettingsTabRedirect({ tab }: { tab: 'workspaces' | 'gateways' }) {
  const location = useLocation()
  return <Navigate to={`${APP_ROUTES.SETTINGS}?tab=${tab}${location.search ? `&${location.search.slice(1)}` : ''}`} replace />
}

function GatewayDetailRedirect() {
  const params = useParams<{ gatewayId?: string }>()
  const gatewayId = params.gatewayId ? `&gatewayId=${encodeURIComponent(params.gatewayId)}` : ''
  return <Navigate to={`${APP_ROUTES.SETTINGS}?tab=gateways${gatewayId}`} replace />
}

function PlanPipelineRunsRedirect() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const state = location.state as { pipeline?: unknown; pipelineId?: unknown; id?: unknown } | null
  const statePipelineId = [state?.pipeline, state?.pipelineId, state?.id].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const pipelineId = params.get('pipeline') ?? params.get('pipelineId') ?? params.get('id') ?? statePipelineId
  if (!pipelineId) {
    return <Navigate to={APP_ROUTES.PLAN_PIPELINE} replace />
  }
  return <Navigate to={`/plan-pipeline/${encodeURIComponent(pipelineId)}/runs`} replace />
}

const SIGNED_IN_ROUTES: RouteConfig[] = [
  { path: '/', element: <Navigate to={APP_ROUTES.DASHBOARD} replace /> },
  { path: APP_ROUTES.DASHBOARD, element: <DashboardPage /> },
  { path: APP_ROUTES.DASHBOARD_DETAIL, element: <DetailedDashboardPage /> },
  { path: APP_ROUTES.PROFILE, element: <ProfilePage /> },
  { path: APP_ROUTES.PROJECTS, element: <ProjectsPage /> },
  { path: APP_ROUTES.PLAN_PIPELINE, element: <PlanPipelinePage /> },
  { path: APP_ROUTES.PLAN_PIPELINE_RUNS, element: <PlanPipelineRunsRedirect /> },
  { path: APP_ROUTES.PLAN_PIPELINE_RUN_DETAIL, element: <PlanPipelineRunsPage /> },
  { path: APP_ROUTES.RUN_PIPELINE, element: <RunPipelinePage /> },
  { path: APP_ROUTES.PIPELINE_STATUS, element: <PipelineStatusPage /> },
  { path: APP_ROUTES.PIPELINE_STATUS_STANDALONE, element: <PipelineStatusPage /> },
  { path: APP_ROUTES.PROJECTS_NEW, element: <ProjectNewPage /> },
  { path: APP_ROUTES.PROJECT_DETAIL, element: <ProjectDetailPage /> },
  { path: APP_ROUTES.PROJECT_TASK_DETAIL, element: <ProjectDetailPage /> },
  { path: APP_ROUTES.PROJECT_SUBTASK_DETAIL, element: <ProjectDetailPage /> },
  { path: APP_ROUTES.WORKSPACES, element: <SettingsTabRedirect tab="workspaces" /> },
  { path: APP_ROUTES.AGENTS, element: <AgentsPage /> },
  { path: APP_ROUTES.AGENTS_NEW, element: <AgentNewPage /> },
  { path: APP_ROUTES.TOOLS, element: <ToolsPage /> },
  { path: APP_ROUTES.GATEWAYS, element: <SettingsTabRedirect tab="gateways" /> },
  { path: APP_ROUTES.GATEWAYS_NEW, element: <SettingsTabRedirect tab="gateways" /> },
  { path: APP_ROUTES.GATEWAY_DETAIL, element: <GatewayDetailRedirect /> },
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
  const location = useLocation()
  useRouteMetadata()
  const [taskCreateInitial, setTaskCreateInitial] = useState<GlobalTaskCreateInitial | null>(null)
  const isElectron = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)
  const [autoRetried, setAutoRetried] = useState(false)
  const [manualRetried, setManualRetried] = useState(false)
  const isRuntimeError = isElectron && typeof errorMessage === 'string' && /IPC|ipc|bridge|runtime|renderer/i.test(errorMessage)
  const authNotice = errorMessage && !isRuntimeError ? errorMessage : null
  const retryExhausted = autoRetried && manualRetried
  const splashReady = initialized || Boolean(errorMessage)

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

  const handleRetry = () => {
    if (manualRetried || retryExhausted) {
      return
    }
    setManualRetried(true)
    void refresh()
  }

  let appContent: ReactNode

  if (location.pathname === APP_ROUTES.PIPELINE_STATUS_STANDALONE || location.pathname.startsWith('/pipeline-status/watch/')) {
    appContent = (
      <Routes>
        <Route path={APP_ROUTES.PIPELINE_STATUS_STANDALONE} element={<PipelineStatusPage />} />
        <Route path={APP_ROUTES.PIPELINE_STATUS_WATCH} element={<PipelineStatusPage />} />
        <Route path="*" element={<PipelineStatusPage />} />
      </Routes>
    )
  } else if (!initialized) {
    appContent = (
      <div className={styles.pageState}>
        <h2>Yukleniyor...</h2>
        <p className={styles.helpText}>Session ve IPC durumu kontrol ediliyor.</p>
      </div>
    )
  } else if (user && !user.name?.trim()) {
    appContent = (
      <Routes>
        <Route path={APP_ROUTES.PROFILE_SETUP} element={<ProtectedRoute><ProfileSetupPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={APP_ROUTES.PROFILE_SETUP} replace />} />
      </Routes>
    )
  } else if (user) {
    if (location.pathname === APP_ROUTES.PIPELINE_STATUS_STANDALONE) {
      appContent = (
        <ProtectedRoute>
          <PipelineStatusPage />
        </ProtectedRoute>
      )
    } else {
      appContent = (
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
  } else if (isElectron && (isRuntimeError || !user)) {
    appContent = (
      <div className={styles.pageState}>
        <h2>Uygulama baslatilamadi</h2>
        {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
        {isRuntimeError && !manualRetried && <p className={styles.helpText}>Tekrar deneme baslatildi...</p>}
        {retryExhausted && <p className={styles.helpText}>Tekrar deneme tamamlanamadi. Uygulamayi kapatip yeniden baslatin.</p>}
        <button className={styles.retryButton} onClick={handleRetry} disabled={retryExhausted}>Tekrar Dene</button>
        <p className={styles.helpText}>Renderer IPC baslatilamadi. Uygulamayi kapatip tekrar baslatin.</p>
      </div>
    )
  } else {
    appContent = (
      <Routes>
        <Route path={APP_ROUTES.SIGN_IN} element={<SignInPage authNotice={authNotice} />} />
        <Route path="*" element={<Navigate to={APP_ROUTES.SIGN_IN} replace />} />
      </Routes>
    )
  }

  return (
    <>
      {appContent}
      <SplashOverlay ready={splashReady} />
    </>
  )
}

export function App() {
  const Router = typeof window !== 'undefined' && window.location.protocol === 'file:' ? HashRouter : BrowserRouter

  return (
    <Provider store={store}>
      <Router>
        <RendererHealthReporter />
        <ThemeProvider>
          <ConfirmationProvider>
            <AuthProvider>
              <AppRouter />
            </AuthProvider>
          </ConfirmationProvider>
        </ThemeProvider>
      </Router>
    </Provider>
  )
}
