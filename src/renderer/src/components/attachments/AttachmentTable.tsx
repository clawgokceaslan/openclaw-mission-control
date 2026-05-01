import { useRef, useState, type DragEvent } from 'react'
import type { TaskAttachment } from '@shared/types/entities'
import { AttachmentRow, downloadAttachment, formatFileSize } from './attachments'
import styles from './AttachmentTable.module.scss'

interface AttachmentTableProps {
  rows: AttachmentRow[]
  uploading?: boolean
  onUpload: (files: File[]) => void
  onRemove: (row: AttachmentRow) => void
  onError?: (message: string) => void
}

export function AttachmentTable({ rows, uploading = false, onUpload, onRemove, onError }: AttachmentTableProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AttachmentRow | null>(null)

  const submitFiles = (files: FileList | File[]) => {
    const nextFiles = Array.from(files).filter(Boolean)
    if (nextFiles.length > 0) onUpload(nextFiles)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    submitFiles(event.dataTransfer.files)
  }

  const copyLink = async (row: AttachmentRow) => {
    try {
      await navigator.clipboard?.writeText(row.url)
    } catch {
      onError?.('Unable to copy attachment link')
    }
  }

  const download = async (row: AttachmentRow) => {
    try {
      await downloadAttachment(row)
    } catch {
      onError?.('Unable to download attachment')
    }
  }

  return (
    <div className={styles.attachmentsPanel}>
      <div
        className={styles.uploadDropzone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <div>
          <strong>Upload attachments</strong>
          <span>Drop files here or select from your computer.</span>
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading...' : 'Choose files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(event) => {
            if (event.target.files) submitFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.attachmentsTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Type</th>
              <th>Size</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className={styles.attachmentName}>{row.name}</span>
                  <span className={styles.attachmentUrl}>{row.url}</span>
                </td>
                <td>{row.source}</td>
                <td>{row.type || 'file'}</td>
                <td>{formatFileSize(row.size)}</td>
                <td>
                  <div className={styles.actionGroup}>
                    <button type="button" onClick={() => void download(row)}>Download</button>
                    <button type="button" onClick={() => void copyLink(row)}>Copy link</button>
                    <button type="button" className={styles.dangerAction} onClick={() => setDeleteTarget(row)}>Delete</button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className={styles.emptyCell}>No attachments yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteTarget ? (
        <div className={styles.confirmBackdrop} role="presentation">
          <section className={styles.confirmDialog} role="dialog" aria-modal="true" aria-label={`Delete ${deleteTarget.name}`}>
            <h4>Delete attachment?</h4>
            <p>
              This removes the attachment reference from {deleteTarget.origin === 'description' ? 'the description' : 'the attachments list'}.
              The physical file will not be deleted.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                type="button"
                className={styles.confirmDelete}
                onClick={() => {
                  onRemove(deleteTarget)
                  setDeleteTarget(null)
                }}
              >
                Delete
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export function storedAttachmentRows(attachments: TaskAttachment[], source = 'Attachments', owner?: Pick<AttachmentRow, 'ownerType' | 'ownerId' | 'ownerTitle'>): AttachmentRow[] {
  return attachments.map((attachment) => ({
    ...attachment,
    source,
    origin: 'stored',
    ...owner
  }))
}
