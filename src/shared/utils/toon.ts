export type ToonObject = Record<string, unknown>

const MULTILINE_SENTINEL = '|-'

function isPlainObject(value: unknown): value is ToonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function scalarToon(value: unknown): string {
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      return `${MULTILINE_SENTINEL}\n${value.split('\n').map((line) => `  ${line}`).join('\n')}`
    }
    return JSON.stringify(value)
  }
  return JSON.stringify(value)
}

export function serializeToonRecord(record: ToonObject): string {
  return Object.keys(record)
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((key) => `${key}: ${scalarToon(record[key])}`)
    .join('\n')
}

export function parseToonRecord(input: string): ToonObject {
  const rows = input.replace(/\r\n/g, '\n').split('\n')
  const output: ToonObject = {}
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row.trim()) continue
    const match = /^([A-Za-z0-9_.-]+):(?:\s(.*))?$/.exec(row)
    if (!match) throw new Error(`Invalid TOON row: ${row}`)
    const [, key, rawValue = ''] = match
    if (rawValue === MULTILINE_SENTINEL) {
      const lines: string[] = []
      while (index + 1 < rows.length && rows[index + 1].startsWith('  ')) {
        index += 1
        lines.push(rows[index].slice(2))
      }
      output[key] = lines.join('\n')
      continue
    }
    try {
      output[key] = JSON.parse(rawValue)
    } catch {
      output[key] = rawValue
    }
  }
  return output
}

export function stringifyCompactJson(value: unknown): string {
  if (!isPlainObject(value) && !Array.isArray(value)) return JSON.stringify(value)
  return JSON.stringify(value)
}
