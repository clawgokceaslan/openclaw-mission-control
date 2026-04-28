import { SqliteAdapter } from '../adapter/sqlite.js'

export abstract class BaseRepository<TRecord extends object> {
  constructor(protected db: SqliteAdapter) {}

  protected parseJson<T = unknown>(value: string | null): T | undefined {
    if (!value) return undefined
    try {
      return JSON.parse(value) as T
    } catch {
      return undefined
    }
  }

  protected toJson(value: unknown): string | null {
    if (value == null) return null
    return JSON.stringify(value)
  }

  protected asRecord(row: any): TRecord {
    return row as TRecord
  }
}
