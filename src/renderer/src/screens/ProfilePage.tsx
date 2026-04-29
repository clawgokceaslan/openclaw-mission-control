import { FormEvent, useEffect, useMemo, useState } from 'react'
import { LuBadgeCheck, LuMail, LuSave, LuUserRound } from 'react-icons/lu'
import type { User } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
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
          <div className={styles.avatar}>{initials}</div>
          <h2>{fullName}</h2>
          <p>{email || user?.email || 'owner@mission.local'}</p>
          <span className={styles.roleBadge}>{role}</span>
        </aside>

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
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
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
    </section>
  )
}
