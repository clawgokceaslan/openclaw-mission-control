export interface OpenClawCompatibilityResult {
  compatible: boolean
  serverVersion?: string
  minimumVersion: string
  reason?: string
}

function parts(value: string): number[] {
  return value.split(/[.-]/).map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part))
}

function compare(a: string, b: string): number {
  const left = parts(a)
  const right = parts(b)
  const size = Math.max(left.length, right.length)
  for (let index = 0; index < size; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function extractOpenClawServerVersion(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const candidates = [record.serverVersion, record.version, record.protocolVersion]
  const payload = record.payload && typeof record.payload === 'object' ? record.payload as Record<string, unknown> : undefined
  if (payload) candidates.push(payload.serverVersion, payload.version)
  return candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function evaluateOpenClawCompatibility(connectPayload: unknown, minimumVersion = '2026.1.30'): OpenClawCompatibilityResult {
  const serverVersion = extractOpenClawServerVersion(connectPayload)
  if (!serverVersion) return { compatible: true, minimumVersion, reason: 'Server version not reported.' }
  const compatible = compare(serverVersion, minimumVersion) >= 0
  return { compatible, serverVersion, minimumVersion, reason: compatible ? undefined : `OpenClaw ${serverVersion} is older than ${minimumVersion}.` }
}
