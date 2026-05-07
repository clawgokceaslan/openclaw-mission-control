import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { marked } from 'marked'
import { LuBookOpen } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { CODEX_DOC_CATEGORIES, CODEX_DOCS, type CodexDoc } from '@renderer/constants/codex-docs'
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

function matchesDoc(doc: CodexDoc, query: string, category: string): boolean {
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
  const [selectedId, setSelectedId] = useState(CODEX_DOCS[0]?.id ?? '')

  const categories = useMemo(() => ['All', ...CODEX_DOC_CATEGORIES], [])
  const docs = useMemo(() => CODEX_DOCS.filter((doc) => matchesDoc(doc, query, category)), [query, category])

  const docsByCategory = useMemo(() => {
    const map = new Map<string, CodexDoc[]>()
    for (const doc of docs) {
      const list = map.get(doc.category) ?? []
      list.push(doc)
      map.set(doc.category, list)
    }
    return Array.from(map.entries())
  }, [docs])

  useEffect(() => {
    if (!docs.find((doc) => doc.id === selectedId)) {
      setSelectedId(docs[0]?.id ?? '')
    }
  }, [docs, selectedId])

  const selected = docs.find((doc) => doc.id === selectedId) ?? docs[0] ?? CODEX_DOCS[0]

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Documentation</h1>
          <p>Kod tabanına göre organize edilmiş operasyonel ve referans dokümanlar.</p>
        </div>
        <Link className={styles.headerLink} to={APP_ROUTES.SETTINGS}>
          <LuBookOpen size={15} />
          Settings
        </Link>
      </header>

      <div className={styles.filters}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Doküman ara..."
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
          {docsByCategory.length === 0 ? (
            <p className={styles.empty}>Arama sonucu belge bulunamadı.</p>
          ) : (
            docsByCategory.map(([categoryName, rows]) => (
              <section key={categoryName} className={styles.docCategory}>
                <h3>{categoryName}</h3>
                <div className={styles.docCardList}>
                  {rows.map((doc) => (
                    <button
                      key={doc.id}
                      className={`${styles.docCard} ${selected?.id === doc.id ? styles.activeCard : ''}`}
                      onClick={() => setSelectedId(doc.id)}
                    >
                      <span>{doc.category}</span>
                      <h2>{doc.title}</h2>
                      <p>{doc.summary}</p>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {selected && (
          <article className={styles.preview}>
            <div className={styles.previewHeader}>
              <span>{selected.category}</span>
              <h2>{selected.title}</h2>
              <p>{selected.summary}</p>
            </div>

            <section className={styles.sources}>
              <h4>Kaynak dosyalar</h4>
              <div>
                {selected.sourceFiles.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </div>
            </section>

            <section className={styles.terms}>
              <h4>Terimler</h4>
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
