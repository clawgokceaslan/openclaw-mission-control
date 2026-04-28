import { FormEvent, useState } from 'react'
import styles from './SignInPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { useAuth } from '@renderer/providers/auth/auth-state'

export function SignInPage() {
  const [email, setEmail] = useState('owner@mission.local')
  const [password, setPassword] = useState('changeme')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const result = await login(email, password)
    setPending(false)
    if (result.ok) {
      navigate(APP_ROUTES.DASHBOARD, { replace: true })
    } else {
      setError(result.message ?? 'Login failed')
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Sign In</h1>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div>
          <label>Email</label>
          <br />
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </div>
        <div>
          <label>Password</label>
          <br />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </div>
        <button type="submit" disabled={pending} className={styles.spacedTop}>
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
