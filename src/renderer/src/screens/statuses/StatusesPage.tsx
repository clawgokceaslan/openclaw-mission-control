import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { LuPencil, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { ProjectStatus, ProjectStatusCategory, StatusTemplate } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import styles from './StatusesPage.module.scss'

type DraftStatus = Pick<ProjectStatus, 'id' | 'name' | 'category' | 'color' | 'sortOrder' | 'isDefault'>

type EditorState = {
  id?: string
  name: string
  items: DraftStatus[]
}

const CATEGORY_LABELS: Record<ProjectStatusCategory, string> = {
  not_started: 'Not started',
  active: 'Active',
  done: 'Done',
  closed: 'Closed'
}

const CATEGORY_HELP: Record<ProjectStatusCategory, string> = {
  not_started: 'Exactly one initial status',
  active: 'One or more working statuses',
  done: 'Exactly one completed status',
  closed: 'Exactly one archived/closed status'
}

const CATEGORY_COLORS: Record<ProjectStatusCategory, string[]> = {
  not_started: ['#8A99B4', '#64748B', '#94A3B8'],
  active: ['#2F80ED', '#5B7CFA', '#8B5CF6', '#22A6F2'],
  done: ['#29B764', '#17A56B', '#35C77E'],
  closed: ['#D94B5F', '#EF4444', '#F97373']
}

const CATEGORY_ORDER: ProjectStatusCategory[] = ['not_started', 'active', 'done', 'closed']

function colorFor(category: ProjectStatusCategory, seed: string) {
  const colors = CATEGORY_COLORS[category]
  let hash = 0
  for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]
}

function createStatus(category: ProjectStatusCategory, index: number): DraftStatus {
  const name = category === 'not_started' ? 'Not started' : category === 'active' ? 'Active' : category === 'done' ? 'Done' : 'Closed'
  return {
    id: crypto.randomUUID(),
    name,
    category,
    color: colorFor(category, `${category}:${index}:${Date.now()}`),
    sortOrder: index,
    isDefault: category === 'not_started'
  }
}

function defaultEditor(): EditorState {
  return {
    name: 'New workflow',
    items: [
      createStatus('not_started', 0),
      createStatus('active', 1),
      { ...createStatus('active', 2), name: 'Review' },
      createStatus('done', 3),
      createStatus('closed', 4)
    ]
  }
}

function templateToEditor(template: StatusTemplate): EditorState {
  return {
    id: template.id,
    name: template.name,
    items: (template.items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      color: item.color,
      sortOrder: item.sortOrder,
      isDefault: item.isDefault
    }))
  }
}

function normalizeItems(items: DraftStatus[]) {
  return CATEGORY_ORDER.flatMap((category) => items
    .filter((item) => item.category === category)
    .map((item, index) => ({ ...item, sortOrder: CATEGORY_ORDER.indexOf(category) * 100 + index, isDefault: category === 'not_started' && index === 0 })))
}

function validateEditor(editor: EditorState) {
  if (!editor.name.trim()) return 'Template name is required.'
  const counts = CATEGORY_ORDER.reduce<Record<ProjectStatusCategory, number>>((acc, category) => {
    acc[category] = editor.items.filter((item) => item.category === category && item.name.trim()).length
    return acc
  }, { not_started: 0, active: 0, done: 0, closed: 0 })
  if (counts.not_started !== 1) return 'Not started must contain exactly one status.'
  if (counts.active < 1) return 'Active must contain at least one status.'
  if (counts.done !== 1) return 'Done must contain exactly one status.'
  if (counts.closed !== 1) return 'Closed must contain exactly one status.'
  return null
}

export function StatusesPage() {
  const { token } = useAuth()
  const [templates, setTemplates] = useState<StatusTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>(defaultEditor)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StatusTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedTemplate = useMemo(() => templates.find((item) => item.id === selectedId) ?? templates[0] ?? null, [selectedId, templates])

  const load = async () => {
    const response = await invokeBridge<StatusTemplate[]>(IPC_CHANNELS.statuses.listTemplates, { actorToken: token })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to load status templates')
      return
    }
    const rows = Array.isArray(response.data) ? response.data : []
    setTemplates(rows)
    if (!selectedId && rows[0]) setSelectedId(rows[0].id)
  }

  useEffect(() => { void load() }, [token])

  useEffect(() => {
    if (selectedTemplate) setEditor(templateToEditor(selectedTemplate))
  }, [selectedTemplate?.id])

  const updateItem = (id: string, patch: Partial<DraftStatus>) => {
    setEditor((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item)
    }))
  }

  const removeItem = (id: string) => {
    setEditor((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }))
  }

  const addActiveStatus = () => {
    setEditor((current) => ({ ...current, items: [...current.items, createStatus('active', current.items.length)] }))
  }

  const saveEditor = async () => {
    const validation = validateEditor(editor)
    if (validation) {
      setError(validation)
      return
    }
    const payload = { name: editor.name.trim(), items: normalizeItems(editor.items).map((item) => ({ name: item.name.trim(), category: item.category, color: item.color, sortOrder: item.sortOrder, isDefault: item.isDefault })) }
    const response = editor.id
      ? await invokeBridge<StatusTemplate>(IPC_CHANNELS.statuses.updateTemplate, { actorToken: token, id: editor.id, ...payload })
      : await invokeBridge<StatusTemplate>(IPC_CHANNELS.statuses.createTemplate, { actorToken: token, ...payload })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to save template')
      return
    }
    setError(null)
    setIsCreateOpen(false)
    await load()
    if (response.data?.id) setSelectedId(response.data.id)
  }

  const deleteTemplate = async () => {
    if (!deleteTarget) return
    const response = await invokeBridge(IPC_CHANNELS.statuses.removeTemplate, { actorToken: token, id: deleteTarget.id })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete template')
      return
    }
    setDeleteTarget(null)
    setSelectedId(null)
    await load()
  }

  const renderEditor = () => (
    <section className={styles.editor}>
      <header className={styles.editorHeader}>
        <div className={styles.editorTitleWrap}>
          <span className={styles.workflowBadge}>Selected workflow</span>
          <h2>{editor.name || 'Untitled workflow'}</h2>
          <p>Status templates are copied into projects and can be adjusted per project later.</p>
        </div>
        <div className={styles.editorActions}>
          <button type="button" className={styles.ghostBtn} onClick={() => setEditor(selectedTemplate ? templateToEditor(selectedTemplate) : defaultEditor())}>Reset</button>
          <button type="button" className={styles.primaryBtn} onClick={() => void saveEditor()}>Save template</button>
        </div>
      </header>
      <div className={styles.groups}>
        <label className={styles.templateNameField}>
          <span>Template name</span>
          <input className={styles.input} value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} />
        </label>
        {CATEGORY_ORDER.map((category) => {
          const rows = editor.items.filter((item) => item.category === category)
          return (
            <section key={category} className={styles.group}>
              <header className={styles.groupHeader}>
                <div>
                  <strong>{CATEGORY_LABELS[category]}</strong>
                  <span>{rows.length} {rows.length === 1 ? 'status' : 'statuses'}</span>
                </div>
                <p>{CATEGORY_HELP[category]}</p>
              </header>
              <div className={styles.groupBody}>
                {rows.map((item) => (
                  <div key={item.id} className={styles.row} style={{ '--status-color': item.color } as CSSProperties}>
                    <div className={styles.rowMain}>
                      <span className={styles.statusDot} aria-hidden="true" />
                      <input className={styles.input} value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} />
                    </div>
                    <div className={styles.colorControls}>
                      <label className={styles.swatch} title="Pick color">
                        <input type="color" value={item.color} onChange={(event) => updateItem(item.id, { color: event.target.value })} />
                      </label>
                      <input className={styles.colorInput} value={item.color} onChange={(event) => updateItem(item.id, { color: event.target.value || colorFor(category, item.name) })} />
                    </div>
                    <button type="button" className={styles.iconBtn} aria-label={`Remove ${item.name}`} onClick={() => removeItem(item.id)} disabled={category !== 'active'}>
                      <LuTrash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              {category === 'active' ? <button type="button" className={styles.addBtn} onClick={addActiveStatus}><LuPlus size={15} /> Add active status</button> : null}
            </section>
          )
        })}
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  )

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerMeta}>
          <span className={styles.headerKicker}>Status flow templates</span>
          <h1>Statuses</h1>
          <p>{templates.length} status templates configured.</p>
        </div>
        <button type="button" className={styles.primaryBtn} onClick={() => { setEditor(defaultEditor()); setIsCreateOpen(true) }}>
          <LuPlus size={16} />
          Add template
        </button>
      </header>
      <main className={styles.content}>
        <aside className={styles.card}>
          <header className={styles.templatePanelHeader}>
            <div>
              <strong>Templates</strong>
              <span>Reusable status flows</span>
            </div>
            <span className={styles.templateCount}>{templates.length}</span>
          </header>
          <div className={styles.templateList}>
            {templates.length === 0 ? <p className={styles.empty}>No status templates configured.</p> : null}
            {templates.map((template) => (
              <div key={template.id} className={`${styles.templateBtn} ${selectedTemplate?.id === template.id ? styles.templateBtnActive : ''}`}>
                <button type="button" className={styles.templateMain} onClick={() => setSelectedId(template.id)}>
                  <strong>{template.name}</strong>
                  <span className={styles.templateSummary}>{template.items?.length ?? 0} statuses</span>
                </button>
                <button type="button" className={styles.templateIconAction} aria-label={`Edit ${template.name}`} onClick={() => setSelectedId(template.id)}><LuPencil size={15} /></button>
                <button type="button" className={styles.templateIconAction} aria-label={`Delete ${template.name}`} onClick={() => setDeleteTarget(template)}><LuTrash2 size={15} /></button>
              </div>
            ))}
          </div>
        </aside>
        {selectedTemplate ? renderEditor() : <section className={`${styles.editor} ${styles.emptyEditor}`}><p className={styles.empty}>Create a template to start.</p></section>}
      </main>

      {isCreateOpen ? (
        <>
          <div className={styles.backdrop} onClick={() => setIsCreateOpen(false)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Add status template">
            <header className={styles.modalHeader}><h3>Add status template</h3><button type="button" className={styles.iconBtn} onClick={() => setIsCreateOpen(false)}><LuX size={16} /></button></header>
            <div className={styles.modalBody}>
              <label>Template name<input className={styles.input} value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} /></label>
            </div>
            <footer className={styles.modalFooter}><button type="button" className={styles.ghostBtn} onClick={() => setIsCreateOpen(false)}>Cancel</button><button type="button" className={styles.modalPrimary} onClick={() => void saveEditor()}>Create</button></footer>
          </section>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className={styles.backdrop} onClick={() => setDeleteTarget(null)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Delete status template">
            <header className={styles.modalHeader}><h3>Delete status template</h3><button type="button" className={styles.iconBtn} onClick={() => setDeleteTarget(null)}><LuX size={16} /></button></header>
            <div className={styles.modalBody}><p>Are you sure you want to delete {deleteTarget.name}? Project statuses already copied from this template will not be removed.</p></div>
            <footer className={styles.modalFooter}><button type="button" className={styles.ghostBtn} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className={styles.dangerBtn} onClick={() => void deleteTemplate()}>Delete</button></footer>
          </section>
        </>
      ) : null}
    </section>
  )
}
