import { FormEvent, useState } from 'react'
import styles from './InvitePage.module.scss'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { Link } from 'react-router-dom'

export function InvitePage() {
  const { token } = useAuth()
  const [userId, setUserId] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const response = await invokeBridge(IPC_CHANNELS.organization.createInvite, { actorToken: token, userId: userId.trim() })
    if (!response.ok) {
      setError(response.error?.message ?? 'Davet üretilemedi')
      return
    }
    setResult(JSON.stringify(response.data))
    setError(null)
    setUserId('')
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Invite</h1>
      <form className={styles.form} onSubmit={submit}>
        <label htmlFor="user-id">User ID</label>
        <input id="user-id" value={userId} onChange={(event) => setUserId(event.target.value)} required />
        <button type="submit">Davet oluştur</button>
      </form>
      {result && <p>Yanıt: {result}</p>}
      {error && <p className={styles.error}>{error}</p>}
      <p>
        <Link to={APP_ROUTES.DASHBOARD}>Dashboard'a dön</Link>
      </p>
    </section>
  )
}
