import { memo, useMemo } from 'react'
import { LuBot, LuChevronDown, LuCircleCheck, LuCopy, LuExternalLink, LuFileText, LuMessageSquare, LuSearch, LuSparkles, LuTerminal, LuX } from 'react-icons/lu'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { formatUsageSummary } from '@shared/utils/gateway-events'
import { gatewayMetadataBlock } from '@shared/utils/gateway-chat-phase'
import type { TaskActivityMessage } from '@renderer/screens/projects/detail/types'
import {
  formatChatTime,
  formatGatewayWorkDuration,
  formatGatewayActivityStatus,
  formatGatewayToolBody,
  codexChangesSummary,
  parseNumberMetadata,
  parseNextChatHandoff,
  handoffFieldItems,
  handoffScalarValue,
  thinkingDurationLabel as resolveThinkingDurationLabel,
  roleLabel,
  stripRawJsonFromChatBody,
  usageFromMetadata
} from '@renderer/screens/projects/detail/chat/chatUtils'
import type { CodexWorkBlock as CodexWorkBlockData, CodexWorkSummaryKind, CodexWorkSummaryRow, ParsedNextChatHandoff } from '@renderer/screens/projects/detail/chat/chatUtils'
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
  blocks: number
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || !/^[{[]/.test(trimmed)) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function detectCodeLanguage(code: string): string {
  const trimmed = code.trim()
  if (!trimmed) return 'text'
  const lines = trimmed.split(/\r?\n/)
  const firstLines = lines.slice(0, 12).join('\n')
  const plusMinusLines = lines.filter((line) => /^[+-](?![+-]{2})/.test(line)).length

  if (/^(diff --git|index\s+[0-9a-f]+\.\.|@@\s+-\d+)/m.test(trimmed) || (/^(---|\+\+\+)\s/m.test(trimmed) && plusMinusLines >= 2)) return 'diff'
  if (looksLikeJson(trimmed)) return 'json'
  if (/^#!.*\b(bash|sh|zsh)\b/m.test(trimmed) || /(^|\n)\s*(npm|pnpm|yarn|bun|git|cd|mkdir|rm|cp|mv|cat|sed|rg|grep|curl|chmod|export)\s+/.test(trimmed) || /^\s*[$#]\s+\S+/m.test(trimmed)) return 'bash'
  if (/<[a-z][\w:-]*(\s[^>]*)?>[\s\S]*<\/[a-z][\w:-]*>/i.test(firstLines) || /<!doctype html/i.test(trimmed)) return 'html'
  if (/(^|\n)\s*(import|export)\s+.+from\s+['"]/.test(trimmed) || /\b(interface|type)\s+[A-Z_a-z][\w$]*\b/.test(trimmed) || /\bReact\.[A-Z_a-z]|\buse[A-Z]\w*\s*\(/.test(trimmed) || /<[A-Z_a-z][\w.:-]*(\s+[^>]*)?\/?>/.test(trimmed)) return 'typescript'
  if (/\b(function|const|let|var)\s+[\w$]+|\bconsole\.(log|warn|error)\s*\(|=>/.test(trimmed)) return 'javascript'
  if (/(^|\n)\s*[.#]?[a-zA-Z][\w-]*(\s+[.#]?[a-zA-Z][\w-]*)*\s*\{[\s\S]*\b(color|background|display|position|margin|padding|border|font-size|grid-template|align-items)\s*:/.test(trimmed)) return 'css'
  if (/^(#{1,6}\s+\S|[-*]\s+\S|\|.+\|)$/m.test(trimmed)) return 'markdown'
  return 'text'
}

function normalizeCodeLanguage(value: string, code = ''): { displayLanguage: string; highlightLanguage: string | undefined } {
  const explicitLanguage = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const displayLanguage = explicitLanguage && explicitLanguage !== 'text'
    ? explicitLanguage
    : detectCodeLanguage(code)
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
  const trimmed = code.trim()
  const { displayLanguage, highlightLanguage } = normalizeCodeLanguage(language, trimmed)
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

type HandoffDisplayGroup = {
  key: string
  label: string
  tone: 'success' | 'info' | 'warning' | 'neutral'
  items: string[]
  mode?: 'chips'
}

function nextChatHandoffFromBody(body: string): ParsedNextChatHandoff | null {
  const match = body.match(/(?:^|\n\n)(NEXT_CHAT_HANDOFF(?:_JSON)?\n[\s\S]*)/)
  return parseNextChatHandoff(match?.[1])
}

function meaningfulHandoffGroups(handoff: ParsedNextChatHandoff): HandoffDisplayGroup[] {
  const goal = handoffScalarValue(handoff, 'goal')
  const groups: HandoffDisplayGroup[] = [
    goal ? { key: 'goal', label: 'Goal', tone: 'neutral', items: [goal] } : null,
    { key: 'completed_work', label: 'Completed', tone: 'success', items: handoffFieldItems(handoff, 'completed_work') },
    { key: 'decisions', label: 'Decisions', tone: 'neutral', items: handoffFieldItems(handoff, 'decisions') },
    { key: 'changed_areas', label: 'Changed areas', tone: 'neutral', items: handoffFieldItems(handoff, 'changed_areas'), mode: 'chips' },
    { key: 'verification', label: 'Verification', tone: 'info', items: handoffFieldItems(handoff, 'verification') },
    { key: 'blockers', label: 'Blockers', tone: 'warning', items: handoffFieldItems(handoff, 'blockers') },
    { key: 'next_steps', label: 'Next steps', tone: 'info', items: handoffFieldItems(handoff, 'next_steps') }
  ].filter((group): group is HandoffDisplayGroup => Boolean(group && group.items.length > 0))
  return groups
}

function renderHandoffValue(group: HandoffDisplayGroup) {
  if (group.mode === 'chips') {
    return (
      <div className={styles.codexHandoffChipList}>
        {group.items.map((item, index) => (
          <span key={`${group.key}-${index}`} className={styles.codexHandoffPathChip} title={item}>
            {shortenPath(item)}
          </span>
        ))}
      </div>
    )
  }
  if (group.items.length === 1) return <div className={styles.codexHandoffValue}>{group.items[0]}</div>
  return (
    <div className={styles.codexHandoffStack}>
      {group.items.map((item, index) => (
        <div key={`${group.key}-${index}`} className={styles.codexHandoffItem}>
          {item}
        </div>
      ))}
    </div>
  )
}

function renderNextChatHandoffCard(message: TaskActivityMessage) {
  if (message.role !== 'assistant') return null
  const handoff = nextChatHandoffFromBody(message.body)
  if (!handoff) return null
  const groups = meaningfulHandoffGroups(handoff)
  const fallbackGroups = groups.length > 0
    ? groups
    : [{ key: 'empty', label: 'Summary', tone: 'neutral' as const, items: ['No structured details reported'] }]
  const totalItems = fallbackGroups.reduce((sum, group) => sum + group.items.length, 0)
  const defaultOpen = totalItems <= 6 && fallbackGroups.length <= 4
  const taskTitle = handoff.task?.title || 'Task'
  const taskStatus = handoff.task?.status || ''
  const title = message.source === 'gateway-run' ? 'Run summary' : 'Chat handoff'

  return (
    <details className={styles.codexHandoffCard} open={defaultOpen}>
      <summary className={styles.codexHandoffHeader}>
        <span className={styles.codexHandoffTitle}>
          <LuChevronDown className={styles.codexHandoffChevron} size={14} />
          <LuFileText size={14} />
          {title}
        </span>
        <span className={styles.codexHandoffTask} title={taskTitle}>{taskTitle}</span>
        {taskStatus ? <span className={styles.codexHandoffStatus}>{taskStatus}</span> : null}
      </summary>
      <div className={styles.codexHandoffGrid}>
        {fallbackGroups.map((group) => (
          <section key={group.key} className={`${styles.codexHandoffSection} ${styles[`codexHandoff_${group.tone}`] ?? ''}`}>
            <h4>{group.label}</h4>
            {renderHandoffValue(group)}
          </section>
        ))}
      </div>
    </details>
  )
}

function shortenPath(value: string): string {
  if (value.length <= 58) return value
  return `${value.slice(0, 24)}...${value.slice(-28)}`
}

function formatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${Math.round(size)} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function attachmentExtension(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.trim() : ''
  return ext ? ext.slice(0, 6).toUpperCase() : 'FILE'
}

function messageCommandLabel(metadata: Record<string, unknown> | undefined): string {
  const command = metadata?.command && typeof metadata.command === 'object' && !Array.isArray(metadata.command)
    ? metadata.command as Record<string, unknown>
    : null
  const label = typeof command?.label === 'string' && command.label.trim() ? command.label.trim() : ''
  const mode = typeof metadata?.mode === 'string' ? metadata.mode : ''
  if (label) return label.startsWith('/') ? label : `/${label}`
  if (mode === 'plan') return '/plan'
  if (mode === 'steer') return '/steer'
  return ''
}

function messageAttachments(metadata: Record<string, unknown> | undefined): Array<{ name: string; size?: number; mimeType?: string; path?: string }> {
  const raw = Array.isArray(metadata?.attachments) ? metadata.attachments : []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : ''
    if (!name) return []
    return [{
      name,
      size: typeof record.size === 'number' ? record.size : undefined,
      mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
      path: typeof record.path === 'string' ? record.path : undefined
    }]
  })
}

function metadataPathEntries(metadata: Record<string, unknown> | undefined): Array<{ key: string; value: string }> {
  if (!metadata) return []
  return ['changesPath', 'finalMessagePath']
    .map((key) => ({ key, value: metadata[key] }))
    .filter((entry): entry is { key: string; value: string } => typeof entry.value === 'string' && entry.value.length > 0)
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

function metadataFileStats(metadata: Record<string, unknown> | undefined): Map<string, { insertions: number; deletions: number; blocks: number }> {
  const entries = Array.isArray(metadata?.changeFileStats) ? metadata.changeFileStats : []
  const stats = new Map<string, { insertions: number; deletions: number; blocks: number }>()
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const record = entry as Record<string, unknown>
    if (typeof record.path !== 'string') return
    stats.set(record.path, {
      insertions: parseNumberMetadata(record.insertions),
      deletions: parseNumberMetadata(record.deletions),
      blocks: parseNumberMetadata(record.blocks)
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
    const lines = chunk.split(/\r?\n/)
    const fallbackInsertions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const fallbackDeletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    const fallbackBlocks = lines.filter((line) => line.startsWith('@@')).length
    return {
      path,
      patch: chunk,
      insertions: fileStats?.insertions ?? fallbackInsertions,
      deletions: fileStats?.deletions ?? fallbackDeletions,
      blocks: fileStats?.blocks ?? fallbackBlocks
    }
  })
}

function renderChangesCard(message: TaskActivityMessage, pathEntries: Array<{ key: string; value: string }>) {
  const changesSummary = codexChangesSummary(message)
  const metadata = message.metadata ?? {}
  const sections = changesSections(message.body)
  const fileSections = splitDiffByFile(sections.patch, metadata)
  const totalBlocks = Math.max(changesSummary.blocks, fileSections.reduce((count, section) => count + section.blocks, 0))
  const fileCount = changesSummary.files || fileSections.length
  const insertions = changesSummary.insertions
  const deletions = changesSummary.deletions
  const hasStructuredChanges = Boolean(sections.status || sections.stat || sections.patch)
  const editedLabel = fileCount === 1 ? '1 file changed' : `${fileCount} files changed`
  const fileSummary = fileCount === 1 ? '1 file' : `${fileCount} files`
  const blockSummary = totalBlocks === 1 ? '1 block' : `${totalBlocks} blocks`

  if (!hasStructuredChanges && !metadata.unavailable) return renderMarkdownLite(stripRawJsonFromChatBody(message.body))
  if (!changesSummary.canRenderCard) return renderMarkdownLite(stripRawJsonFromChatBody(message.body))

  return (
    <div className={styles.codexChangesCard}>
      <div className={styles.codexChangesHeader}>
        <div>
          <span className={styles.codexChangesEyebrow}>{editedLabel}</span>
          <strong>{fileSummary}{totalBlocks > 0 ? `, ${blockSummary}` : ''}</strong>
        </div>
        <div className={styles.codexChangesStats}>
          <span className={styles.codexChangesAdded}>+{insertions}</span>
          <span className={styles.codexChangesRemoved}>-{deletions}</span>
          <span>{blockSummary}</span>
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
      <div className={styles.codexChangesSummaryBar}>
        <span>
          {fileSummary}
          {blockSummary ? <b> · {blockSummary}</b> : ''}
          <span> <b>+{insertions}</b> <i>-{deletions}</i></span>
        </span>
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

type GatewayChatMessageItemProps = {
  message: TaskActivityMessage
  onSteerMessageClick?: (conversationId: string) => void
}

type CodexWorkBlockProps = {
  block: CodexWorkBlockData
}

function workSummaryIcon(kind: CodexWorkSummaryKind) {
  if (kind === 'explored') return <LuSearch size={14} />
  if (kind === 'changed') return <LuFileText size={14} />
  return <LuTerminal size={14} />
}

function workTextBody(message: TaskActivityMessage): string {
  if (message.role === 'thinking') {
    return stripRawJsonFromChatBody(message.body) || (message.status === 'running' ? 'Codex çalışıyor' : '')
  }
  return stripRawJsonFromChatBody(message.body)
}

function commandFallbackBody(message: TaskActivityMessage): string {
  const command = typeof message.metadata?.command === 'string' ? message.metadata.command.trim() : ''
  const status = formatGatewayActivityStatus(
    typeof message.metadata?.commandStatus === 'string'
      ? message.metadata.commandStatus
      : message.status
  )
  return command ? `${status}: ${command}` : status
}

function renderWorkTextMessage(message: TaskActivityMessage) {
  const body = workTextBody(message)
  if (!body) return null
  return (
    <div key={message.id} className={`${styles.codexWorkText} ${message.role === 'thinking' ? styles.codexWorkThinkingText : ''}`}>
      {renderMarkdownLite(body)}
    </div>
  )
}

function renderWorkToolMessage(message: TaskActivityMessage) {
  const gatewayBlock = gatewayMetadataBlock(message.metadata)
  const pathEntries = metadataPathEntries(message.metadata)
  if (message.role === 'tool' && gatewayBlock === 'changes') {
    return (
      <div key={message.id} className={styles.codexWorkNestedOutput}>
        {renderChangesCard(message, pathEntries)}
      </div>
    )
  }

  const toolTitle = gatewayBlock === 'log'
    ? 'Kayıt'
    : gatewayBlock === 'command'
      ? 'Komut'
      : 'Araç çıktısı'
  const toolBody = message.role === 'tool'
    ? (stripRawJsonFromChatBody(gatewayBlock ? message.body : formatGatewayToolBody(message.body)) || commandFallbackBody(message))
    : stripRawJsonFromChatBody(message.body)

  return (
    <div key={message.id} className={styles.codexWorkCommandRaw}>
      <div className={styles.codexWorkCommandTitle}>
        <LuTerminal size={13} />
        <span>{toolTitle}</span>
        {message.metadata?.exitCode !== undefined ? <small>exit {String(message.metadata.exitCode)}</small> : null}
      </div>
      <div className={styles.codexTranscriptText}>{renderMarkdownLite(toolBody)}</div>
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

function renderWorkSummary(summary: CodexWorkSummaryRow) {
  return (
    <details key={summary.id} className={`${styles.codexWorkSummaryDetails} ${styles[`codexWorkSummary_${summary.kind}`] ?? ''}`}>
      <summary>
        {workSummaryIcon(summary.kind)}
        <span>{summary.label}</span>
        <LuChevronDown className={styles.codexWorkChevron} size={13} />
      </summary>
      <div className={styles.codexWorkSummaryBody}>
        {summary.messages.map(renderWorkToolMessage)}
      </div>
    </details>
  )
}

export const CodexWorkBlock = memo(function CodexWorkBlock({ block }: CodexWorkBlockProps) {
  return (
    <article className={`${styles.chatMessage} ${styles.codexTranscriptRow} ${styles.codexWorkBlock}`}>
      <details className={styles.codexWorkDetails} open>
        <summary className={styles.codexWorkHeader}>
          <LuChevronDown className={styles.codexWorkChevron} size={15} />
          <span>{formatGatewayWorkDuration(block.durationMs, block.isRunning)}</span>
          {block.isRunning ? <span className={styles.thinkingDots}><i /><i /><i /></span> : null}
        </summary>
        {block.isRunning && block.activityLabel ? (
          <div className={styles.codexWorkActivityLine}>
            <LuSearch size={14} />
            <span key={block.activityLabel} className={styles.codexWorkActivityText}>{block.activityLabel}</span>
          </div>
        ) : null}
        <div className={styles.codexWorkBody}>
          {block.entries.map((entry) => (
            entry.kind === 'text'
              ? renderWorkTextMessage(entry.message)
              : renderWorkSummary(entry.summary)
          ))}
        </div>
      </details>
    </article>
  )
})

function renderCodexTranscriptMessage(params: {
  message: TaskActivityMessage
  gatewayBlock: string
  thinkingLabel: string
  thinkingText: string
  thinkingBody: ReturnType<typeof renderMarkdownLite>
  messageBody: ReturnType<typeof renderMarkdownLite>
  toolBodyRendered: ReturnType<typeof renderMarkdownLite>
  pathEntries: Array<{ key: string; value: string }>
  toolTitle: string
  changesSummary: ReturnType<typeof codexChangesSummary>
}) {
  const {
    message,
    gatewayBlock,
    thinkingLabel,
    thinkingText,
    thinkingBody,
    messageBody,
    toolBodyRendered,
    pathEntries,
    toolTitle,
    changesSummary
  } = params

  if (message.role === 'thinking') {
    const summaryLabel = [`Thinking`, thinkingLabel].filter(Boolean).join(' · ')
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow} ${styles.codexTranscriptThinking}`}>
        <details className={styles.codexThinkingDetails} open>
          <summary className={styles.codexTranscriptTime}>
            {summaryLabel}
            {message.status === 'running' ? <span className={styles.thinkingDots}><i /><i /><i /></span> : null}
          </summary>
          {thinkingText ? <div className={styles.codexTranscriptText}>{thinkingBody}</div> : null}
        </details>
      </article>
    )
  }

  if (message.role === 'tool' && gatewayBlock === 'changes') {
    if (!changesSummary.canRenderCard) {
      return (
        <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
          {changesSummary.hasNoChanges ? <div className={styles.codexProgressLine}><LuCircleCheck size={14} /> Çalışma alanında değişiklik yok.</div> : renderMarkdownLite(stripRawJsonFromChatBody(message.body))}
        </article>
      )
    }
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
        {renderChangesCard(message, pathEntries)}
      </article>
    )
  }

  if (message.role === 'tool') {
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
        <details className={styles.codexTranscriptDetails}>
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

  if (message.role === 'system' && gatewayBlock === 'run-complete') {
    return (
      <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
        <div className={styles.codexProgressLine}><LuCircleCheck size={14} /> {message.body}</div>
      </article>
    )
  }

  return (
    <article className={`${styles.chatMessage} ${styles.codexTranscriptRow}`}>
      {stripRawJsonFromChatBody(message.body) ? <div className={styles.codexTranscriptText}>{messageBody}</div> : null}
      {renderNextChatHandoffCard(message)}
    </article>
  )
}

export const GatewayChatMessageItem = memo(function GatewayChatMessageItem({ message, onSteerMessageClick }: GatewayChatMessageItemProps) {
  const usage = usageFromMetadata(message.metadata)
  const gatewayBlock = gatewayMetadataBlock(message.metadata)
  const changesSummary = codexChangesSummary(message)
  const toolTitle = gatewayBlock === 'changes'
    ? 'Değişiklikler'
    : gatewayBlock === 'command'
      ? 'Komut'
      : gatewayBlock === 'log'
        ? 'Kayıt'
        : gatewayBlock === 'run-complete'
          ? 'Run tamamlandı'
        : 'Araç çıktısı'
  const statusLabel = message.metadata?.runStatus === 'running' && gatewayBlock !== 'run-complete'
    ? formatGatewayActivityStatus('running')
    : message.status
      ? formatGatewayActivityStatus(message.status)
      : message.source
  const thinkingLabel = resolveThinkingDurationLabel(message, Date.now())
  const visibleMessageBody = useMemo(() => stripRawJsonFromChatBody(message.body), [message.body])
  const thinkingText = visibleMessageBody || (message.status === 'running'
    ? 'Codex çalışıyor'
    : '')
  const toolBody = useMemo(() => (
    message.role === 'tool'
      ? (stripRawJsonFromChatBody(gatewayBlock ? message.body : formatGatewayToolBody(message.body)) || commandFallbackBody(message))
      : ''
  ), [gatewayBlock, message])
  const thinkingBody = useMemo(() => renderMarkdownLite(thinkingText), [thinkingText])
  const messageBody = useMemo(() => renderMarkdownLite(visibleMessageBody), [visibleMessageBody])
  const toolBodyRendered = useMemo(() => renderMarkdownLite(toolBody), [toolBody])
  const pathEntries = useMemo(() => metadataPathEntries(message.metadata), [message.metadata])
  const commandLabel = messageCommandLabel(message.metadata)
  const attachments = messageAttachments(message.metadata)
  const steerConversationId = message.role === 'user' && message.metadata?.mode === 'steer'
    ? message.conversationId || message.runId
    : ''
  const isClickableSteerMessage = Boolean(steerConversationId && onSteerMessageClick)
  const handleSteerMessageClick = () => {
    if (!steerConversationId) return
    onSteerMessageClick?.(steerConversationId)
  }

  if (message.role !== 'user') {
    return renderCodexTranscriptMessage({
      message,
      gatewayBlock,
      thinkingLabel,
      thinkingText,
      thinkingBody,
      messageBody,
      toolBodyRendered,
      pathEntries,
      toolTitle,
      changesSummary
    })
  }

  return (
    <article
      className={`${styles.chatMessage} ${styles[`chatRole_${message.role}`] ?? ''} ${isClickableSteerMessage ? styles.chatSteerMessageClickable : ''}`}
      role={isClickableSteerMessage ? 'button' : undefined}
      tabIndex={isClickableSteerMessage ? 0 : undefined}
      onClick={isClickableSteerMessage ? handleSteerMessageClick : undefined}
      onKeyDown={isClickableSteerMessage
        ? (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            handleSteerMessageClick()
          }
        : undefined}
      aria-label={isClickableSteerMessage ? 'Open steer conversation' : undefined}
      title={isClickableSteerMessage ? 'Open steer conversation' : undefined}
    >
      <div className={styles.chatMessageHeader}>
        <span className={styles.chatRoleGlyph} aria-hidden="true">
          {message.role === 'assistant' ? <LuBot size={14} /> : null}
          {message.role === 'user' ? <LuMessageSquare size={14} /> : null}
          {message.role === 'tool' || message.role === 'system' ? <LuTerminal size={14} /> : null}
          {message.role === 'thinking' ? (message.status === 'running' ? <LuSparkles size={14} /> : <LuCircleCheck size={14} />) : null}
          {message.role === 'error' ? <LuX size={14} /> : null}
        </span>
        <span className={styles.chatMessageKicker}>{roleLabel(message.role)}</span>
        <span className={styles.chatMessageMeta}>{statusLabel} · {formatChatTime(message.createdAt)}</span>
        {usage ? <span className={styles.chatMessageMeta}>{formatUsageSummary(usage)}</span> : null}
      </div>
      {commandLabel ? (
        <div className={styles.chatMessageCommandRow}>
          <span><LuSparkles size={13} /> {commandLabel}</span>
          <small>structured command metadata</small>
        </div>
      ) : null}
      <div className={styles.chatMessageBody}>
        {message.role === 'thinking' ? (
          <div className={styles.chatThinkingBlock}>
            <span className={styles.chatThinkingLine}>
              {message.status === 'running' ? (
                <>Çalışıyor <span className={styles.thinkingDots}><i /><i /><i /></span></>
              ) : (
                <><LuCircleCheck size={15} /> {thinkingLabel || 'Çalıştı'}</>
              )}
            </span>
            {thinkingText ? <div className={styles.chatThinkingText}>{thinkingBody}</div> : null}
          </div>
        ) : null}
        {message.role === 'tool' && gatewayBlock === 'changes' ? (
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
        ) : message.role === 'system' && gatewayBlock === 'run-complete' ? (
          <div className={styles.gatewayRunComplete}><LuCircleCheck size={15} /> {message.body}</div>
        ) : message.role !== 'thinking' ? (
          messageBody
        ) : null}
        {attachments.length > 0 ? (
          <div className={styles.chatSentAttachmentGrid}>
            {attachments.map((attachment) => (
              <div key={`${attachment.name}-${attachment.path ?? ''}`} className={styles.chatSentAttachmentTile} title={attachment.path ?? attachment.name}>
                <span><LuFileText size={15} /></span>
                <b>{attachmentExtension(attachment.name)}</b>
                <small>{attachment.name}</small>
                {attachment.size ? <em>{formatAttachmentSize(attachment.size)}</em> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {message.body.trim() ? (
        <button
          type="button"
          className={styles.copyMessageButton}
          onClick={(event) => {
            event.stopPropagation()
            void navigator.clipboard?.writeText(message.body)
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label="Copy message"
          title="Copy message"
        >
          <LuCopy size={13} />
        </button>
      ) : null}
    </article>
  )
})
