import { FormEvent, useState } from 'react'
import styles from './ProfileSetupPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { useAuth } from '@renderer/providers/auth/auth-state'

export function ProfileSetupPage() {
  const { refresh, updateProfile } = useAuth()
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const response = await updateProfile(firstName.trim(), lastName.trim())
    setPending(false)
    if (response.ok) {
      await refresh()
      navigate(APP_ROUTES.DASHBOARD, { replace: true })
      return
    }
    setError(response.message ?? 'Profil güncellenemedi')
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Profil Bilgisi</h1>
      <p>Devam etmek için adınızı ve soyadınızı girin.</p>
      <form className={styles.form} onSubmit={submit}>
        <div>
          <label>Ad</label>
          <br />
          <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
        </div>
        <div>
          <label>Soyad</label>
          <br />
          <input value={lastName} onChange={(event) => setLastName(event.target.value)} required />
        </div>
        <button type="submit" disabled={pending} className={styles.spacedTop}>
          {pending ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
