import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { LuBadgeCheck, LuCheck, LuMail, LuMonitor, LuMoon, LuSave, LuSun, LuUserRound } from 'react-icons/lu'
import type { User } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { useTheme, type ThemeMode } from '@renderer/providers/theme/theme-state'
import styles from './ProfilePage.module.scss'

const TITLE_OPTIONS: User['role'][] = ['owner', 'admin', 'member']

function splitName(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'OC'
}

export function ProfilePage() {
  const { user, updateProfile, refresh } = useAuth()
  const { mode, resolvedMode, paletteId, backgroundId, palettes, backgrounds, setMode, setPaletteId, setBackgroundId } = useTheme()
  const initialName = useMemo(() => splitName(user?.name), [user?.name])
  const [firstName, setFirstName] = useState(initialName.firstName)
  const [lastName, setLastName] = useState(initialName.lastName)
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState<User['role']>(user?.role ?? 'member')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const fullName = `${firstName} ${lastName}`.trim() || user?.name?.trim() || 'Mission Operator'
  const initials = initialsFromName(fullName)
  const modeOptions: Array<{ value: ThemeMode; label: string; icon: typeof LuMonitor }> = [
    { value: 'system', label: 'System', icon: LuMonitor },
    { value: 'light', label: 'Light', icon: LuSun },
    { value: 'dark', label: 'Dark', icon: LuMoon }
  ]

  useEffect(() => {
    setFirstName(initialName.firstName)
    setLastName(initialName.lastName)
    setEmail(user?.email ?? '')
    setRole(user?.role ?? 'member')
  }, [initialName.firstName, initialName.lastName, user?.email, user?.role])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    setStatus(null)

    const response = await updateProfile(firstName.trim(), lastName.trim(), {
      email: email.trim(),
      role
    })
    setPending(false)

    if (!response.ok) {
      setError(response.message ?? 'Profil güncellenemedi')
      return
    }

    await refresh()
    setStatus('Profil bilgileri güncellendi.')
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Profil</h1>
          <p>Kullanıcı bilgilerinizi ve görünen adınızı yönetin.</p>
        </div>
      </header>

      <div className={styles.profileGrid}>
        <aside className={styles.summaryPanel}>
          <div className={styles.avatarWrap}>
            <div className={styles.avatar}>{initials}</div>
          </div>
          <div className={styles.summaryIdentity}>
            <h2>{fullName}</h2>
            <p>{email || user?.email || 'owner@mission.local'}</p>
          </div>
          <div className={styles.summaryMeta}>
            <span className={styles.roleBadge}>{role}</span>
            <span>Kullanıcı profili</span>
          </div>
        </aside>

        <div className={styles.profileMain}>
          <section className={styles.formPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Appearance</h2>
                <p>Theme and palette are saved on this device.</p>
              </div>
            </div>

            <div className={styles.appearanceGrid}>
              <div className={styles.settingBlock}>
                <div className={styles.settingCopy}>
                  <span className={styles.settingLabel}>Mode</span>
                  <p className={styles.settingHint}>
                    {mode === 'system' ? `Using system: ${resolvedMode}` : `Using ${resolvedMode} mode`}
                  </p>
                </div>
                <div className={styles.modeSegment}>
                  {modeOptions.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={mode === option.value ? styles.modeActive : undefined}
                        onClick={() => setMode(option.value)}
                      >
                        <Icon size={15} />
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className={styles.settingBlock}>
                <div className={styles.settingCopy}>
                  <span className={styles.settingLabel}>Palette</span>
                  <p>Accent color used across controls.</p>
                </div>
                <div className={styles.paletteRow}>
                  {palettes.map((palette) => (
                    <button
                      key={palette.id}
                      type="button"
                      className={paletteId === palette.id ? styles.paletteActive : undefined}
                      style={{ '--palette-color': palette.swatch } as CSSProperties}
                      onClick={() => setPaletteId(palette.id)}
                      aria-label={`Use ${palette.name} palette`}
                      title={palette.name}
                    >
                      {paletteId === palette.id ? <LuCheck size={16} /> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.settingBlock}>
                <div className={styles.settingCopy}>
                  <span className={styles.settingLabel}>Background</span>
                  <p>Canvas treatment for this device.</p>
                </div>
                <div className={styles.backgroundRow}>
                  {backgrounds.map((background) => (
                    <button
                      key={background.id}
                      type="button"
                      className={backgroundId === background.id ? styles.backgroundActive : undefined}
                      style={{ '--background-preview': background.preview } as CSSProperties}
                      onClick={() => setBackgroundId(background.id)}
                      aria-label={`Use ${background.name} background`}
                      title={background.name}
                    >
                      {backgroundId === background.id ? <LuCheck size={15} /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <form className={styles.formPanel} onSubmit={submit}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Hesap Bilgileri</h2>
                <p>Bu bilgiler üst barda ve çalışma alanı kayıtlarında görünür.</p>
              </div>
            </div>

            <div className={styles.formGrid}>
              <label>
                <span>Ad</span>
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
              </label>
              <label>
                <span>Soyad</span>
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} required />
              </label>
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label>
                <span>Title</span>
                <select value={role} onChange={(event) => setRole(event.target.value as User['role'])}>
                  {TITLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <section className={styles.readonlySection} aria-label="Read-only account details">
              <div className={styles.readonlyHeader}>
                <h3>Account Details</h3>
                <p>Reference information shown by the application.</p>
              </div>
              <div className={styles.readonlyGrid}>
                <div className={styles.infoRow}>
                  <LuMail size={16} />
                  <div>
                    <span>E-posta</span>
                    <strong>{email || user?.email || 'owner@mission.local'}</strong>
                  </div>
                </div>
                <div className={styles.infoRow}>
                  <LuBadgeCheck size={16} />
                  <div>
                    <span>Title</span>
                    <strong>{role}</strong>
                  </div>
                </div>
                <div className={styles.infoRow}>
                  <LuUserRound size={16} />
                  <div>
                    <span>Kullanıcı ID</span>
                    <strong>{user?.id ?? '-'}</strong>
                  </div>
                </div>
              </div>
            </section>

            {error ? <p className={styles.error}>{error}</p> : null}
            {status ? <p className={styles.success}>{status}</p> : null}

            <footer className={styles.footer}>
              <button type="submit" disabled={pending}>
                <LuSave size={16} />
                {pending ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </section>
  )
}
