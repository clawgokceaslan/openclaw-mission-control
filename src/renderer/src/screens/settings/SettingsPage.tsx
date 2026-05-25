import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LuArrowRight, LuBellOff, LuBot, LuCheck, LuClipboard, LuCog, LuCopy, LuDatabase, LuExternalLink, LuFileJson, LuFileSearch, LuFolderOpen, LuGlobe, LuHardDrive, LuLanguages, LuPlay, LuPower, LuRefreshCw, LuServer, LuSlidersHorizontal, LuTriangleAlert, LuVolume2, LuWaypoints, LuWifi } from 'react-icons/lu'
import { IPC_CHANNELS, type DatabaseLocationState, type PickDatabaseFileResponse, type PickDatabaseFolderResponse, type WebServerStatusState } from '@shared/contracts/ipc'
import { GATEWAY_LANGUAGE_OPTIONS, DEFAULT_GATEWAY_LANGUAGE } from '@shared/utils/gateway-language'
import { DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR, type PlannerQuestionAttentionBehavior } from '@shared/utils/planner-question-attention'
import { ALERT_SOUND_CATEGORIES, ALERT_SOUND_VARIANTS_BY_CATEGORY, DEFAULT_ALERT_SOUND_SETTINGS, normalizeAlertSoundSettings, type AlertSoundCategory, type AlertSoundSettings, type AlertSoundVariant } from '@shared/utils/alert-sound-settings'
import type { Agent } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { LoadingState } from '@renderer/components/loading'
import { WorkspacesPage } from '@renderer/screens/workspaces/WorkspacesPage'
import { GatewaysPage } from '@renderer/screens/gateways/GatewaysPage'
import { GatewayDetailPage } from '@renderer/screens/gateways/GatewayDetailPage'
import { playAlertSound } from '@renderer/utils/alertSounds'
import { webServerLanMessage, webServerPrimaryUrl, webServerStatusLabel, webServerStatusTone } from './webServerViewModel'
import styles from './SettingsPage.module.scss'

type SettingsSection = 'general' | 'alert-sounds' | 'workspaces' | 'gateways' | 'database' | 'web-server'

const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'alert-sounds', 'workspaces', 'gateways', 'database', 'web-server']

const databaseFallbackState: DatabaseLocationState = {
  currentFolderPath: '',
  currentDbPath: '',
  currentDbExists: false,
  pendingFolderPath: null,
  pendingDbPath: null,
  pendingDbExists: false,
  recommendedSourceDbPath: null,
  restartRequired: false
}

export function SettingsPage() {
  const { token } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') as SettingsSection | null
  const [activeSection, setActiveSection] = useState<SettingsSection>(requestedTab && SETTINGS_SECTIONS.includes(requestedTab) ? requestedTab : 'general')
  const selectedGatewayId = searchParams.get('gatewayId')
  const [agents, setAgents] = useState<Agent[]>([])
  const [defaultAgentId, setDefaultAgentId] = useState('')
  const [gatewayLanguage, setGatewayLanguage] = useState(DEFAULT_GATEWAY_LANGUAGE)
  const [gatewayLanguageSaving, setGatewayLanguageSaving] = useState(false)
  const [gatewayLanguageMessage, setGatewayLanguageMessage] = useState<string | null>(null)
  const [plannerQuestionAttention, setPlannerQuestionAttention] = useState<PlannerQuestionAttentionBehavior>(DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR)
  const [plannerQuestionAttentionSaving, setPlannerQuestionAttentionSaving] = useState(false)
  const [plannerQuestionAttentionMessage, setPlannerQuestionAttentionMessage] = useState<string | null>(null)
  const [alertSoundSettings, setAlertSoundSettings] = useState<AlertSoundSettings>(DEFAULT_ALERT_SOUND_SETTINGS)
  const [alertSoundSaving, setAlertSoundSaving] = useState(false)
  const [alertSoundMessage, setAlertSoundMessage] = useState<string | null>(null)
  const [alertSoundPreviewing, setAlertSoundPreviewing] = useState<AlertSoundCategory | null>(null)
  const [defaultAgentSaving, setDefaultAgentSaving] = useState(false)
  const [defaultAgentMessage, setDefaultAgentMessage] = useState<string | null>(null)
  const [databaseState, setDatabaseState] = useState<DatabaseLocationState>(databaseFallbackState)
  const [databaseFolder, setDatabaseFolder] = useState('')
  const [sourceDatabasePath, setSourceDatabasePath] = useState('')
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [databaseLoadError, setDatabaseLoadError] = useState<string | null>(null)
  const [databaseMoving, setDatabaseMoving] = useState(false)
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null)
  const [databaseCopied, setDatabaseCopied] = useState(false)
  const [webServerStatus, setWebServerStatus] = useState<WebServerStatusState | null>(null)
  const [webServerLoading, setWebServerLoading] = useState(false)
  const [webServerMessage, setWebServerMessage] = useState<string | null>(null)
  const [webServerHealth, setWebServerHealth] = useState<unknown>(null)
  const [webServerCapabilities, setWebServerCapabilities] = useState<unknown>(null)
  const [webServerAction, setWebServerAction] = useState<'open' | 'copy' | 'refresh' | 'restart' | null>(null)

  useEffect(() => {
    if (requestedTab && SETTINGS_SECTIONS.includes(requestedTab)) {
      setActiveSection(requestedTab)
    }
  }, [requestedTab])

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setAgents([])
      setDefaultAgentId('')
      setGatewayLanguage(DEFAULT_GATEWAY_LANGUAGE)
      setPlannerQuestionAttention(DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR)
      setAlertSoundSettings(DEFAULT_ALERT_SOUND_SETTINGS)
      setAlertSoundSaving(false)
      setAlertSoundMessage(null)
      setDatabaseState(databaseFallbackState)
      setDatabaseFolder('')
      setSourceDatabasePath('')
      setDatabaseLoading(false)
      setDatabaseLoadError(null)
      setWebServerStatus(null)
      setWebServerLoading(false)
      setWebServerMessage(null)
      setWebServerHealth(null)
      setWebServerCapabilities(null)
      return
    }
    setDatabaseLoading(true)
    setWebServerLoading(true)
    setDatabaseLoadError(null)
    void Promise.all([
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      invokeBridge<{ agentId: string | null }>(IPC_CHANNELS.appSettings.getDefaultAgent, { actorToken: token }),
      invokeBridge<{ language: string }>(IPC_CHANNELS.appSettings.getGatewayLanguage, { actorToken: token }),
      invokeBridge<{ behavior: PlannerQuestionAttentionBehavior }>(IPC_CHANNELS.appSettings.getPlannerQuestionAttention, { actorToken: token }),
      invokeBridge<{ settings: AlertSoundSettings }>(IPC_CHANNELS.appSettings.getAlertSoundSettings, { actorToken: token }),
      invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.getDatabaseLocation, { actorToken: token }),
      invokeBridge<WebServerStatusState>(IPC_CHANNELS.appSettings.getWebServerStatus, { actorToken: token })
    ]).then(([agentResponse, defaultResponse, languageResponse, plannerQuestionAttentionResponse, alertSoundResponse, databaseResponse, webServerResponse]) => {
      if (cancelled) return
      setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
      setDefaultAgentId(defaultResponse.ok && defaultResponse.data?.agentId ? defaultResponse.data.agentId : '')
      setGatewayLanguage(languageResponse.ok && languageResponse.data?.language ? languageResponse.data.language : DEFAULT_GATEWAY_LANGUAGE)
      setPlannerQuestionAttention(plannerQuestionAttentionResponse.ok && plannerQuestionAttentionResponse.data?.behavior ? plannerQuestionAttentionResponse.data.behavior : DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR)
      setAlertSoundSettings(alertSoundResponse.ok && alertSoundResponse.data?.settings ? normalizeAlertSoundSettings(alertSoundResponse.data.settings) : DEFAULT_ALERT_SOUND_SETTINGS)
      if (databaseResponse.ok && databaseResponse.data) {
        setDatabaseState(databaseResponse.data)
      } else {
        setDatabaseLoadError(databaseResponse.error?.message ?? 'Unable to load database location.')
      }
      if (webServerResponse.ok && webServerResponse.data) {
        setWebServerStatus(webServerResponse.data)
      } else {
        setWebServerMessage(webServerResponse.error?.message ?? 'Unable to load web server status.')
      }
    }).catch(() => {
      if (!cancelled) setDefaultAgentMessage('Unable to load settings.')
      if (!cancelled) setDatabaseLoadError('Unable to load database location.')
      if (!cancelled) setWebServerMessage('Unable to load web server status.')
    }).finally(() => {
      if (!cancelled) setDatabaseLoading(false)
      if (!cancelled) setWebServerLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const agentOptions = useMemo<AppSelectOption[]>(() => {
    return [...agents]
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .map((agent) => ({ value: agent.id, label: agent.name }))
  }, [agents])

  const selectedDefaultAgentOption = useMemo<AppSelectOption | null>(() => {
    return agentOptions.find((option) => option.value === defaultAgentId) ?? null
  }, [agentOptions, defaultAgentId])

  const gatewayLanguageOptions = useMemo<AppSelectOption[]>(() => (
    GATEWAY_LANGUAGE_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label
    }))
  ), [])

  const selectedGatewayLanguageOption = useMemo<AppSelectOption | null>(() => {
    return gatewayLanguageOptions.find((option) => option.value === gatewayLanguage) ?? gatewayLanguageOptions[0] ?? null
  }, [gatewayLanguage, gatewayLanguageOptions])

  const plannerQuestionAttentionOptions = useMemo<AppSelectOption[]>(() => [
    { value: 'focus-and-modal', label: 'Focus app and open modal' },
    { value: 'modal', label: 'Open in-app modal only' },
    { value: 'off', label: 'Do nothing automatically' }
  ], [])

  const selectedPlannerQuestionAttentionOption = useMemo<AppSelectOption | null>(() => {
    return plannerQuestionAttentionOptions.find((option) => option.value === plannerQuestionAttention) ?? plannerQuestionAttentionOptions[0] ?? null
  }, [plannerQuestionAttention, plannerQuestionAttentionOptions])

  const alertSoundVariantOptionsByCategory = useMemo<Record<AlertSoundCategory, AppSelectOption[]>>(() => ({
    success: ALERT_SOUND_VARIANTS_BY_CATEGORY.success.map((variant) => ({ value: variant.value, label: variant.label })),
    error: ALERT_SOUND_VARIANTS_BY_CATEGORY.error.map((variant) => ({ value: variant.value, label: variant.label })),
    warning: ALERT_SOUND_VARIANTS_BY_CATEGORY.warning.map((variant) => ({ value: variant.value, label: variant.label })),
    completed: ALERT_SOUND_VARIANTS_BY_CATEGORY.completed.map((variant) => ({ value: variant.value, label: variant.label }))
  }), [])

  const saveDefaultAgent = async (option: AppSelectOption | null) => {
    setDefaultAgentSaving(true)
    setDefaultAgentMessage(null)
    try {
      const response = await invokeBridge<{ agentId: string | null }>(IPC_CHANNELS.appSettings.setDefaultAgent, {
        actorToken: token,
        agentId: option?.value ?? null
      })
      if (!response.ok) {
        setDefaultAgentMessage(response.error?.message ?? 'Unable to update the default task agent.')
        return
      }
      setDefaultAgentId(response.data?.agentId ?? '')
      setDefaultAgentMessage(option ? 'Default task agent updated.' : 'Default task agent cleared.')
    } catch (error) {
      setDefaultAgentMessage(error instanceof Error ? error.message : 'Unable to update the default task agent.')
    } finally {
      setDefaultAgentSaving(false)
    }
  }

  const saveGatewayLanguage = async (option: AppSelectOption | null) => {
    setGatewayLanguageSaving(true)
    setGatewayLanguageMessage(null)
    try {
      const response = await invokeBridge<{ language: string }>(IPC_CHANNELS.appSettings.setGatewayLanguage, {
        actorToken: token,
        language: option?.value ?? DEFAULT_GATEWAY_LANGUAGE
      })
      if (!response.ok) {
        setGatewayLanguageMessage(response.error?.message ?? 'Unable to update Codex language.')
        return
      }
      setGatewayLanguage(response.data?.language ?? DEFAULT_GATEWAY_LANGUAGE)
      setGatewayLanguageMessage('Codex language updated.')
    } catch (error) {
      setGatewayLanguageMessage(error instanceof Error ? error.message : 'Unable to update Codex language.')
    } finally {
      setGatewayLanguageSaving(false)
    }
  }

  const savePlannerQuestionAttention = async (option: AppSelectOption | null) => {
    setPlannerQuestionAttentionSaving(true)
    setPlannerQuestionAttentionMessage(null)
    try {
      const response = await invokeBridge<{ behavior: PlannerQuestionAttentionBehavior }>(IPC_CHANNELS.appSettings.setPlannerQuestionAttention, {
        actorToken: token,
        behavior: option?.value ?? DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR
      })
      if (!response.ok) {
        setPlannerQuestionAttentionMessage(response.error?.message ?? 'Unable to update planner question behavior.')
        return
      }
      setPlannerQuestionAttention(response.data?.behavior ?? DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR)
      setPlannerQuestionAttentionMessage('Planner question behavior updated.')
    } catch (error) {
      setPlannerQuestionAttentionMessage(error instanceof Error ? error.message : 'Unable to update planner question behavior.')
    } finally {
      setPlannerQuestionAttentionSaving(false)
    }
  }

  const saveAlertSoundSettings = async (nextSettings: AlertSoundSettings, message: string) => {
    const normalized = normalizeAlertSoundSettings(nextSettings)
    setAlertSoundSettings(normalized)
    setAlertSoundSaving(true)
    setAlertSoundMessage(null)
    try {
      const response = await invokeBridge<{ settings: AlertSoundSettings }>(IPC_CHANNELS.appSettings.setAlertSoundSettings, {
        actorToken: token,
        settings: normalized
      })
      if (!response.ok) {
        setAlertSoundMessage(response.error?.message ?? 'Uyarı sesi ayarları kaydedilemedi.')
        return
      }
      setAlertSoundSettings(response.data?.settings ? normalizeAlertSoundSettings(response.data.settings) : normalized)
      setAlertSoundMessage(message)
    } catch (error) {
      setAlertSoundMessage(error instanceof Error ? error.message : 'Uyarı sesi ayarları kaydedilemedi.')
    } finally {
      setAlertSoundSaving(false)
    }
  }

  const saveAlertSoundVolume = (volume: number) => {
    void saveAlertSoundSettings({
      ...alertSoundSettings,
      volume
    }, 'Uyarı sesi yüksekliği güncellendi.')
  }

  const saveAlertSoundVariant = (category: AlertSoundCategory, option: AppSelectOption | null) => {
    void saveAlertSoundSettings({
      ...alertSoundSettings,
      variants: {
        ...alertSoundSettings.variants,
        [category]: (option?.value as AlertSoundVariant | undefined) ?? DEFAULT_ALERT_SOUND_SETTINGS.variants[category]
      }
    }, 'Uyarı sesi varyantı güncellendi.')
  }

  const previewAlertSound = async (category: AlertSoundCategory) => {
    setAlertSoundPreviewing(category)
    setAlertSoundMessage(null)
    try {
      await playAlertSound(alertSoundSettings.variants[category], alertSoundSettings.volume)
      setAlertSoundMessage(`${ALERT_SOUND_CATEGORIES.find((item) => item.value === category)?.label ?? 'Uyarı'} sesi çalındı.`)
    } catch (error) {
      setAlertSoundMessage(error instanceof Error ? error.message : 'Ses önizlemesi çalınamadı.')
    } finally {
      window.setTimeout(() => setAlertSoundPreviewing((current) => current === category ? null : current), 300)
    }
  }

  const pickDatabaseFolder = async () => {
    setDatabaseMessage(null)
    try {
      const response = await invokeBridge<PickDatabaseFolderResponse>(IPC_CHANNELS.appSettings.pickDatabaseFolder, { actorToken: token })
      if (!response.ok) {
        setDatabaseMessage(response.error?.message ?? 'Unable to select a database folder.')
        return
      }
      if (!response.data?.folderPath) {
        setDatabaseMessage('Database folder selection cancelled.')
        return
      }
      setDatabaseFolder(response.data.folderPath)
      setDatabaseMessage(`Selected folder: ${response.data.folderPath}`)
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'Unable to select a database folder.')
    }
  }

  const pickSourceDatabaseFile = async () => {
    setDatabaseMessage(null)
    try {
      const response = await invokeBridge<PickDatabaseFileResponse>(IPC_CHANNELS.appSettings.pickDatabaseFile, { actorToken: token })
      if (!response.ok) {
        setDatabaseMessage(response.error?.message ?? 'Unable to select a source database file.')
        return
      }
      if (!response.data?.filePath) {
        setDatabaseMessage('Source database selection cancelled.')
        return
      }
      setSourceDatabasePath(response.data.filePath)
      setDatabaseFolder('')
      setDatabaseMessage(`Source database selected: ${response.data.filePath}`)
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'Unable to select a source database file.')
    }
  }

  const useRecommendedSourceDatabase = () => {
    if (!databaseState.recommendedSourceDbPath) return
    setSourceDatabasePath(databaseState.recommendedSourceDbPath)
    setDatabaseFolder('')
    setDatabaseMessage(`Source database selected: ${databaseState.recommendedSourceDbPath}`)
  }

  const applyDatabaseMove = async () => {
    if (!databaseFolder) {
      setDatabaseMessage('Select a database folder first.')
      return
    }
    setDatabaseMoving(true)
    setDatabaseMessage(null)
    try {
      const response = await invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.moveDatabaseLocation, {
        actorToken: token,
        folderPath: databaseFolder,
        sourceDbPath: sourceDatabasePath || databaseState.recommendedSourceDbPath || null
      })
      if (!response.ok) {
        setDatabaseMessage(response.error?.message ?? 'Unable to move the database folder.')
        return
      }
      setDatabaseState(response.data ?? databaseState)
      if (response.data?.restartRequired) {
        setDatabaseMessage('Database moved. Restarting the app...')
        const restartResponse = await invokeBridge<{ restarting: boolean }>(IPC_CHANNELS.app.restartToDatabaseSettings, {})
        if (!restartResponse.ok) {
          setDatabaseMessage(restartResponse.error?.message ?? 'Database moved, but the app could not restart automatically.')
          setDatabaseMoving(false)
        }
        return
      } else {
        setDatabaseMessage('Database is already using this folder.')
      }
      setDatabaseFolder('')
      setSourceDatabasePath('')
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'Unable to move the database folder.')
    } finally {
      setDatabaseMoving(false)
    }
  }

  const refreshDatabaseLocation = async () => {
    setDatabaseMessage(null)
    setDatabaseLoading(true)
    setDatabaseLoadError(null)
    try {
      const response = await invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.getDatabaseLocation, { actorToken: token })
      if (!response.ok) {
        const message = response.error?.message ?? 'Unable to refresh database location.'
        setDatabaseLoadError(message)
        setDatabaseMessage(message)
        return
      }
      setDatabaseState(response.data ?? databaseFallbackState)
      setDatabaseMessage('Database location refreshed.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh database location.'
      setDatabaseLoadError(message)
      setDatabaseMessage(message)
    } finally {
      setDatabaseLoading(false)
    }
  }

  const copyDatabasePath = async () => {
    const value = databaseState.currentDbPath || databaseState.currentFolderPath
    if (!value) {
      setDatabaseMessage('No database path is available to copy.')
      return
    }
    try {
      await navigator.clipboard?.writeText(value)
      setDatabaseCopied(true)
      setDatabaseMessage('Database path copied.')
      window.setTimeout(() => setDatabaseCopied(false), 1600)
    } catch {
      setDatabaseMessage('Unable to copy database path.')
    }
  }

  const revealDatabasePath = async () => {
    const value = databaseState.currentDbPath || databaseState.currentFolderPath
    if (!value) {
      setDatabaseMessage('No database path is available to open.')
      return
    }
    const response = await invokeBridge<{ revealed: boolean }>(IPC_CHANNELS.appSettings.revealDatabaseLocation, {
      actorToken: token,
      path: value
    })
    if (!response.ok) {
      setDatabaseMessage(response.error?.message ?? 'Unable to open database folder.')
      return
    }
    setDatabaseMessage('Database folder opened.')
  }

  const refreshWebServerStatus = async (withPublicChecks = false) => {
    setWebServerAction('refresh')
    setWebServerLoading(true)
    setWebServerMessage(null)
    try {
      const response = await invokeBridge<WebServerStatusState>(IPC_CHANNELS.appSettings.getWebServerStatus, { actorToken: token })
      if (!response.ok || !response.data) {
        setWebServerMessage(response.error?.message ?? 'Unable to refresh web server status.')
        return
      }
      setWebServerStatus(response.data)
      if (!withPublicChecks) {
        setWebServerMessage('Web server status refreshed.')
        return
      }
      const baseUrl = webServerPrimaryUrl(response.data)
      if (!baseUrl || response.data.status !== 'running') {
        setWebServerHealth(null)
        setWebServerCapabilities(null)
        setWebServerMessage('Web server is not running, so public endpoint checks were skipped.')
        return
      }
      const [healthResponse, capabilitiesResponse] = await Promise.all([
        fetch(`${baseUrl}/api/health`),
        fetch(`${baseUrl}/api/capabilities`)
      ])
      const health = await healthResponse.json()
      const capabilities = await capabilitiesResponse.json()
      setWebServerHealth(health)
      setWebServerCapabilities(capabilities)
      if (!healthResponse.ok || !capabilitiesResponse.ok) {
        setWebServerMessage('Public endpoint checks returned an error.')
        return
      }
      setWebServerMessage('Health and capabilities refreshed.')
    } catch (error) {
      setWebServerMessage(error instanceof Error ? error.message : 'Unable to refresh web server checks.')
    } finally {
      setWebServerLoading(false)
      setWebServerAction(null)
    }
  }

  const openWebServerUrl = async () => {
    const url = webServerPrimaryUrl(webServerStatus)
    if (!url) {
      setWebServerMessage('No web URL is available to open.')
      return
    }
    setWebServerAction('open')
    setWebServerMessage(null)
    try {
      const response = await invokeBridge<{ opened: boolean; url: string }>(IPC_CHANNELS.appSettings.openWebServerUrl, {
        actorToken: token,
        url
      })
      setWebServerMessage(response.ok ? 'Web URL opened.' : response.error?.message ?? 'Unable to open web URL.')
    } catch (error) {
      setWebServerMessage(error instanceof Error ? error.message : 'Unable to open web URL.')
    } finally {
      setWebServerAction(null)
    }
  }

  const copyWebServerUrl = async () => {
    const url = webServerPrimaryUrl(webServerStatus)
    if (!url) {
      setWebServerMessage('No web URL is available to copy.')
      return
    }
    setWebServerAction('copy')
    try {
      await navigator.clipboard?.writeText(url)
      setWebServerMessage('Web URL copied.')
      window.setTimeout(() => {
        setWebServerAction((current) => current === 'copy' ? null : current)
      }, 1400)
    } catch {
      setWebServerMessage('Unable to copy web URL.')
      setWebServerAction(null)
    }
  }

  const restartAppFromWebServerPanel = async () => {
    setWebServerAction('restart')
    setWebServerMessage(null)
    try {
      const response = await invokeBridge<{ restarting: boolean }>(IPC_CHANNELS.app.restart, {})
      if (!response.ok) {
        setWebServerMessage(response.error?.message ?? 'Unable to restart the app.')
        setWebServerAction(null)
        return
      }
      setWebServerMessage('Restarting the app...')
    } catch (error) {
      setWebServerMessage(error instanceof Error ? error.message : 'Unable to restart the app.')
      setWebServerAction(null)
    }
  }

  const selectSection = (section: SettingsSection) => {
    setActiveSection(section)
    setSearchParams(section === 'general' ? {} : { tab: section })
  }

  const openGatewayDetail = (gatewayId: string) => {
    setActiveSection('gateways')
    setSearchParams({ tab: 'gateways', gatewayId })
  }

  const closeGatewayDetail = () => {
    setActiveSection('gateways')
    setSearchParams({ tab: 'gateways' })
  }

  const sections = [
    { id: 'general' as SettingsSection, label: 'General', icon: LuSlidersHorizontal },
    { id: 'alert-sounds' as SettingsSection, label: 'Uyarı Sesleri', icon: LuVolume2 },
    { id: 'workspaces' as SettingsSection, label: 'Workspaces', icon: LuFolderOpen },
    { id: 'gateways' as SettingsSection, label: 'Gateways', icon: LuWaypoints },
    { id: 'database' as SettingsSection, label: 'Database', icon: LuHardDrive },
    { id: 'web-server' as SettingsSection, label: 'Web Sunucusu', icon: LuServer }
  ]

  const hasPendingRestart = databaseState.restartRequired
  const sourcePath = sourceDatabasePath || databaseState.recommendedSourceDbPath || (databaseState.currentDbExists ? databaseState.currentDbPath : '')
  const hasValidSource = Boolean(sourceDatabasePath || databaseState.recommendedSourceDbPath || (databaseState.currentDbExists && databaseState.currentDbPath))
  const sourceStatus = sourceDatabasePath
    ? 'Manual source'
    : databaseState.recommendedSourceDbPath
      ? 'Detected development data file'
      : databaseState.currentDbExists
        ? 'Active database'
        : 'Missing source'
  const sourceStepMessage = databaseLoading
    ? 'Veritabanı durumu hazırlanıyor.'
    : databaseLoadError
      ? databaseLoadError
      : hasValidSource
        ? 'This is the database file that will be moved.'
        : 'No usable source database was found. Select an existing SQLite file to continue.'
  const destinationDisabled = databaseMoving || databaseLoading || Boolean(databaseLoadError) || !hasValidSource
  const destinationStatus = databaseLoading
    ? 'Waiting'
    : databaseLoadError
      ? 'Blocked'
      : !hasValidSource
        ? 'Source required'
        : databaseFolder
          ? 'Ready'
          : 'Required'
  const destinationStepMessage = databaseLoading
    ? 'Destination selection will unlock after the current database status loads.'
    : databaseLoadError
      ? 'Refresh the database status before selecting a destination.'
      : !hasValidSource
        ? 'Select a source database first. The destination stays locked to avoid an invalid move.'
        : databaseFolder
          ? 'This folder will contain mission-control.sqlite after restart.'
          : 'Choose the folder that should contain the SQLite database after restart.'
  const confirmDisabled = destinationDisabled || !databaseFolder
  const confirmStatus = databaseMoving
    ? 'Moving'
    : confirmDisabled
      ? 'Waiting'
      : 'Ready'
  const confirmStepMessage = databaseMoving
    ? 'Moving the database and preparing the restart.'
    : !hasValidSource
      ? 'Answer the source question first.'
      : !databaseFolder
        ? 'Answer the destination question before moving the database.'
        : 'Review the answers, then move the database and restart into the new location.'
  const webPrimaryUrl = webServerPrimaryUrl(webServerStatus)
  const webStatusTone = webServerStatus ? webServerStatusTone(webServerStatus.status) : 'muted'
  const webServerCanUseUrl = Boolean(webPrimaryUrl && webServerStatus?.status === 'running')

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Settings</h1>
          <p>Manage application behavior and runtime defaults.</p>
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.tabBar} aria-label="Settings sections">
          {sections.map((section) => {
            const Icon = section.icon
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                className={isActive ? styles.activeTabItem : styles.tabItem}
                onClick={() => selectSection(section.id)}
              >
                <span><Icon size={17} /></span>
                {section.label}
              </button>
            )
          })}
        </nav>

        <section className={styles.surface}>
          {activeSection === 'general' ? (
            <div className={styles.panel}>
              <header className={styles.panelHeader}>
                <span className={styles.panelIcon}><LuCog size={19} /></span>
                <div>
                  <h2>General settings</h2>
                  <p>Default task agent, Codex language, and planner question attention.</p>
                </div>
              </header>
              <div className={styles.surfaceSection}>
                <h3><LuBot size={17} /> Default task agent</h3>
                <div className={styles.defaultAgentRow}>
                  <AppSelect
                    mode="single"
                    value={selectedDefaultAgentOption}
                    options={agentOptions}
                    placeholder={agents.length > 0 ? 'Select a default agent' : 'No agents available'}
                    isClearable
                    isDisabled={defaultAgentSaving || agents.length === 0}
                    onChange={(option) => {
                      if (!Array.isArray(option)) void saveDefaultAgent(option)
                    }}
                  />
                  <span>{defaultAgentSaving ? 'Saving...' : selectedDefaultAgentOption ? `${selectedDefaultAgentOption.label} will be used for new tasks.` : 'No default agent assigned.'}</span>
                </div>
                {defaultAgentMessage ? <p className={styles.settingMessage}>{defaultAgentMessage}</p> : null}
              </div>

              <div className={styles.surfaceSection}>
                <h3><LuLanguages size={17} /> Codex language</h3>
                <div className={styles.defaultAgentRow}>
                  <AppSelect
                    mode="single"
                    value={selectedGatewayLanguageOption}
                    options={gatewayLanguageOptions}
                    placeholder="Select Codex language"
                    isDisabled={gatewayLanguageSaving}
                    onChange={(option) => {
                      if (!Array.isArray(option)) void saveGatewayLanguage(option)
                    }}
                  />
                  <span>{gatewayLanguageSaving ? 'Saving...' : `${selectedGatewayLanguageOption?.label ?? 'Turkish'} will be used for Codex output.`}</span>
                </div>
                {gatewayLanguageMessage ? <p className={styles.settingMessage}>{gatewayLanguageMessage}</p> : null}
              </div>

              <div className={styles.surfaceSection}>
                <h3><LuBellOff size={17} /> Planner question attention</h3>
                <div className={styles.defaultAgentRow}>
                  <AppSelect
                    mode="single"
                    value={selectedPlannerQuestionAttentionOption}
                    options={plannerQuestionAttentionOptions}
                    placeholder="Select planner question behavior"
                    isDisabled={plannerQuestionAttentionSaving}
                    onChange={(option) => {
                      if (!Array.isArray(option)) void savePlannerQuestionAttention(option)
                    }}
                  />
                  <span>{plannerQuestionAttentionSaving ? 'Saving...' : 'Planner questions never use system notifications.'}</span>
                </div>
                <p className={styles.settingMessage}>Controls only the in-app planner question modal and whether Open Mission Control is brought forward when a new question arrives.</p>
                {plannerQuestionAttentionMessage ? <p className={styles.settingMessage}>{plannerQuestionAttentionMessage}</p> : null}
              </div>
            </div>
          ) : null}

          {activeSection === 'alert-sounds' ? (
            <div className={styles.panel}>
              <header className={styles.panelHeader}>
                <span className={styles.panelIcon}><LuVolume2 size={19} /></span>
                <div>
                  <h2>Uyarı sesleri</h2>
                  <p>Planla ve Çalıştır akışlarında kullanılan ses yüksekliği ve durum varyantları.</p>
                </div>
              </header>

              <div className={styles.surfaceSection}>
                <h3><LuVolume2 size={17} /> Ortak ses yüksekliği</h3>
                <div className={styles.alertVolumeRow}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={Math.round(alertSoundSettings.volume * 100)}
                    disabled={alertSoundSaving}
                    aria-label="Uyarı sesi yüksekliği"
                    onChange={(event) => setAlertSoundSettings({
                      ...alertSoundSettings,
                      volume: Number(event.target.value) / 100
                    })}
                    onBlur={(event) => saveAlertSoundVolume(Number(event.currentTarget.value) / 100)}
                    onMouseUp={(event) => saveAlertSoundVolume(Number(event.currentTarget.value) / 100)}
                    onTouchEnd={(event) => saveAlertSoundVolume(Number(event.currentTarget.value) / 100)}
                  />
                  <strong>{Math.round(alertSoundSettings.volume * 100)}%</strong>
                </div>
                <p className={styles.settingMessage}>Bu değer Planla ve Çalıştır uyarılarında aynı çarpan olarak uygulanır.</p>
              </div>

              <div className={styles.alertSoundGrid}>
                {ALERT_SOUND_CATEGORIES.map((category) => {
                  const categoryVariants = ALERT_SOUND_VARIANTS_BY_CATEGORY[category.value]
                  const variantOptions = alertSoundVariantOptionsByCategory[category.value]
                  const selectedVariant = variantOptions.find((option) => option.value === alertSoundSettings.variants[category.value]) ?? variantOptions[0] ?? null
                  const description = categoryVariants.find((variant) => variant.value === selectedVariant?.value)?.description ?? ''
                  return (
                    <section key={category.value} className={styles.alertSoundCard}>
                      <header>
                        <div>
                          <h3>{category.label}</h3>
                          <p>{description}</p>
                        </div>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => void previewAlertSound(category.value)}
                          disabled={alertSoundPreviewing === category.value || alertSoundSettings.volume <= 0}
                          aria-label={`${category.label} sesini önizle`}
                          title={`${category.label} sesini önizle`}
                        >
                          {alertSoundPreviewing === category.value ? <LoadingState size="compact" message="" /> : <LuPlay size={15} />}
                        </button>
                      </header>
                      <AppSelect
                        mode="single"
                        value={selectedVariant}
                        options={variantOptions}
                        placeholder="Varyant seç"
                        isDisabled={alertSoundSaving}
                        onChange={(option) => {
                          if (!Array.isArray(option)) saveAlertSoundVariant(category.value, option)
                        }}
                      />
                    </section>
                  )
                })}
              </div>

              {alertSoundMessage ? <p className={styles.settingMessage}>{alertSoundMessage}</p> : null}
            </div>
          ) : null}

          {activeSection === 'workspaces' ? (
            <div className={styles.panel}>
              <WorkspacesPage embedded />
            </div>
          ) : null}

          {activeSection === 'gateways' ? (
            <div className={styles.panel}>
              {selectedGatewayId ? (
                <GatewayDetailPage embedded gatewayId={selectedGatewayId} onBack={closeGatewayDetail} />
              ) : (
                <GatewaysPage embedded onOpenGateway={openGatewayDetail} />
              )}
            </div>
          ) : null}

          {activeSection === 'web-server' ? (
            <div className={`${styles.panel} ${styles.webServerPanel}`}>
              <header className={styles.webServerHero}>
                <span className={styles.panelIcon}><LuServer size={19} /></span>
                <div>
                  <h2>Web Sunucusu</h2>
                  <p>Runtime web arayüzü, public health kontrolleri ve yerel ağ erişim durumu.</p>
                </div>
                <span className={webStatusTone === 'ok' ? styles.statusPillOk : webStatusTone === 'warn' ? styles.statusPillWarn : styles.statusPillMuted}>
                  {webServerLoading ? 'Loading' : webServerStatus ? webServerStatusLabel(webServerStatus.status) : 'Unknown'}
                </span>
              </header>

              {webServerLoading && !webServerStatus ? (
                <div className={styles.webServerNotice} role="status">
                  <LoadingState size="compact" message="" />
                  <span>Web server status is loading.</span>
                </div>
              ) : null}

              {webServerStatus?.status === 'error' ? (
                <div className={styles.databaseWarning} role="alert">
                  <LuTriangleAlert size={17} />
                  <span>{webServerStatus.lastError || 'Web server failed to start.'}</span>
                </div>
              ) : null}

              {webServerStatus?.status === 'stopped' ? (
                <div className={styles.webServerNotice} role="status">
                  <LuPower size={17} />
                  <span>Web server is currently stopped. Restart the app to start it again.</span>
                </div>
              ) : null}

              <div className={styles.webServerGrid}>
                <div className={styles.webServerMetric}>
                  <small>Status</small>
                  <strong>{webServerStatus ? webServerStatusLabel(webServerStatus.status) : 'Unknown'}</strong>
                  <span>{webServerStatus?.lastError || 'Current runtime state'}</span>
                </div>
                <div className={styles.webServerMetric}>
                  <small>Host</small>
                  <strong>{webServerStatus?.host || 'Unknown'}</strong>
                  <span>{webServerStatus?.lanReachable ? 'LAN binding is reachable.' : 'Bound to localhost or unavailable.'}</span>
                </div>
                <div className={styles.webServerMetric}>
                  <small>Preferred port</small>
                  <strong>{webServerStatus?.preferredPort || 'Unknown'}</strong>
                  <span>Configured startup port</span>
                </div>
                <div className={styles.webServerMetric}>
                  <small>Actual port</small>
                  <strong>{webServerStatus?.actualPort ?? 'Not listening'}</strong>
                  <span>Active listener port after fallback scan</span>
                </div>
              </div>

              <section className={styles.surfaceSection}>
                <h3><LuGlobe size={17} /> Localhost URL</h3>
                <div className={styles.webServerUrlRow}>
                  <span>{webPrimaryUrl || 'No local URL available'}</span>
                  <button type="button" className={styles.secondaryButton} onClick={() => void openWebServerUrl()} disabled={!webServerCanUseUrl || webServerAction === 'open'}>
                    <LuExternalLink size={15} />
                    {webServerAction === 'open' ? 'Opening' : 'Open'}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void copyWebServerUrl()} disabled={!webPrimaryUrl || webServerAction === 'copy'}>
                    {webServerAction === 'copy' ? <LuCheck size={15} /> : <LuCopy size={15} />}
                    {webServerAction === 'copy' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </section>

              <section className={styles.surfaceSection}>
                <h3><LuWifi size={17} /> LAN IPv4 addresses</h3>
                <p className={styles.settingMessage}>{webServerLanMessage(webServerStatus)}</p>
                <div className={styles.lanAddressList}>
                  {webServerStatus?.lanAddresses.length ? webServerStatus.lanAddresses.map((entry) => (
                    <label key={entry.address}>
                      <small>{entry.address}</small>
                      <span>{entry.url || 'Not reachable while bound to localhost'}</span>
                    </label>
                  )) : (
                    <div className={styles.webServerEmpty}>No LAN IPv4 address found.</div>
                  )}
                </div>
              </section>

              <section className={styles.surfaceSection}>
                <h3><LuFileJson size={17} /> Health and capabilities</h3>
                <div className={styles.webServerActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => void refreshWebServerStatus(true)} disabled={webServerAction === 'refresh'}>
                    <LuRefreshCw size={15} />
                    {webServerAction === 'refresh' ? <LoadingState size="compact" message="" /> : 'Refresh checks'}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void refreshWebServerStatus(false)} disabled={webServerAction === 'refresh'}>
                    <LuRefreshCw size={15} />
                    Refresh status
                  </button>
                  <button type="button" className={styles.primaryButton} onClick={() => void restartAppFromWebServerPanel()} disabled={webServerAction === 'restart'}>
                    <LuPower size={15} />
                    {webServerAction === 'restart' ? 'Restarting' : 'Restart app'}
                  </button>
                </div>
                <div className={styles.webServerChecks}>
                  <label>
                    <small>Health</small>
                    <code>{webServerHealth ? JSON.stringify(webServerHealth) : 'Not refreshed yet'}</code>
                  </label>
                  <label>
                    <small>Capabilities</small>
                    <code>{webServerCapabilities ? JSON.stringify(webServerCapabilities) : 'Not refreshed yet'}</code>
                  </label>
                </div>
                {webServerMessage ? <p className={styles.settingMessage}>{webServerMessage}</p> : null}
              </section>
            </div>
          ) : null}

          {activeSection === 'database' ? (
            <div className={`${styles.panel} ${styles.databasePanel}`}>
              <header className={styles.databaseHero}>
                <span className={styles.panelIcon}><LuHardDrive size={19} /></span>
                <div>
                  <h2>Database</h2>
                  <p>Move the SQLite database to a folder that will be activated after restart.</p>
                </div>
                <span className={databaseState.currentDbExists ? styles.statusPillOk : styles.statusPillWarn}>
                  {databaseState.currentDbExists ? 'Current file found' : 'Current file missing'}
                </span>
              </header>

              <div className={styles.databaseOverview}>
                <div className={styles.databasePathBlock}>
                  <small>Current location</small>
                  <strong>{databaseState.currentFolderPath || 'Unknown'}</strong>
                  <span>{databaseState.currentDbPath || 'No database path available'}</span>
                </div>
                <div className={styles.databasePathBlock}>
                  <small>Pending location</small>
                  <strong>{databaseState.pendingFolderPath || 'None'}</strong>
                  <span>{databaseState.pendingDbPath || 'No pending database file'}</span>
                </div>
              </div>

              {!databaseState.currentDbExists ? (
                <div className={styles.databaseWarning} role="status">
                  <LuTriangleAlert size={17} />
                  <span>The configured database file was not found. Select the existing SQLite file before moving it.</span>
                </div>
              ) : null}

              <div className={styles.databaseFlow}>
                <section className={styles.databaseStep}>
                  <div className={styles.stepMarker}>
                    <span>1</span>
                    <LuDatabase size={16} />
                  </div>
                  <div className={styles.stepContent}>
                    <header>
                      <div>
                        <h3>1. Which database should move?</h3>
                        <p>{sourceStepMessage}</p>
                      </div>
                      <b className={hasValidSource ? styles.stepStatusReady : styles.stepStatusBlocked}>{sourceStatus}</b>
                    </header>
                    <div className={styles.pathInput}>
                      <span>{sourcePath || 'No source selected'}</span>
                      <b>{databaseLoading ? <LoadingState size="compact" message="" /> : databaseLoadError ? 'Error' : sourceStatus}</b>
                    </div>
                    <div className={styles.databaseActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => void pickSourceDatabaseFile()} disabled={databaseMoving || databaseLoading}>
                        <LuFileSearch size={15} />
                        Select database file
                      </button>
                      {databaseState.recommendedSourceDbPath ? (
                        <button type="button" className={styles.secondaryButton} onClick={useRecommendedSourceDatabase} disabled={databaseMoving || databaseLoading}>
                          <LuCheck size={15} />
                          Use detected data file
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>

                <span className={styles.transferArrow}><LuArrowRight size={18} /></span>

                <section className={destinationDisabled ? styles.databaseStepDisabled : styles.databaseStep}>
                  <div className={styles.stepMarker}>
                    <span>2</span>
                    <LuFolderOpen size={16} />
                  </div>
                  <div className={styles.stepContent}>
                    <header>
                      <div>
                        <h3>2. Where should it live?</h3>
                        <p>{destinationStepMessage}</p>
                      </div>
                      <b className={databaseFolder ? styles.stepStatusReady : styles.stepStatusBlocked}>{destinationStatus}</b>
                    </header>
                    <div className={styles.pathInput}>
                      <span>{databaseFolder || 'No destination folder selected'}</span>
                      <b>{destinationStatus}</b>
                    </div>
                    <div className={styles.databaseActions}>
                      <button type="button" className={styles.secondaryButton} onClick={pickDatabaseFolder} disabled={destinationDisabled}>
                        <LuFolderOpen size={15} />
                        Select folder
                      </button>
                    </div>
                  </div>
                </section>

                <span className={styles.transferArrow}><LuArrowRight size={18} /></span>

                <section className={confirmDisabled ? styles.databaseStepDisabled : styles.databaseStep}>
                  <div className={styles.stepMarker}>
                    <span>3</span>
                    <LuCheck size={16} />
                  </div>
                  <div className={styles.stepContent}>
                    <header>
                      <div>
                        <h3>3. Ready to move and restart?</h3>
                        <p>{confirmStepMessage}</p>
                      </div>
                      <b className={!confirmDisabled ? styles.stepStatusReady : styles.stepStatusBlocked}>{confirmStatus}</b>
                    </header>
                    <div className={styles.databaseSummary}>
                      <label>
                        <small>From</small>
                        <span>{sourcePath || 'Waiting for source database'}</span>
                      </label>
                      <label>
                        <small>To</small>
                        <span>{databaseFolder || 'Waiting for destination folder'}</span>
                      </label>
                    </div>
                    <div className={styles.databaseActions}>
                      <button type="button" className={styles.primaryButton} onClick={applyDatabaseMove} disabled={confirmDisabled}>
                        {databaseMoving ? <LoadingState size="compact" messageIndex={2} /> : 'Move database'}
                      </button>
                    </div>
                  </div>
                </section>
              </div>

              {hasPendingRestart ? (
                <p className={styles.restartNotice}>Restart the app to switch to the pending database location.</p>
              ) : null}

              <div className={styles.databaseFooter}>
                <div className={styles.databaseActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => void copyDatabasePath()} disabled={!databaseState.currentDbPath && !databaseState.currentFolderPath}>
                    {databaseCopied ? <LuCheck size={15} /> : <LuClipboard size={15} />}
                    {databaseCopied ? 'Copied' : 'Copy current path'}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void revealDatabasePath()} disabled={!databaseState.currentDbPath && !databaseState.currentFolderPath}>
                    <LuFolderOpen size={15} />
                    Show current folder
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void refreshDatabaseLocation()} disabled={databaseLoading}>
                    <LuRefreshCw size={15} />
                    {databaseLoading ? <LoadingState size="compact" message="" /> : 'Refresh'}
                  </button>
                </div>
                {databaseMessage ? <p className={styles.settingMessage}>{databaseMessage}</p> : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  )
}
