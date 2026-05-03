import { memo, useMemo } from 'react'
import { LuBot, LuCircleCheck, LuCopy, LuExternalLink, LuFileText, LuMessageSquare, LuSparkles, LuTerminal, LuX } from 'react-icons/lu'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
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

const MAX_HIGHLIGHT_CHARS = 25_000

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'bash',
  css: 'css',
  diff: 'diff',
  html: 'xml',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  xml: 'xml'
}

type MarkdownSegment = {
  type: 'text'
  text: string
} | {
  type: 'code'
  language: string
  code: string
}

type DiffFileSection = {
  path: string
  patch: string
  insertions: number
  deletions: number
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeCodeLanguage(value: string): { displayLanguage: string; highlightLanguage: string | undefined } {
  const displayLanguage = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'text'
  return {
    displayLanguage,
    highlightLanguage: LANGUAGE_ALIASES[displayLanguage]
  }
}

function highlightCode(code: string, highlightLanguage: string | undefined): string {
  if (!highlightLanguage || code.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(code)
  try {
    return hljs.highlight(code, { language: highlightLanguage, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(code)
  }
}

function tokenizeMarkdownLite(body: string): MarkdownSegment[] {
  const lines = body.split(/\r?\n/)
  const segments: MarkdownSegment[] = []
  let textLines: string[] = []
  let index = 0

  const flushText = () => {
    if (textLines.length === 0) return
    segments.push({ type: 'text', text: textLines.join('\n') })
    textLines = []
  }

  while (index < lines.length) {
    const line = lines[index]
    const openFence = line.match(/^(`{3,})([a-zA-Z0-9_-]*)\s*$/)
    if (!openFence) {
      textLines.push(line)
      index += 1
      continue
    }

    flushText()
    const fenceLength = openFence[1].length
    const language = openFence[2] || 'text'
    const codeLines: string[] = []
    index += 1

    while (index < lines.length) {
      const closeFence = lines[index].match(/^(`{3,})\s*$/)
      if (closeFence && closeFence[1].length >= fenceLength) break
      codeLines.push(lines[index])
      index += 1
    }

    if (index < lines.length) index += 1
    segments.push({ type: 'code', language, code: codeLines.join('\n') })
  }

  flushText()
  return segments
}

function renderCodeBlock(language: string, code: string, key: string | number) {
  const { displayLanguage, highlightLanguage } = normalizeCodeLanguage(language)
  const trimmed = code.trim()
  const highlightedCode = highlightCode(trimmed, highlightLanguage)
  return (
    <div key={key} className={styles.codexCodeBlockWrap}>
      <span className={styles.codexCodeLanguage}>{displayLanguage}</span>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(trimmed)}>Copy</button>
      <pre className={`${styles.codexCodeBlock} ${styles[`codexCode_${displayLanguage}`] ?? ''}`}>
        <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
      </pre>
    </div>
  )
}

function renderMarkdownLite(body: string) {
  const segments = tokenizeMarkdownLite(body)
  return segments.map((segment, index) => {
    if (segment.type === 'code') {
      return renderCodeBlock(segment.language, segment.code, index)
    }
    return segment.text.split('\n').map((line, lineIndex) => {
      if (!line.trim()) return <br key={`${index}-${lineIndex}`} />
      if (line.trim().startsWith('- ')) return <p key={`${index}-${lineIndex}`} className={styles.codexBullet}>{line.trim()}</p>
      return <p key={`${index}-${lineIndex}`} className={styles.codexMarkdownLine}>{line}</p>
    })
  })
}

function compactMetadataPreview(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const allowedKeys = ['codexBlock', 'commandStatus', 'exitCode', 'eventsPath', 'changesPath', 'truncated', 'unavailable', 'stopped']
  const compact = Object.fromEntries(allowedKeys
    .filter((key) => metadata[key] !== undefined)
    .map((key) => [key, metadata[key]])
  )
  return Object.keys(compact).length > 0 ? compact : undefined
}

function shortenPath(value: string): string {
  if (value.length <= 58) return value
  return `${value.slice(0, 24)}...${value.slice(-28)}`
}

function metadataPathEntries(metadata: Record<string, unknown> | undefined): Array<{ key: string; value: string }> {
  if (!metadata) return []
  return ['eventsPath', 'changesPath', 'finalMessagePath']
    .map((key) => ({ key, value: metadata[key] }))
    .filter((entry): entry is { key: string; value: string } => typeof entry.value === 'string' && entry.value.length > 0)
}

function parseNumberMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatDurationMs(value: number | undefined): string {
  if (!Number.isFinite(value) || !value) return ''
  const seconds = Math.max(0, Math.round(value / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`
}

function changesSections(body: string): { status: string; stat: string; patch: string } {
  const sections = { status: '', stat: '', patch: '' }
  let pendingHeading = ''
  tokenizeMarkdownLite(body).forEach((segment) => {
    if (segment.type === 'text') {
      const heading = segment.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)?.toLowerCase() ?? ''
      if (heading === 'status' || heading === 'stat') pendingHeading = heading
      return
    }
    if (normalizeCodeLanguage(segment.language).displayLanguage === 'diff') {
      sections.patch = [sections.patch, segment.code].filter(Boolean).join('\n')
      return
    }
    if (pendingHeading === 'status') sections.status = segment.code
    if (pendingHeading === 'stat') sections.stat = segment.code
  })
  return sections
}

function metadataFileStats(metadata: Record<string, unknown> | undefined): Map<string, { insertions: number; deletions: number }> {
  const entries = Array.isArray(metadata?.changeFileStats) ? metadata.changeFileStats : []
  const stats = new Map<string, { insertions: number; deletions: number }>()
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const record = entry as Record<string, unknown>
    if (typeof record.path !== 'string') return
    stats.set(record.path, {
      insertions: parseNumberMetadata(record.insertions),
      deletions: parseNumberMetadata(record.deletions)
    })
  })
  return stats
}

function patchFilePath(header: string): string {
  const plusLine = header.split(/\r?\n/).find((line) => line.startsWith('+++ '))
  if (plusLine) return plusLine.replace(/^\+\+\+\s+b\//, '').replace(/^\+\+\+\s+/, '').trim()
  const diffLine = header.split(/\r?\n/).find((line) => line.startsWith('diff --git '))
  const match = diffLine?.match(/\sb\/(.+)$/)
  return match?.[1]?.trim() || 'workspace changes'
}

function splitDiffByFile(patch: string, metadata: Record<string, unknown> | undefined): DiffFileSection[] {
  if (!patch.trim()) return []
  const stats = metadataFileStats(metadata)
  const chunks = patch.split(/(?=^diff --git\s)/m).map((chunk) => chunk.trim()).filter(Boolean)
  return chunks.map((chunk, index) => {
    const path = patchFilePath(chunk) || `change-${index + 1}`
    const fileStats = stats.get(path)
    const fallbackInsertions = chunk.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const fallbackDeletions = chunk.split(/\r?\n/).filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    return {
      path,
      patch: chunk,
      insertions: fileStats?.insertions ?? fallbackInsertions,
      deletions: fileStats?.deletions ?? fallbackDeletions
    }
  })
}

function renderChangesCard(message: TaskActivityMessage, pathEntries: Array<{ key: string; value: string }>) {
  const metadata = message.metadata ?? {}
  const files = parseNumberMetadata(metadata.changeFiles)
  const insertions = parseNumberMetadata(metadata.changeInsertions)
  const deletions = parseNumberMetadata(metadata.changeDeletions)
  const sections = changesSections(message.body)
  const fileSections = splitDiffByFile(sections.patch, metadata)
  const hasStructuredChanges = Boolean(sections.status || sections.stat || sections.patch)
  const editedLabel = files === 1 ? 'Edited file' : `Edited ${files || fileSections.length} files`

  if (!hasStructuredChanges && !metadata.unavailable) return renderMarkdownLite(message.body)

  return (
    <div className={styles.codexChangesCard}>
      <div className={styles.codexChangesHeader}>
        <div>
          <span className={styles.codexChangesEyebrow}>{editedLabel}</span>
          <strong>{files || fileSections.length} files changed</strong>
        </div>
        <div className={styles.codexChangesStats}>
          <span className={styles.codexChangesAdded}>+{insertions}</span>
          <span className={styles.codexChangesRemoved}>-{deletions}</span>
          {metadata.truncated ? <span>truncated</span> : null}
          {metadata.unavailable ? <span>unavailable</span> : null}
        </div>
      </div>
      {fileSections.slice(0, 4).map((section) => (
        <section key={section.path} className={styles.codexEditedFileCard}>
          <div className={styles.codexDiffHeader}>
            <span>{section.path}</span>
            <small><b>+{section.insertions}</b> <i>-{section.deletions}</i></small>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(section.patch)} aria-label="Copy diff">
              <LuCopy size={13} />
            </button>
          </div>
          {renderCodeBlock('diff', section.patch, `changes-patch-${section.path}`)}
        </section>
      ))}
      {fileSections.length > 4 ? <p className={styles.codexProgressLine}>{fileSections.length - 4} more files hidden from preview.</p> : null}
      {!sections.status && !sections.stat && !sections.patch ? <div>{renderMarkdownLite(message.body)}</div> : null}
      <div className={styles.codexChangesSummaryBar}>
        <span>{files || fileSections.length} files changed <b>+{insertions}</b> <i>-{deletions}</i></span>
        <button type="button">Review changes <LuExternalLink size={13} /></button>
      </div>
      {pathEntries.length > 0 ? (
        <div className={styles.codexPathList}>
          {pathEntries.map((entry) => (
            <span key={entry.key} className={styles.codexPathChip} title={entry.value}>
              <LuFileText size={12} /> <small>{entry.key.replace(/Path$/, '')}</small> {shortenPath(entry.value)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
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
  const duration = formatDurationMs(fallbackDurationMs)
  return duration ? `Working for ${duration}` : ''
}

function renderCodexTranscriptMessage(params: {
  message: TaskActivityMessage
  codexBlock: string
  thinkingLabel: string
  thinkingText: string
  thinkingBody: ReturnType<typeof renderMarkdownLite>
  messageBody: ReturnType<typeof renderMarkdownLite>
  toolBodyRendered: ReturnType<typeof renderMarkdownLite>
  pathEntries: Array<{ key: string; value: string }>
  toolTitle: string
}) {
  const { message, codexBlock, thinkingLabel, thinkingText, thinkingBody, messageBody, toolBodyRendered, pathEntries, toolTitle } = params

  if (message.role === 'thinking') {
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow} ${styles.codexTranscriptThinking}`}>
        <div className={styles.codexTranscriptTime}>
          {message.status === 'running' ? (
            <>Working <span className={styles.thinkingDots}><i /><i /><i /></span></>
          ) : thinkingLabel || 'Working'}
        </div>
        {thinkingText ? <div className={styles.codexTranscriptText}>{thinkingBody}</div> : null}
      </article>
    )
  }

  if (message.role === 'tool' && codexBlock === 'changes') {
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
        {renderChangesCard(message, pathEntries)}
      </article>
    )
  }

  if (message.role === 'tool') {
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
        <details className={styles.codexTranscriptDetails} open={codexBlock === 'command'}>
          <summary><LuTerminal size={14} /> {toolTitle}</summary>
          <div>{toolBodyRendered}</div>
          {pathEntries.length > 0 ? (
            <div className={styles.codexPathList}>
              {pathEntries.map((entry) => (
                <span key={entry.key} className={styles.codexPathChip} title={entry.value}>
                  <LuFileText size={12} /> <small>{entry.key.replace(/Path$/, '')}</small> {shortenPath(entry.value)}
                </span>
              ))}
            </div>
          ) : null}
        </details>
      </article>
    )
  }

  if (message.role === 'system' && codexBlock === 'run-complete') {
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
        <div className={styles.codexProgressLine}><LuCircleCheck size={14} /> {message.body}</div>
      </article>
    )
  }

  return (
    <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
      <div className={styles.codexTranscriptText}>{messageBody}</div>
    </article>
  )
}

export const CodexChatMessageItem = memo(function CodexChatMessageItem({ message }: CodexChatMessageItemProps) {
  const usage = usageFromMetadata(message.metadata)
  const codexBlock = typeof message.metadata?.codexBlock === 'string' ? message.metadata.codexBlock : ''
  const toolTitle = codexBlock === 'changes'
    ? 'Changes'
    : codexBlock === 'command'
      ? 'Command'
      : codexBlock === 'log'
        ? 'Log'
        : codexBlock === 'run-complete'
          ? 'Run complete'
        : 'Tool output'
  const statusLabel = message.metadata?.runStatus === 'running' && codexBlock !== 'run-complete'
    ? 'running'
    : message.status
  const thinkingLabel = thinkingDurationLabel(message)
  const thinkingText = message.body.trim() || (message.status === 'running'
    ? 'Codex is working...'
    : '')
  const toolBody = useMemo(() => (
    message.role === 'tool' ? (codexBlock ? message.body : formatCodexToolBody(message.body)) : ''
  ), [codexBlock, message.body, message.role])
  const thinkingBody = useMemo(() => renderMarkdownLite(thinkingText), [thinkingText])
  const messageBody = useMemo(() => renderMarkdownLite(message.body), [message.body])
  const toolBodyRendered = useMemo(() => renderMarkdownLite(toolBody), [toolBody])
  const pathEntries = useMemo(() => metadataPathEntries(message.metadata), [message.metadata])
  const metadataBody = useMemo(() => (
    compactMetadataPreview(message.metadata) ? formatJsonMetadata(compactMetadataPreview(message.metadata) ?? {}) : ''
  ), [message.metadata])

  if (message.role !== 'user') {
    return renderCodexTranscriptMessage({
      message,
      codexBlock,
      thinkingLabel,
      thinkingText,
      thinkingBody,
      messageBody,
      toolBodyRendered,
      pathEntries,
      toolTitle
    })
  }

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
        <span className={styles.chatMessageMeta}>{statusLabel ?? message.source} · {formatChatTime(message.createdAt)}</span>
        {usage ? <span className={styles.chatMessageMeta}>{formatUsageSummary(usage)}</span> : null}
      </div>
      <div className={styles.chatMessageBody}>
        {message.role === 'thinking' ? (
          <div className={styles.chatThinkingBlock}>
            <span className={styles.chatThinkingLine}>
              {message.status === 'running' ? (
                <>Working <span className={styles.thinkingDots}><i /><i /><i /></span></>
              ) : (
                <><LuCircleCheck size={15} /> {thinkingLabel || 'Working'}</>
              )}
            </span>
            {thinkingText ? <div className={styles.chatThinkingText}>{thinkingBody}</div> : null}
          </div>
        ) : null}
        {message.role === 'tool' && codexBlock === 'changes' ? (
          renderChangesCard(message, pathEntries)
        ) : message.role === 'tool' ? (
          <details className={styles.codexDetails} open>
            <summary><LuTerminal size={14} /> {toolTitle}</summary>
            <div>{toolBodyRendered}</div>
            {pathEntries.length > 0 ? (
              <div className={styles.codexPathList}>
                {pathEntries.map((entry) => (
                  <span key={entry.key} className={styles.codexPathChip} title={entry.value}>
                    <LuFileText size={12} /> <small>{entry.key.replace(/Path$/, '')}</small> {shortenPath(entry.value)}
                  </span>
                ))}
              </div>
            ) : null}
          </details>
        ) : message.role === 'system' && codexBlock === 'run-complete' ? (
          <div className={styles.codexRunComplete}><LuCircleCheck size={15} /> {message.body}</div>
        ) : message.role !== 'thinking' ? (
          messageBody
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
