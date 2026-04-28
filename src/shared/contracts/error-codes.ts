export const ErrorCodes = {
  Unauthenticated: 'ERR_UNAUTHENTICATED',
  Forbidden: 'ERR_FORBIDDEN',
  NotFound: 'ERR_NOT_FOUND',
  Conflict: 'ERR_CONFLICT',
  Validation: 'ERR_VALIDATION',
  Internal: 'ERR_INTERNAL',
  GatewayUnavailable: 'ERR_GATEWAY_UNAVAILABLE',
  RateLimited: 'ERR_RATE_LIMITED',
  Retryable: 'ERR_RETRYABLE'
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
