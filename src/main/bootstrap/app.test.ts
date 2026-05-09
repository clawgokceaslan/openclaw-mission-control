import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { buildDevRelaunchCommand } from './app.js'

describe('buildDevRelaunchCommand', () => {
  it('starts the development app from the current project folder', () => {
    const command = buildDevRelaunchCommand(false, '/Users/test/Open Mission Control', {
      generation: 'restart-1',
      oldPid: 123,
      oldParentPid: 45
    })

    expect(command).toContain("export OMC_DEV_RESTART_GENERATION='restart-1'")
    expect(command).toContain("export OMC_DEV_RESTART_OLD_PID='123'")
    expect(command).toContain("export OMC_DEV_RESTART_OLD_PPID='45'")
    expect(command).toContain("export OMC_DEV_RESTART_WORKSPACE='/Users/test/Open Mission Control'")
    expect(command).toContain("printf '\\033]0;%s\\007' 'OpenMissionControl Dev restart-1'")
    expect(command).toContain("cd '/Users/test/Open Mission Control'")
    expect(command).toContain('cleanup_old_omc_dev || true')
    expect(command).toContain('env -u ELECTRON_RUN_AS_NODE npm run dev')
  })

  it('preserves the database settings restart intent in development', () => {
    const command = buildDevRelaunchCommand(true, "/Users/test/O'Mission", {
      generation: 'restart-2',
      oldPid: 123,
      oldParentPid: 45
    })

    expect(command).toContain("export OMC_DEV_RESTART_WORKSPACE='/Users/test/O'\\''Mission'")
    expect(command).toContain("cd '/Users/test/O'\\''Mission'")
    expect(command).toContain('env -u ELECTRON_RUN_AS_NODE OMC_OPEN_DATABASE_SETTINGS=1 npm run dev')
  })

  it('generates valid zsh syntax for the Unix cleanup flow', () => {
    const command = buildDevRelaunchCommand(false, '/Users/test/Open Mission Control', {
      generation: 'syntax-check',
      oldPid: 123,
      oldParentPid: 45
    })
    const result = spawnSync('zsh', ['-n'], { input: command, encoding: 'utf8' })
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})
