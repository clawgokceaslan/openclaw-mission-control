import { useEffect, useMemo, useState } from 'react'
import { LuPencil, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import styles from './TagsPage.module.scss'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Tag } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'

type TagFormState = {
  name: string
  description: string
  color: string
}

const DEFAULT_COLOR = '#9E9E9E'
const SMART_COLORS = ['#3B82F6', '#14B8A6', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#0EA5E9', '#F97316', '#64748B', '#22C55E']

function normalizeHex(raw: string) {
  const stripped = raw.trim().replace(/^#/, '').toUpperCase()
  const safe = stripped.replace(/[^0-9A-F]/g, '').slice(0, 6)
  return `#${safe}`
}

function isValidHex(hex: string) {
  return /^#[0-9A-F]{6}$/.test(hex)
}

function suggestTagColor(seed: string) {
  if (!seed.trim()) return SMART_COLORS[0]
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % SMART_COLORS.length
  return SMART_COLORS[index]
}

function toFormState(tag?: Tag | null): TagFormState {
  const name = tag?.name ?? ''
  return {
    name,
    description: tag?.description ?? '',
    color: isValidHex((tag?.color ?? '').toUpperCase()) ? (tag?.color as string).toUpperCase() : suggestTagColor(name || 'tag')
  }
}

export function TagsPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<Tag[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isFormModalOpen, setIsFormModalOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [pendingDeleteTag, setPendingDeleteTag] = useState<Tag | null>(null)
  const [form, setForm] = useState<TagFormState>(toFormState())

  const refresh = async () => {
    const response = await loadList<Tag[]>(IPC_CHANNELS.customFields.tagsList, token)
    if (!response.ok) {
      setError(response.error?.message ?? 'Failed to load tags.')
      setItems([])
      return
    }
    setItems(Array.isArray(response.data) ? response.data : [])
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const openNewModal = () => {
    setEditingTag(null)
    setForm(toFormState())
    setIsFormModalOpen(true)
  }

  const openEditModal = (tag: Tag) => {
    setEditingTag(tag)
    setForm(toFormState(tag))
    setIsFormModalOpen(true)
  }

  const closeFormModal = () => {
    setIsFormModalOpen(false)
    setEditingTag(null)
    setForm(toFormState())
  }

  const saveTag = async () => {
    const name = form.name.trim()
    const description = form.description.trim()
    const hasColorInput = form.color.trim().length > 0
    const normalizedColor = hasColorInput ? normalizeHex(form.color) : ''
    if (!name) {
      setError('Tag name is required.')
      return
    }
    if (hasColorInput && !isValidHex(normalizedColor)) {
      setError('Color must be a valid hex code like #9E9E9E.')
      return
    }
    const resolvedColor = hasColorInput
      ? normalizedColor
      : (editingTag?.color || suggestTagColor(name))

    setIsSaving(true)
    const response = editingTag
      ? await invokeBridge<Tag>(IPC_CHANNELS.customFields.tagsUpdate, {
        actorToken: token,
        id: editingTag.id,
        name,
        description: description || undefined,
        color: resolvedColor
      })
      : await invokeBridge<Tag>(IPC_CHANNELS.customFields.tagsCreate, {
        actorToken: token,
        name,
        description: description || undefined,
        color: resolvedColor
      })
    setIsSaving(false)

    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to save tag.')
      return
    }

    closeFormModal()
    await refresh()
  }

  const updateTagColorInline = async (tag: Tag, color: string) => {
    const normalized = normalizeHex(color)
    if (!isValidHex(normalized)) return
    const response = await invokeBridge<Tag>(IPC_CHANNELS.customFields.tagsUpdate, {
      actorToken: token,
      id: tag.id,
      name: tag.name,
      description: tag.description || undefined,
      color: normalized
    })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to update tag color.')
      return
    }
    await refresh()
  }

  const confirmDelete = async () => {
    if (!pendingDeleteTag) return
    setIsSaving(true)
    const response = await invokeBridge<{ removed: boolean }>(IPC_CHANNELS.customFields.tagsRemove, {
      actorToken: token,
      id: pendingDeleteTag.id
    })
    setIsSaving(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete tag.')
      return
    }
    setPendingDeleteTag(null)
    await refresh()
  }

  const tagCountText = useMemo(() => `${items.length} tags configured.`, [items.length])

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Tags</h1>
          <p className={styles.subtitle}>{tagCountText}</p>
        </div>
        <button type="button" className={styles.primaryBtn} onClick={openNewModal}>
          <LuPlus size={16} />
          Add tag
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.tableCard}>
        <header className={styles.tableHeader}>
          <span>Tag</span>
          <span>Color</span>
          <span>Tasks</span>
          <span>Updated</span>
          <span className={styles.actionsCol}>Actions</span>
        </header>
        {items.map((item) => (
          <article key={item.id} className={styles.tableRow}>
            <div className={styles.tagCell}>
              <div className={styles.tagPill}>
                <span className={styles.tagDot} style={{ background: item.color || DEFAULT_COLOR }} />
                <span>{item.name}</span>
              </div>
              <p>{item.description || 'No description'}</p>
            </div>
            <div className={styles.colorCell}>
              <input
                type="color"
                className={styles.inlineColorPicker}
                aria-label={`Color picker for ${item.name}`}
                title="Pick color"
                value={isValidHex((item.color || '').toUpperCase()) ? (item.color as string).toUpperCase() : suggestTagColor(item.name)}
                onChange={(event) => void updateTagColorInline(item, event.target.value)}
              />
              <code>{(item.color || suggestTagColor(item.name)).toUpperCase()}</code>
            </div>
            <div>{item.taskCount ?? 0}</div>
            <div>{new Date(item.updatedAt ?? Date.now()).toLocaleString()}</div>
            <div className={styles.actionsCell}>
              <button type="button" className={styles.iconBtn} aria-label="Update tag" title="Update tag" onClick={() => openEditModal(item)}>
                <LuPencil size={15} />
              </button>
              <button type="button" className={styles.iconBtnDanger} aria-label="Delete tag" title="Delete tag" onClick={() => setPendingDeleteTag(item)}>
                <LuTrash2 size={15} />
              </button>
            </div>
          </article>
        ))}
        {items.length === 0 ? <div className={styles.emptyRow}>No tags configured.</div> : null}
      </section>

      {isFormModalOpen ? (
        <>
          <div className={styles.modalBackdrop} onClick={closeFormModal} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={editingTag ? 'Update tag' : 'Add tag'}>
            <header className={styles.modalHeader}>
              <h3>{editingTag ? 'Update tag' : 'Add tag'}</h3>
              <button type="button" onClick={closeFormModal} aria-label="Close">
                <LuX size={14} />
              </button>
            </header>
            <div className={styles.modalBody}>
              <label>
                Tag
                <input
                  value={form.name}
                  onChange={(event) => {
                    const name = event.target.value
                    setForm((prev) => ({
                      ...prev,
                      name,
                      color: editingTag ? prev.color : suggestTagColor(name || 'tag')
                    }))
                  }}
                  placeholder="e.g. Research"
                  autoFocus
                />
              </label>
              <label>
                Description (optional)
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={3}
                  placeholder="What this tag means..."
                />
              </label>
              <label>
                Color
                <div className={styles.colorInputRow}>
                  <input
                    type="color"
                    value={isValidHex(form.color) ? form.color : suggestTagColor(form.name || 'tag')}
                    onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value.toUpperCase() }))}
                  />
                  <input
                    value={form.color}
                    onChange={(event) => setForm((prev) => ({ ...prev, color: normalizeHex(event.target.value) }))}
                    placeholder="Leave empty for auto color"
                  />
                </div>
              </label>
            </div>
            <footer className={styles.modalFooter}>
              <button type="button" className={styles.ghostBtn} onClick={closeFormModal}>
                Cancel
              </button>
              <button type="button" className={styles.primaryBtn} disabled={isSaving} onClick={() => void saveTag()}>
                {editingTag ? 'Update' : 'Create'}
              </button>
            </footer>
          </section>
        </>
      ) : null}

      {pendingDeleteTag ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setPendingDeleteTag(null)} />
          <section className={styles.confirmModal} role="dialog" aria-modal="true" aria-label="Delete tag">
            <h3>Delete tag</h3>
            <p>This will permanently remove "{pendingDeleteTag.name}". This action cannot be undone.</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setPendingDeleteTag(null)}>
                Cancel
              </button>
              <button type="button" className={styles.dangerBtn} disabled={isSaving} onClick={() => void confirmDelete()}>
                Delete
              </button>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
