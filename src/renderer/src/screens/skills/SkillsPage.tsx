import { FormEvent, useEffect, useState } from 'react'
import { marked } from 'marked'
import { LuEye, LuPencil, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import { IPC_CHANNELS, type PaginatedResponse } from '@shared/contracts/ipc'
import type { Skill } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { invokeBridge } from '@renderer/utils/api'
import { AppSelect, type AppSelectOption } from '@renderer/components/select/AppSelect'
import styles from './SkillsPage.module.scss'

const PAGE_SIZE_OPTIONS: AppSelectOption[] = [
  { label: '10 / page', value: '10' },
  { label: '20 / page', value: '20' },
  { label: '50 / page', value: '50' }
]

const STATUS_OPTIONS: AppSelectOption[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' }
]

type SkillFormState = {
  id?: string
  title: string
  descriptionMarkdown: string
  status: 'active' | 'inactive'
}

const emptyForm: SkillFormState = {
  title: '',
  descriptionMarkdown: '',
  status: 'active'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function markdownToSafeHtml(markdown: string): string {
  return marked.parse(escapeHtml(markdown), {
    async: false,
    breaks: true,
    gfm: true
  }) as string
}

function markdownSnippet(markdown?: string): string {
  const normalized = (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\-[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || 'No description.'
}

export function SkillsPage() {
  const { token } = useAuth()
  const [rows, setRows] = useState<Skill[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AppSelectOption>(STATUS_OPTIONS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<SkillFormState>(emptyForm)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)
  const [previewTarget, setPreviewTarget] = useState<Skill | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : ((page - 1) * pageSize) + 1
  const end = Math.min(total, page * pageSize)

  const loadSkills = async () => {
    setLoading(true)
    const response = await invokeBridge<PaginatedResponse<Skill>>(IPC_CHANNELS.skills.listPage, {
      actorToken: token,
      page,
      pageSize,
      query,
      status: status.value === 'active' || status.value === 'inactive' ? status.value : undefined
    })
    setLoading(false)

    if (!response.ok || !response.data) {
      setRows([])
      setTotal(0)
      setError(response.error?.message ?? 'Unable to load skills')
      return
    }

    setRows(response.data.rows)
    setTotal(response.data.total)
    setError(null)
  }

  useEffect(() => {
    void loadSkills()
  }, [token, page, pageSize, query, status.value])

  const openCreate = () => {
    setForm(emptyForm)
    setModalMode('create')
  }

  const openEdit = (skill: Skill) => {
    setForm({
      id: skill.id,
      title: skill.name,
      descriptionMarkdown: skill.descriptionMarkdown ?? '',
      status: skill.status ?? (skill.enabled ? 'active' : 'inactive')
    })
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setForm(emptyForm)
  }

  const submitSkill = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.title.trim()) return
    setLoading(true)
    const channel = modalMode === 'edit' ? IPC_CHANNELS.skills.update : IPC_CHANNELS.skills.create
    const response = await invokeBridge<Skill>(channel, {
      actorToken: token,
      id: form.id,
      title: form.title.trim(),
      descriptionMarkdown: form.descriptionMarkdown,
      status: form.status
    })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to save skill')
      return
    }
    closeModal()
    setPage(1)
    await loadSkills()
  }

  const removeSkill = async () => {
    if (!deleteTarget) return
    setLoading(true)
    const response = await invokeBridge<{ ok: true }>(IPC_CHANNELS.skills.remove, {
      actorToken: token,
      id: deleteTarget.id
    })
    setLoading(false)
    if (!response.ok) {
      setError(response.error?.message ?? 'Unable to delete skill')
      return
    }
    setDeleteTarget(null)
    setPage(1)
    await loadSkills()
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Skills</h1>
          <p>{total} skills configured.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openCreate} disabled={loading}>
          <LuPlus size={16} />
          Add skill
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.filterBar}>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
          placeholder="Search skills..."
        />
        <AppSelect
          mode="single"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(value) => {
            setStatus(value ?? STATUS_OPTIONS[0])
            setPage(1)
          }}
        />
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <span>Skill</span>
          <span>Description</span>
          <span>Status</span>
          <span>Updated</span>
          <span>Preview</span>
          <span />
        </div>
        {rows.length > 0 ? rows.map((skill) => (
          <div key={skill.id} className={styles.tableRow}>
            <span className={styles.skillName}>{skill.name}</span>
            <span className={styles.descriptionCell}>{markdownSnippet(skill.descriptionMarkdown)}</span>
            <span>
              <span className={skill.status === 'active' ? styles.enabledPill : styles.disabledPill}>
                {skill.status === 'active' ? 'Active' : 'Inactive'}
              </span>
            </span>
            <span>{skill.updatedAt ? new Date(skill.updatedAt).toLocaleString() : '-'}</span>
            <span className={styles.previewCell}>
              <button
                type="button"
                onClick={() => setPreviewTarget(skill)}
                disabled={!skill.descriptionMarkdown?.trim()}
                aria-label={`Preview ${skill.name}`}
              >
                <LuEye size={15} />
              </button>
            </span>
            <span className={styles.actionCell}>
              <button type="button" onClick={() => openEdit(skill)} aria-label={`Edit ${skill.name}`}>
                <LuPencil size={15} />
              </button>
              <button type="button" onClick={() => setDeleteTarget(skill)} aria-label={`Delete ${skill.name}`}>
                <LuTrash2 size={15} />
              </button>
            </span>
          </div>
        )) : (
          <div className={styles.emptyRow}>{loading ? 'Loading skills...' : 'No skills found.'}</div>
        )}
      </section>

      <footer className={styles.pagination}>
        <span>{start}-{end} of {total}</span>
        <div>
          <AppSelect
            mode="single"
            value={PAGE_SIZE_OPTIONS.find((option) => option.value === String(pageSize)) ?? PAGE_SIZE_OPTIONS[1]}
            options={PAGE_SIZE_OPTIONS}
            onChange={(value) => {
              setPageSize(Number(value?.value ?? 20))
              setPage(1)
            }}
          />
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
            Previous
          </button>
          <span>Page {page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>
            Next
          </button>
        </div>
      </footer>

      {modalMode ? (
        <>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <section className={styles.skillModal} role="dialog" aria-modal="true" aria-label={modalMode === 'edit' ? 'Edit skill' : 'Add skill'}>
            <header className={styles.modalHeader}>
              <h2>{modalMode === 'edit' ? 'Edit skill' : 'Add skill'}</h2>
              <button type="button" onClick={closeModal} aria-label="Close skill modal"><LuX size={16} /></button>
            </header>
            <form className={styles.skillForm} onSubmit={submitSkill}>
              <label>
                <span>Title *</span>
                <input
                  autoFocus
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="e.g. Research assistant"
                />
              </label>
              <label>
                <span>Description (Markdown)</span>
                <textarea
                  value={form.descriptionMarkdown}
                  onChange={(event) => setForm((current) => ({ ...current, descriptionMarkdown: event.target.value }))}
                  placeholder="Describe what this skill does..."
                  rows={7}
                />
              </label>
              <label>
                <span>Status</span>
                <AppSelect
                  mode="single"
                  value={STATUS_OPTIONS.find((option) => option.value === form.status) ?? STATUS_OPTIONS[1]}
                  options={STATUS_OPTIONS.filter((option) => option.value !== 'all')}
                  onChange={(value) => {
                    if (value?.value === 'active' || value?.value === 'inactive') {
                      setForm((current) => ({ ...current, status: value.value }))
                    }
                  }}
                />
              </label>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={closeModal}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={loading || !form.title.trim()}>
                  {modalMode === 'edit' ? 'Save changes' : 'Add skill'}
                </button>
              </footer>
            </form>
          </section>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setDeleteTarget(null)} />
          <section className={styles.confirmModal} role="dialog" aria-modal="true" aria-label="Delete skill">
            <h2>Delete skill</h2>
            <p>Are you sure you want to delete {deleteTarget.name}? Linked tasks will lose this skill.</p>
            <footer className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className={styles.dangerButton} onClick={() => void removeSkill()} disabled={loading}>Delete</button>
            </footer>
          </section>
        </>
      ) : null}

      {previewTarget ? (
        <>
          <div className={styles.modalBackdrop} onClick={() => setPreviewTarget(null)} />
          <section className={`${styles.skillModal} ${styles.previewModal}`} role="dialog" aria-modal="true" aria-label="Skill markdown preview">
            <header className={styles.modalHeader}>
              <div>
                <h2>{previewTarget.name}</h2>
                <span className={previewTarget.status === 'active' ? styles.enabledPill : styles.disabledPill}>
                  {previewTarget.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
              <button type="button" onClick={() => setPreviewTarget(null)} aria-label="Close preview modal"><LuX size={16} /></button>
            </header>
            <div className={styles.previewBody}>
              {previewTarget.descriptionMarkdown?.trim() ? (
                <article
                  className={styles.markdownPreview}
                  dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(previewTarget.descriptionMarkdown) }}
                />
              ) : (
                <p className={styles.previewEmpty}>No markdown description.</p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
