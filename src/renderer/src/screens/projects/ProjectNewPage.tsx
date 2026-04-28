import { FormEvent, useState } from 'react'
import styles from './ProjectNewPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'

export function ProjectNewPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const response = await invokeBridge(IPC_CHANNELS.projects.create, {
      actorToken: token,
      name: name.trim(),
      description: description.trim() || undefined
    })
    setPending(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Oluşturulamadı')
      return
    }
    navigate(APP_ROUTES.PROJECTS, { replace: true })
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Yeni Project</h1>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label>Project adı</label>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
        <label>Açıklama</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        <button type="submit" disabled={pending}>
          {pending ? 'Kaydediliyor...' : 'Oluştur'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
