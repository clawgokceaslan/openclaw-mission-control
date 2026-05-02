import { DragEvent, useState } from 'react'
import { LuDownload, LuUpload, LuX } from 'react-icons/lu'
import { parseTaskJsonImportPreview, TASK_JSON_IMPORT_EXAMPLE, TASK_JSON_IMPORT_INSTRUCT } from '../../detail/taskJsonImport'
import styles from '../../ProjectDetailPage.module.scss'

interface TaskJsonImportPopupProps {
  open: boolean
  title: string
  busy?: boolean
  onClose: () => void
  onImport: (jsonText: string) => void
}

export function TaskJsonImportPopup({ open, title, busy = false, onClose, onImport }: TaskJsonImportPopupProps) {
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  if (!open) return null

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Only .json files are supported.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setJsonText(String(reader.result ?? ''))
      setError(null)
    }
    reader.onerror = () => setError('JSON file could not be read.')
    reader.readAsText(file)
  }

  const importJson = () => {
    try {
      parseTaskJsonImportPreview(jsonText)
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Enter valid JSON.')
      return
    }
    setError(null)
    onImport(jsonText)
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

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = Array.from(event.dataTransfer.files ?? [])[0]
    if (file) readFile(file)
  }

  return (
    <>
      <div className={styles.nestedCreateBackdrop} onClick={onClose} />
      <section className={styles.jsonImportModal} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.jsonImportHeader}>
          <div>
            <h4>{title}</h4>
            <p>Paste one task JSON or drop a .json file.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close JSON import"><LuX size={16} /></button>
        </header>
        <div
          className={`${styles.jsonDropZone} ${isDragging ? styles.jsonDropZoneActive : ''}`}
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
          <span>Drop JSON file here</span>
        </div>
        <label className={styles.jsonImportField}>
          <span>JSON</span>
          <textarea value={jsonText} onChange={(event) => { setJsonText(event.target.value); setError(null) }} placeholder={TASK_JSON_IMPORT_EXAMPLE} />
        </label>
        <section className={styles.jsonImportGuide}>
          <header>
            <strong>JSON value guide</strong>
            <div className={styles.jsonImportDownloads}>
              <button type="button" onClick={() => downloadTextFile('example-task-import.json', `${TASK_JSON_IMPORT_EXAMPLE}\n`, 'application/json;charset=utf-8')}>
                <LuDownload size={14} />
                Download example
              </button>
              <button type="button" onClick={() => downloadTextFile('INSTRUCT.md', TASK_JSON_IMPORT_INSTRUCT, 'text/markdown;charset=utf-8')}>
                <LuDownload size={14} />
                Download INSTRUCT.md
              </button>
            </div>
          </header>
          <dl>
            <div><dt>title</dt><dd>Required. Creates or overwrites the task/template title.</dd></div>
            <div><dt>description</dt><dd>Markdown body for the main task/template description.</dd></div>
            <div><dt>tags</dt><dd>Shared labels. Existing tags are reused, missing tags are created.</dd></div>
            <div><dt>customFields</dt><dd>Field values by name. Missing fields are created using type: text, number, boolean, or json.</dd></div>
            <div><dt>checklist</dt><dd>Checklist rows. Each item needs title; checked defaults to false.</dd></div>
            <div><dt>comments</dt><dd>Imported notes. authorName defaults to Operator when omitted.</dd></div>
            <div><dt>subtasks</dt><dd>Child task list. Each subtask supports description, tags, customFields, checklist, comments, and dueAt.</dd></div>
          </dl>
        </section>
        {error ? <p className={styles.formError}>{error}</p> : null}
        <footer className={styles.jsonImportFooter}>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={importJson} disabled={busy || !jsonText.trim()}>{busy ? 'Importing...' : 'Import'}</button>
        </footer>
      </section>
    </>
  )
}
