import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LuArrowRight, LuBot, LuCheck, LuClipboard, LuCog, LuDatabase, LuFileSearch, LuFolderOpen, LuHardDrive, LuLanguages, LuRefreshCw, LuSlidersHorizontal, LuTriangleAlert, LuWaypoints } from 'react-icons/lu'
import { IPC_CHANNELS, type DatabaseLocationState, type PickDatabaseFileResponse, type PickDatabaseFolderResponse } from '@shared/contracts/ipc'
import { GATEWAY_LANGUAGE_OPTIONS, DEFAULT_GATEWAY_LANGUAGE } from '@shared/utils/gateway-language'
import type { Agent } from '@shared/types/entities'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { WorkspacesPage } from '@renderer/screens/workspaces/WorkspacesPage'
import { GatewaysPage } from '@renderer/screens/gateways/GatewaysPage'
import { GatewayDetailPage } from '@renderer/screens/gateways/GatewayDetailPage'
import styles from './SettingsPage.module.scss'

type SettingsSection = 'general' | 'workspaces' | 'gateways' | 'database'

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
  const [activeSection, setActiveSection] = useState<SettingsSection>(requestedTab && ['general', 'workspaces', 'gateways', 'database'].includes(requestedTab) ? requestedTab : 'general')
  const selectedGatewayId = searchParams.get('gatewayId')
  const [agents, setAgents] = useState<Agent[]>([])
  const [defaultAgentId, setDefaultAgentId] = useState('')
  const [gatewayLanguage, setGatewayLanguage] = useState(DEFAULT_GATEWAY_LANGUAGE)
  const [gatewayLanguageSaving, setGatewayLanguageSaving] = useState(false)
  const [gatewayLanguageMessage, setGatewayLanguageMessage] = useState<string | null>(null)
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

  useEffect(() => {
    if (requestedTab && ['general', 'workspaces', 'gateways', 'database'].includes(requestedTab)) {
      setActiveSection(requestedTab)
    }
  }, [requestedTab])

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setAgents([])
      setDefaultAgentId('')
      setGatewayLanguage(DEFAULT_GATEWAY_LANGUAGE)
      setDatabaseState(databaseFallbackState)
      setDatabaseFolder('')
      setSourceDatabasePath('')
      setDatabaseLoading(false)
      setDatabaseLoadError(null)
      return
    }
    setDatabaseLoading(true)
    setDatabaseLoadError(null)
    void Promise.all([
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      invokeBridge<{ agentId: string | null }>(IPC_CHANNELS.appSettings.getDefaultAgent, { actorToken: token }),
      invokeBridge<{ language: string }>(IPC_CHANNELS.appSettings.getGatewayLanguage, { actorToken: token }),
      invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.getDatabaseLocation, { actorToken: token })
    ]).then(([agentResponse, defaultResponse, languageResponse, databaseResponse]) => {
      if (cancelled) return
      setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
      setDefaultAgentId(defaultResponse.ok && defaultResponse.data?.agentId ? defaultResponse.data.agentId : '')
      setGatewayLanguage(languageResponse.ok && languageResponse.data?.language ? languageResponse.data.language : DEFAULT_GATEWAY_LANGUAGE)
      if (databaseResponse.ok && databaseResponse.data) {
        setDatabaseState(databaseResponse.data)
      } else {
        setDatabaseLoadError(databaseResponse.error?.message ?? 'Unable to load database location.')
      }
    }).catch(() => {
      if (!cancelled) setDefaultAgentMessage('Unable to load settings.')
      if (!cancelled) setDatabaseLoadError('Unable to load database location.')
    }).finally(() => {
      if (!cancelled) setDatabaseLoading(false)
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
    { id: 'workspaces' as SettingsSection, label: 'Workspaces', icon: LuFolderOpen },
    { id: 'gateways' as SettingsSection, label: 'Gateways', icon: LuWaypoints },
    { id: 'database' as SettingsSection, label: 'Database', icon: LuHardDrive }
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
    ? 'Loading database status...'
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
                  <p>Default task agent and Codex language.</p>
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
                      <b>{databaseLoading ? 'Loading' : databaseLoadError ? 'Error' : sourceStatus}</b>
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
                        {databaseMoving ? 'Moving...' : 'Move database'}
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
                    {databaseLoading ? 'Refreshing...' : 'Refresh'}
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
