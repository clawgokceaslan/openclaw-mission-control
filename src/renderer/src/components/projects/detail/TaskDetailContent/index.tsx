import { CSSProperties, ReactNode, RefObject } from 'react'
import { LuPencil, LuSend, LuTrash2, LuX } from 'react-icons/lu'
import { Form } from 'react-bootstrap'
import type { TaskComment } from '@shared/types/entities'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface TaskDetailContentProps {
  detailPane?: ReactNode
  children?: ReactNode
  bodyRef?: RefObject<HTMLDivElement | null>
  splitTemplate?: string
  onResizeStart?: () => void
  comments?: TaskComment[]
  commentDraft?: string
  editingCommentId?: string | null
  commentPlaceholder?: string
  onCommentDraftChange?: (value: string) => void
  onSubmitComment?: () => void
  onEditComment?: (comment: TaskComment) => void
  onRemoveComment?: (comment: TaskComment) => void
  onCancelEditComment?: () => void
}

export function TaskDetailContent({
  detailPane,
  children,
  bodyRef,
  splitTemplate,
  onResizeStart,
  comments,
  commentDraft = '',
  editingCommentId = null,
  commentPlaceholder,
  onCommentDraftChange,
  onSubmitComment,
  onEditComment,
  onRemoveComment,
  onCancelEditComment
}: TaskDetailContentProps) {
  const orderedComments = [...(comments ?? [])].sort((a, b) => a.createdAt - b.createdAt)
  const style = splitTemplate ? { gridTemplateColumns: splitTemplate } as CSSProperties : undefined
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'OP'

  return (
    <div className={styles.modalBody} ref={bodyRef} style={style}>
      {detailPane ?? children}
      {comments ? (
        <>
          <div
            className={styles.splitHandle}
            onMouseDown={onResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize detail and comments panels"
          />
          <aside className={styles.commentsPane}>
            <header className={styles.commentsHeader}>
              <div>
                <h4>Comments</h4>
                <span>{orderedComments.length} notes</span>
              </div>
            </header>
            <div className={styles.commentsFeed}>
              {orderedComments.length > 0 ? (
                orderedComments.map((comment) => (
                  <article key={comment.id} className={styles.commentItem}>
                    <div className={styles.commentAvatar}>{initials(comment.authorName || 'Operator')}</div>
                    <div className={styles.commentContent}>
                      <div className={styles.commentMeta}>
                        <strong>{comment.authorName || 'Operator'}</strong>
                        <span>{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>
                      <p>{comment.body}</p>
                      <div className={styles.commentActions}>
                        <button
                          type="button"
                          className={styles.commentIconBtn}
                          onClick={() => onEditComment?.(comment)}
                          title="Edit comment"
                          aria-label="Edit comment"
                        >
                          <LuPencil size={13} />
                        </button>
                        <button
                          type="button"
                          className={styles.commentIconBtn}
                          onClick={() => onRemoveComment?.(comment)}
                          title="Delete comment"
                          aria-label="Delete comment"
                        >
                          <LuTrash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              ) : null}
            </div>
            <section className={styles.commentsComposer}>
              <div className={styles.commentsComposerHeader}>
                <span>{editingCommentId ? 'Editing comment' : 'New comment'}</span>
                {editingCommentId ? (
                  <button type="button" onClick={onCancelEditComment} aria-label="Cancel comment edit">
                    <LuX size={14} />
                  </button>
                ) : null}
              </div>
              <Form.Control
                as="textarea"
                rows={3}
                value={commentDraft}
                onChange={(event) => onCommentDraftChange?.(event.target.value)}
                placeholder={commentPlaceholder ?? (editingCommentId ? 'Edit comment...' : 'Write a comment...')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    onSubmitComment?.()
                  }
                  if (event.key === 'Escape') {
                    onCancelEditComment?.()
                  }
                }}
              />
              <div className={styles.commentComposerFooter}>
                <span>{editingCommentId ? 'Esc cancels edit' : 'Enter sends, Shift+Enter adds a line'}</span>
                <button type="button" onClick={onSubmitComment} disabled={!commentDraft.trim()}>
                  <LuSend size={14} />
                  {editingCommentId ? 'Save' : 'Send'}
                </button>
              </div>
            </section>
          </aside>
        </>
      ) : null}
    </div>
  )
}
