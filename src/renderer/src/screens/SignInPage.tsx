import { FormEvent, useState } from 'react'
import styles from './SignInPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { useAuth } from '@renderer/providers/auth/auth-state'
import {
  LuActivity,
  LuEye,
  LuEyeOff,
  LuLoaderCircle,
  LuLockKeyhole,
  LuLogIn,
  LuMail,
  LuNetwork,
  LuShieldCheck,
  LuTriangleAlert
} from 'react-icons/lu'

const appIconSrc = new URL('../../../../app-icon.png', import.meta.url).href

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeLoginMessage(message?: string) {
  if (!message) return 'Giris tamamlanamadi. Bilgileri kontrol edip tekrar deneyin.'
  if (/too many|rate/i.test(message)) {
    return 'Cok fazla hatali giris denemesi yapildi. Bir sure sonra tekrar deneyin.'
  }
  if (/invalid|failed|unauthorized|password|credentials/i.test(message)) {
    return 'E-posta veya sifre hatali. Bilgileri kontrol edip tekrar deneyin.'
  }
  return message
}

export function SignInPage({ authNotice }: { authNotice?: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const notice = error ?? authNotice ?? null
  const noticeIsRateLimited = Boolean(notice && /cok fazla|too many|rate/i.test(notice))

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim()

    if (!normalizedEmail) {
      setError('E-posta adresi gerekli.')
      return
    }

    if (!emailPattern.test(normalizedEmail)) {
      setError('Gecerli bir e-posta adresi girin.')
      return
    }

    if (!password) {
      setError('Sifre gerekli.')
      return
    }

    setPending(true)
    setError(null)
    const result = await login(normalizedEmail, password)
    setPending(false)
    if (result.ok) {
      navigate(APP_ROUTES.DASHBOARD, { replace: true })
    } else {
      setError(normalizeLoginMessage(result.message))
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.shell} aria-labelledby="signin-title">
        <section className={styles.brandPanel} aria-label="Open Mission Control">
          <div className={styles.brandLockup}>
            <img src={appIconSrc} alt="Open Mission Control" />
            <div className={styles.brandText}>
              <span>Open Mission Control</span>
              <h1 id="signin-title">Operasyon merkezine giris</h1>
            </div>
          </div>

          <p className={styles.brandLead}>
            Workspace, gateway ve gorev operasyonlarinizi tek bir kontrollu oturumdan yonetin.
          </p>

          <div className={styles.signalGrid} aria-label="Oturum kapsami">
            <div className={styles.signalItem}>
              <LuShieldCheck size={18} />
              <span>Yerel hesap dogrulamasi</span>
            </div>
            <div className={styles.signalItem}>
              <LuNetwork size={18} />
              <span>Gateway erisim kontrolu</span>
            </div>
            <div className={styles.signalItem}>
              <LuActivity size={18} />
              <span>Canli operasyon paneli</span>
            </div>
          </div>
        </section>

        <section className={styles.authPanel} aria-label="Giris formu">
          <header className={styles.header}>
            <span>Guvenli oturum</span>
            <h2>Hesabinizla devam edin</h2>
            <p>E-posta ve sifrenizle Open Mission Control calisma alanina baglanin.</p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
              <label htmlFor="signin-email">E-posta</label>
              <div className={styles.inputWrap}>
                <LuMail size={17} aria-hidden="true" />
                <input
                  id="signin-email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (error) setError(null)
                  }}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  disabled={pending}
                  aria-invalid={Boolean(error && /e-posta/i.test(error))}
                  placeholder="pilot@example.com"
                  required
                />
              </div>
            </div>
            <div className={styles.field}>
              <label htmlFor="signin-password">Sifre</label>
              <div className={styles.inputWrap}>
                <LuLockKeyhole size={17} aria-hidden="true" />
                <input
                  id="signin-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError(null)
                  }}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  disabled={pending}
                  aria-invalid={Boolean(error && /sifre/i.test(error))}
                  required
                />
                <button
                  className={styles.passwordToggle}
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={pending}
                  aria-label={showPassword ? 'Sifreyi gizle' : 'Sifreyi goster'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <LuEyeOff size={17} aria-hidden="true" /> : <LuEye size={17} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {notice && (
              <p className={noticeIsRateLimited ? styles.warning : styles.error} role="alert" aria-live="polite">
                {noticeIsRateLimited && <LuTriangleAlert size={17} aria-hidden="true" />}
                <span>{notice}</span>
              </p>
            )}

            <button className={styles.submitButton} type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <LuLoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : <LuLogIn size={17} aria-hidden="true" />}
              {pending ? 'Giris kontrol ediliyor...' : 'Giris yap'}
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
