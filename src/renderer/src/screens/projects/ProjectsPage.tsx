import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LuArrowUpRight, LuPlus, LuRefreshCw, LuX } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import type { Project, StatusTemplate } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
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
  const [statusTemplates, setStatusTemplates] = useState<StatusTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [creating, setCreating] = useState(false)
  const selectedTemplate = useMemo(
    () => statusTemplates.find((template) => template.id === selectedTemplateId) ?? statusTemplates[0] ?? null,
    [selectedTemplateId, statusTemplates]
  )

  const closeCreateModal = () => {
    setShowCreate(false)
    setName('')
    setDescription('')
    setSelectedTemplateId(statusTemplates[0]?.id ?? '')
  }

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

  useEffect(() => {
    const loadTemplates = async () => {
      const response = await invokeBridge<StatusTemplate[]>(IPC_CHANNELS.statuses.listTemplates, { actorToken: token })
      if (!response.ok) {
        setError(response.error?.message ?? 'Unable to load status templates')
        return
      }
      const rows = Array.isArray(response.data) ? response.data : []
      setStatusTemplates(rows)
      setSelectedTemplateId((current) => current || rows[0]?.id || '')
    }

    void loadTemplates()
  }, [token])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    setCreating(true)
    const response = await invokeBridge<Project>(IPC_CHANNELS.projects.create, {
      actorToken: token,
      name: name.trim(),
      description: description.trim() || undefined
    })

    if (!response.ok) {
      setCreating(false)
      setError(response.error?.message ?? 'Olusturulamadi')
      return
    }

    if (response.data?.id && selectedTemplateId) {
      const templateResponse = await invokeBridge(IPC_CHANNELS.statuses.applyTemplateToProject, {
        actorToken: token,
        projectId: response.data.id,
        templateId: selectedTemplateId
      })
      if (!templateResponse.ok) {
        setCreating(false)
        setError(templateResponse.error?.message ?? 'Project created, but status template could not be applied.')
        await loadProjects()
        return
      }
    }

    setCreating(false)
    closeCreateModal()
    await loadProjects()
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Projects</h1>
          <p>Manage projects and task workflows. {items.length} project total.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadProjects()}>
            <LuRefreshCw size={15} />
            Refresh
          </button>
          <button className={styles.primaryButton} type="button" onClick={() => setShowCreate(true)}>
            <LuPlus size={16} />
            Create project
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status !== 'Hazir' ? <p className={styles.notice}>{status}</p> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <span>Project</span>
          <span>State</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {items.length > 0 ? items.map((project) => (
          <div key={project.id} className={styles.tableRow}>
            <span>
              <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={styles.tableName}>
                {project.name}
              </Link>
              <small>{project.description || 'No description.'}</small>
            </span>
            <span>
              <span className={`${styles.statePill} ${project.archived ? styles.stateArchived : styles.stateActive}`}>
                {project.archived ? 'Archived' : 'Active'}
              </span>
            </span>
            <span className={styles.updatedCell}>{formatProjectTime(project.updatedAt)}</span>
            <span className={styles.actionsCell}>
              <Link to={`${APP_ROUTES.PROJECTS}/${project.id}`} className={styles.textIconButton}>
                <LuArrowUpRight size={15} />
                Open
              </Link>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>No projects yet.</div>
        )}
      </section>

      {showCreate ? (
        <>
          <div className={styles.modalBackdrop} onClick={closeCreateModal} />
          <section className={styles.createModal} role="dialog" aria-modal="true" aria-label="Create project">
            <header className={styles.modalHeader}>
              <div>
                <h2>Create project</h2>
                <p>Initialize a project and choose its workflow template.</p>
              </div>
              <button type="button" onClick={closeCreateModal} aria-label="Close create project modal">
                <LuX size={16} />
              </button>
            </header>
            <form onSubmit={handleCreate} className={styles.form}>
              <label>
                <span>Project name</span>
                <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  id="project-description"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span>Status template</span>
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={statusTemplates.length === 0}>
                  {statusTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.items?.length ?? 0} statuses)
                    </option>
                  ))}
                </select>
                {statusTemplates.length === 0 ? <small className={styles.fieldHint}>Status templates are loading.</small> : null}
              </label>
              {selectedTemplate ? (
                <div className={styles.statusPreview}>
                  <div className={styles.statusPreviewHeader}>
                    <span>Selected statuses</span>
                    <strong>{selectedTemplate.items?.length ?? 0}</strong>
                  </div>
                  <div className={styles.statusPreviewList}>
                    {(selectedTemplate.items ?? []).map((status) => (
                      <span key={status.id} className={styles.statusPreviewItem}>
                        <i style={{ background: status.color }} />
                        {status.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <footer className={styles.modalFooter}>
                <button className={styles.secondaryButton} type="button" onClick={closeCreateModal} disabled={creating}>Cancel</button>
                <button className={styles.primaryButton} type="submit" disabled={creating || !name.trim() || statusTemplates.length === 0}>
                  {creating ? 'Creating...' : 'Create project'}
                </button>
              </footer>
            </form>
          </section>
        </>
      ) : null}
    </section>
  )
}
