import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './ProjectGroupsPage.module.scss'
import { Alert, Button, Card, Form, Modal } from 'react-bootstrap'
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Project, ProjectGroup } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { LoadingState } from '@renderer/components/loading'

type EditorMode = 'create' | 'edit' | null

function formatUpdatedAt(value?: number) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export function ProjectGroupsPage() {
  const { token } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [items, setItems] = useState<ProjectGroup[]>([])
  const [status, setStatus] = useState('Loading...')
  const [error, setError] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [search, setSearch] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectGroup | null>(null)

  const refresh = async () => {
    setStatus('Loading...')
    const [groupsResponse, projectsResponse] = await Promise.all([
      loadList<ProjectGroup[]>(IPC_CHANNELS.projectGroups.list, token),
      loadList<Project[]>(IPC_CHANNELS.projects.list, token)
    ])

    if (!groupsResponse.ok || !projectsResponse.ok) {
      setStatus('Failed')
      setError(groupsResponse.error?.message ?? projectsResponse.error?.message ?? 'Unable to load project groups')
      setItems([])
      setProjects([])
      return
    }

    setStatus('Ready')
    setItems(Array.isArray(groupsResponse.data) ? groupsResponse.data : [])
    setProjects(Array.isArray(projectsResponse.data) ? projectsResponse.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const isEditorOpen = editorMode !== null
  const currentGroup = useMemo(
    () => items.find((item) => item.id === targetGroupId) ?? null,
    [items, targetGroupId]
  )

  const groupedProjectMap = useMemo(() => {
    const next = new Map<string, { groupId: string; groupName: string }>()
    for (const group of items) {
      const projectIds = Array.isArray(group.projectIds) ? group.projectIds : []
      for (const projectId of projectIds) {
        if (editorMode === 'edit' && group.id === targetGroupId) continue
        next.set(projectId, { groupId: group.id, groupName: group.name })
      }
    }
    return next
  }, [items, editorMode, targetGroupId])

  const visibleProjects = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return projects
    return projects.filter((project) => {
      const name = project.name.toLowerCase()
      const id = project.id.toLowerCase()
      return name.includes(normalized) || id.includes(normalized)
    })
  }, [projects, search])

  const openCreate = () => {
    setEditorMode('create')
    setTargetGroupId(null)
    setGroupName('')
    setGroupDescription('')
    setSelectedProjectIds([])
    setSearch('')
    setFormError(null)
  }

  const openEdit = (group: ProjectGroup) => {
    setEditorMode('edit')
    setTargetGroupId(group.id)
    setGroupName(group.name)
    setGroupDescription(group.description ?? '')
    setSelectedProjectIds(Array.isArray(group.projectIds) ? group.projectIds : [])
    setSearch('')
    setFormError(null)
  }

  const closeEditor = () => {
    setEditorMode(null)
    setTargetGroupId(null)
    setGroupName('')
    setGroupDescription('')
    setSelectedProjectIds([])
    setSearch('')
    setFormError(null)
  }

  const toggleProject = (projectId: string) => {
    if (groupedProjectMap.has(projectId)) return

    setSelectedProjectIds((prev) => {
      if (prev.includes(projectId)) {
        return prev.filter((item) => item !== projectId)
      }
      return [...prev, projectId]
    })
  }

  const submitEditor = async (event: FormEvent) => {
    event.preventDefault()
    if (!groupName.trim()) {
      setFormError('Group name is required.')
      return
    }

    const channel = editorMode === 'edit' ? IPC_CHANNELS.projectGroups.update : IPC_CHANNELS.projectGroups.create
    const payload: Record<string, unknown> = {
      actorToken: token,
      name: groupName.trim(),
      description: groupDescription.trim(),
      projectIds: selectedProjectIds
    }

    if (editorMode === 'edit' && targetGroupId) {
      payload.id = targetGroupId
    }

    setIsSubmitting(true)
    setFormError(null)
    const response = await invokeBridge<ProjectGroup>(channel, payload)
    setIsSubmitting(false)

    if (!response.ok) {
      setFormError(response.error?.message ?? 'Unable to save project group.')
      return
    }

    closeEditor()
    await refresh()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setIsSubmitting(true)
    const response = await invokeBridge(IPC_CHANNELS.projectGroups.remove, {
      actorToken: token,
      id: deleteTarget.id
    })
    setIsSubmitting(false)

    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete project group.')
      return
    }

    setDeleteTarget(null)
    await refresh()
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {editorMode === 'create' ? 'Create project group' : editorMode === 'edit' ? (currentGroup?.name ?? 'Edit project group') : 'Project groups'}
          </h1>
          <p className={styles.subtitle}>
            {editorMode
              ? (editorMode === 'create'
                ? 'Groups help agents discover related work across projects.'
                : 'Update the shared context that connects projects in this group.')
              : `Group projects so agents can see related work. ${items.length} group total.`}
          </p>
        </div>
        {!isEditorOpen ? (
          <button type="button" className={styles.createButton} onClick={openCreate}>
            <LuPlus size={16} />
            Create group
          </button>
        ) : null}
      </header>

      {error ? <Alert variant="danger" className={styles.notice}>{error}</Alert> : null}
      {!isEditorOpen ? (
        <section className={styles.tableCard}>
          <div className={styles.tableHead}>
            <span>Group</span>
            <span>Projects</span>
            <span>Updated</span>
            <span>Actions</span>
          </div>
          {status !== 'Ready' && items.length === 0 ? (
            <LoadingState variant="skeleton" rows={4} columns={4} messageIndex={0} />
          ) : items.length > 0 ? items.map((item) => (
            <div key={item.id} className={styles.tableRow}>
              <span>
                <Link to={`${APP_ROUTES.PROJECT_GROUPS}/${item.id}`} className={styles.groupNameLink}>{item.name}</Link>
                <small>{item.description || 'No description yet.'}</small>
              </span>
              <span className={styles.projectCount}>{Array.isArray(item.projectIds) ? item.projectIds.length : 0} projects</span>
              <span className={styles.updatedCell}>{formatUpdatedAt(item.updatedAt)}</span>
              <span className={styles.actionsCell}>
                <button type="button" className={styles.iconButton} onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`} title="Edit">
                  <LuPencil size={15} />
                </button>
                <button type="button" className={`${styles.iconButton} ${styles.dangerIconButton}`} onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.name}`} title="Delete">
                  <LuTrash2 size={15} />
                </button>
              </span>
            </div>
          )) : (
            <div className={styles.emptyRow}>No project groups yet.</div>
          )}
        </section>
      ) : (
        <Card className={styles.formCard}>
          <Card.Body>
            <Form onSubmit={submitEditor}>
              <Form.Group className={styles.formGroup}>
                <Form.Label>Group name <span className={styles.required}>*</span></Form.Label>
                <Form.Control
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="e.g. Release hardening"
                  required
                />
              </Form.Group>

              <Form.Group className={styles.formGroup}>
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={groupDescription}
                  onChange={(event) => setGroupDescription(event.target.value)}
                  placeholder="What ties these projects together? What should agents coordinate on?"
                />
              </Form.Group>

              <div className={styles.projectHeader}>
                <Form.Label className={styles.projectLabel}>Projects</Form.Label>
                <span className={styles.selectedCount}>{selectedProjectIds.length} selected</span>
              </div>

              <Form.Control
                className={styles.searchInput}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search projects..."
              />

              <div className={styles.projectList}>
                {visibleProjects.map((project) => {
                  const grouped = groupedProjectMap.get(project.id)
                  const disabled = Boolean(grouped)
                  const checked = selectedProjectIds.includes(project.id)
                  return (
                    <label key={project.id} className={`${styles.projectRow} ${disabled ? styles.projectRowDisabled : ''}`}>
                      <Form.Check
                        type="checkbox"
                        className={styles.projectCheck}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleProject(project.id)}
                      />
                      <div className={styles.projectMeta}>
                        <span className={styles.projectName}>{project.name}</span>
                        <span className={styles.projectId}>{project.id}</span>
                      </div>
                      {grouped ? <span className={styles.groupedBadge}>currently grouped</span> : null}
                    </label>
                  )
                })}
                {visibleProjects.length === 0 ? (
                  <div className={styles.emptyProjects}>No projects match your search.</div>
                ) : null}
              </div>

              <p className={styles.helpText}>
                Optional. Selected projects will be assigned to this group after save. You can change membership later in group edit or project settings.
              </p>

              {formError ? <Alert variant="danger" className={styles.formError}>{formError}</Alert> : null}

              <div className={styles.actions}>
                <Button variant="link" className={styles.cancelBtn} onClick={closeEditor} disabled={isSubmitting}>Cancel</Button>
                <Button type="submit" className={styles.submitBtn} disabled={isSubmitting || !groupName.trim()}>
                  {isSubmitting ? <LoadingState size="compact" messageIndex={2} /> : (editorMode === 'create' ? 'Create group' : 'Save changes')}
                </Button>
              </div>
            </Form>
          </Card.Body>
          <Card.Footer className={styles.formFooter}>
            Want to assign projects later? Update each project in <span>Projects</span> and pick this group.
          </Card.Footer>
        </Card>
      )}

      <Modal show={Boolean(deleteTarget)} onHide={() => setDeleteTarget(null)} centered>
        <Modal.Body className={styles.deleteModalBody}>
          <h3 className={styles.deleteTitle}>Delete project group</h3>
          <p className={styles.deleteText}>
            This will remove {deleteTarget?.name ?? 'this group'}. Projects will be ungrouped. This action cannot be undone.
          </p>
          <div className={styles.deleteActions}>
            <Button variant="outline-secondary" onClick={() => setDeleteTarget(null)} disabled={isSubmitting}>Cancel</Button>
            <Button variant="primary" onClick={() => void confirmDelete()} disabled={isSubmitting}>
              {isSubmitting ? <LoadingState size="compact" messageIndex={3} /> : 'Delete'}
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </section>
  )
}
