import { useEffect, useState } from 'react'
import styles from './FeaturePage.module.scss'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { IpcChannel } from '@shared/contracts/ipc'

export function FeaturePage({ title, channel }: { title: string; channel?: IpcChannel }) {
  const { token } = useAuth()
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [status, setStatus] = useState('Yükleniyor...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!channel) {
      setStatus('Bu sayfada kullanılabilir veri endpoint’i henüz eşlenmedi')
      setError(null)
      setItems([])
      return
    }
    void (async () => {
      const response = await loadList<Record<string, unknown>[]>(channel, token)
      if (!response.ok) {
        setError(response.error?.message ?? 'Yükleme hatası')
        setStatus('Hata')
        return
      }
      setStatus('Yüklendi')
      setItems(Array.isArray(response.data) ? (response.data as Record<string, unknown>[]) : [])
      setError(null)
    })()
  }, [channel, token])

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.status}>{status}</p>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.list}>
        <ul>
          {items.map((item, index) => (
            <li key={String((item.id as string) ?? index)}>{JSON.stringify(item)}</li>
          ))}
        </ul>
      </div>
      <button onClick={async () => {
        if (!channel) return
        const response = await invokeBridge(channel, { actorToken: token })
        if (!response.ok) {
          setError(response.error?.message ?? 'Tekrar dene')
        } else {
          const rows = response.data as unknown
          setItems(Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [])
        }
      }}>
        Yenile
      </button>
    </section>
  )
}
