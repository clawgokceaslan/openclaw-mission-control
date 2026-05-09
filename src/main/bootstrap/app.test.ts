import { describe, expect, it } from 'vitest'
import { buildDevRelaunchCommand } from './app.js'

describe('buildDevRelaunchCommand', () => {
  it('starts the development app from the current project folder', () => {
    expect(buildDevRelaunchCommand(false, '/Users/test/Open Mission Control')).toBe(
      "sleep 1 && cd '/Users/test/Open Mission Control' && env -u ELECTRON_RUN_AS_NODE npm run dev"
    )
  })

  it('preserves the database settings restart intent in development', () => {
    expect(buildDevRelaunchCommand(true, "/Users/test/O'Mission")).toBe(
      "sleep 1 && cd '/Users/test/O'\\''Mission' && env -u ELECTRON_RUN_AS_NODE OMC_OPEN_DATABASE_SETTINGS=1 npm run dev"
    )
  })
})
