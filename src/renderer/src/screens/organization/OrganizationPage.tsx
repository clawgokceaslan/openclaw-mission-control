import { FormEvent, useEffect, useState } from 'react'
import styles from './OrganizationPage.module.scss'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Membership, Organization } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { Link } from 'react-router-dom'
import { LoadingState } from '@renderer/components/loading'

interface OrganizationPayload extends Organization {
  members?: Membership[]
}

export function OrganizationPage() {
  const { token } = useAuth()
  const [organization, setOrganization] = useState<OrganizationPayload | null>(null)
  const [members, setMembers] = useState<Membership[]>([])
  const [membersStatus, setMembersStatus] = useState('Yükleniyor...')
  const [userId, setUserId] = useState('')
  const [inviteResult, setInviteResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const response = await invokeBridge<OrganizationPayload>(IPC_CHANNELS.organization.me, { actorToken: token })
    if (!response.ok) {
      setError(response.error?.message ?? 'Kuruluş yüklenemedi')
      return
    }
    const data = response.data ?? null
    setOrganization(data as OrganizationPayload)
    setMembers((data as OrganizationPayload)?.members ?? [])
    setError(null)
  }

  const loadMembers = async () => {
    setMembersStatus('Yükleniyor...')
    const response = await loadList<Membership[]>(IPC_CHANNELS.organization.listMembers, token)
    if (!response.ok) {
      setMembersStatus('Hata')
      return
    }
    setMembers(response.data as Membership[])
    setMembersStatus('Yüklendi')
  }

  useEffect(() => {
    void load()
    void loadMembers()
  }, [token])

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    const response = await invokeBridge(IPC_CHANNELS.organization.createInvite, { actorToken: token, userId: userId.trim() })
    if (!response.ok) {
      setError(response.error?.message ?? 'Davetiye üretilemedi')
      return
    }
    setInviteResult(JSON.stringify(response.data))
    setUserId('')
    setError(null)
    await loadMembers()
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Organization</h1>
      {error && <p className={styles.error}>{error}</p>}
      {organization ? (
        <div>
          <p>Org: {organization.name}</p>
          <p>Id: {organization.id}</p>
        </div>
      ) : (
        <LoadingState messageIndex={2} />
      )}

      <h2>Invite</h2>
      <form className={styles.form} onSubmit={invite}>
        <input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="userId"
          required
        />
        <button type="submit">Davet token üret</button>
      </form>
      {inviteResult && <p>Sonuç: {inviteResult}</p>}

      <h2>Members</h2>
      {membersStatus === 'Yükleniyor...' ? <LoadingState variant="skeleton" rows={3} columns={2} messageIndex={3} /> : <p>{membersStatus}</p>}
      <ul>
        {members.map((member) => (
          <li key={member.id}>
            {member.userId} - {member.role}
          </li>
        ))}
      </ul>
      <Link to={APP_ROUTES.INVITE}>Invite detay sayfası</Link>
    </section>
  )
}
