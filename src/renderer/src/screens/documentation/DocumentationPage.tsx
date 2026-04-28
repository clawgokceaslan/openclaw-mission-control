import { useMemo, useState } from 'react'
import { marked } from 'marked'
import { OPENCLAW_DOC_CATEGORIES, OPENCLAW_DOCS, type OpenClawDoc } from '@renderer/constants/openclaw-docs'
import styles from './DocumentationPage.module.scss'

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

function matchesDoc(doc: OpenClawDoc, query: string, category: string): boolean {
  if (category !== 'All' && doc.category !== category) return false
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    doc.title,
    doc.category,
    doc.summary,
    doc.sourceFiles.join(' '),
    doc.terms.map((term) => `${term.term} ${term.description}`).join(' '),
    doc.markdown
  ].join(' ').toLowerCase()
  return haystack.includes(needle)
}

export function DocumentationPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [selectedId, setSelectedId] = useState(OPENCLAW_DOCS[0]?.id ?? '')

  const categories = useMemo(() => ['All', ...OPENCLAW_DOC_CATEGORIES], [])
  const docs = useMemo(() => OPENCLAW_DOCS.filter((doc) => matchesDoc(doc, query, category)), [query, category])
  const selected = docs.find((doc) => doc.id === selectedId) ?? docs[0] ?? OPENCLAW_DOCS[0]

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Documentation</h1>
          <p>OpenClaw gateway protocol and connector notes</p>
        </div>
      </header>

      <div className={styles.filters}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search OpenClaw gateway docs..."
        />
        <div className={styles.categoryChips}>
          {categories.map((item) => (
            <button
              key={item}
              className={category === item ? styles.activeChip : ''}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.cardGrid}>
          {docs.map((doc) => (
            <button
              key={doc.id}
              className={`${styles.docCard} ${selected?.id === doc.id ? styles.activeCard : ''}`}
              onClick={() => setSelectedId(doc.id)}
            >
              <span>{doc.category}</span>
              <h2>{doc.title}</h2>
              <p>{doc.summary}</p>
              <small>{doc.sourceFiles.length} source file{doc.sourceFiles.length === 1 ? '' : 's'}</small>
            </button>
          ))}
          {docs.length === 0 && <p className={styles.empty}>No documentation matched your search.</p>}
        </div>

        {selected && (
          <article className={styles.preview}>
            <div className={styles.previewHeader}>
              <span>{selected.category}</span>
              <h2>{selected.title}</h2>
              <p>{selected.summary}</p>
            </div>

            <section className={styles.sources}>
              <h3>Source files</h3>
              <div>
                {selected.sourceFiles.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </div>
            </section>

            <section className={styles.terms}>
              <h3>Terms</h3>
              <div>
                {selected.terms.map((term) => (
                  <span key={term.term}>
                    <b>{term.term}</b>
                    <small>{term.description}</small>
                  </span>
                ))}
              </div>
            </section>

            <section
              className={styles.markdownPreview}
              dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(selected.markdown) }}
            />
          </article>
        )}
      </div>
    </section>
  )
}
