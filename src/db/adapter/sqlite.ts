import { createRequire } from 'node:module'
import type * as Sqlite3 from 'sqlite3'

const require = createRequire(import.meta.url)
const sqlite3 = require('sqlite3') as typeof Sqlite3

export type BoundParams = { [key: string]: unknown } | unknown[]

interface PlaceholderSummary {
  named: string[]
  hasPositional: boolean
}

function normalizeBoundParams(params: BoundParams | undefined): BoundParams {
  if (!params || Array.isArray(params)) {
    return params ?? []
  }

  if (typeof params !== 'object') {
    return [params]
  }

  const source = params as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('@') || key.startsWith('$') || key.startsWith(':')) {
      normalized[key] = value
    } else {
      normalized[`@${key}`] = value
    }
  }

  return normalized
}

function summarizePlaceholders(sql: string): PlaceholderSummary {
  const named: string[] = []
  const seen = new Set<string>()
  const hasPositional = sql.includes('?')
  const placeholderRegExp = /([:@$])([A-Za-z_][A-Za-z0-9_]*)/g
  let match: RegExpExecArray | null
  while ((match = placeholderRegExp.exec(sql)) !== null) {
    const token = `${match[1]}${match[2]}`
    if (!seen.has(token)) {
      seen.add(token)
      named.push(match[2])
    }
  }
  return { named, hasPositional }
}

function usesNamedPlaceholders(summary: PlaceholderSummary): boolean {
  return summary.named.length > 0
}

function executionParamsForSql(sql: string, boundParams: BoundParams): BoundParams {
  if (Array.isArray(boundParams)) {
    return boundParams
  }

  if (typeof boundParams !== 'object' || boundParams === null) {
    return boundParams as BoundParams
  }

  const summary = summarizePlaceholders(sql)
  if (!summary.hasPositional || usesNamedPlaceholders(summary)) {
    return boundParams
  }

  return Object.values(boundParams)
}

function assertBoundParams(sql: string, boundParams: BoundParams): void {
  const summary = summarizePlaceholders(sql)
  if (summary.hasPositional) {
    return
  }

  const isObject = !Array.isArray(boundParams) && boundParams !== undefined && boundParams !== null
  if (!summary.named.length) {
    return
  }

  if (!isObject) {
    if (Array.isArray(boundParams)) {
      if (boundParams.length < summary.named.length) {
        throw new Error(`Missing named bind parameters for SQL query. Expected: ${summary.named.join(', ')}`)
      }
    }
    return
  }

  const paramSource = summary.hasPositional ? {} : (boundParams as Record<string, unknown>)
  const missing = summary.named.filter((name) => {
    const variants = [`${name}`, `@${name}`, `:${name}`, `$${name}`]
    return !variants.some((variant) => Object.prototype.hasOwnProperty.call(paramSource as object, variant))
  })
  if (missing.length > 0) {
    throw new Error(`Missing named bind parameters: ${missing.join(', ')}`)
  }
  void paramSource
}

function logAndReject(query: string, boundParams: BoundParams, error: unknown): Error | null {
  const detail = { query, params: boundParams }
  console.error('SQLite query failed', detail, error)
  if (error instanceof Error) return error
  return new Error(String(error))
}

export interface RunResult {
  changes: number
  lastID: number | bigint | null
}

export interface PreparedStatement {
  all<T = unknown>(params?: BoundParams): Promise<T[]>
  get<T = unknown>(params?: BoundParams): Promise<T | undefined>
  run(params?: BoundParams): Promise<RunResult>
}

interface StatementResult {
  changes?: number
  lastID?: number | bigint | null
}

export class SqliteAdapter {
  private readonly db: Sqlite3.Database
  private closed = false

  private constructor(db: Sqlite3.Database) {
    this.db = db
  }

  static open(filePath: string): Promise<SqliteAdapter> {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(filePath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (error) => {
        if (error) {
          reject(error)
          return
        }
        db.configure('busyTimeout', 10000)
        resolve(new SqliteAdapter(db))
      })
    })
  }

  prepare(sql: string): PreparedStatement {
    const db = this.db
    return {
      all: <T = unknown>(params: BoundParams = []) =>
        new Promise<T[]>((resolve, reject) => {
          const boundParams = normalizeBoundParams(params)
          try {
            assertBoundParams(sql, boundParams)
          } catch (error) {
            reject(error)
            return
          }
          db.all(sql, boundParams as unknown, (error: Error | null, rows: T[]) => {
            if (error) {
              reject(logAndReject(sql, boundParams, error))
              return
            }
            resolve(rows as T[])
          })
        }),
      get: <T = unknown>(params: BoundParams = []) =>
        new Promise<T | undefined>((resolve, reject) => {
          const boundParams = normalizeBoundParams(params)
          const execParams = executionParamsForSql(sql, boundParams)
          try {
            assertBoundParams(sql, boundParams)
          } catch (error) {
            reject(error)
            return
          }
          db.get(sql, execParams as unknown, (error: Error | null, row: T | undefined) => {
            if (error) {
              reject(logAndReject(sql, boundParams, error))
              return
            }
            resolve(row as T | undefined)
          })
        }),
      run: (params: BoundParams = []) =>
        new Promise<RunResult>((resolve, reject) => {
          const boundParams = normalizeBoundParams(params)
          const execParams = executionParamsForSql(sql, boundParams)
          try {
            assertBoundParams(sql, boundParams)
          } catch (error) {
            reject(error)
            return
          }
          db.run(sql, execParams as unknown, function callback(this: StatementResult, error: Error | null) {
            if (error) {
              reject(logAndReject(sql, boundParams, error))
              return
            }
            resolve({
              changes: this.changes ?? 0,
              lastID: this.lastID ?? null
            })
          })
        })
    }
  }

  run(sql: string, params: BoundParams = []): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const boundParams = normalizeBoundParams(params)
      const execParams = executionParamsForSql(sql, boundParams)
      try {
        assertBoundParams(sql, boundParams)
      } catch (error) {
        reject(error)
        return
      }
      this.db.run(sql, execParams as unknown, function callback(this: StatementResult, error: Error | null) {
        if (error) {
          reject(logAndReject(sql, boundParams, error))
          return
        }
        resolve({
          changes: this.changes ?? 0,
          lastID: this.lastID ?? null
        })
      })
    })
  }

  get<T = unknown>(sql: string, params: BoundParams = []): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const boundParams = normalizeBoundParams(params)
      const execParams = executionParamsForSql(sql, boundParams)
      try {
        assertBoundParams(sql, boundParams)
      } catch (error) {
        reject(error)
        return
      }
      this.db.get(sql, execParams as unknown, (error: Error | null, row: T | undefined) => {
        if (error) {
          reject(logAndReject(sql, boundParams, error))
          return
        }
        resolve(row as T | undefined)
      })
    })
  }

  all<T = unknown>(sql: string, params: BoundParams = []): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const boundParams = normalizeBoundParams(params)
      const execParams = executionParamsForSql(sql, boundParams)
      try {
        assertBoundParams(sql, boundParams)
      } catch (error) {
        reject(error)
        return
      }
      this.db.all(sql, execParams as unknown, (error: Error | null, rows: T[]) => {
        if (error) {
          reject(logAndReject(sql, boundParams, error))
          return
        }
        resolve(rows as T[])
      })
    })
  }

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (error: Error | null) => {
        if (error) {
          reject(logAndReject(sql, [], error))
          return
        }
        resolve()
      })
    })
  }

  close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve()
    }
    this.closed = true
    return new Promise((resolve, reject) => {
      this.db.close((error: Error | null) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    await this.exec('BEGIN IMMEDIATE')
    try {
      const result = await callback()
      await this.exec('COMMIT')
      return result
    } catch (error) {
      await this.exec('ROLLBACK')
      throw error
    }
  }

  async pragma(statement: string): Promise<unknown[]> {
    return this.all(`PRAGMA ${statement}`)
  }
}
