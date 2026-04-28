import { FormEvent, useState } from 'react'
import styles from './AgentNewPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'

export function AgentNewPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const response = await invokeBridge(IPC_CHANNELS.agents.create, { actorToken: token, name: name.trim(), status: 'idle' })
    if (!response.ok) {
      setError(response.error?.message ?? 'Oluşturulamadı')
      return
    }
    navigate(APP_ROUTES.AGENTS, { replace: true })
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Yeni Agent</h1>
      <form className={styles.form} onSubmit={create}>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
        <button type="submit">Kaydet</button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
