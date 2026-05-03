import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import '@blocknote/core/fonts/inter.css'
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { LuDatabase, LuMaximize2, LuMinimize2, LuPlus, LuX } from 'react-icons/lu'
import type { AgentOutputFormatField, OutputFormat } from '@shared/types/entities'
import { useTheme } from '@renderer/providers/theme/theme-state'
import styles from './MarkdownDescriptionEditor.module.scss'

type EditorStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed'
type DataFormatRole = OutputFormat['formatRole']
type DataFormatCodeMode = 'json' | 'yaml'

export type DescriptionDataFormat = Pick<OutputFormat, 'id' | 'name' | 'formatRole' | 'fields'>
  & Partial<Pick<OutputFormat, 'description'>>

const LEGACY_DATA_FORMAT_TOKEN_RE = /:::omc-data-format\s+(\{[^\n]*\})\s*\n:::/g
const EMPTY_DATA_FORMATS: DescriptionDataFormat[] = []

function normalizeFields(fields: AgentOutputFormatField[]): AgentOutputFormatField[] {
  return fields
    .map((field) => ({
      ...field,
      key: field.key.trim(),
      description: field.description.trim(),
      defaultValue: field.defaultValue?.trim() ?? '',
      enumValues: (field.enumValues ?? []).map((value) => value.trim()).filter(Boolean),
      children: normalizeFields(field.children ?? [])
    }))
    .filter((field) => field.key || field.description || field.defaultValue || field.enumValues?.length || field.children.length)
}

function sampleValue(field: AgentOutputFormatField): unknown {
  const children = field.children ?? []
  if (children.length > 0) {
    const childObject = fieldsToSampleObject(children)
    return field.valueType === 'array' ? [childObject] : childObject
  }
  const defaultValue = field.defaultValue?.trim() ?? ''
  const description = field.description?.trim() ?? ''
  const valueType = field.valueType ?? 'string'
  if (valueType === 'enum') {
    const values = field.enumValues ?? []
    return defaultValue && values.includes(defaultValue) ? defaultValue : values[0] ?? ''
  }
  if (defaultValue) {
    if (valueType === 'number') {
      const numericValue = Number(defaultValue)
      return Number.isFinite(numericValue) ? numericValue : defaultValue
    }
    if (valueType === 'boolean') return defaultValue === 'true'
    if (valueType === 'array') return defaultValue.split(',').map((item) => item.trim()).filter(Boolean)
    return defaultValue
  }
  if (description) return description
  if (valueType === 'number') return 0
  if (valueType === 'boolean') return false
  if (valueType === 'array') return []
  return ''
}

function fieldsToSampleObject(fields: AgentOutputFormatField[]): Record<string, unknown> {
  return normalizeFields(fields).reduce<Record<string, unknown>>((acc, field) => {
    if (field.key) acc[field.key] = sampleValue(field)
    return acc
  }, {})
}

function markdownCell(value: unknown): string {
  const text = String(value ?? '').trim()
  return text ? text.replace(/\|/g, '\\|').replace(/\n/g, '<br>') : '-'
}

function sampleLabel(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function flattenFieldRows(fields: AgentOutputFormatField[], prefix = ''): Array<{ path: string; field: AgentOutputFormatField; sample: unknown }> {
  return normalizeFields(fields).flatMap((field) => {
    const key = field.key || 'untitled'
    const path = prefix
      ? field.valueType === 'array'
        ? `${prefix}.${key}[]`
        : `${prefix}.${key}`
      : field.valueType === 'array'
        ? `${key}[]`
        : key
    const childPrefix = field.valueType === 'array' ? path : path
    return [
      { path, field, sample: sampleValue(field) },
      ...flattenFieldRows(field.children ?? [], childPrefix)
    ]
  })
}

function toYamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `"${String(value).replace(/"/g, '\\"')}"`
}

function toYaml(value: unknown, indent = 0): string {
  const padding = '  '.repeat(indent)
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return `${padding}${toYamlValue(value)}`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${padding}[]`
    return value.map((item) => {
      if (item && typeof item === 'object') return `${padding}-\n${toYaml(item, indent + 1)}`
      return `${padding}- ${toYamlValue(item)}`
    }).join('\n')
  }
  return Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => {
    if (fieldValue === null || fieldValue === undefined || ['string', 'number', 'boolean'].includes(typeof fieldValue)) {
      return `${padding}${key}: ${toYamlValue(fieldValue)}`
    }
    if (Array.isArray(fieldValue) && fieldValue.length === 0) return `${padding}${key}: []`
    return `${padding}${key}:\n${toYaml(fieldValue, indent + 1)}`
  }).join('\n')
}

function dataFormatToCode(format: DescriptionDataFormat, mode: DataFormatCodeMode): string {
  const sample = fieldsToSampleObject(format.fields ?? [])
  return mode === 'json' ? JSON.stringify(sample, null, 2) : toYaml(sample)
}

function dataFormatCodeBlock(format: DescriptionDataFormat, mode: DataFormatCodeMode) {
  return `\`\`\`${mode}\n${dataFormatToCode(format, mode)}\n\`\`\``
}

function dataFormatContractTable(format: DescriptionDataFormat): string {
  const rows = flattenFieldRows(format.fields ?? [])
  const contractRows = rows.length > 0
    ? rows.map(({ path, field, sample }) => (
      `| ${markdownCell(path)} | ${markdownCell(field.valueType ?? 'string')} | ${field.required ? 'yes' : 'no'} | ${markdownCell((field.enumValues ?? []).join(', '))} | ${markdownCell(sampleLabel(sample))} | ${markdownCell(field.description)} |`
    )).join('\n')
    : '| No fields defined | - | no | - | - | - |'
  return `| Path | Type | Required | Allowed Values | Default/Sample | Description |
| --- | --- | --- | --- | --- | --- |
${contractRows}`
}

function dataFormatMarkdown(format: DescriptionDataFormat, mode: DataFormatCodeMode) {
  const role = format.formatRole === 'input' ? 'Input' : 'Output'
  const description = format.description?.trim()
  return `### ${role} Data Format: ${format.name}
${description ? `\n${description}\n` : ''}
${dataFormatContractTable(format)}

${dataFormatCodeBlock(format, mode)}`
}

export function descriptionHasDataFormatToken(value: string) {
  LEGACY_DATA_FORMAT_TOKEN_RE.lastIndex = 0
  return LEGACY_DATA_FORMAT_TOKEN_RE.test(value)
}

export function prefixDataFormatTokens(value: string, inputFormatId?: string | null, outputFormatId?: string | null, dataFormats: DescriptionDataFormat[] = []) {
  let nextValue = value.replace(LEGACY_DATA_FORMAT_TOKEN_RE, (_match, rawJson) => {
    try {
      const parsed = JSON.parse(rawJson) as { formatId?: string }
      const format = dataFormats.find((item) => item.id === parsed.formatId)
      return format ? dataFormatMarkdown(format, 'json') : ''
    } catch {
      return ''
    }
  }).trim()
  if (descriptionHasDataFormatToken(value)) return nextValue
  const blocks = [
    inputFormatId ? dataFormats.find((format) => format.id === inputFormatId) : null,
    outputFormatId ? dataFormats.find((format) => format.id === outputFormatId) : null
  ].filter((format): format is DescriptionDataFormat => Boolean(format)).map((format) => dataFormatMarkdown(format, 'json'))
  if (blocks.length === 0) return nextValue || value
  return `${blocks.join('\n\n')}${nextValue ? `\n\n${nextValue}` : ''}`
}

interface MarkdownDescriptionEditorProps {
  value: string
  onChange: (value: string) => void
  dataFormats?: DescriptionDataFormat[]
  onCreateDataFormat?: (role: DataFormatRole) => Promise<DescriptionDataFormat | null>
  enableDataFormatCommands?: boolean
  onCommit?: () => void
  onCancel?: () => void
  placeholder?: string
  minHeight?: number
  status?: EditorStatus
  className?: string
}

export function MarkdownDescriptionEditor({
  value,
  onChange,
  dataFormats = EMPTY_DATA_FORMATS,
  onCreateDataFormat,
  enableDataFormatCommands = false,
  onCommit,
  onCancel,
  placeholder = 'Write description...',
  minHeight = 148,
  status = 'idle',
  className
}: MarkdownDescriptionEditorProps) {
  const { resolvedMode } = useTheme()
  const loadingRef = useRef(false)
  const latestValueRef = useRef<string | null>(null)
  const [isEmpty, setIsEmpty] = useState(!value.trim())
  const [pendingRole, setPendingRole] = useState<DataFormatRole | null>(null)
  const [selectedFormatId, setSelectedFormatId] = useState('')
  const [codeMode, setCodeMode] = useState<DataFormatCodeMode>('json')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const resolvedFileUrlCacheRef = useRef(new Map<string, string>())

  const roleFormats = useMemo(() => {
    if (!pendingRole) return []
    return dataFormats.filter((format) => format.formatRole === pendingRole)
  }, [dataFormats, pendingRole])

  const selectedFormat = useMemo(() => roleFormats.find((format) => format.id === selectedFormatId) ?? null, [roleFormats, selectedFormatId])

  const resolveFileUrl = async (url: string): Promise<string> => {
    if (!url.startsWith('file://')) return url

    const cached = resolvedFileUrlCacheRef.current.get(url)
    if (cached) return cached

    const req = (globalThis as { require?: (name: string) => unknown }).require
    if (typeof req !== 'function') return url

    try {
      const { fileURLToPath } = req('node:url') as { fileURLToPath: (value: string) => string }
      const { readFile } = req('node:fs/promises') as { readFile: (path: string) => Promise<Uint8Array> }
      const filePath = fileURLToPath(url)
      const bytes = await readFile(filePath)
      const extension = filePath.split('.').pop()?.toLowerCase()
      const type = extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'png'
          ? 'image/png'
          : extension === 'gif'
            ? 'image/gif'
            : extension === 'webp'
              ? 'image/webp'
              : extension === 'svg'
                ? 'image/svg+xml'
                : extension === 'mp4' || extension === 'm4v'
                  ? 'video/mp4'
                  : extension === 'webm'
                    ? 'video/webm'
                    : extension === 'ogv' || extension === 'ogg'
                      ? 'video/ogg'
                      : extension === 'mov'
                        ? 'video/quicktime'
                        : 'application/octet-stream'
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const blob = new Blob([buffer], { type })
      const objectUrl = URL.createObjectURL(blob)
      resolvedFileUrlCacheRef.current.set(url, objectUrl)
      return objectUrl
    } catch {
      return url
    }
  }

  const editor = useCreateBlockNote({ resolveFileUrl }, [])

  useEffect(() => {
    return () => {
      for (const objectUrl of resolvedFileUrlCacheRef.current.values()) {
        URL.revokeObjectURL(objectUrl)
      }
      resolvedFileUrlCacheRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (value === latestValueRef.current) return
    latestValueRef.current = value
    setIsEmpty(!value.trim())
    loadingRef.current = true
    try {
      const blocks = value.trim()
        ? editor.tryParseMarkdownToBlocks(prefixDataFormatTokens(value, null, null, dataFormats))
        : [{ type: 'paragraph', content: '' }]
      editor.replaceBlocks(editor.document, blocks as any)
    } finally {
      window.setTimeout(() => {
        loadingRef.current = false
      }, 0)
    }
  }, [dataFormats, editor, value])

  const handleChange = () => {
    if (loadingRef.current) return
    const markdown = editor.blocksToMarkdownLossy(editor.document)
    latestValueRef.current = markdown
    setIsEmpty(!markdown.trim())
    onChange(markdown)
  }

  const openDataFormatPicker = (role: DataFormatRole) => {
    setPendingRole(role)
    setSelectedFormatId('')
    setCodeMode('json')
  }

  const closeDataFormatPicker = () => {
    setPendingRole(null)
    setSelectedFormatId('')
    setCodeMode('json')
  }

  const insertSelectedFormat = () => {
    if (!selectedFormat) return
    const blocks = editor.tryParseMarkdownToBlocks(dataFormatMarkdown(selectedFormat, codeMode))
    const insertedBlock = insertOrUpdateBlockForSlashMenu(editor as any, blocks[0] as any)
    if (blocks.length > 1) {
      editor.insertBlocks(blocks.slice(1) as any, insertedBlock, 'after')
    }
    closeDataFormatPicker()
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (isFullscreen) return
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onCommit?.()
  }

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      onCommit?.()
    }
    if (event.key === 'Escape') {
      if (pendingRole) {
        event.preventDefault()
        closeDataFormatPicker()
        return
      }
      if (isFullscreen) {
        event.preventDefault()
        setIsFullscreen(false)
        return
      }
      onCancel?.()
    }
  }

  const editorContent = (
    <>
      <button
        type="button"
        className={styles.fullscreenButton}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setIsFullscreen((value) => !value)}
        aria-label={isFullscreen ? 'Exit fullscreen description editor' : 'Open fullscreen description editor'}
      >
        {isFullscreen ? <LuMinimize2 size={16} /> : <LuMaximize2 size={16} />}
      </button>
      <BlockNoteView editor={editor} onChange={handleChange} theme={resolvedMode} slashMenu={!enableDataFormatCommands}>
        {enableDataFormatCommands ? (
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => filterSuggestionItems([
              ...getDefaultReactSlashMenuItems(editor),
              {
                title: 'Input data format',
                subtext: 'Insert input format as code',
                aliases: ['input', 'data', 'format', 'json', 'yaml'],
                group: 'Data Formats',
                icon: <LuDatabase size={16} />,
                onItemClick: () => openDataFormatPicker('input')
              },
              {
                title: 'Output data format',
                subtext: 'Insert output format as code',
                aliases: ['output', 'data', 'format', 'json', 'yaml'],
                group: 'Data Formats',
                icon: <LuDatabase size={16} />,
                onItemClick: () => openDataFormatPicker('output')
              }
            ], query)}
          />
        ) : null}
      </BlockNoteView>
      {pendingRole ? (
        <div className={styles.dataFormatPicker}>
          <div className={styles.dataFormatPickerHeader}>
            <span className={`${styles.dataFormatRole} ${pendingRole === 'input' ? styles.inputRole : styles.outputRole}`}>
              {pendingRole === 'input' ? 'Input' : 'Output'}
            </span>
            <strong>{pendingRole === 'input' ? 'Input data format' : 'Output data format'}</strong>
            <button type="button" onClick={closeDataFormatPicker} aria-label="Cancel data format insert"><LuX size={15} /></button>
          </div>
          <div className={styles.dataFormatPickerBody}>
            <select value={selectedFormatId} onChange={(event) => setSelectedFormatId(event.target.value)}>
              <option value="">Choose data format...</option>
              {roleFormats.map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}
            </select>
            <div className={styles.codeModeSwitch}>
              {(['json', 'yaml'] as const).map((mode) => (
                <button key={mode} type="button" className={codeMode === mode ? styles.codeModeActive : undefined} onClick={() => setCodeMode(mode)}>
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {selectedFormat ? <pre className={styles.dataFormatPreview}>{dataFormatMarkdown(selectedFormat, codeMode)}</pre> : null}
          <div className={styles.dataFormatPickerActions}>
            <button type="button" onClick={async () => {
              const created = await onCreateDataFormat?.(pendingRole)
              if (created) setSelectedFormatId(created.id)
            }}>
              <LuPlus size={14} />
              New
            </button>
            <button type="button" onClick={insertSelectedFormat} disabled={!selectedFormat}>Insert format</button>
          </div>
        </div>
      ) : null}
    </>
  )

  return (
    <>
      <div
        className={`${styles.editorShell} ${className ?? ''}`}
        style={{ '--markdown-editor-min-height': `${minHeight}px` } as CSSProperties}
        data-status={status}
        onBlur={handleBlur}
        onKeyDownCapture={handleKeyDownCapture}
      >
        {isFullscreen ? null : editorContent}
      </div>
      {isFullscreen ? createPortal(
        <>
          <div className={styles.fullscreenBackdrop} onMouseDown={() => setIsFullscreen(false)} />
          <section
            className={styles.fullscreenShell}
            role="dialog"
            aria-modal="true"
            aria-label="Fullscreen description editor"
            style={{ '--markdown-editor-min-height': `${minHeight}px` } as CSSProperties}
            data-status={status}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onCommit?.()
            }}
            onKeyDownCapture={handleKeyDownCapture}
          >
            <header className={styles.fullscreenHeader}>
              <span>Description</span>
              <button type="button" onClick={() => setIsFullscreen(false)} aria-label="Close fullscreen description editor">
                <LuX size={18} />
              </button>
            </header>
            <div className={styles.fullscreenBody}>
              {editorContent}
            </div>
          </section>
        </>,
        document.body
      ) : null}
    </>
  )
}
