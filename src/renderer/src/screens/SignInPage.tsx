import { FormEvent, useState } from 'react'
import styles from './SignInPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { LuLockKeyhole, LuLogIn, LuMail } from 'react-icons/lu'

export function SignInPage({ authNotice }: { authNotice?: string | null }) {
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
      <section className={styles.authPanel} aria-labelledby="signin-title">
        <header className={styles.header}>
          <span>Open Mission Control</span>
          <h1 id="signin-title">Sign In</h1>
          <p>Use your local workspace account to continue.</p>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Email</span>
            <div className={styles.inputWrap}>
              <LuMail size={17} />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                disabled={pending}
                required
              />
            </div>
          </label>
          <label className={styles.field}>
            <span>Password</span>
            <div className={styles.inputWrap}>
              <LuLockKeyhole size={17} />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                disabled={pending}
                required
              />
            </div>
          </label>

          {(error || authNotice) && <p className={styles.error}>{error ?? authNotice}</p>}

          <button type="submit" disabled={pending}>
            <LuLogIn size={17} />
            {pending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className={styles.bootstrapHint}>
          <span>Default account</span>
          <strong>owner@mission.local</strong>
        </div>
      </section>
    </div>
  )
}
