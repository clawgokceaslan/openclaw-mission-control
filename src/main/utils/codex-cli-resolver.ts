import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type CodexExecutableResolution = {
  command: string
  attempted: string[]
  original: string
  envPath: string
  nodeCommand?: string
}

export class CodexCliNotFoundError extends Error {
  readonly code = 'ENOENT'
  readonly attempted: string[]
  readonly original: string

  constructor(original: string, attempted: string[]) {
    super(codexCliNotFoundMessage(original, attempted))
    this.name = 'CodexCliNotFoundError'
    this.original = original
    this.attempted = attempted
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes(sep)
}

function commonExecutableDirs(): string[] {
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(homedir(), '.local/bin'),
    join(homedir(), '.npm-global/bin'),
    join(homedir(), '.bun/bin')
  ]
}

function pathDirs(): string[] {
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean)
}

function executableCandidates(command: string): string[] {
  return unique([...pathDirs(), ...commonExecutableDirs()].map((dir) => join(dir, command)))
}

async function executable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function commandFromLoginShell(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', `command -v -- ${shellSingleQuote(command)}`], {
      timeout: 5_000,
      maxBuffer: 1024 * 64
    })
    const found = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return found ?? null
  } catch {
    return null
  }
}

async function optionalExecutable(command: string): Promise<string | undefined> {
  for (const candidate of executableCandidates(command)) {
    if (await executable(candidate)) return candidate
  }
  const shellCandidate = await commandFromLoginShell(command)
  if (shellCandidate && await executable(shellCandidate)) return shellCandidate
  return undefined
}

function codexEnvPath(command: string, nodeCommand?: string): string {
  return unique([
    dirname(command),
    nodeCommand ? dirname(nodeCommand) : '',
    ...commonExecutableDirs(),
    ...pathDirs()
  ]).join(delimiter)
}

export function codexProcessEnv(resolution: Pick<CodexExecutableResolution, 'envPath'>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: resolution.envPath
  }
}

export function codexCliNotFoundMessage(original: string, attempted: string[]): string {
  const tried = attempted.length > 0 ? ` Tried: ${attempted.join(', ')}.` : ''
  return `Codex CLI not found for "${original}".${tried} Set the Codex command/path in Gateway settings.`
}

export function isCodexCliNotFoundError(error: unknown): error is CodexCliNotFoundError {
  return error instanceof CodexCliNotFoundError || (
    Boolean(error)
      && typeof error === 'object'
      && (error as { code?: unknown }).code === 'ENOENT'
      && Array.isArray((error as { attempted?: unknown }).attempted)
  )
}

export async function resolveCodexExecutable(input?: string): Promise<CodexExecutableResolution> {
  const original = input?.trim() || 'codex'
  const attempted: string[] = []
  const withRuntime = async (command: string): Promise<CodexExecutableResolution> => {
    const nodeCommand = await optionalExecutable('node')
    return { command, attempted: unique(attempted), original, envPath: codexEnvPath(command, nodeCommand), nodeCommand }
  }

  if (isAbsolute(original) || hasPathSeparator(original)) {
    const candidate = isAbsolute(original) ? original : resolve(original)
    attempted.push(candidate)
    if (await executable(candidate)) return withRuntime(candidate)
    throw new CodexCliNotFoundError(original, unique(attempted))
  }

  for (const candidate of executableCandidates(original)) {
    attempted.push(candidate)
    if (await executable(candidate)) return withRuntime(candidate)
  }

  const shellCandidate = await commandFromLoginShell(original)
  if (shellCandidate) {
    attempted.push(shellCandidate)
    if (await executable(shellCandidate)) return withRuntime(shellCandidate)
  }

  throw new CodexCliNotFoundError(original, unique(attempted))
}
