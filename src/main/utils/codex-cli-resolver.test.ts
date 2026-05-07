import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexCliNotFoundError, resolveCodexExecutable } from './codex-cli-resolver.js'

const originalPath = process.env.PATH
const tempDirs: string[] = []

afterEach(async () => {
  process.env.PATH = originalPath
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('resolveCodexExecutable', () => {
  it('resolves a bare codex command from PATH to an executable absolute path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omc-codex-resolver-'))
    tempDirs.push(dir)
    const executable = join(dir, 'codex')
    await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(executable, 0o700)
    process.env.PATH = dir

    const resolved = await resolveCodexExecutable('codex')

    expect(resolved.command).toBe(executable)
    expect(resolved.original).toBe('codex')
    expect(resolved.attempted).toContain(executable)
  })

  it('fails with attempted paths for a missing bare command', async () => {
    process.env.PATH = ''

    await expect(resolveCodexExecutable('definitely-not-openmissioncontrol-codex')).rejects.toMatchObject({
      name: 'CodexCliNotFoundError',
      original: 'definitely-not-openmissioncontrol-codex'
    })
  })

  it('fails cleanly for an invalid absolute path', async () => {
    await expect(resolveCodexExecutable('/definitely/missing/codex')).rejects.toBeInstanceOf(CodexCliNotFoundError)
  })
})
