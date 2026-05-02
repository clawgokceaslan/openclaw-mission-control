import { LuCircleCheck, LuX } from 'react-icons/lu'
import type { ChatOperationFeedbackData } from '../types'
import styles from '../../ProjectDetailPage.module.scss'

export function ChatOperationFeedback({ feedback }: { feedback: ChatOperationFeedbackData }) {
  return (
    <section
      className={`${styles.chatOperationFeedback} ${styles[`chatOperationFeedback_${feedback.state}`] ?? ''}`}
      role={feedback.state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className={styles.chatOperationIcon} aria-hidden="true">
        {feedback.state === 'running' ? <span className={styles.thinkingDots}><i /><i /><i /></span> : null}
        {feedback.state === 'success' ? <LuCircleCheck size={15} /> : null}
        {feedback.state === 'error' ? <LuX size={15} /> : null}
      </span>
      <span className={styles.chatOperationCopy}>
        <b>{feedback.title}</b>
        <span>{feedback.message}</span>
      </span>
    </section>
  )
}
