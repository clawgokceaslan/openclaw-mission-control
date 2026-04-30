import { FormEvent, useEffect, useState } from 'react'
import styles from './ProjectNewPage.module.scss'
import { useNavigate } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { loadList } from '@renderer/utils/api'
import type { Workspace } from '@shared/types/entities'

export function ProjectNewPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceDraftName, setWorkspaceDraftName] = useState('')
  const [workspaceDraftPath, setWorkspaceDraftPath] = useState('')
  const [showWorkspaceCreate, setShowWorkspaceCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const loadWorkspaces = async () => {
      const response = await loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token)
      if (response.ok) setWorkspaces(Array.isArray(response.data) ? response.data : [])
    }
    void loadWorkspaces()
  }, [token])

  const chooseWorkspaceFolder = async () => {
    const pickResponse = await invokeBridge<{ rootPath: string } | null>(IPC_CHANNELS.workspaces.pickFolder, { actorToken: token })
    if (!pickResponse.ok) {
      setError(pickResponse.error?.message ?? 'Workspace seçilemedi')
      return
    }
    const rootPath = pickResponse.data?.rootPath
    if (!rootPath) return
    setWorkspaceDraftPath(rootPath)
  }

  const createWorkspaceFromDraft = async () => {
    if (!workspaceDraftName.trim() || !workspaceDraftPath.trim()) return
    const createResponse = await invokeBridge<Workspace>(IPC_CHANNELS.workspaces.create, {
      actorToken: token,
      name: workspaceDraftName.trim(),
      rootPath: workspaceDraftPath.trim()
    })
    if (!createResponse.ok || !createResponse.data) {
      setError(createResponse.error?.message ?? 'Workspace oluşturulamadı')
      return
    }
    setWorkspaces((current) => [createResponse.data!, ...current])
    setWorkspaceId(createResponse.data.id)
    setWorkspaceDraftName('')
    setWorkspaceDraftPath('')
    setShowWorkspaceCreate(false)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const response = await invokeBridge(IPC_CHANNELS.projects.create, {
      actorToken: token,
      name: name.trim(),
      description: description.trim() || undefined,
      workspaceId: workspaceId || null
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
        <label>Workspace</label>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
          <option value="">Workspace yok</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => setShowWorkspaceCreate((value) => !value)}>Workspace ekle</button>
        {showWorkspaceCreate ? (
          <div className={styles.workspaceCreateCard}>
            <label>Workspace başlığı</label>
            <input value={workspaceDraftName} onChange={(event) => setWorkspaceDraftName(event.target.value)} />
            <label>Klasör</label>
            <input value={workspaceDraftPath} onChange={(event) => setWorkspaceDraftPath(event.target.value)} />
            <button type="button" onClick={() => void chooseWorkspaceFolder()}>Klasör seç</button>
            <button type="button" disabled={!workspaceDraftName.trim() || !workspaceDraftPath.trim()} onClick={() => void createWorkspaceFromDraft()}>
              Workspace kaydet
            </button>
          </div>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? 'Kaydediliyor...' : 'Oluştur'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
