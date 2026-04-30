import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { TaskAttachment } from '@shared/types/entities'
import { invokeBridge } from '@renderer/utils/api'

export interface AttachmentRow {
  id: string
  name: string
  url: string
  type: string
  size: number
  source: string
  origin: 'stored' | 'description'
  createdAt?: number
}

interface UploadedAttachment {
  url: string
  name: string
  type: string
  size: number
}

const URL_PATTERN = /(!?\[([^\]]*)\]\((file:\/\/[^)\s]+)\))|(<(?:img|video|source)\b[^>]*\bsrc=["'](file:\/\/[^"']+)["'][^>]*>)|(<a\b[^>]*\bhref=["'](file:\/\/[^"']+)["'][^>]*>(.*?)<\/a>)/gi

export function createLocalId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function normalizeAttachments(value: unknown): TaskAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const url = typeof item.url === 'string' ? item.url : ''
    if (!url) return []
    return [{
      id: typeof item.id === 'string' && item.id ? item.id : createLocalId(),
      name: typeof item.name === 'string' && item.name ? item.name : fileNameFromUrl(url),
      url,
      type: typeof item.type === 'string' && item.type ? item.type : typeFromName(url),
      size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
    }]
  })
}

export function attachmentRowsFromDescription(markdown: string, source: string): AttachmentRow[] {
  const rows: AttachmentRow[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(URL_PATTERN)) {
    const markdownUrl = match[3]
    const htmlMediaUrl = match[5]
    const linkUrl = match[7]
    const url = markdownUrl || htmlMediaUrl || linkUrl
    if (!url || seen.has(url)) continue
    seen.add(url)
    const label = match[2] || match[8] || ''
    rows.push({
      id: `description:${source}:${url}`,
      name: label.trim() || fileNameFromUrl(url),
      url,
      type: typeFromName(url),
      size: 0,
      source,
      origin: 'description'
    })
  }
  return rows
}

export function removeAttachmentFromMarkdown(markdown: string, url: string): string {
  if (!url) return markdown
  return markdown
    .split('\n')
    .map((line) => {
      if (!line.includes(url)) return line
      return line
        .replace(new RegExp(`!?\\[[^\\]]*\\]\\(${escapeRegExp(url)}\\)`, 'g'), '')
        .replace(new RegExp(`<(?:img|video|source)\\b[^>]*(?:src=["']${escapeRegExp(url)}["'])[^>]*>`, 'gi'), '')
        .replace(new RegExp(`<a\\b[^>]*(?:href=["']${escapeRegExp(url)}["'])[^>]*>.*?<\\/a>`, 'gi'), '')
        .trim()
    })
    .filter((line, index, lines) => line || lines[index - 1] !== '')
    .join('\n')
    .trim()
}

export interface AttachmentUploadContext {
  scope?: 'task' | 'subtask' | 'template' | 'templateSubtask' | 'project'
  projectId?: string
  taskId?: string
  subtaskId?: string
  templateId?: string
  templateSubtaskId?: string
}

export async function uploadTaskAttachment(file: File, actorToken: string | null, context: AttachmentUploadContext = {}): Promise<TaskAttachment> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  const response = await invokeBridge<UploadedAttachment>(IPC_CHANNELS.attachments.upload, {
    actorToken,
    name: file.name,
    type: file.type || 'application/octet-stream',
    dataBase64: btoa(binary),
    ...context
  })
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message ?? 'Unable to upload attachment')
  }
  return {
    id: createLocalId(),
    name: response.data.name || file.name,
    url: response.data.url,
    type: response.data.type || file.type || typeFromName(file.name),
    size: response.data.size,
    createdAt: Date.now()
  }
}

export async function downloadAttachment(row: AttachmentRow): Promise<void> {
  let href = row.url
  let revoke = false
  if (row.url.startsWith('file://')) {
    const req = (globalThis as { require?: (name: string) => unknown }).require
    if (typeof req === 'function') {
      const { fileURLToPath } = req('node:url') as { fileURLToPath: (value: string) => string }
      const { readFile } = req('node:fs/promises') as { readFile: (path: string) => Promise<Uint8Array> }
      const bytes = await readFile(fileURLToPath(row.url))
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      href = URL.createObjectURL(new Blob([buffer], { type: row.type || 'application/octet-stream' }))
      revoke = true
    }
  }
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = row.name || fileNameFromUrl(row.url)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export function fileNameFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url)
    const name = decoded.split('/').pop()?.replace(/^[a-f0-9-]{36}-/i, '')
    return name || 'attachment'
  } catch {
    return 'attachment'
  }
}

export function formatFileSize(size: number): string {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function typeFromName(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase()
  if (!extension) return 'file'
  if (['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension)) return `image/${extension === 'jpg' ? 'jpeg' : extension}`
  if (['m4v', 'mov', 'mp4', 'ogv', 'ogg', 'webm'].includes(extension)) return `video/${extension}`
  return extension
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
