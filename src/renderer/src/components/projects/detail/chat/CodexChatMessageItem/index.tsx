import { memo, useMemo } from 'react'
import { LuBot, LuCircleCheck, LuCopy, LuMessageSquare, LuSparkles, LuTerminal, LuX } from 'react-icons/lu'
import { formatUsageSummary } from '@shared/utils/codex-events'
import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import {
  formatChatTime,
  formatCodexToolBody,
  formatJsonMetadata,
  roleLabel,
  usageFromMetadata
} from '@renderer/screens/projects/detail/chat/chatUtils'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function renderMarkdownLite(body: string) {
  const segments = body.split(/```/g)
  return segments.map((segment, index) => {
    if (index % 2 === 1) {
      const lines = segment.split('\n')
      const code = lines.length > 1 ? lines.slice(1).join('\n') : segment
      const trimmed = code.trim()
      return (
        <div key={index} className={styles.codexCodeBlockWrap}>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(trimmed)}>Copy</button>
          <pre className={styles.codexCodeBlock}><code>{trimmed}</code></pre>
        </div>
      )
    }
    return segment.split('\n').map((line, lineIndex) => {
      if (!line.trim()) return <br key={`${index}-${lineIndex}`} />
      if (line.trim().startsWith('- ')) return <p key={`${index}-${lineIndex}`} className={styles.codexBullet}>{line.trim()}</p>
      return <p key={`${index}-${lineIndex}`} className={styles.codexMarkdownLine}>{line}</p>
    })
  })
}

type CodexChatMessageItemProps = {
  message: TaskActivityMessage
}

function thinkingDurationLabel(message: TaskActivityMessage): string {
  const metadata = message.metadata ?? {}
  const explicitDurationMs = parseDurationMs(metadata.thinkingDurationMs) ?? parseDurationMs(metadata.durationMs)
  const startedAt = parseDurationMs(metadata.thinkingStartedAt) ?? parseDurationMs(metadata.thinkingStartAt)
  const endedAt = parseDurationMs(metadata.thinkingEndedAt) ?? parseDurationMs(metadata.thinkingEndAt) ?? message.createdAt
  const fallbackDurationMs = explicitDurationMs ?? (startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined)
  if (!Number.isFinite(fallbackDurationMs) || !fallbackDurationMs) return ''
  return `Working for ${Math.max(0, Math.round(fallbackDurationMs / 1000))}s`
}

export const CodexChatMessageItem = memo(function CodexChatMessageItem({ message }: CodexChatMessageItemProps) {
  const usage = usageFromMetadata(message.metadata)
  const thinkingLabel = thinkingDurationLabel(message)
  const thinkingText = message.body.trim() || (message.status === 'running'
    ? message.source === 'codex-plan'
      ? 'Codex is planning this task...'
      : message.source === 'codex-run'
        ? 'Codex is running this task...'
        : 'Codex is thinking...'
    : '')
  const toolBody = useMemo(() => (
    message.role === 'tool' ? formatCodexToolBody(message.body) : ''
  ), [message.body, message.role])
  const metadataBody = useMemo(() => (
    message.metadata && Object.keys(message.metadata).length > 0 ? formatJsonMetadata(message.metadata) : ''
  ), [message.metadata])

  return (
    <article className={`${styles.chatMessage} ${styles[`chatRole_${message.role}`] ?? ''}`}>
      <div className={styles.chatMessageHeader}>
        <span className={styles.chatRoleGlyph} aria-hidden="true">
          {message.role === 'assistant' ? <LuBot size={14} /> : null}
          {message.role === 'user' ? <LuMessageSquare size={14} /> : null}
          {message.role === 'tool' || message.role === 'system' ? <LuTerminal size={14} /> : null}
          {message.role === 'thinking' ? (message.status === 'running' ? <LuSparkles size={14} /> : <LuCircleCheck size={14} />) : null}
          {message.role === 'error' ? <LuX size={14} /> : null}
        </span>
        <span className={styles.chatMessageKicker}>{roleLabel(message.role)}</span>
        <span className={styles.chatMessageMeta}>{message.status ?? message.source} · {formatChatTime(message.createdAt)}</span>
        {usage ? <span className={styles.chatMessageMeta}>{formatUsageSummary(usage)}</span> : null}
      </div>
      <div className={styles.chatMessageBody}>
        {message.role === 'thinking' ? (
          <div className={styles.chatThinkingBlock}>
            <span className={styles.chatThinkingLine}>
              {message.status === 'running' ? (
                <>{message.source === 'codex-plan' ? 'Planning' : message.source === 'codex-run' ? 'Running' : 'Thinking'} <span className={styles.thinkingDots}><i /><i /><i /></span></>
              ) : (
                <><LuCircleCheck size={15} /> {thinkingLabel || 'Thinking complete'}</>
              )}
            </span>
            {thinkingText ? <div className={styles.chatThinkingText}>{renderMarkdownLite(thinkingText)}</div> : null}
          </div>
        ) : null}
        {message.role === 'tool' ? (
          <details className={styles.codexDetails} open>
            <summary><LuTerminal size={14} /> Tool / command output</summary>
            <div>{renderMarkdownLite(toolBody)}</div>
          </details>
        ) : message.role !== 'thinking' ? (
          renderMarkdownLite(message.body)
        ) : null}
      </div>
      {metadataBody && message.role !== 'tool' ? (
        <details className={styles.codexDetails}>
          <summary>Details</summary>
          <pre>{metadataBody}</pre>
        </details>
      ) : null}
      {message.body.trim() ? (
        <button
          type="button"
          className={styles.copyMessageButton}
          onClick={() => void navigator.clipboard?.writeText(message.body)}
          aria-label="Copy message"
          title="Copy message"
        >
          <LuCopy size={13} />
        </button>
      ) : null}
    </article>
  )
})
