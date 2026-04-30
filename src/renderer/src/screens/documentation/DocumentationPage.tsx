import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { marked } from 'marked'
import { LuArrowRight, LuBookOpen, LuWaypoints } from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'
import { OPENCLAW_DOC_CATEGORIES, OPENCLAW_DOCS, type OpenClawDoc } from '@renderer/constants/openclaw-docs'
import styles from './DocumentationPage.module.scss'

const GATEWAY_SOURCE_LABELS = [
  'src/main/services/gateway/*',
  'src/renderer/src/screens/gateways/*',
  'src/shared/contracts/ipc.ts',
  'src/shared/types/entities.ts'
]

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

function gatewayMarkdown(markdown: string): string {
  return markdown
    .replace(/mc\/backend\/app\/services\/openclaw\/[^\s,)`]+/g, 'src/main/services/gateway/*')
    .replace(/mc\/docs\/[^\s,)`]+/g, 'OpenClaw Gateway documentation')
    .replace(/\bOpenMissionControl\b/g, 'Open Mission Control')
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
  const location = useLocation()
  const isGatewayDocs = location.pathname === APP_ROUTES.DOCUMENTATION_GATEWAY
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [selectedId, setSelectedId] = useState(OPENCLAW_DOCS[0]?.id ?? '')

  const categories = useMemo(() => ['All', ...OPENCLAW_DOC_CATEGORIES], [])
  const docs = useMemo(() => OPENCLAW_DOCS.filter((doc) => matchesDoc(doc, query, category)), [query, category])
  const selected = docs.find((doc) => doc.id === selectedId) ?? docs[0] ?? OPENCLAW_DOCS[0]

  if (!isGatewayDocs) {
    return (
      <section className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1>Documentation</h1>
            <p>Operational documents grouped by product surface.</p>
          </div>
        </header>
        <div className={styles.docHubGrid}>
          <Link className={styles.hubCard} to={APP_ROUTES.DOCUMENTATION_GATEWAY}>
            <span className={styles.hubIcon}><LuWaypoints size={20} /></span>
            <div>
              <strong>Gateway Documents</strong>
              <p>OpenClaw Gateway protocol, pairing, sessions, RPC, and troubleshooting notes.</p>
            </div>
            <LuArrowRight size={18} />
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Gateway Documents</h1>
          <p>OpenClaw Gateway protocol and connector notes, independent from local MC folders.</p>
        </div>
        <Link className={styles.headerLink} to={APP_ROUTES.DOCUMENTATION}>
          <LuBookOpen size={15} />
          Documentation hub
        </Link>
      </header>

      <div className={styles.filters}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search OpenClaw Gateway docs..."
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
              <small>OpenClaw Gateway</small>
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
                {GATEWAY_SOURCE_LABELS.map((file) => (
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
              dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(gatewayMarkdown(selected.markdown)) }}
            />
          </article>
        )}
      </div>
    </section>
  )
}
