export interface ErrorPayload {
  code: string
  message: string
  details?: unknown
}

export interface ServiceResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: ErrorPayload
  meta?: Record<string, unknown>
}

export function okResponse<T>(data?: T, meta?: Record<string, unknown>): ServiceResponse<T> {
  return { ok: true, data, meta }
}

export function errorResponse<T = unknown>(
  code: string,
  message: string,
  details?: unknown
): ServiceResponse<T> {
  return { ok: false, error: { code, message, details } }
}

export function wrapResponseMeta(
  base: Record<string, unknown> | undefined,
  additions: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!base && !additions) return undefined
  return {
    ...(base ?? {}),
    ...(additions ?? {})
  }
}
