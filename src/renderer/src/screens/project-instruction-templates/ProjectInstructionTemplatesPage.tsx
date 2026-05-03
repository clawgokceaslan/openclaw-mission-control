import { FormEvent, useEffect, useMemo, useState } from 'react'
import { LuCopyPlus, LuPencil, LuPlus, LuSearch, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { ProjectInstructionTemplate, ProjectInstructionTemplatePayload } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge, loadList } from '@renderer/utils/api'
import styles from './ProjectInstructionTemplatesPage.module.scss'

const emptyTemplate: ProjectInstructionTemplatePayload = {
  generalContext: '',
  generalPrompt: '',
  planGuide: '',
  defaultOutput: '',
  rules: ''
}

type EditorMode = 'create' | 'edit' | 'copy'
type EditorState = {
  mode: EditorMode
  source?: ProjectInstructionTemplate | null
  name: string
  description: string
  template: ProjectInstructionTemplatePayload
}

function normalizeTemplate(value?: ProjectInstructionTemplatePayload): ProjectInstructionTemplatePayload {
  return {
    generalContext: value?.generalContext ?? '',
    generalPrompt: value?.generalPrompt ?? '',
    planGuide: value?.planGuide ?? '',
    defaultOutput: value?.defaultOutput ?? '',
    rules: value?.rules ?? ''
  }
}

function fieldCount(template: ProjectInstructionTemplatePayload): number {
  return [
    template.generalContext,
    template.generalPrompt,
    template.planGuide,
    template.defaultOutput,
    template.rules
  ].filter((value) => String(value ?? '').trim()).length
}

export function ProjectInstructionTemplatesPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<ProjectInstructionTemplate[]>([])
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectInstructionTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr')
    if (!needle) return items
    return items.filter((item) => `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('tr').includes(needle))
  }, [items, query])

  const load = async () => {
    setLoading(true)
    const response = await loadList<ProjectInstructionTemplate[]>(IPC_CHANNELS.projectInstructionTemplates.list, token)
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to load project instruction templates')
      return
    }
    setItems(Array.isArray(response.data) ? response.data : [])
  }

  useEffect(() => {
    void load()
  }, [token])

  const openCreate = () => {
    setFormError(null)
    setEditor({ mode: 'create', name: '', description: '', template: emptyTemplate })
  }

  const openEdit = (item: ProjectInstructionTemplate) => {
    setFormError(null)
    setEditor({
      mode: item.builtIn ? 'copy' : 'edit',
      source: item,
      name: item.builtIn ? `${item.name} Copy` : item.name,
      description: item.description ?? '',
      template: normalizeTemplate(item.template)
    })
  }

  const patchTemplate = (patch: Partial<ProjectInstructionTemplatePayload>) => {
    setEditor((current) => current ? { ...current, template: { ...current.template, ...patch } } : current)
  }

  const saveTemplate = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    if (!editor.name.trim()) {
      setFormError('Template name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload = {
      actorToken: token,
      name: editor.name.trim(),
      description: editor.description.trim(),
      template: editor.template
    }
    const shouldCreate = editor.mode !== 'edit' || editor.source?.builtIn
    const response = shouldCreate
      ? await invokeBridge<ProjectInstructionTemplate>(IPC_CHANNELS.projectInstructionTemplates.create, payload)
      : await invokeBridge<ProjectInstructionTemplate>(IPC_CHANNELS.projectInstructionTemplates.update, { ...payload, id: editor.source?.id })
    setSaving(false)
    if (!response.ok || !response.data) {
      setFormError(response.error?.message ?? 'Unable to save project instruction template')
      return
    }
    await load()
    setEditor(null)
  }

  const removeTemplate = async () => {
    if (!deleteTarget || deleteTarget.builtIn) return
    const response = await invokeBridge<{ ok: true }>(IPC_CHANNELS.projectInstructionTemplates.remove, { actorToken: token, id: deleteTarget.id })
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to remove template')
      return
    }
    setDeleteTarget(null)
    await load()
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Project Instructions</h1>
          <p>{items.length} templates configured.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openCreate} disabled={loading}>
          <LuPlus size={16} />
          Add template
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableToolbar}>
          <label className={styles.searchBox}>
            <LuSearch size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project instruction templates" aria-label="Search project instruction templates" />
          </label>
          <span className={styles.resultCount}>{filtered.length} / {items.length}</span>
        </div>

        <div className={styles.tableHead}>
          <span>Template</span>
          <span>Description</span>
          <span>Fields</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>

        {filtered.length > 0 ? filtered.map((item) => (
          <div key={item.id} className={styles.tableRow}>
            <span className={styles.nameCell}>
              {item.name}
              {item.builtIn ? <small className={styles.builtInBadge}>Built-in</small> : null}
            </span>
            <span className={styles.mutedCell}>{item.description || 'No description.'}</span>
            <span className={styles.mutedCell}>{fieldCount(item.template)} / 5</span>
            <span className={styles.mutedCell}>{item.builtIn ? 'Preset' : new Date(item.updatedAt).toLocaleDateString()}</span>
            <span className={styles.actionsCell}>
              <button type="button" className={styles.iconButton} onClick={() => openEdit(item)} aria-label={item.builtIn ? `Copy ${item.name}` : `Edit ${item.name}`}>
                {item.builtIn ? <LuCopyPlus size={15} /> : <LuPencil size={15} />}
              </button>
              {!item.builtIn ? (
                <button type="button" className={styles.iconButton} onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.name}`}>
                  <LuTrash2 size={15} />
                </button>
              ) : null}
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading project instruction templates...' : 'No templates match your search.'}</div>
        )}
      </section>

      {editor ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setEditor(null)} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={editor.mode === 'edit' ? 'Edit project instruction template' : 'Create project instruction template'}>
            <header className={styles.modalHeader}>
              <div>
                <h2>{editor.mode === 'edit' ? 'Edit project instruction template' : editor.mode === 'copy' ? 'Save custom copy' : 'Create project instruction template'}</h2>
                <p>{editor.mode === 'copy' ? 'Built-in templates are read-only. Saving creates a custom template.' : 'One template covers all Project Instructions fields.'}</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setEditor(null)} aria-label="Close template editor"><LuX size={16} /></button>
            </header>

            <form className={styles.form} onSubmit={saveTemplate}>
              {formError ? <p className={styles.formError}>{formError}</p> : null}
              <div className={styles.formGrid}>
                <label><span>Name *</span><input autoFocus value={editor.name} onChange={(event) => setEditor((current) => current ? { ...current, name: event.target.value } : current)} required /></label>
                <label><span>Description</span><input value={editor.description} onChange={(event) => setEditor((current) => current ? { ...current, description: event.target.value } : current)} /></label>
                <label><span>Context</span><textarea value={editor.template.generalContext ?? ''} onChange={(event) => patchTemplate({ generalContext: event.target.value })} /></label>
                <label><span>Prompt</span><textarea value={editor.template.generalPrompt ?? ''} onChange={(event) => patchTemplate({ generalPrompt: event.target.value })} /></label>
                <label className={styles.wideField}><span>Plan guide</span><textarea value={editor.template.planGuide ?? ''} onChange={(event) => patchTemplate({ planGuide: event.target.value })} /></label>
                <label><span>Output</span><textarea value={editor.template.defaultOutput ?? ''} onChange={(event) => patchTemplate({ defaultOutput: event.target.value })} /></label>
                <label><span>Rules</span><textarea value={editor.template.rules ?? ''} onChange={(event) => patchTemplate({ rules: event.target.value })} /></label>
              </div>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)} disabled={saving}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={saving || !editor.name.trim()}>{saving ? 'Saving...' : editor.mode === 'copy' ? 'Save custom copy' : 'Save'}</button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteTarget(null)} />
          <section className={styles.confirmModal} role="dialog" aria-modal="true" aria-label="Delete project instruction template">
            <header className={styles.modalHeader}>
              <div><h2>Delete project instruction template</h2><p>This does not affect projects that already used this template.</p></div>
              <button type="button" className={styles.modalClose} onClick={() => setDeleteTarget(null)} aria-label="Close delete confirmation"><LuX size={16} /></button>
            </header>
            <div className={styles.confirmBody}>Delete <strong>{deleteTarget.name}</strong>?</div>
            <footer className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className={styles.dangerButton} onClick={() => void removeTemplate()}>Delete</button>
            </footer>
          </section>
        </>
      ) : null}
    </section>
  )
}
