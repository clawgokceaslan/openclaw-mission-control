import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Project } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import ui from '@renderer/components/ui/PagePrimitives.module.scss'
import { ActionRow, DataTable, InlineNotice, PageFrame, SectionCard } from '@renderer/components/ui'
import styles from './ProjectsPage.module.scss'

function formatProjectTime(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

export function ProjectsPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<Project[]>([])
  const [status, setStatus] = useState('Yukleniyor...')
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const loadProjects = async () => {
    setStatus('Yukleniyor...')
    const response = await loadList<Project[]>(IPC_CHANNELS.projects.list, token)
    if (!response.ok) {
      setError(response.error?.message ?? 'Yukleme hatasi')
      setStatus('Yukleme hatasi')
      setItems([])
      return
    }

    setItems(Array.isArray(response.data) ? response.data : [])
    setStatus('Hazir')
    setError(null)
  }

  useEffect(() => {
    void loadProjects()
  }, [token])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    const response = await invokeBridge(IPC_CHANNELS.projects.create, {
      actorToken: token,
      name: name.trim(),
      description: description.trim() || undefined
    })

    if (!response.ok) {
      setError(response.error?.message ?? 'Olusturulamadi')
      return
    }

    setName('')
    setDescription('')
    setShowCreate(false)
    await loadProjects()
  }

  const columns = useMemo(
    () => [
      {
        key: 'project',
        header: 'Project',
        render: (project: Project) => (
          <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={styles.tableName}>
            {project.name}
          </Link>
        )
      },
      {
        key: 'state',
        header: 'State',
        render: (project: Project) => <span>{project.archived ? 'Archived' : 'Active'}</span>
      },
      {
        key: 'updated',
        header: 'Updated',
        render: (project: Project) => <span>{formatProjectTime(project.updatedAt)}</span>
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (project: Project) => (
          <ActionRow>
            <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={ui.textAction}>
              Open
            </Link>
          </ActionRow>
        )
      }
    ],
    []
  )

  return (
    <PageFrame
      title="Projects"
      subtitle={`Manage projects and task workflows. ${items.length} project total.`}
      actions={
        <ActionRow>
          <button className={ui.ghostBtn} type="button" onClick={() => void loadProjects()}>
            Refresh
          </button>
          <button className={ui.primaryBtn} type="button" onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Close' : 'Create project'}
          </button>
        </ActionRow>
      }
    >
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {status !== 'Hazir' ? <InlineNotice tone="info">{status}</InlineNotice> : null}

      {showCreate ? (
        <SectionCard title="Create project" subtitle="Initialize a project to start task tracking.">
          <form onSubmit={handleCreate} className={styles.form}>
            <label htmlFor="project-name">Project name</label>
            <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} required />
            <label htmlFor="project-description">Description</label>
            <textarea
              id="project-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
            <ActionRow>
              <button className={ui.primaryBtn} type="submit">Create</button>
              <button className={ui.ghostBtn} type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </ActionRow>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard title="Project list" subtitle="Latest project activity and status.">
        <DataTable columns={columns} rows={items} rowKey={(project) => project.id} emptyLabel="No projects yet." />
      </SectionCard>
    </PageFrame>
  )
}
