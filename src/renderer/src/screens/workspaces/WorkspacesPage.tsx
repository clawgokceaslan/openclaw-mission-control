import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuFolderOpen, LuPencil, LuPlus, LuRefreshCw, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { Project, Workspace } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import styles from './WorkspacesPage.module.scss'

type WorkspaceEditor = {
  workspace: Workspace | null
  name: string
  rootPath: string
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

interface WorkspacesPageProps {
  embedded?: boolean
}

export function WorkspacesPage({ embedded = false }: WorkspacesPageProps) {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editor, setEditor] = useState<WorkspaceEditor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)

  const projectCountByWorkspace = useMemo(() => {
    const counts = new Map<string, number>()
    for (const project of projects) {
      if (project.workspaceId) counts.set(project.workspaceId, (counts.get(project.workspaceId) ?? 0) + 1)
    }
    return counts
  }, [projects])

  const refresh = async () => {
    setLoading(true)
    const [workspaceResponse, projectResponse] = await Promise.all([
      loadList<Workspace[]>(IPC_CHANNELS.workspaces.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token)
    ])
    setLoading(false)
    if (!workspaceResponse.ok) {
      setError(workspaceResponse.error?.message ?? 'Unable to load workspaces')
      return
    }
    setWorkspaces(Array.isArray(workspaceResponse.data) ? workspaceResponse.data : [])
    if (projectResponse.ok) setProjects(Array.isArray(projectResponse.data) ? projectResponse.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const pickFolder = async () => {
    const response = await invokeBridge<{ rootPath: string } | null>(IPC_CHANNELS.workspaces.pickFolder, { actorToken: token })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to pick folder')
      return null
    }
    return response.data?.rootPath ?? null
  }

  const openCreate = () => {
    setEditor({ workspace: null, name: '', rootPath: '' })
  }

  useEffect(() => {
    const state = location.state as { openCreate?: boolean; name?: string } | null
    const searchParams = new URLSearchParams(location.search)
    const shouldOpen = Boolean(state?.openCreate) || searchParams.get('create') === '1'
    if (!shouldOpen) return
    setEditor({ workspace: null, name: state?.name ?? searchParams.get('name') ?? '', rootPath: '' })
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    const state = location.state as { openEditId?: string; workspace?: Workspace } | null
    const searchParams = new URLSearchParams(location.search)
    const editId = state?.openEditId ?? searchParams.get('edit')
    if (!editId) return
    const target = state?.workspace ?? workspaces.find((workspace) => workspace.id === editId)
    if (!target) return
    setEditor({ workspace: target, name: target.name, rootPath: target.rootPath })
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate, workspaces])

  const changeEditorFolder = async () => {
    const rootPath = await pickFolder()
    if (rootPath) setEditor((current) => current ? { ...current, rootPath } : current)
  }

  const saveWorkspace = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor?.name.trim() || !editor.rootPath.trim()) return
    const channel = editor.workspace ? IPC_CHANNELS.workspaces.update : IPC_CHANNELS.workspaces.create
    const response = await invokeBridge<Workspace>(channel, {
      actorToken: token,
      id: editor.workspace?.id,
      name: editor.name.trim(),
      rootPath: editor.rootPath.trim()
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to save workspace')
      return
    }
    setEditor(null)
    await refresh()
  }

  const removeWorkspace = async () => {
    if (!deleteTarget) return
    const response = await invokeBridge(IPC_CHANNELS.workspaces.remove, { actorToken: token, id: deleteTarget.id })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete workspace')
      return
    }
    setDeleteTarget(null)
    await refresh()
  }

  return (
    <section className={`${styles.page} ${embedded ? styles.embeddedPage : ''}`}>
      <header className={styles.header}>
        <div>
          <h1>Workspaces</h1>
          <p>Manage local folders used for project files and task attachments.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => void refresh()}>
            <LuRefreshCw size={15} />
            Refresh
          </button>
          <button type="button" className={styles.primaryButton} onClick={openCreate}>
            <LuPlus size={16} />
            Add workspace
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.notice}>Loading workspaces...</p> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <span>Name</span>
          <span>Folder path</span>
          <span>Projects</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        {workspaces.length > 0 ? workspaces.map((workspace) => (
          <div key={workspace.id} className={styles.tableRow}>
            <span className={styles.nameCell}>{workspace.name}</span>
            <span className={styles.pathCell}>{workspace.rootPath}</span>
            <span>{projectCountByWorkspace.get(workspace.id) ?? 0}</span>
            <span>{formatTime(workspace.updatedAt)}</span>
            <span className={styles.actionsCell}>
              <button type="button" onClick={() => setEditor({ workspace, name: workspace.name, rootPath: workspace.rootPath })}>
                <LuPencil size={14} />
                Edit
              </button>
              <button type="button" className={styles.dangerButton} onClick={() => setDeleteTarget(workspace)}>
                <LuTrash2 size={14} />
                Delete
              </button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>No workspaces yet.</div>
        )}
      </section>

      {editor ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setEditor(null)} />
          <form className={styles.modal} onSubmit={saveWorkspace}>
            <header className={styles.modalHeader}>
              <div>
                <h2>{editor.workspace ? 'Edit workspace' : 'Add workspace'}</h2>
                <p>Choose the folder where project files will be stored.</p>
              </div>
              <button type="button" onClick={() => setEditor(null)} aria-label="Close workspace editor"><LuX size={16} /></button>
            </header>
            <div className={styles.formBody}>
              <label>
                <span>Name</span>
                <input autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
              </label>
              <label>
                <span>Folder path</span>
                <div className={styles.inlinePicker}>
                  <input value={editor.rootPath} onChange={(event) => setEditor({ ...editor, rootPath: event.target.value })} />
                  <button type="button" className={styles.secondaryButton} onClick={() => void changeEditorFolder()}>
                    <LuFolderOpen size={15} />
                    Choose
                  </button>
                </div>
              </label>
            </div>
            <footer className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)}>Cancel</button>
              <button type="submit" className={styles.primaryButton} disabled={!editor.name.trim() || !editor.rootPath.trim()}>Save workspace</button>
            </footer>
          </form>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteTarget(null)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Delete workspace">
            <header className={styles.modalHeader}>
              <div>
                <h2>Delete workspace</h2>
                <p>Physical folders will not be deleted.</p>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)} aria-label="Close delete workspace modal"><LuX size={16} /></button>
            </header>
            <div className={styles.formBody}>
              <p className={styles.notice}>
                {projectCountByWorkspace.get(deleteTarget.id) ?? 0} project(s) are assigned to {deleteTarget.name}. Their workspace selection will be cleared.
              </p>
            </div>
            <footer className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className={styles.dangerPrimaryButton} onClick={() => void removeWorkspace()}>Delete workspace</button>
            </footer>
          </section>
        </>
      ) : null}
    </section>
  )
}
