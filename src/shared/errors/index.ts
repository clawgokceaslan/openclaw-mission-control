export class AppError extends Error {
  constructor(
    public code: string,
    public details?: unknown
  ) {
    super(`${code}`)
    this.name = 'AppError'
  }
}
