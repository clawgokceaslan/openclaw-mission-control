import { FormEvent, useEffect, useMemo, useState } from 'react'
import styles from './ProfileSetupPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { DatabaseLocationState, PickDatabaseFolderResponse } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import { LuDatabase, LuFolderOpen, LuRefreshCw, LuRotateCcw, LuUserRound } from 'react-icons/lu'
import { LoadingState } from '@renderer/components/loading'

export function ProfileSetupPage() {
  const { refresh, token, updateProfile } = useAuth()
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [databaseState, setDatabaseState] = useState<DatabaseLocationState | null>(null)
  const [selectedDatabaseFolder, setSelectedDatabaseFolder] = useState<string | null>(null)
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null)

  const currentDatabaseFolder = databaseState?.currentFolderPath ?? ''
  const effectiveDatabaseFolder = selectedDatabaseFolder ?? currentDatabaseFolder
  const databaseStatus = useMemo(() => {
    if (selectedDatabaseFolder) return 'Özel klasör seçildi'
    if (databaseState?.currentDbExists) return 'Varsayılan veritabanı hazır'
    if (databaseState) return 'Veritabanı burada oluşturulacak'
    return 'Veritabanı konumu kontrol ediliyor'
  }, [databaseState, selectedDatabaseFolder])

  const refreshDatabaseLocation = async () => {
    if (!token) return
    setDatabaseLoading(true)
    const response = await invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.getDatabaseLocation, { actorToken: token })
    setDatabaseLoading(false)
    if (!response.ok || !response.data) {
      setDatabaseMessage(response.error?.message ?? 'Veritabanı konumu yüklenemedi.')
      return
    }
    setDatabaseState(response.data)
    setDatabaseMessage(null)
  }

  useEffect(() => {
    void refreshDatabaseLocation()
  }, [token])

  const chooseDatabaseFolder = async () => {
    if (!token) return
    setDatabaseMessage(null)
    const response = await invokeBridge<PickDatabaseFolderResponse>(IPC_CHANNELS.appSettings.pickDatabaseFolder, { actorToken: token })
    if (!response.ok) {
      setDatabaseMessage(response.error?.message ?? 'Veritabanı klasörü seçilemedi.')
      return
    }
    if (!response.data?.folderPath) {
      return
    }
    setSelectedDatabaseFolder(response.data.folderPath)
    setDatabaseMessage('Özel veritabanı klasörü seçildi. Kaydettikten sonra uygulanacak.')
  }

  const useDefaultDatabaseFolder = () => {
    setSelectedDatabaseFolder(null)
    setDatabaseMessage('Varsayılan veritabanı konumu kullanılacak.')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()
    if (!trimmedFirstName || !trimmedLastName) {
      setError('Ad ve soyad zorunludur.')
      return
    }

    setPending(true)
    setError(null)
    setDatabaseMessage(null)
    const response = await updateProfile(trimmedFirstName, trimmedLastName)
    if (response.ok) {
      if (selectedDatabaseFolder) {
        const moveResponse = await invokeBridge<DatabaseLocationState>(IPC_CHANNELS.appSettings.moveDatabaseLocation, {
          actorToken: token,
          folderPath: selectedDatabaseFolder
        })
        if (!moveResponse.ok || !moveResponse.data) {
          setPending(false)
          setError(moveResponse.error?.message ?? 'Veritabanı klasörü uygulanamadı.')
          return
        }
        setDatabaseState(moveResponse.data)
        if (moveResponse.data.restartRequired) {
          setDatabaseMessage('Veritabanı taşındı. Yeni konumu etkinleştirmek için uygulama yeniden başlatılıyor...')
          const restartResponse = await invokeBridge<{ restarting: boolean }>(IPC_CHANNELS.app.restart, {})
          if (!restartResponse.ok) {
            setPending(false)
            setError(restartResponse.error?.message ?? 'Veritabanı taşındı, ancak uygulama otomatik yeniden başlatılamadı.')
          }
          return
        }
      }
      await refresh()
      setPending(false)
      navigate(APP_ROUTES.DASHBOARD, { replace: true })
      return
    }
    setPending(false)
    setError(response.message ?? 'Profil güncellenemedi')
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <span>İlk kurulum</span>
        <h1>Profil Bilgisi</h1>
        <p>Devam etmek için adınızı ve soyadınızı girin. Veritabanı klasörü opsiyoneldir.</p>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelIcon}><LuUserRound size={18} /></span>
            <div>
              <h2>Ad Soyad</h2>
              <p>Uygulama içinde görünen operatör bilgisi.</p>
            </div>
          </div>

          <div className={styles.fieldGrid}>
            <label>
              <span>Ad</span>
              <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required autoFocus />
            </label>
            <label>
              <span>Soyad</span>
              <input value={lastName} onChange={(event) => setLastName(event.target.value)} required />
            </label>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelIcon}><LuDatabase size={18} /></span>
            <div>
              <h2>Veritabanı</h2>
              <p>Varsayılan konumu kullanabilir veya farklı bir klasör seçebilirsiniz.</p>
            </div>
          </div>

          <div className={styles.databaseBox}>
            <small>{selectedDatabaseFolder ? 'Seçilen klasör' : 'Geçerli varsayılan klasör'}</small>
            <strong>{effectiveDatabaseFolder || <LoadingState size="compact" messageIndex={0} />}</strong>
            <span>{databaseStatus}</span>
          </div>

          <div className={styles.databaseActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void chooseDatabaseFolder()} disabled={pending || databaseLoading}>
              <LuFolderOpen size={15} />
              Klasör seç
            </button>
            <button type="button" className={styles.secondaryButton} onClick={useDefaultDatabaseFolder} disabled={pending || !selectedDatabaseFolder}>
              <LuRotateCcw size={15} />
              Varsayılanı kullan
            </button>
            <button type="button" className={styles.iconButton} onClick={() => void refreshDatabaseLocation()} disabled={pending || databaseLoading} aria-label="Veritabanı konumunu yenile" title="Veritabanı konumunu yenile">
              <LuRefreshCw size={15} />
            </button>
          </div>

          {databaseMessage ? <p className={styles.hint}>{databaseMessage}</p> : null}
        </section>

        <div className={styles.footer}>
          <button type="submit" disabled={pending}>
            {pending ? <LoadingState size="compact" messageIndex={2} /> : 'Kaydet ve Devam Et'}
          </button>
        </div>
      </form>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
