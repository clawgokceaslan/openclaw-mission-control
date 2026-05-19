import { DragEvent, useMemo, useState } from 'react'
import { LuDownload, LuLoaderCircle, LuUpload, LuX } from 'react-icons/lu'
import { BULK_TASK_JSON_IMPORT_EXAMPLE, BULK_TASK_JSON_IMPORT_INSTRUCT, parseBulkTaskJsonImportPreview } from '@renderer/screens/projects/detail/taskJsonImport'
import styles from './index.module.scss'

interface BulkTaskJsonImportPopupProps {
  open: boolean
  busy?: boolean
  importedCount?: number
  onClose: () => void
  onImport: (jsonText: string, expectedCount: number) => Promise<{ importedCount: number; warnings: string[] }>
}

export function BulkTaskJsonImportPopup({ open, busy = false, importedCount = 0, onClose, onImport }: BulkTaskJsonImportPopupProps) {
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const previewCount = useMemo(() => {
    if (!jsonText.trim()) return 0
    try {
      return parseBulkTaskJsonImportPreview(jsonText).length
    } catch {
      return 0
    }
  }, [jsonText])

  if (!open) return null

  const resetMessages = () => {
    setError(null)
    setWarnings([])
    setSuccessMessage(null)
  }

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Only .json files are supported.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setJsonText(String(reader.result ?? ''))
      resetMessages()
    }
    reader.onerror = () => setError('JSON file could not be read.')
    reader.readAsText(file)
  }

  const downloadTextFile = (fileName: string, content: string, type: string) => {
    const blob = new Blob([content], { type })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  const importJson = async () => {
    let expectedCount = 0
    try {
      expectedCount = parseBulkTaskJsonImportPreview(jsonText).length
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Enter valid JSON array.')
      setSuccessMessage(null)
      setWarnings([])
      return
    }
    resetMessages()
    try {
      const result = await onImport(jsonText, expectedCount)
      setWarnings(result.warnings)
      setSuccessMessage(`${result.importedCount} task imported.`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Bulk task import failed.')
      setSuccessMessage(null)
      setWarnings([])
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = Array.from(event.dataTransfer.files ?? [])[0]
    if (file) readFile(file)
  }

  return (
    <>
      <div className={styles.bulkTaskJsonImportBackdrop} onClick={busy ? undefined : onClose} />
      <section className={styles.bulkTaskJsonImportModal} role="dialog" aria-modal="true" aria-labelledby="bulk-task-json-import-heading">
        <header className={styles.bulkTaskJsonImportHeader}>
          <div>
            <h4 id="bulk-task-json-import-heading">Import task JSON array</h4>
            <p>Paste a task array or drop a .json file.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close bulk JSON import"><LuX size={16} /></button>
        </header>
        <div className={styles.bulkTaskJsonImportBody}>
          <div
            className={`${styles.bulkTaskJsonImportDropZone} ${isDragging ? styles.bulkTaskJsonImportDropZoneActive : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setIsDragging(false)
            }}
            onDrop={onDrop}
          >
            <LuUpload size={18} />
            <span>Drop JSON array here</span>
          </div>
          <label className={styles.bulkTaskJsonImportField}>
            <span>JSON array</span>
            <textarea value={jsonText} onChange={(event) => { setJsonText(event.target.value); resetMessages() }} placeholder={BULK_TASK_JSON_IMPORT_EXAMPLE} disabled={busy} />
          </label>
          <section className={styles.bulkTaskJsonImportProgress} aria-live="polite">
            <div>
              <strong>{busy ? 'Importing tasks' : successMessage ?? 'Ready to import'}</strong>
              <span>{busy ? `${importedCount} / ${previewCount || '...'} created` : `${previewCount} task${previewCount === 1 ? '' : 's'} detected`}</span>
            </div>
            {busy ? <LuLoaderCircle size={18} className={styles.bulkTaskJsonImportSpinner} /> : null}
          </section>
          <section className={styles.bulkTaskJsonImportGuide}>
            <header>
              <strong>Array import guide</strong>
              <div className={styles.bulkTaskJsonImportDownloads}>
                <button type="button" onClick={() => downloadTextFile('example-bulk-task-import.json', `${BULK_TASK_JSON_IMPORT_EXAMPLE}\n`, 'application/json;charset=utf-8')}>
                  <LuDownload size={14} />
                  Download example
                </button>
                <button type="button" onClick={() => downloadTextFile('INSTRUCT.md', BULK_TASK_JSON_IMPORT_INSTRUCT, 'text/markdown;charset=utf-8')}>
                  <LuDownload size={14} />
                  Download INSTRUCT.md
                </button>
              </div>
            </header>
            <dl>
              <div><dt>root</dt><dd>Required JSON array. Each item creates one task.</dd></div>
              <div><dt>atomic</dt><dd>If any item is invalid, no task is created.</dd></div>
              <div><dt>details</dt><dd>Each item supports title, description, status, tags, customFields, checklist, comments, and subtasks.</dd></div>
              <div><dt>project instructions</dt><dd>Shown in INSTRUCT.md help only; this import does not modify project settings.</dd></div>
            </dl>
          </section>
          {error ? <p className={styles.bulkTaskJsonImportError}>{error}</p> : null}
          {warnings.length > 0 ? <p className={styles.bulkTaskJsonImportWarning}>{warnings.join(' ')}</p> : null}
        </div>
        <footer className={styles.bulkTaskJsonImportFooter}>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={() => void importJson()} disabled={busy || !jsonText.trim()} aria-busy={busy}>{busy ? 'Importing...' : 'Import tasks'}</button>
        </footer>
      </section>
    </>
  )
}
