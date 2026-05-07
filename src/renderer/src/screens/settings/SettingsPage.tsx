import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LuBot, LuCheck, LuClipboard, LuCog, LuFolderOpen, LuHardDrive, LuLanguages, LuRefreshCw, LuSlidersHorizontal, LuWaypoints } from 'react-icons/lu'
import { IPC_CHANNELS, type DatabaseLocationState, type PickDatabaseFolderResponse } from '@shared/contracts/ipc'
import { CODEX_LANGUAGE_OPTIONS, DEFAULT_CODEX_LANGUAGE } from '@shared/utils/codex-language'
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
  pendingFolderPath: null,
  pendingDbPath: null,
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
  const [codexLanguage, setCodexLanguage] = useState(DEFAULT_CODEX_LANGUAGE)
  const [codexLanguageSaving, setCodexLanguageSaving] = useState(false)
  const [codexLanguageMessage, setCodexLanguageMessage] = useState<string | null>(null)
  const [defaultAgentSaving, setDefaultAgentSaving] = useState(false)
  const [defaultAgentMessage, setDefaultAgentMessage] = useState<string | null>(null)
  const [databaseState, setDatabaseState] = useState<DatabaseLocationState>(databaseFallbackState)
  const [databaseFolder, setDatabaseFolder] = useState('')
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
      setCodexLanguage(DEFAULT_CODEX_LANGUAGE)
      setDatabaseState(databaseFallbackState)
      return
    }
    void Promise.all([
      loadList<Agent[]>(IPC_CHANNELS.agents.list, token),
      invokeBridge<{ agentId: string | null }>(IPC_CHANNELS.appSettings.getDefaultAgent, { actorToken: token }),
      invokeBridge<{ language: string }>(IPC_CHANNELS.appSettings.getCodexLanguage, { actorToken: token }),
      invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.getDatabaseLocation, { actorToken: token })
    ]).then(([agentResponse, defaultResponse, languageResponse, databaseResponse]) => {
      if (cancelled) return
      setAgents(Array.isArray(agentResponse.data) ? agentResponse.data : [])
      setDefaultAgentId(defaultResponse.ok && defaultResponse.data?.agentId ? defaultResponse.data.agentId : '')
      setCodexLanguage(languageResponse.ok && languageResponse.data?.language ? languageResponse.data.language : DEFAULT_CODEX_LANGUAGE)
      if (databaseResponse.ok && databaseResponse.data) {
        setDatabaseState(databaseResponse.data)
      }
    }).catch(() => {
      if (!cancelled) setDefaultAgentMessage('Ayarlar yüklenirken hata oluştu.')
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const agentOptions = useMemo<AppSelectOption[]>(() => {
    return [...agents]
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((agent) => ({ value: agent.id, label: agent.name }))
  }, [agents])

  const selectedDefaultAgentOption = useMemo<AppSelectOption | null>(() => {
    return agentOptions.find((option) => option.value === defaultAgentId) ?? null
  }, [agentOptions, defaultAgentId])

  const codexLanguageOptions = useMemo<AppSelectOption[]>(() => (
    CODEX_LANGUAGE_OPTIONS.map((option) => ({
      value: option.value,
      label: option.value === 'tr' ? 'Türkçe' : option.label
    }))
  ), [])

  const selectedCodexLanguageOption = useMemo<AppSelectOption | null>(() => {
    return codexLanguageOptions.find((option) => option.value === codexLanguage) ?? codexLanguageOptions[0] ?? null
  }, [codexLanguage, codexLanguageOptions])

  const saveDefaultAgent = async (option: AppSelectOption | null) => {
    setDefaultAgentSaving(true)
    setDefaultAgentMessage(null)
    try {
      const response = await invokeBridge<{ agentId: string | null }>(IPC_CHANNELS.appSettings.setDefaultAgent, {
        actorToken: token,
        agentId: option?.value ?? null
      })
      if (!response.ok) {
        setDefaultAgentMessage(response.error?.message ?? 'Varsayılan görev ajanı güncellenemedi.')
        return
      }
      setDefaultAgentId(response.data?.agentId ?? '')
      setDefaultAgentMessage(option ? 'Varsayılan görev ajanı güncellendi.' : 'Varsayılan görev ajanı temizlendi.')
    } catch (error) {
      setDefaultAgentMessage(error instanceof Error ? error.message : 'Varsayılan görev ajanı güncellenemedi.')
    } finally {
      setDefaultAgentSaving(false)
    }
  }

  const saveCodexLanguage = async (option: AppSelectOption | null) => {
    setCodexLanguageSaving(true)
    setCodexLanguageMessage(null)
    try {
      const response = await invokeBridge<{ language: string }>(IPC_CHANNELS.appSettings.setCodexLanguage, {
        actorToken: token,
        language: option?.value ?? DEFAULT_CODEX_LANGUAGE
      })
      if (!response.ok) {
        setCodexLanguageMessage(response.error?.message ?? 'Codex dili güncellenemedi.')
        return
      }
      setCodexLanguage(response.data?.language ?? DEFAULT_CODEX_LANGUAGE)
      setCodexLanguageMessage('Codex dili güncellendi.')
    } catch (error) {
      setCodexLanguageMessage(error instanceof Error ? error.message : 'Codex dili güncellenemedi.')
    } finally {
      setCodexLanguageSaving(false)
    }
  }

  const pickDatabaseFolder = async () => {
    setDatabaseMessage(null)
    try {
      const response = await invokeBridge<PickDatabaseFolderResponse>(IPC_CHANNELS.appSettings.pickDatabaseFolder, { actorToken: token })
      if (!response.ok) {
        setDatabaseMessage(response.error?.message ?? 'Veri klasörü seçilemedi.')
        return
      }
      if (!response.data?.folderPath) {
        setDatabaseMessage('Veri klasörü seçimi iptal edildi.')
        return
      }
      setDatabaseFolder(response.data.folderPath)
      setDatabaseMessage(`Secilen klasör: ${response.data.folderPath}`)
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'Veri klasörü seçilemedi.')
    }
  }

  const applyDatabaseMove = async () => {
    if (!databaseFolder) {
      setDatabaseMessage('Önce veritabanı klasörü seçilmeli.')
      return
    }
    setDatabaseMoving(true)
    setDatabaseMessage(null)
    try {
      const response = await invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.moveDatabaseLocation, {
        actorToken: token,
        folderPath: databaseFolder
      })
      if (!response.ok) {
        setDatabaseMessage(response.error?.message ?? 'Veritabanı klasörü taşınamadı.')
        return
      }
      setDatabaseState(response.data ?? databaseState)
      if (response.data?.restartRequired) {
        setDatabaseMessage('Veritabanı yeni klasöre kopyalandı. Yeni klasörün aktif olması için uygulama yeniden başlatılmalı.')
      } else {
        setDatabaseMessage('Veritabanı konumu zaten bu klasörde.'
        )
      }
      setDatabaseFolder('')
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'Veritabanı klasörü taşınamadı.')
    } finally {
      setDatabaseMoving(false)
    }
  }

  const refreshDatabaseLocation = async () => {
    setDatabaseMessage(null)
    const response = await invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.getDatabaseLocation, { actorToken: token })
    if (!response.ok) {
      setDatabaseMessage(response.error?.message ?? 'Veritabanı konumu yenilenemedi.')
      return
    }
    setDatabaseState(response.data ?? databaseFallbackState)
    setDatabaseMessage('Veritabanı konumu yenilendi.')
  }

  const copyDatabasePath = async () => {
    const value = databaseState.currentDbPath || databaseState.currentFolderPath
    if (!value) {
      setDatabaseMessage('Kopyalanacak veritabanı yolu bulunamadı.')
      return
    }
    try {
      await navigator.clipboard?.writeText(value)
      setDatabaseCopied(true)
      setDatabaseMessage('Veritabanı yolu kopyalandı.')
      window.setTimeout(() => setDatabaseCopied(false), 1600)
    } catch {
      setDatabaseMessage('Veritabanı yolu kopyalanamadı.')
    }
  }

  const revealDatabasePath = async () => {
    const value = databaseState.currentDbPath || databaseState.currentFolderPath
    if (!value) {
      setDatabaseMessage('Açılacak veritabanı yolu bulunamadı.')
      return
    }
    const response = await invokeBridge<{ revealed: boolean }>(IPC_CHANNELS.appSettings.revealDatabaseLocation, {
      actorToken: token,
      path: value
    })
    if (!response.ok) {
      setDatabaseMessage(response.error?.message ?? 'Veritabanı klasörü açılamadı.')
      return
    }
    setDatabaseMessage('Veritabanı klasörü açıldı.')
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
    { id: 'general' as SettingsSection, label: 'Genel', icon: LuSlidersHorizontal },
    { id: 'workspaces' as SettingsSection, label: 'Workspaces', icon: LuFolderOpen },
    { id: 'gateways' as SettingsSection, label: 'Gateways', icon: LuWaypoints },
    { id: 'database' as SettingsSection, label: 'Veritabanı', icon: LuHardDrive }
  ]

  const hasPendingRestart = databaseState.restartRequired

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Ayarlar</h1>
          <p>Uygulama davranışını genel olarak yönetin.</p>
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.tabBar} aria-label="Ayar bölümleri">
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
                  <h2>Genel ayarlar</h2>
                  <p>Varsayılan görev ajanı ve Codex dili.</p>
                </div>
              </header>
              <div className={styles.surfaceSection}>
                <h3><LuBot size={17} /> Varsayılan görev ajanı</h3>
                <div className={styles.defaultAgentRow}>
                  <AppSelect
                    mode="single"
                    value={selectedDefaultAgentOption}
                    options={agentOptions}
                    placeholder={agents.length > 0 ? 'Varsayılan ajan seçin' : 'Kullanılabilir ajan yok'}
                    isClearable
                    isDisabled={defaultAgentSaving || agents.length === 0}
                    onChange={(option) => {
                      if (!Array.isArray(option)) void saveDefaultAgent(option)
                    }}
                  />
                  <span>{defaultAgentSaving ? 'Kaydediliyor...' : selectedDefaultAgentOption ? `${selectedDefaultAgentOption.label} yeni görevlerde varsayılan olur.` : 'Varsayılan ajan atanmadı.'}</span>
                </div>
                {defaultAgentMessage ? <p className={styles.settingMessage}>{defaultAgentMessage}</p> : null}
              </div>

              <div className={styles.surfaceSection}>
                <h3><LuLanguages size={17} /> Codex dili</h3>
                <div className={styles.defaultAgentRow}>
                  <AppSelect
                    mode="single"
                    value={selectedCodexLanguageOption}
                    options={codexLanguageOptions}
                    placeholder="Codex dili seçin"
                    isDisabled={codexLanguageSaving}
                    onChange={(option) => {
                      if (!Array.isArray(option)) void saveCodexLanguage(option)
                    }}
                  />
                  <span>{codexLanguageSaving ? 'Kaydediliyor...' : `${selectedCodexLanguageOption?.label ?? 'Türkçe'} Codex çıktılarında kullanılacak.`}</span>
                </div>
                {codexLanguageMessage ? <p className={styles.settingMessage}>{codexLanguageMessage}</p> : null}
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
            <div className={styles.panel}>
              <header className={styles.panelHeader}>
                <span className={styles.panelIcon}><LuHardDrive size={19} /></span>
                <div>
                  <h2>SQLite veritabanı klasörü</h2>
                  <p>Veritabanı dosyasının bulunduğu klasörü kopyala ve yeniden başlatma gerektiren değişimi uygula.</p>
                </div>
              </header>

              <div className={styles.surfaceSection}>
                <h3>Mevcut durum</h3>
                <div className={styles.infoList}>
                  <label>
                    <small>Mevcut klasör</small>
                    <span>{databaseState.currentFolderPath || 'Bilinmiyor'}</span>
                  </label>
                  <label>
                    <small>Mevcut veritabanı dosyası</small>
                    <span>{databaseState.currentDbPath || 'Henüz hazır değil'}</span>
                  </label>
                  {databaseState.pendingFolderPath ? (
                    <label>
                      <small>Bekleyen klasör</small>
                      <span>{databaseState.pendingFolderPath}</span>
                    </label>
                  ) : null}
                  {databaseState.pendingDbPath ? (
                    <label>
                      <small>Bekleyen dosya</small>
                      <span>{databaseState.pendingDbPath}</span>
                    </label>
                  ) : null}
                </div>

                <p className={hasPendingRestart ? styles.restartNotice : undefined}>
                  {hasPendingRestart
                    ? 'Yeni klasöre geçmek için uygulamayı yeniden başlatmanız gerekiyor.'
                    : 'Veritabanı dosyası aktif klasöre bağlı çalışır.'}
                </p>
                <div className={styles.databaseActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => void copyDatabasePath()} disabled={!databaseState.currentDbPath && !databaseState.currentFolderPath}>
                    {databaseCopied ? <LuCheck size={15} /> : <LuClipboard size={15} />}
                    {databaseCopied ? 'Kopyalandı' : 'Yolu kopyala'}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void revealDatabasePath()} disabled={!databaseState.currentDbPath && !databaseState.currentFolderPath}>
                    <LuFolderOpen size={15} />
                    Klasörde aç
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void refreshDatabaseLocation()}>
                    <LuRefreshCw size={15} />
                    Yenile
                  </button>
                </div>
              </div>

              <div className={styles.surfaceSection}>
                <h3>Yeni klasör seçin</h3>
                <div className={styles.databaseRow}>
                  <span>{databaseFolder || 'Klasör seçilmedi.'}</span>
                  <button type="button" onClick={pickDatabaseFolder} disabled={databaseMoving}>
                    Klasör seç
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={applyDatabaseMove} disabled={databaseMoving || !databaseFolder}>
                    {databaseMoving ? 'Taşınıyor...' : 'Klasörü uygula (yeniden başlatma gerektirir)'}
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
